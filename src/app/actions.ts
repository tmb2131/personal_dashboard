"use server";

import * as chrono from "chrono-node";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { auth } from "@/lib/auth";
import { applyDashboardToggle } from "@/lib/sync/orchestrator";
import { pushNotionPageToTodoist, pushTodoistTaskToNotion } from "@/lib/sync/cross-post";
import { syncTodoist } from "@/lib/sync/todoist";

export type QuickAddResult = { ok: true; summary?: string } | { ok: false; error: string };

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

  let projectId: string | undefined;
  if (projectName) {
    const projects = (await (api as unknown as {
      getProjects: () => Promise<{ id: string; name: string }[] | { results: { id: string; name: string }[] }>;
    }).getProjects()) as { id: string; name: string }[] | { results: { id: string; name: string }[] };
    const list = Array.isArray(projects) ? projects : projects.results;
    const match = list.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
    projectId = match?.id;
  }

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
