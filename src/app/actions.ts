"use server";

import * as chrono from "chrono-node";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
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

// Toggle a task's done state. Updates the source-of-truth (Notion or Todoist),
// the linked counterpart if any, and the local cache.
export async function toggleTaskDoneAction(args: {
  notionPageId: string | null;
  todoistTaskId: string | null;
  done: boolean;
}) {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" } as const;

  // M3 will own the propagation logic. For now we only mutate the local cache so
  // the dashboard reflects the click; the next webhook tick (or cron) reconciles
  // with sources. This keeps M2 self-contained while M3 is in progress.
  if (args.notionPageId) {
    await db
      .update(schema.notionPages)
      .set({ status: args.done ? "Done" : "Not started" })
      .where(eq(schema.notionPages.id, args.notionPageId));
  }
  if (args.todoistTaskId) {
    await db
      .update(schema.todoistTasks)
      .set({ checked: args.done })
      .where(eq(schema.todoistTasks.id, args.todoistTaskId));
  }
  return { ok: true } as const;
}
