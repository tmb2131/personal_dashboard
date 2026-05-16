"use server";

import * as chrono from "chrono-node";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  formatDateOnlyLocal,
  parseDateOnlyLocalStrict,
  parseDateTimeLocal,
} from "@/lib/date-utils";
import { db, schema } from "@/lib/db";
import { extractProject } from "@/lib/quick-add";
import { isTravelEventsCategory } from "@/lib/utils";
import { logAudit } from "@/lib/sync/audit";
import {
  applyDashboardToggle,
  insertTaskLinkForPair,
  mirrorNotionFromTodoist,
  mirrorTodoistFromNotion,
  refreshTaskLinkHash,
} from "@/lib/sync/orchestrator";
import { pushNotionPageToTodoist, pushTodoistTaskToNotion } from "@/lib/sync/cross-post";
import {
  createNotionProject,
  createNotionProjectSubtask,
  updateNotionFocus,
  updateNotionProjectSubtask,
  updateNotionTaskDate,
  updateNotionTripDates,
  updateNotionTodoStatus,
} from "@/lib/sync/notion";
import { reconcileAllLinks, type ReconcileSummary } from "@/lib/sync/reconcile";
import { getPersonalProjectId, syncTodoist, syncTodoistTasksByIds } from "@/lib/sync/todoist";

export type QuickAddResult = { ok: true; summary?: string } | { ok: false; error: string };
const DEFAULT_QUICK_ADD_PROJECT = "Personal";

function quickAddIdempotencyKey(args: {
  text: string;
  notionProjectPageId: string | null;
  notionProjectTitle: string | null;
}): string {
  return JSON.stringify({
    text: args.text.trim().toLowerCase(),
    notionProjectPageId: args.notionProjectPageId,
    notionProjectTitle: args.notionProjectTitle?.trim().toLowerCase() ?? null,
  });
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
  const dueHasTime = parsed?.start.isCertain("hour") === true;
  const dueDateOnly = dueDate ? formatDateOnlyLocal(dueDate) : null;
  const content = parsed
    ? (text.slice(0, parsed.index) + text.slice(parsed.index + parsed.text.length)).replace(/\s+/g, " ").trim()
    : text;

  const api = new TodoistApi(process.env.TODOIST_TOKEN);

  const selectedNotionProjectId = opts?.notionProjectPageId?.trim() || null;
  const selectedNotionProjectTitle = opts?.notionProjectTitle?.trim() || null;
  const idempotencyKey = quickAddIdempotencyKey({
    text: content,
    notionProjectPageId: selectedNotionProjectId,
    notionProjectTitle: selectedNotionProjectTitle,
  });
  const [prior] = await db
    .select({ id: schema.auditLog.id, payload: schema.auditLog.payload })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.source, "dashboard"),
        eq(schema.auditLog.op, "quick_add_success"),
        sql`payload->>'idempotencyKey' = ${idempotencyKey}`,
        sql`${schema.auditLog.ts} > now() - interval '2 minutes'`,
      ),
    )
    .limit(1);
  if (prior) {
    return { ok: true, summary: "Already added recently" };
  }

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
      ? dueHasTime
        ? { ...baseArgs, dueDatetime: dueDate.toISOString() }
        : { ...baseArgs, dueDate: dueDateOnly! }
      : baseArgs;
    const created = await api.addTask(args as Parameters<typeof api.addTask>[0]);

    if (selectedNotionProjectId) {
      try {
        const { pageId } = await createNotionProjectSubtask({
          notionParentPageId: selectedNotionProjectId,
          title: content,
          dueDate: dueDateOnly,
        });
        await syncTodoistTasksByIds([created.id]);
        await insertTaskLinkForPair(pageId, created.id);
      } catch (e) {
        await logAudit({
          source: "dashboard",
          op: "quick_add_partial",
          payload: { idempotencyKey, todoistTaskId: created.id },
          error: (e as Error).message,
        });
        throw e;
      }
    } else {
      await syncTodoist().catch(() => {});
    }

    await logAudit({
      source: "dashboard",
      op: "quick_add_success",
      payload: { idempotencyKey, todoistTaskId: created.id },
    });

    return {
      ok: true,
      summary: created.content + (dueDate ? ` · ${dueDate.toLocaleDateString()}` : ""),
    };
  } catch (e) {
    await logAudit({
      source: "dashboard",
      op: "quick_add_error",
      payload: { idempotencyKey },
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}

export type CrossPostResult = { ok: true } | { ok: false; error: string };

async function updateTodoistTaskDueViaRest(args: {
  token: string;
  taskId: string;
  payload: { due_date?: string; due_datetime?: string; due_string?: string };
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

type DueInput = {
  dueDate: string | null;
  dueTime: string | null;
  dueAt: Date | null;
  todoistPayload: { due_date?: string; due_datetime?: string; due_string?: string };
};

function parseDueInput(dueDateInput: string | null, dueTimeInput?: string | null): DueInput {
  const dueDate = dueDateInput?.trim() || null;
  const dueTime = dueTimeInput?.trim() || null;

  if (!dueDate) {
    if (dueTime) throw new Error("Choose a date before setting a time");
    return {
      dueDate: null,
      dueTime: null,
      dueAt: null,
      todoistPayload: { due_string: "no date" },
    };
  }

  if (dueTime) {
    const dueAt = parseDateTimeLocal(dueDate, dueTime);
    if (!dueAt) throw new Error("Invalid date/time");
    return {
      dueDate,
      dueTime,
      dueAt,
      todoistPayload: { due_datetime: dueAt.toISOString() },
    };
  }

  const dueAt = parseDateOnlyLocalStrict(dueDate);
  return {
    dueDate,
    dueTime: null,
    dueAt,
    todoistPayload: { due_date: dueDate },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function patchTodoistDueCache(taskId: string, due: DueInput) {
  const [task] = await db
    .select({ raw: schema.todoistTasks.raw })
    .from(schema.todoistTasks)
    .where(eq(schema.todoistTasks.id, taskId));
  const raw = asRecord(task?.raw);
  const existingDue = asRecord(raw.due);

  if (due.dueDate) {
    const nextDue: Record<string, unknown> = {
      ...existingDue,
      date: due.dueDate,
      string: due.dueDate,
    };
    if (typeof existingDue.isRecurring === "boolean") nextDue.isRecurring = existingDue.isRecurring;
    if (due.dueTime && due.dueAt) {
      nextDue.datetime = due.dueAt.toISOString();
    } else {
      delete nextDue.datetime;
    }
    raw.due = nextDue;
  } else {
    raw.due = null;
  }

  await db
    .update(schema.todoistTasks)
    .set({
      dueDate: due.dueAt,
      dueString: due.dueDate,
      raw,
      updatedAt: new Date(),
    })
    .where(eq(schema.todoistTasks.id, taskId));
}

async function patchNotionDueCache(pageId: string, due: DueInput) {
  await db
    .update(schema.notionPages)
    .set({
      dateStart: due.dueAt,
      dateEnd: null,
      dateIsDatetime: Boolean(due.dueTime),
      updatedAt: new Date(),
    })
    .where(eq(schema.notionPages.id, pageId));
}

async function patchNotionTripDatesCache(
  pageId: string,
  dates: { dateStart: Date | null; dateEnd: Date | null },
) {
  await db
    .update(schema.notionPages)
    .set({
      dateStart: dates.dateStart,
      dateEnd: dates.dateEnd,
      dateIsDatetime: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.notionPages.id, pageId));
}

function normalizeOptionalYyyyMmDd(value: string | null | undefined): string | null {
  const t = value?.trim() ?? "";
  return t || null;
}

async function resolveDueTaskLink(args: {
  notionPageId?: string | null;
  todoistTaskId?: string | null;
}) {
  if (args.notionPageId) {
    const [link] = await db
      .select()
      .from(schema.taskLinks)
      .where(eq(schema.taskLinks.notionPageId, args.notionPageId));
    if (link) return link;
  }
  if (args.todoistTaskId) {
    const [link] = await db
      .select()
      .from(schema.taskLinks)
      .where(eq(schema.taskLinks.todoistTaskId, args.todoistTaskId));
    if (link) return link;
  }
  return null;
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
  todoistTaskId?: string | null;
  notionPageId?: string | null;
  dueDate: string | null;
  dueTime?: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  let pendingLinkId: string | null = null;

  try {
    const requestedTodoistTaskId = args.todoistTaskId?.trim() || null;
    const requestedNotionPageId = args.notionPageId?.trim() || null;
    const link = await resolveDueTaskLink({
      todoistTaskId: requestedTodoistTaskId,
      notionPageId: requestedNotionPageId,
    });
    const todoistTaskId = requestedTodoistTaskId ?? link?.todoistTaskId ?? null;
    const notionPageId = requestedNotionPageId ?? link?.notionPageId ?? null;
    const todoistToken = process.env.TODOIST_TOKEN;
    const notionToken = process.env.NOTION_TOKEN;

    if (!todoistTaskId && !notionPageId) return { ok: false, error: "Missing task" };
    if (todoistTaskId && !todoistToken) {
      return { ok: false, error: "TODOIST_TOKEN missing" };
    }
    if (notionPageId && !notionToken) {
      return { ok: false, error: "NOTION_TOKEN missing" };
    }

    const due = parseDueInput(args.dueDate, args.dueTime ?? null);

    if (link) {
      pendingLinkId = link.id;
      await db
        .update(schema.taskLinks)
        .set({ pendingOrigin: "dashboard" })
        .where(eq(schema.taskLinks.id, link.id));
    }

    if (todoistTaskId) {
      await updateTodoistTaskDueViaRest({
        token: todoistToken!,
        taskId: todoistTaskId,
        payload: due.todoistPayload,
      });
      await syncTodoistTasksByIds([todoistTaskId]).catch(() => {});
      await patchTodoistDueCache(todoistTaskId, due);
    }
    if (notionPageId) {
      await updateNotionTaskDate(
        notionPageId,
        due.dueDate ? { dueDate: due.dueDate, dueTime: due.dueTime } : null,
      );
      await patchNotionDueCache(notionPageId, due);
    }

    // If the pair is linked, run a mirror to catch any other field drift in the same request.
    // Picks the direction by whichever side we touched (or Notion when both sides hit).
    if (link) {
      try {
        if (notionPageId) await mirrorTodoistFromNotion(notionPageId);
        else if (todoistTaskId) await mirrorNotionFromTodoist(todoistTaskId);
      } catch (e) {
        await logAudit({
          source: "dashboard",
          op: "set_task_due_mirror_error",
          payload: { todoistTaskId, notionPageId },
          error: (e as Error).message,
        });
      }
      await refreshTaskLinkHash(link.id);
    }
    await logAudit({
      source: "dashboard",
      op: "set_task_due",
      payload: { todoistTaskId, notionPageId, dueDate: due.dueDate, dueTime: due.dueTime },
    });
    return { ok: true };
  } catch (e) {
    if (pendingLinkId) {
      await db
        .update(schema.taskLinks)
        .set({ pendingOrigin: null })
        .where(eq(schema.taskLinks.id, pendingLinkId));
    }
    await logAudit({
      source: "dashboard",
      op: "set_task_due_error",
      payload: args,
      error: (e as Error).message,
    });
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

export async function setTodoistTaskContentAction(args: {
  todoistTaskId: string;
  content: string;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.todoistTaskId) return { ok: false, error: "Missing Todoist task" };
  if (!args.content.trim()) return { ok: false, error: "Task title is required" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };

  try {
    const api = new TodoistApi(process.env.TODOIST_TOKEN);
    await api.updateTask(args.todoistTaskId, { content: args.content.trim() });
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
  description?: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionParentPageId) return { ok: false, error: "Missing project page" };
  if (!args.title.trim()) return { ok: false, error: "Task title is required" };
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };
  if (!process.env.TODOIST_TOKEN) return { ok: false, error: "TODOIST_TOKEN missing" };

  try {
    const description = args.description?.trim() ?? "";
    const { pageId } = await createNotionProjectSubtask({
      ...args,
      description,
    });

    const api = new TodoistApi(process.env.TODOIST_TOKEN);
    const projects = (await (api as unknown as {
      getProjects: () => Promise<{ id: string; name: string }[] | { results: { id: string; name: string }[] }>;
    }).getProjects()) as { id: string; name: string }[] | { results: { id: string; name: string }[] };
    const list = Array.isArray(projects) ? projects : projects.results;
    const notionProject = list.find((p) => p.name.toLowerCase() === "notion");
    const projectId = notionProject?.id ?? (await getPersonalProjectId());

    const basePayload = {
      content: args.title.trim(),
      projectId,
      ...(description ? { description } : {}),
    };
    const payload: Parameters<typeof api.addTask>[0] = args.dueDate
      ? { ...basePayload, dueDate: args.dueDate }
      : basePayload;
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
  description?: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionPageId) return { ok: false, error: "Missing task page" };
  if (!args.title.trim()) return { ok: false, error: "Task title is required" };
  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };
  let pendingLinkId: string | null = null;

  try {
    const description = args.description?.trim() ?? "";
    const due = parseDueInput(args.dueDate, null);
    const [link] = await db
      .select()
      .from(schema.taskLinks)
      .where(eq(schema.taskLinks.notionPageId, args.notionPageId));
    const todoistToken = process.env.TODOIST_TOKEN;
    if (link && !todoistToken) {
      return { ok: false, error: "TODOIST_TOKEN missing" };
    }

    await updateNotionProjectSubtask({
      ...args,
      description,
    });

    if (link && todoistToken) {
      const api = new TodoistApi(todoistToken);
      pendingLinkId = link.id;
      await db
        .update(schema.taskLinks)
        .set({ pendingOrigin: "dashboard" })
        .where(eq(schema.taskLinks.id, link.id));
      await api.updateTask(link.todoistTaskId, { content: args.title.trim(), description });
      await updateTodoistTaskDueViaRest({
        token: todoistToken,
        taskId: link.todoistTaskId,
        payload: due.todoistPayload,
      });
      await syncTodoistTasksByIds([link.todoistTaskId]).catch(() => {});
      await patchTodoistDueCache(link.todoistTaskId, due);
      await refreshTaskLinkHash(link.id);
    }
    return { ok: true };
  } catch (e) {
    if (pendingLinkId) {
      await db
        .update(schema.taskLinks)
        .set({ pendingOrigin: null })
        .where(eq(schema.taskLinks.id, pendingLinkId));
    }
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

export async function createTripAction(args: {
  title: string;
  dateStart: string | null;
  dateEnd: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.title.trim()) return { ok: false, error: "Trip title is required" };

  const dateStart = normalizeOptionalYyyyMmDd(args.dateStart);
  const dateEnd = normalizeOptionalYyyyMmDd(args.dateEnd);
  if (dateEnd && !dateStart) return { ok: false, error: "End date requires a start date" };
  if (dateStart && dateEnd) {
    const a = parseDateOnlyLocalStrict(dateStart);
    const b = parseDateOnlyLocalStrict(dateEnd);
    if (b.getTime() < a.getTime()) {
      return { ok: false, error: "End date must be on or after start date" };
    }
  }

  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };

  try {
    const categories = await db.select().from(schema.notionCategories);
    const travel = categories.find((c) => isTravelEventsCategory(c.title));
    if (!travel) return { ok: false, error: "Travel/Events category not found" };

    await createNotionProject({
      title: args.title.trim(),
      categoryId: travel.id,
      focus: "No",
      dateStart,
      dateEnd,
    });
    await logAudit({ source: "dashboard", op: "create_trip", payload: args });
    return { ok: true };
  } catch (e) {
    await logAudit({
      source: "dashboard",
      op: "create_trip_error",
      payload: args,
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}

export async function setTripDatesAction(args: {
  notionPageId: string;
  dateStart: string | null;
  dateEnd: string | null;
}): Promise<CrossPostResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  if (!args.notionPageId?.trim()) return { ok: false, error: "Missing Notion page" };

  const dateStart = normalizeOptionalYyyyMmDd(args.dateStart);
  const dateEnd = normalizeOptionalYyyyMmDd(args.dateEnd);
  if (dateEnd && !dateStart) return { ok: false, error: "End date requires a start date" };
  if (dateStart && dateEnd) {
    const a = parseDateOnlyLocalStrict(dateStart);
    const b = parseDateOnlyLocalStrict(dateEnd);
    if (b.getTime() < a.getTime()) {
      return { ok: false, error: "End date must be on or after start date" };
    }
  }

  if (!process.env.NOTION_TOKEN) return { ok: false, error: "NOTION_TOKEN missing" };

  try {
    await updateNotionTripDates(args.notionPageId, { dateStart, dateEnd });

    await patchNotionTripDatesCache(args.notionPageId, {
      dateStart: dateStart ? parseDateOnlyLocalStrict(dateStart) : null,
      dateEnd: dateEnd ? parseDateOnlyLocalStrict(dateEnd) : null,
    });

    await logAudit({ source: "dashboard", op: "set_trip_dates", payload: args });
    return { ok: true };
  } catch (e) {
    await logAudit({
      source: "dashboard",
      op: "set_trip_dates_error",
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

    // Push through to Todoist if this Notion page is linked. We don't rely on Notion's own
    // webhook to round-trip the change — Vercel can drop async-after-200 work.
    const [link] = await db
      .select({ id: schema.taskLinks.id })
      .from(schema.taskLinks)
      .where(eq(schema.taskLinks.notionPageId, args.notionPageId));
    if (link && process.env.TODOIST_TOKEN) {
      try {
        await mirrorTodoistFromNotion(args.notionPageId);
      } catch (e) {
        await logAudit({
          source: "dashboard",
          op: "set_project_status_mirror_error",
          payload: args,
          error: (e as Error).message,
        });
      }
    }

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

export type ReconcileResult =
  | ({ ok: true } & ReconcileSummary)
  | { ok: false; error: string };

/** Manual "reconcile sync" trigger from the dashboard. */
export async function reconcileSyncAction(): Promise<ReconcileResult> {
  const session = await auth();
  if (!session) return { ok: false, error: "Not signed in" };
  try {
    const summary = await reconcileAllLinks();
    return { ok: true, ...summary };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
