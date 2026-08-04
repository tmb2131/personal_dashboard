/**
 * Link-aware sync orchestration (M3): mirror Notion ↔ Todoist for paired tasks,
 * reconcile hashes on `task_links`, recurring-instance repair, and audit trails.
 *
 * Conflict policy: callers upsert the authoritative side first; this module pushes
 * the mirror side to match using `mappings.ts`.
 */

import { TodoistApi } from "@doist/todoist-api-typescript";
import { and, eq, sql } from "drizzle-orm";
import { formatDateOnlyLocal } from "@/lib/date-utils";
import { todoistDueHasTime, type TodoistDueLike } from "@/lib/todoist-due";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import {
  IN_PROGRESS_LABEL,
  notionStatusFromTodoist,
  PRIORITY_NOTION_TO_TODOIST,
  PRIORITY_TODOIST_TO_NOTION,
  syncHash,
  todoistCheckedFromNotion,
  type NotionPage,
  type TodoistTask,
} from "@/lib/sync/mappings";
import { updateNotionTodoFields, updateNotionTodoStatus } from "@/lib/sync/notion";
import { mapTodoistTaskToRow } from "@/lib/sync/todoist";

function todoistApi() {
  const token = process.env.TODOIST_TOKEN;
  if (!token) throw new Error("TODOIST_TOKEN missing");
  return new TodoistApi(token);
}

/** Labels to apply on Todoist for an open task so it reflects Notion status. */
export function mergeLabelsForNotion(
  current: string[] | null | undefined,
  page: NotionPage,
): string[] {
  if (page.status === "Done") return current ?? [];
  const without = (current ?? []).filter((l) => l !== IN_PROGRESS_LABEL);
  if (page.status === "In progress") {
    if (!without.includes(IN_PROGRESS_LABEL)) without.push(IN_PROGRESS_LABEL);
    return without;
  }
  return without;
}

export function hashForPair(page: NotionPage, task: TodoistTask): string {
  return syncHash({
    title: page.title,
    status: page.status,
    date: page.dateStart,
    deadline: page.deadline,
    priority: page.priority,
    categoryOrProjectId: page.categoryId ?? task.projectId ?? null,
    todoist: {
      content: task.content,
      checked: task.checked,
      dueDate: task.dueDate,
      deadline: task.deadline,
      priority: task.priority,
    },
  });
}

export async function refreshTaskLinkHash(linkId: string) {
  const [link] = await db.select().from(schema.taskLinks).where(eq(schema.taskLinks.id, linkId));
  if (!link) return;
  const [page] = await db
    .select()
    .from(schema.notionPages)
    .where(eq(schema.notionPages.id, link.notionPageId));
  const [task] = await db
    .select()
    .from(schema.todoistTasks)
    .where(eq(schema.todoistTasks.id, link.todoistTaskId));
  if (!page || !task) return;
  const h = hashForPair(page as NotionPage, task as TodoistTask);
  await db
    .update(schema.taskLinks)
    .set({ lastSyncHash: h, lastSyncAt: new Date(), pendingOrigin: null })
    .where(eq(schema.taskLinks.id, linkId));
}

/** Insert one `task_links` row after both sides exist in the DB (e.g. cross-post create). */
export async function insertTaskLinkForPair(
  notionPageId: string,
  todoistTaskId: string,
): Promise<{ linkId: string }> {
  const [page] = await db.select().from(schema.notionPages).where(eq(schema.notionPages.id, notionPageId));
  const [task] = await db.select().from(schema.todoistTasks).where(eq(schema.todoistTasks.id, todoistTaskId));
  if (!page || !task) throw new Error("Missing Notion page or Todoist task for link");
  const h = hashForPair(page as NotionPage, task as TodoistTask);
  const linkId = crypto.randomUUID();
  await db.insert(schema.taskLinks).values({
    id: linkId,
    notionPageId,
    todoistTaskId,
    lastSyncHash: h,
    lastSyncAt: new Date(),
    pendingOrigin: "dashboard",
  });
  await refreshTaskLinkHash(linkId);
  return { linkId };
}

const TODOIST_TASK_UPSERT_SET = {
  projectId: sql`excluded.project_id`,
  parentId: sql`excluded.parent_id`,
  content: sql`excluded.content`,
  description: sql`excluded.description`,
  dueDate: sql`excluded.due_date`,
  dueString: sql`excluded.due_string`,
  dueIsRecurring: sql`excluded.due_is_recurring`,
  deadline: sql`excluded.deadline`,
  priority: sql`excluded.priority`,
  checked: sql`excluded.checked`,
  labels: sql`excluded.labels`,
  raw: sql`excluded.raw`,
  updatedAt: sql`excluded.updated_at`,
} as const;

/** Read `task.raw.due` to determine if the Todoist due carries a time component. */
function todoistDueIsDatetime(task: TodoistTask): boolean {
  if (!task.dueDate) return false;
  const raw = task.raw as { due?: TodoistDueLike } | null;
  return todoistDueHasTime(raw?.due);
}

async function refetchAndUpsertTodoistTask(api: TodoistApi, todoistTaskId: string) {
  const fresh = await api.getTask(todoistTaskId);
  const row = mapTodoistTaskToRow(
    fresh as unknown as Parameters<typeof mapTodoistTaskToRow>[0],
    new Date(),
  );
  await db.insert(schema.todoistTasks).values(row).onConflictDoUpdate({
    target: schema.todoistTasks.id,
    set: TODOIST_TASK_UPSERT_SET,
  });
}

/**
 * Build the Todoist updateTask payload for fields that differ between the Notion page
 * and the cached Todoist task. Returns null if nothing needs to change.
 */
function buildTodoistFieldDiff(
  page: NotionPage,
  task: TodoistTask,
): { args: Record<string, unknown>; changedFields: string[] } | null {
  const args: Record<string, unknown> = {};
  const changed: string[] = [];

  if (page.title !== task.content) {
    args.content = page.title;
    changed.push("content");
  }

  // Date diff: Notion `dateStart` + `dateIsDatetime` ↔ Todoist `dueDate`. The Todoist API
  // requires `dueDate` (YYYY-MM-DD) XOR `dueDatetime` (ISO), and we use `dueString: "no date"`
  // to clear.
  const taskHasDate = task.dueDate != null;
  const pageHasDate = page.dateStart != null;
  if (!pageHasDate && taskHasDate) {
    args.dueString = "no date";
    changed.push("due");
  } else if (pageHasDate) {
    if (page.dateIsDatetime) {
      const iso = page.dateStart!.toISOString();
      if (task.dueDate?.getTime() !== page.dateStart!.getTime() || !task.dueString?.includes("T")) {
        args.dueDatetime = iso;
        changed.push("due");
      }
    } else {
      const ymd = formatDateOnlyLocal(page.dateStart!);
      const taskYmd = task.dueDate ? formatDateOnlyLocal(task.dueDate) : null;
      if (taskYmd !== ymd) {
        args.dueDate = ymd;
        changed.push("due");
      }
    }
  }

  const wantPriority = page.priority ? PRIORITY_NOTION_TO_TODOIST[page.priority] : 1;
  if (wantPriority !== task.priority) {
    args.priority = wantPriority;
    changed.push("priority");
  }

  if (changed.length === 0) return null;
  return { args, changedFields: changed };
}

/** After Notion is authoritative in DB: sync Todoist completion, labels, title, due, priority. */
export async function mirrorTodoistFromNotion(notionPageId: string): Promise<void> {
  const [link] = await db
    .select()
    .from(schema.taskLinks)
    .where(eq(schema.taskLinks.notionPageId, notionPageId));
  if (!link) return;

  const [page] = await db
    .select()
    .from(schema.notionPages)
    .where(eq(schema.notionPages.id, notionPageId));
  const [task] = await db
    .select()
    .from(schema.todoistTasks)
    .where(eq(schema.todoistTasks.id, link.todoistTaskId));
  if (!page || !task) return;

  // Echo short-circuit: if both sides already match the hash and there's no in-flight write,
  // a webhook fired by our own previous push has nothing to do.
  const currentHash = hashForPair(page as NotionPage, task as TodoistTask);
  if (link.pendingOrigin == null && currentHash === link.lastSyncHash) {
    return;
  }

  const p = page as NotionPage;
  const api = todoistApi();

  try {
    // Archived / ignored Notion task → close the linked Todoist task and bail.
    if ((p.archived || p.ignore) && !task.checked) {
      await api.closeTask(link.todoistTaskId);
      await db
        .update(schema.todoistTasks)
        .set({ checked: true, updatedAt: new Date() })
        .where(eq(schema.todoistTasks.id, link.todoistTaskId));
      await logAudit({
        source: "orchestrator",
        op: "todoist.close_from_notion_archived",
        payload: {
          notionPageId,
          todoistTaskId: link.todoistTaskId,
          reason: p.archived ? "archived" : "ignored",
        },
      });
      await refreshTaskLinkHash(link.id);
      return;
    }

    const wantChecked = todoistCheckedFromNotion(p);
    if (wantChecked !== task.checked) {
      if (wantChecked) {
        const wasRecurring = task.dueIsRecurring;
        await api.closeTask(link.todoistTaskId);
        await db
          .update(schema.todoistTasks)
          .set({ checked: true, updatedAt: new Date() })
          .where(eq(schema.todoistTasks.id, link.todoistTaskId));
        await logAudit({
          source: "orchestrator",
          op: "todoist.close_from_notion",
          payload: { notionPageId, todoistTaskId: link.todoistTaskId },
        });
        if (wasRecurring) await repairRecurringTodoistLink(link.todoistTaskId);
      } else {
        await api.reopenTask(link.todoistTaskId);
        await refetchAndUpsertTodoistTask(api, link.todoistTaskId);
        await logAudit({
          source: "orchestrator",
          op: "todoist.reopen_from_notion",
          payload: { notionPageId, todoistTaskId: link.todoistTaskId },
        });
      }
    }

    const [task2] = await db
      .select()
      .from(schema.todoistTasks)
      .where(eq(schema.todoistTasks.id, link.todoistTaskId));
    if (!task2 || task2.checked) {
      await refreshTaskLinkHash(link.id);
      return;
    }

    // Push title/date/priority deltas in one updateTask call.
    const fieldDiff = buildTodoistFieldDiff(p, task2 as TodoistTask);
    if (fieldDiff) {
      await api.updateTask(link.todoistTaskId, fieldDiff.args as never);
      await refetchAndUpsertTodoistTask(api, link.todoistTaskId);
      await logAudit({
        source: "orchestrator",
        op: "todoist.fields_from_notion",
        payload: {
          notionPageId,
          todoistTaskId: link.todoistTaskId,
          changedFields: fieldDiff.changedFields,
        },
      });
    }

    // Label diff (in-progress flag) — read latest cache row after the field push above.
    const [task3] = await db
      .select()
      .from(schema.todoistTasks)
      .where(eq(schema.todoistTasks.id, link.todoistTaskId));
    if (task3 && !task3.checked) {
      const merged = mergeLabelsForNotion(task3.labels ?? [], p);
      const prev = task3.labels ?? [];
      const same = merged.length === prev.length && merged.every((l, i) => l === prev[i]);
      if (!same) {
        await api.updateTask(link.todoistTaskId, { labels: merged });
        await refetchAndUpsertTodoistTask(api, link.todoistTaskId);
      }
    }

    await refreshTaskLinkHash(link.id);
  } catch (e) {
    await logAudit({
      source: "orchestrator",
      op: "mirrorTodoistFromNotion_error",
      payload: { notionPageId },
      error: (e as Error).message,
    });
    throw e;
  }
}

/**
 * Build the Notion field-update payload for fields that differ between the Todoist task
 * and the cached Notion page. Returns null if nothing needs to change.
 */
function buildNotionFieldDiff(
  page: NotionPage,
  task: TodoistTask,
): {
  fields: Parameters<typeof updateNotionTodoFields>[1];
  cachePatch: Partial<NotionPage>;
  changedFields: string[];
} | null {
  const fields: Parameters<typeof updateNotionTodoFields>[1] = {};
  const cachePatch: Partial<NotionPage> = {};
  const changed: string[] = [];

  if (task.content !== page.title) {
    fields.title = task.content;
    cachePatch.title = task.content;
    changed.push("title");
  }

  const wantStatus = notionStatusFromTodoist(task);
  if (wantStatus != null && wantStatus !== page.status) {
    fields.status = wantStatus;
    cachePatch.status = wantStatus;
    changed.push("status");
  }

  const taskHasDate = task.dueDate != null;
  const pageHasDate = page.dateStart != null;
  const dueIsDatetime = todoistDueIsDatetime(task);
  if (!taskHasDate && pageHasDate) {
    fields.date = null;
    cachePatch.dateStart = null;
    cachePatch.dateIsDatetime = false;
    changed.push("date");
  } else if (taskHasDate) {
    const datesEqual = page.dateStart?.getTime() === task.dueDate!.getTime() && page.dateIsDatetime === dueIsDatetime;
    if (!datesEqual) {
      fields.date = { value: task.dueDate!, isDatetime: dueIsDatetime };
      cachePatch.dateStart = task.dueDate!;
      cachePatch.dateIsDatetime = dueIsDatetime;
      changed.push("date");
    }
  }

  const wantPriority = PRIORITY_TODOIST_TO_NOTION[task.priority] ?? null;
  if (wantPriority !== page.priority) {
    fields.priority = wantPriority;
    cachePatch.priority = wantPriority;
    changed.push("priority");
  }

  if (changed.length === 0) return null;
  return { fields, cachePatch, changedFields: changed };
}

/** After Todoist is authoritative in DB: sync Notion status, title, due, priority. */
export async function mirrorNotionFromTodoist(todoistTaskId: string): Promise<void> {
  const [link] = await db
    .select()
    .from(schema.taskLinks)
    .where(eq(schema.taskLinks.todoistTaskId, todoistTaskId));
  if (!link) return;

  const [page] = await db
    .select()
    .from(schema.notionPages)
    .where(eq(schema.notionPages.id, link.notionPageId));
  const [task] = await db
    .select()
    .from(schema.todoistTasks)
    .where(eq(schema.todoistTasks.id, todoistTaskId));
  if (!page || !task) return;

  const currentHash = hashForPair(page as NotionPage, task as TodoistTask);
  if (link.pendingOrigin == null && currentHash === link.lastSyncHash) {
    return;
  }

  const diff = buildNotionFieldDiff(page as NotionPage, task as TodoistTask);
  if (!diff) {
    await refreshTaskLinkHash(link.id);
    return;
  }

  try {
    await updateNotionTodoFields(link.notionPageId, diff.fields);
    await db
      .update(schema.notionPages)
      .set({ ...diff.cachePatch, updatedAt: new Date() })
      .where(eq(schema.notionPages.id, link.notionPageId));
    await logAudit({
      source: "orchestrator",
      op: "notion.fields_from_todoist",
      payload: {
        notionPageId: link.notionPageId,
        todoistTaskId,
        changedFields: diff.changedFields,
      },
    });
    await refreshTaskLinkHash(link.id);
  } catch (e) {
    await logAudit({
      source: "orchestrator",
      op: "mirrorNotionFromTodoist_error",
      payload: { todoistTaskId },
      error: (e as Error).message,
    });
    throw e;
  }
}

/** When a recurring Todoist task completes, repoint the link to the new open instance (same title + project). */
export async function repairRecurringTodoistLink(oldTodoistTaskId: string) {
  const [link] = await db
    .select()
    .from(schema.taskLinks)
    .where(eq(schema.taskLinks.todoistTaskId, oldTodoistTaskId));
  if (!link) return { repaired: false as const };

  const [page] = await db
    .select()
    .from(schema.notionPages)
    .where(eq(schema.notionPages.id, link.notionPageId));
  const [oldT] = await db
    .select()
    .from(schema.todoistTasks)
    .where(eq(schema.todoistTasks.id, oldTodoistTaskId));
  if (!page || !oldT?.projectId) return { repaired: false as const };

  const api = todoistApi();
  const resp = await api.getTasks({ projectId: oldT.projectId });
  const list = resp.results ?? [];
  const match = list.find((t) => t.content === page.title && !t.checked);
  if (!match) {
    await logAudit({
      source: "orchestrator",
      op: "recurring_repair_miss",
      payload: { oldTodoistTaskId, notionPageId: link.notionPageId },
    });
    return { repaired: false as const };
  }

  const row = mapTodoistTaskToRow(
    match as unknown as Parameters<typeof mapTodoistTaskToRow>[0],
    new Date(),
  );
  await db.insert(schema.todoistTasks).values(row).onConflictDoUpdate({
    target: schema.todoistTasks.id,
    set: {
      projectId: sql`excluded.project_id`,
      parentId: sql`excluded.parent_id`,
      content: sql`excluded.content`,
      description: sql`excluded.description`,
      dueDate: sql`excluded.due_date`,
      dueString: sql`excluded.due_string`,
      dueIsRecurring: sql`excluded.due_is_recurring`,
      deadline: sql`excluded.deadline`,
      priority: sql`excluded.priority`,
      checked: sql`excluded.checked`,
      labels: sql`excluded.labels`,
      raw: sql`excluded.raw`,
      updatedAt: sql`excluded.updated_at`,
    },
  });

  await db
    .update(schema.taskLinks)
    .set({ todoistTaskId: match.id, lastSyncAt: new Date() })
    .where(eq(schema.taskLinks.id, link.id));

  await logAudit({
    source: "orchestrator",
    op: "recurring_repair",
    payload: { oldTodoistTaskId, newTodoistTaskId: match.id, notionPageId: link.notionPageId },
  });

  await refreshTaskLinkHash(link.id);
  return { repaired: true as const, newTodoistTaskId: match.id };
}

export type ToggleDashboardArgs = {
  notionPageId: string | null;
  todoistTaskId: string | null;
  done: boolean;
};

async function resolveTaskLink(args: ToggleDashboardArgs) {
  if (args.notionPageId && args.todoistTaskId) {
    return (
      await db
        .select()
        .from(schema.taskLinks)
        .where(
          and(
            eq(schema.taskLinks.notionPageId, args.notionPageId),
            eq(schema.taskLinks.todoistTaskId, args.todoistTaskId),
          ),
        )
    )[0];
  }
  if (args.notionPageId) {
    return (
      await db
        .select()
        .from(schema.taskLinks)
        .where(eq(schema.taskLinks.notionPageId, args.notionPageId))
    )[0];
  }
  if (args.todoistTaskId) {
    return (
      await db
        .select()
        .from(schema.taskLinks)
        .where(eq(schema.taskLinks.todoistTaskId, args.todoistTaskId))
    )[0];
  }
  return undefined;
}

/**
 * End-to-end toggle from the dashboard: mutate external APIs, refresh cache rows,
 * align labels for linked pairs, repair recurring links, clear pending_origin via
 * refreshTaskLinkHash.
 */
export async function applyDashboardToggle(args: ToggleDashboardArgs): Promise<void> {
  const api = todoistApi();
  const linkRow = await resolveTaskLink(args);
  const notionTarget: "Not started" | "In progress" | "Done" = args.done ? "Done" : "Not started";

  const notionBeforeRows = args.notionPageId
    ? await db
        .select()
        .from(schema.notionPages)
        .where(eq(schema.notionPages.id, args.notionPageId))
    : [];
  const notionBefore = notionBeforeRows[0];

  const taskBeforeRows = args.todoistTaskId
    ? await db
        .select()
        .from(schema.todoistTasks)
        .where(eq(schema.todoistTasks.id, args.todoistTaskId))
    : [];
  const taskBefore = taskBeforeRows[0];

  const notionAlready = !args.notionPageId || notionBefore?.status === notionTarget;
  const todoistAlready = !args.todoistTaskId || taskBefore?.checked === args.done;
  if (notionAlready && todoistAlready) {
    if (linkRow) await refreshTaskLinkHash(linkRow.id);
    await logAudit({ source: "dashboard", op: "toggle_task_noop", payload: args });
    return;
  }

  if (linkRow) {
    await db
      .update(schema.taskLinks)
      .set({ pendingOrigin: "dashboard" })
      .where(eq(schema.taskLinks.id, linkRow.id));
  }

  try {
    if (args.notionPageId) {
      await updateNotionTodoStatus(args.notionPageId, notionTarget);
      await db
        .update(schema.notionPages)
        .set({ status: notionTarget, updatedAt: new Date() })
        .where(eq(schema.notionPages.id, args.notionPageId));
    }

    if (args.todoistTaskId) {
      if (args.done) {
        await api.closeTask(args.todoistTaskId);
        await db
          .update(schema.todoistTasks)
          .set({ checked: true, updatedAt: new Date() })
          .where(eq(schema.todoistTasks.id, args.todoistTaskId));
      } else {
        await api.reopenTask(args.todoistTaskId);
        const t = await api.getTask(args.todoistTaskId);
        const row = mapTodoistTaskToRow(t as unknown as Parameters<typeof mapTodoistTaskToRow>[0], new Date());
        await db.insert(schema.todoistTasks).values(row).onConflictDoUpdate({
          target: schema.todoistTasks.id,
          set: {
            projectId: sql`excluded.project_id`,
            parentId: sql`excluded.parent_id`,
            content: sql`excluded.content`,
            description: sql`excluded.description`,
            dueDate: sql`excluded.due_date`,
            dueString: sql`excluded.due_string`,
            dueIsRecurring: sql`excluded.due_is_recurring`,
            deadline: sql`excluded.deadline`,
            priority: sql`excluded.priority`,
            checked: sql`excluded.checked`,
            labels: sql`excluded.labels`,
            raw: sql`excluded.raw`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      }
    }

    if (args.notionPageId && args.todoistTaskId) {
      const [page] = await db
        .select()
        .from(schema.notionPages)
        .where(eq(schema.notionPages.id, args.notionPageId));
      const [task] = await db
        .select()
        .from(schema.todoistTasks)
        .where(eq(schema.todoistTasks.id, args.todoistTaskId));
      if (page && task && !task.checked) {
        const merged = mergeLabelsForNotion(task.labels ?? [], page as NotionPage);
        await api.updateTask(args.todoistTaskId, { labels: merged });
        const t3 = await api.getTask(args.todoistTaskId);
        const row = mapTodoistTaskToRow(t3 as unknown as Parameters<typeof mapTodoistTaskToRow>[0], new Date());
        await db.insert(schema.todoistTasks).values(row).onConflictDoUpdate({
          target: schema.todoistTasks.id,
          set: {
            labels: sql`excluded.labels`,
            raw: sql`excluded.raw`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      }
    }

    if (args.todoistTaskId && args.done && taskBefore?.dueIsRecurring && linkRow) {
      await repairRecurringTodoistLink(args.todoistTaskId);
    }

    if (linkRow) await refreshTaskLinkHash(linkRow.id);

    await logAudit({ source: "dashboard", op: "toggle_task", payload: args });
  } catch (e) {
    if (linkRow) {
      await db
        .update(schema.taskLinks)
        .set({ pendingOrigin: null })
        .where(eq(schema.taskLinks.id, linkRow.id));
    }
    await logAudit({
      source: "dashboard",
      op: "toggle_task_error_retryable",
      payload: args,
      error: (e as Error).message,
    });
    throw e;
  }
}
