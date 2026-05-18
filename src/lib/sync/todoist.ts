import { TodoistApi } from "@doist/todoist-api-typescript";
import type { InferSelectModel } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { parseDateOnlyLocal } from "@/lib/date-utils";

let _api: TodoistApi | null = null;
function api() {
  if (!_api) _api = new TodoistApi(process.env.TODOIST_TOKEN!);
  return _api;
}

type TodoistTask = {
  id: string;
  projectId?: string | null;
  parentId?: string | null;
  content: string;
  description?: string | null;
  due?: { date?: string; datetime?: string; string?: string; isRecurring?: boolean } | null;
  deadline?: { date?: string } | null;
  priority: number;
  isCompleted?: boolean;
  checked?: boolean;
  labels?: string[];
};

type TodoistProject = {
  id: string;
  name: string;
  parentId?: string | null;
  color?: string;
  isArchived?: boolean;
};

type TodoistTaskRow = InferSelectModel<typeof schema.todoistTasks>;

/** Todoist inbox project id (REST v2 marks inbox explicitly when present). */
export async function getInboxProjectId(): Promise<string> {
  type Proj = TodoistProject & { inbox_project?: boolean };
  const result = (await (api() as unknown as {
    getProjects: () => Promise<Proj[] | { results: Proj[] }>;
  }).getProjects()) as Proj[] | { results: Proj[] };
  const list = Array.isArray(result) ? result : result.results;
  const inbox = list.find(
    (p) => (p as Proj).inbox_project === true || (p.name ?? "").toLowerCase() === "inbox",
  );
  if (!inbox) throw new Error("Todoist inbox project not found");
  return inbox.id;
}

/** Todoist project whose name matches exactly (trimmed, case-insensitive). */
export async function getTodoistProjectIdByName(name: string): Promise<string> {
  const want = name.trim().toLowerCase();
  const result = (await (api() as unknown as {
    getProjects: () => Promise<TodoistProject[] | { results: TodoistProject[] }>;
  }).getProjects()) as TodoistProject[] | { results: TodoistProject[] };
  const list = Array.isArray(result) ? result : result.results;
  const match = list.find((p) => (p.name ?? "").trim().toLowerCase() === want);
  if (!match) throw new Error(`Todoist project named "${name.trim()}" not found`);
  return match.id;
}

/** Todoist project whose name is exactly `Personal` (case-insensitive). */
export async function getPersonalProjectId(): Promise<string> {
  return getTodoistProjectIdByName("Personal");
}

async function fetchAllProjects(): Promise<TodoistProject[]> {
  const out: TodoistProject[] = [];
  // The SDK paginates internally; v7+ returns { results, nextCursor } shapes for some calls.
  // We treat it generically to avoid version mismatches.
  const result = (await (api() as unknown as {
    getProjects: () => Promise<TodoistProject[] | { results: TodoistProject[] }>;
  }).getProjects()) as TodoistProject[] | { results: TodoistProject[] };
  if (Array.isArray(result)) out.push(...result);
  else out.push(...result.results);
  return out;
}

async function fetchAllTasks(): Promise<TodoistTask[]> {
  const out: TodoistTask[] = [];
  let cursor: string | undefined;
  let guard = 0;

  while (true) {
    const result = (await (api() as unknown as {
      getTasks: (
        args?: { cursor?: string },
      ) => Promise<TodoistTask[] | { results: TodoistTask[]; nextCursor?: string | null }>;
    }).getTasks(cursor ? { cursor } : undefined)) as
      | TodoistTask[]
      | { results: TodoistTask[]; nextCursor?: string | null };

    if (Array.isArray(result)) {
      out.push(...result);
      break;
    }

    out.push(...result.results);
    const nextCursor = typeof result.nextCursor === "string" ? result.nextCursor.trim() : "";
    if (!nextCursor || nextCursor === cursor) break;

    cursor = nextCursor;
    guard++;
    if (guard > 200) break;
  }

  return out;
}

function dueToDate(t: TodoistTask): Date | null {
  if (t.due?.datetime) return new Date(t.due.datetime);
  if (t.due?.date) return parseDateOnlyLocal(t.due.date);
  return null;
}

function deadlineToDate(t: TodoistTask): Date | null {
  if (t.deadline?.date) return parseDateOnlyLocal(t.deadline.date);
  return null;
}

export function mapTodoistTaskToRow(t: TodoistTask, updatedAt: Date) {
  return {
    id: t.id,
    projectId: t.projectId ?? null,
    parentId: t.parentId ?? null,
    content: t.content,
    description: t.description ?? null,
    dueDate: dueToDate(t),
    dueString: t.due?.string ?? null,
    dueIsRecurring: Boolean(t.due?.isRecurring),
    deadline: deadlineToDate(t),
    priority: t.priority ?? 1,
    checked: Boolean(t.isCompleted ?? t.checked),
    labels: t.labels ?? [],
    raw: t as unknown,
    updatedAt,
  };
}

function sameTime(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function sameLabels(a: string[], b: string[]) {
  return a.length === b.length && a.every((label, i) => label === b[i]);
}

function todoistRowsMatch(existing: TodoistTaskRow, next: ReturnType<typeof mapTodoistTaskToRow>) {
  return (
    existing.projectId === next.projectId &&
    existing.parentId === next.parentId &&
    existing.content === next.content &&
    existing.description === next.description &&
    sameTime(existing.dueDate, next.dueDate) &&
    existing.dueString === next.dueString &&
    existing.dueIsRecurring === next.dueIsRecurring &&
    sameTime(existing.deadline, next.deadline) &&
    existing.priority === next.priority &&
    existing.checked === next.checked &&
    sameLabels(existing.labels ?? [], next.labels)
  );
}

export type SyncTodoistResult = {
  projects: number;
  tasks: number;
  changedTaskIds: string[];
  completedTaskIds: string[];
  completedRecurringTaskIds: string[];
};

export async function syncTodoist(): Promise<SyncTodoistResult> {
  const [projects, tasks] = await Promise.all([fetchAllProjects(), fetchAllTasks()]);
  const now = new Date();
  const existingTasks = await db.select().from(schema.todoistTasks);
  const existingTaskById = new Map(existingTasks.map((t) => [t.id, t]));
  const activeTaskIds = new Set(tasks.map((t) => t.id));
  const changedTaskIds: string[] = [];
  const completedTaskIds: string[] = [];
  const completedRecurringTaskIds: string[] = [];

  if (projects.length) {
    await db
      .insert(schema.todoistProjects)
      .values(
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          parentId: p.parentId ?? null,
          color: p.color ?? null,
          archived: Boolean(p.isArchived),
          raw: p as unknown,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: schema.todoistProjects.id,
        set: {
          name: sql`excluded.name`,
          parentId: sql`excluded.parent_id`,
          color: sql`excluded.color`,
          archived: sql`excluded.archived`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  const taskRows = tasks.map((t) => mapTodoistTaskToRow(t, now));
  for (const row of taskRows) {
    const existing = existingTaskById.get(row.id);
    if (!existing || !todoistRowsMatch(existing, row)) changedTaskIds.push(row.id);
  }

  if (taskRows.length) {
    await db
      .insert(schema.todoistTasks)
      .values(taskRows)
      .onConflictDoUpdate({
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

  for (const task of existingTasks) {
    if (task.checked || activeTaskIds.has(task.id)) continue;
    await db
      .update(schema.todoistTasks)
      .set({ checked: true, updatedAt: now })
      .where(eq(schema.todoistTasks.id, task.id));
    completedTaskIds.push(task.id);
    if (task.dueIsRecurring) completedRecurringTaskIds.push(task.id);
  }

  await db
    .insert(schema.syncState)
    .values({
      source: "todoist",
      lastFullSyncAt: now,
    })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { lastFullSyncAt: now },
    });

  return {
    projects: projects.length,
    tasks: tasks.length,
    changedTaskIds,
    completedTaskIds,
    completedRecurringTaskIds,
  };
}

/** Fetch and upsert specific tasks (incremental webhook path). */
export async function syncTodoistTasksByIds(
  taskIds: string[],
  opt?: {
    /** Task ids known to be completed (active GET may 404). */
    assumedCompletedIds?: Set<string>;
  },
) {
  const now = new Date();
  const results = { upserted: 0, assumedComplete: 0, deleted: 0, errors: [] as string[] };
  const completed = opt?.assumedCompletedIds ?? new Set<string>();
  const a = api();

  for (const id of taskIds) {
    try {
      const t = await a.getTask(id);
      const row = mapTodoistTaskToRow(t as unknown as TodoistTask, now);
      await db
        .insert(schema.todoistTasks)
        .values(row)
        .onConflictDoUpdate({
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
      results.upserted++;
    } catch {
      if (completed.has(id)) {
        await db
          .update(schema.todoistTasks)
          .set({ checked: true, updatedAt: now })
          .where(eq(schema.todoistTasks.id, id));
        results.assumedComplete++;
      } else {
        results.errors.push(id);
      }
    }
  }

  await db
    .insert(schema.syncState)
    .values({ source: "todoist", lastIncrementalAt: now })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { lastIncrementalAt: now },
    });

  return results;
}

export async function deleteTodoistTaskCacheRow(taskId: string) {
  await db.delete(schema.todoistTasks).where(eq(schema.todoistTasks.id, taskId));
}

/**
 * Fetch and upsert specific projects (incremental webhook path for `project:*`).
 * Avoids the full `syncTodoist()` re-pull on simple renames / archives.
 */
export async function syncTodoistProjectsByIds(projectIds: string[]) {
  const now = new Date();
  const results = { upserted: 0, missing: 0, errors: [] as string[] };
  if (!projectIds.length) return results;
  const a = api() as unknown as { getProject: (id: string) => Promise<TodoistProject> };

  for (const id of projectIds) {
    try {
      const p = await a.getProject(id);
      await db
        .insert(schema.todoistProjects)
        .values({
          id: p.id,
          name: p.name,
          parentId: p.parentId ?? null,
          color: p.color ?? null,
          archived: Boolean(p.isArchived),
          raw: p as unknown,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.todoistProjects.id,
          set: {
            name: sql`excluded.name`,
            parentId: sql`excluded.parent_id`,
            color: sql`excluded.color`,
            archived: sql`excluded.archived`,
            raw: sql`excluded.raw`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      results.upserted++;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      // 404 / not found → project was deleted upstream; mark archived locally.
      if (/404|not[\s-]*found/i.test(msg)) {
        await db
          .update(schema.todoistProjects)
          .set({ archived: true, updatedAt: now })
          .where(eq(schema.todoistProjects.id, id));
        results.missing++;
      } else {
        results.errors.push(`${id}: ${msg}`);
      }
    }
  }

  await db
    .insert(schema.syncState)
    .values({ source: "todoist", lastIncrementalAt: now })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { lastIncrementalAt: now },
    });

  return results;
}

export async function markTodoistProjectArchived(projectId: string) {
  const now = new Date();
  await db
    .update(schema.todoistProjects)
    .set({ archived: true, updatedAt: now })
    .where(eq(schema.todoistProjects.id, projectId));
}
