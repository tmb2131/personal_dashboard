"use server";

import * as chrono from "chrono-node";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { insertTaskLinkForPair } from "@/lib/sync/orchestrator";
import { applyDashboardToggle } from "@/lib/sync/orchestrator";
import { pushNotionPageToTodoist, pushTodoistTaskToNotion } from "@/lib/sync/cross-post";
import {
  createNotionProject,
  createNotionProjectSubtask,
  updateNotionFocus,
  updateNotionProjectSubtask,
  updateNotionTodoStatus,
} from "@/lib/sync/notion";
import { getPersonalProjectId, syncTodoist, syncTodoistTasksByIds } from "@/lib/sync/todoist";

export type QuickAddResult = { ok: true; summary?: string } | { ok: false; error: string };
const DEFAULT_QUICK_ADD_PROJECT = "Personal";

// Parses "@my-project" out of the input, returns `{ text, projectName }`.
function extractProject(s: string): { text: string; projectName: string | null } {
  const bracket = s.match(/(^|\s)@\{([^}]+)\}/);
  if (bracket) {
    const projectName = bracket[2].trim();
    const text = s.replace(bracket[0], "").trim();
    return { text, projectName: projectName || null };
  }
  const m = s.match(/(^|\s)@([\w-]+)/);
  if (!m) return { text: s.trim(), projectName: null };
  const projectName = m[2].replace(/-/g, " ").trim();
  const text = s.replace(m[0], "").trim();
  return { text, projectName };
}

export async function quickAddAction(
  raw: string,
  opts?: { notionProjectPageId?: string | null; notionProjectTitle?: string | null },
): Promise<QuickAddResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };

  const { text, projectName } = extractProject(raw);
  if (!text) return { ok: false, error: "Empty task" };

  // chrono-node parses dates from natural language. We strip the matched date span
  // so the task content stays clean ("reply to investor" rather than "reply to investor tomorrow 9am").
  const parsed = chrono.parse(text, new Date(), { forwardDate: true })[0];
  const dueDate = parsed?.start.date() ?? null;
  const content = parsed
    ? (text.slice(0, parsed.index) + text.slice(parsed.index + parsed.text.length)).replace(/\s+/g, " ").trim()
    : text;

  const api = new TodoistApi(process.env.TODOIST_TOKEN);

  const selectedNotionProjectId = opts?.notionProjectPageId?.trim() || null;
  const selectedNotionProjectTitle = opts?.notionProjectTitle?.trim() || null;
  const targetProjectName = selectedNotionProjectId ? "Notion" : (projectName ?? DEFAULT_QUICK_ADD_PROJECT);
  const projects = (await (api as unknown as {
    getProjects: () => Promise<{ id: string; name: string }[] | { results: { id: string; name: string }[] }>;
  }).getProjects()) as { id: string; name: string }[] | { results: { id: string; name: string }[] };
  const list = Array.isArray(projects) ? projects : projects.results;
  const match = list.find((p) => p.name.toLowerCase() === targetProjectName.toLowerCase());
  const projectId = selectedNotionProjectId ? (match?.id ?? (await getPersonalProjectId())) : match?.id;

  try {
    const projectLabel = selectedNotionProjectTitle ?? projectName ?? null;
    const labels = projectLabel ? [projectLabel.slice(0, 60)] : undefined;
    const baseArgs = { content, ...(projectId ? { projectId } : {}), ...(labels ? { labels } : {}) };
    const args = dueDate
      ? { ...baseArgs, dueDatetime: dueDate.toISOString() }
      : baseArgs;
    const created = await api.addTask(args as Parameters<typeof api.addTask>[0]);

    if (selectedNotionProjectId) {
      const { pageId } = await createNotionProjectSubtask({
        notionParentPageId: selectedNotionProjectId,
        title: content,
        dueDate: dueDate
          ? `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`
          : null,
      });
      await syncTodoistTasksByIds([created.id]);
      await insertTaskLinkForPair(pageId, created.id);
    } else {
      await syncTodoist().catch(() => {});
    }

    return {
      ok: true,
      summary: created.content + (dueDate ? ` · ${dueDate.toLocaleDateString()}` : ""),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type CrossPostResult = { ok: true } | { ok: false; error: string };

async function updateTodoistTaskDueViaRest(args: {
  token: string;
  taskId: string;
  payload: { due_datetime?: string; due_string?: string };
}) {
  let lastError = "Todoist update failed";
  const endpoints = [
    `https://api.todoist.com/api/v1/tasks/${args.taskId}`,
    `https://api.todoist.com/rest/v2/tasks/${args.taskId}`,
  ];

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args.payload),
        cache: "no-store",
      });

      if (res.ok) return;
      const body = await res.text().catch(() => "");
      lastError = body || `HTTP ${res.status}: ${res.statusText}`;

      // Todoist occasionally returns transient 5xx responses; retry once.
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      break;
    }
  }
  throw new Error(lastError);
}

export async function pushNotionTaskToTodoistAction(notionPageId: string): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!notionPageId) return { ok: false, error: "Missing Notion page" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };
  try {
    await pushNotionPageToTodoist(notionPageId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function pushTodoistTaskToNotionAction(args: {
  todoistTaskId: string;
  notionParentPageId: string;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.todoistTaskId || !args.notionParentPageId) {
    return { ok: false, error: "Missing task or parent" };
  }
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };
  try {
    await pushTodoistTaskToNotion(args.todoistTaskId, args.notionParentPageId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Toggle a task's done state. Updates Todoist + Notion APIs, linked mirrors, cache.
export async function toggleTaskDoneAction(args: {
  notionPageId: string | null;
  todoistTaskId: string | null;
  done: boolean;
}) {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" } as const;

  if (args.notionPageId && !process.env.NOTION_TOKEN) {
    return { ok: false, error: "NOTION_TOKEN missing" } as const;
  }
  if (args.todoistTaskId && !process.env.TODOIST_TOKEN) {
    return { ok: false, error: "TODOIST_TOKEN missing" } as const;
  }

  try {
    await applyDashboardToggle(args);
    return { ok: true } as const;
  } catch (e) {
    return { ok: false, error: (e as Error).message } as const;
  }
}

export async function setProjectFocusAction(args: {
  notionPageId: string;
  focus: "Yes" | "No";
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionPageId) return { ok: false, error: "Missing Notion page" };
  if (args.focus !== "Yes" && args.focus !== "No") {
    return { ok: false, error: "Invalid focus value" };
  }
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };

  try {
    await updateNotionFocus(args.notionPageId, args.focus);
    await db
      .update(schema.notionPages)
      .set({ focus: args.focus, updatedAt: new Date() })
      .where(eq(schema.notionPages.id, args.notionPageId));
    await logAudit({
      source: "dashboard",
      op: "set_project_focus",
      payload: args,
    });
    return { ok: true };
  } catch (e) {
    await logAudit({
      source: "dashboard",
      op: "set_project_focus_error",
      payload: args,
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}

export async function setTodoistTaskDueAction(args: {
  todoistTaskId: string;
  dueDatetime: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.todoistTaskId) return { ok: false, error: "Missing Todoist task" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };

  try {
    if (args.dueDatetime == null) {
      await updateTodoistTaskDueViaRest({
        token: process.env.TODOIST_TOKEN,
        taskId: args.todoistTaskId,
        payload: { due_string: "no date" },
      });
    } else {
      const parsed = new Date(args.dueDatetime);
      if (Number.isNaN(parsed.getTime())) return { ok: false, error: "Invalid date/time" };
      await updateTodoistTaskDueViaRest({
        token: process.env.TODOIST_TOKEN,
        taskId: args.todoistTaskId,
        payload: { due_datetime: parsed.toISOString() },
      });
    }

    await syncTodoist().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setTodoistTaskDescriptionAction(args: {
  todoistTaskId: string;
  description: string;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.todoistTaskId) return { ok: false, error: "Missing Todoist task" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };

  try {
    const api = new TodoistApi(process.env.TODOIST_TOKEN);
    await api.updateTask(args.todoistTaskId, { description: args.description.trim() || "" });
    await syncTodoistTasksByIds([args.todoistTaskId]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function createProjectSubtaskAction(args: {
  notionParentPageId: string;
  title: string;
  dueDate: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionParentPageId) return { ok: false, error: "Missing project page" };
  if (!args.title.trim()) return { ok: false, error: "Task title is required" };
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };

  try {
    const { pageId } = await createNotionProjectSubtask(args);

    const api = new TodoistApi(process.env.TODOIST_TOKEN);
    const projects = (await (api as unknown as {
      getProjects: () => Promise<{ id: string; name: string }[] | { results: { id: string; name: string }[] }>;
    }).getProjects()) as { id: string; name: string }[] | { results: { id: string; name: string }[] };
    const list = Array.isArray(projects) ? projects : projects.results;
    const notionProject = list.find((p) => p.name.toLowerCase() === "notion");
    const projectId = notionProject?.id ?? (await getPersonalProjectId());

    const payload: Parameters<typeof api.addTask>[0] = args.dueDate
      ? { content: args.title.trim(), projectId, dueDate: args.dueDate }
      : { content: args.title.trim(), projectId };
    const created = await api.addTask(payload);
    await syncTodoistTasksByIds([created.id]);
    await insertTaskLinkForPair(pageId, created.id);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateProjectSubtaskAction(args: {
  notionPageId: string;
  title: string;
  dueDate: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionPageId) return { ok: false, error: "Missing task page" };
  if (!args.title.trim()) return { ok: false, error: "Task title is required" };
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };

  try {
    await updateNotionProjectSubtask(args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function createProjectAction(args: {
  title: string;
  categoryId: string | null;
  focus: "Yes" | "No";
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.title.trim()) return { ok: false, error: "Project title is required" };
  if (args.focus !== "Yes" && args.focus !== "No") {
    return { ok: false, error: "Invalid focus value" };
  }
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };

  try {
    await createNotionProject({
      title: args.title.trim(),
      categoryId: args.categoryId?.trim() || null,
      focus: args.focus,
    });
    await logAudit({ source: "dashboard", op: "create_project", payload: args });
    return { ok: true };
  } catch (e) {
    await logAudit({
      source: "dashboard",
      op: "create_project_error",
      payload: args,
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}

export async function setProjectStatusAction(args: {
  notionPageId: string;
  status: "Not started" | "In progress" | "Done";
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionPageId) return { ok: false, error: "Missing Notion page" };
  if (!["Not started", "In progress", "Done"].includes(args.status)) {
    return { ok: false, error: "Invalid status" };
  }
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };

  try {
    await updateNotionTodoStatus(args.notionPageId, args.status);
    await db
      .update(schema.notionPages)
      .set({ status: args.status, updatedAt: new Date() })
      .where(eq(schema.notionPages.id, args.notionPageId));
    await logAudit({
      source: "dashboard",
      op: "set_project_status",
      payload: args,
    });
    return { ok: true };
  } catch (e) {
    await logAudit({
      source: "dashboard",
      op: "set_project_status_error",
      payload: args,
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}
