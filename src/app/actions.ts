"use server";

import * as chrono from "chrono-node";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { applyDashboardToggle } from "@/lib/sync/orchestrator";
import { pushNotionPageToTodoist, pushTodoistTaskToNotion } from "@/lib/sync/cross-post";
import {
  createNotionProjectSubtask,
  updateNotionFocus,
  updateNotionProjectSubtask,
} from "@/lib/sync/notion";
import { syncTodoist } from "@/lib/sync/todoist";

export type QuickAddResult = { ok: true; summary?: string } | { ok: false; error: string };
const DEFAULT_QUICK_ADD_PROJECT = "Personal";

// Parses "@my-project" out of the input, returns `{ text, projectName }`.
function extractProject(s: string): { text: string; projectName: string | null } {
  const m = s.match(/(^|\s)@([\w-]+)/);
  if (!m) return { text: s.trim(), projectName: null };
  const projectName = m[2].replace(/-/g, " ");
  const text = s.replace(m[0], "").trim();
  return { text, projectName };
}

export async function quickAddAction(raw: string): Promise<QuickAddResult> {
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

  const targetProjectName = projectName ?? DEFAULT_QUICK_ADD_PROJECT;
  const projects = (await (api as unknown as {
    getProjects: () => Promise<{ id: string; name: string }[] | { results: { id: string; name: string }[] }>;
  }).getProjects()) as { id: string; name: string }[] | { results: { id: string; name: string }[] };
  const list = Array.isArray(projects) ? projects : projects.results;
  const match = list.find((p) => p.name.toLowerCase() === targetProjectName.toLowerCase());
  const projectId = match?.id;

  try {
    const baseArgs = { content, ...(projectId ? { projectId } : {}) };
    const args = dueDate
      ? { ...baseArgs, dueDatetime: dueDate.toISOString() }
      : baseArgs;
    const created = await api.addTask(args as Parameters<typeof api.addTask>[0]);

    await syncTodoist().catch(() => {});

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

  try {
    await createNotionProjectSubtask(args);
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
