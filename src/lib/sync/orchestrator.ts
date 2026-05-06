/**
 * Link-aware sync orchestration (M3): mirror Notion ↔ Todoist for paired tasks,
 * reconcile hashes on `task_links`, recurring-instance repair, and audit trails.
 *
 * Conflict policy: callers upsert the authoritative side first; this module pushes
 * the mirror side to match using `mappings.ts`.
 */

import { TodoistApi } from "@doist/todoist-api-typescript";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import {
  IN_PROGRESS_LABEL,
  notionStatusFromTodoist,
  syncHash,
  todoistCheckedFromNotion,
  type NotionPage,
  type TodoistTask,
} from "@/lib/sync/mappings";
import { updateNotionTodoStatus } from "@/lib/sync/notion";
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

/** After Notion is authoritative in DB: sync Todoist completion + labels. */
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

  const p = page as NotionPage;
  const api = todoistApi();
  const wantChecked = todoistCheckedFromNotion(p);

  try {
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
        const refreshed = await api.getTask(link.todoistTaskId);
        const row = mapTodoistTaskToRow(refreshed as unknown as Parameters<typeof mapTodoistTaskToRow>[0], new Date());
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

    const merged = mergeLabelsForNotion(task2.labels ?? [], p);
    const prev = task2.labels ?? [];
    const same = merged.length === prev.length && merged.every((l, i) => l === prev[i]);
    if (!same) {
      await api.updateTask(link.todoistTaskId, { labels: merged });
      const again = await api.getTask(link.todoistTaskId);
      const row = mapTodoistTaskToRow(again as unknown as Parameters<typeof mapTodoistTaskToRow>[0], new Date());
      await db.insert(schema.todoistTasks).values(row).onConflictDoUpdate({
        target: schema.todoistTasks.id,
        set: {
          labels: sql`excluded.labels`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
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

/** After Todoist is authoritative in DB: sync Notion status. */
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

  const want = notionStatusFromTodoist(task as TodoistTask);
  if (want == null || page.status === want) {
    await refreshTaskLinkHash(link.id);
    return;
  }

  await updateNotionTodoStatus(link.notionPageId, want);
  await db
    .update(schema.notionPages)
    .set({ status: want, updatedAt: new Date() })
    .where(eq(schema.notionPages.id, link.notionPageId));
  await logAudit({
    source: "orchestrator",
    op: "notion.status_from_todoist",
    payload: { notionPageId: link.notionPageId, todoistTaskId, want },
  });

  await refreshTaskLinkHash(link.id);
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

  const taskBeforeRows = args.todoistTaskId
    ? await db
        .select()
        .from(schema.todoistTasks)
        .where(eq(schema.todoistTasks.id, args.todoistTaskId))
    : [];
  const taskBefore = taskBeforeRows[0];

  if (linkRow) {
    await db
      .update(schema.taskLinks)
      .set({ pendingOrigin: "dashboard" })
      .where(eq(schema.taskLinks.id, linkRow.id));
  }

  const notionTarget: "Not started" | "In progress" | "Done" = args.done ? "Done" : "Not started";

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
      op: "toggle_task_error",
      payload: args,
      error: (e as Error).message,
    });
    throw e;
  }
}
