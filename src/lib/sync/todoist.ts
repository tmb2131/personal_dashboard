import { TodoistApi } from "@doist/todoist-api-typescript";
import { db, schema } from "@/lib/db";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { parseDateOnlyLocal } from "@/lib/date-utils";
import { parseTodoistDue, type TodoistDueLike } from "@/lib/todoist-due";

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
  due?: (TodoistDueLike & { string?: string; isRecurring?: boolean }) | null;
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

/**
 * Todoist inbox project id — the default destination for anything the dashboard
 * creates without a project of its own. The inbox flag is spelled differently
 * across API/SDK versions, so accept all three and fall back to the name.
 */
export async function getInboxProjectId(): Promise<string> {
  type Proj = TodoistProject & {
    inbox_project?: boolean;
    inboxProject?: boolean;
    is_inbox_project?: boolean;
    isInboxProject?: boolean;
  };
  const result = (await (api() as unknown as {
    getProjects: () => Promise<Proj[] | { results: Proj[] }>;
  }).getProjects()) as Proj[] | { results: Proj[] };
  const list = Array.isArray(result) ? result : result.results;
  const inbox = list.find(
    (p) =>
      p.inbox_project === true ||
      p.inboxProject === true ||
      p.is_inbox_project === true ||
      p.isInboxProject === true ||
      (p.name ?? "").trim().toLowerCase() === "inbox",
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
  return parseTodoistDue(t.due);
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

/**
 * True when the incoming row differs from the stored one on any field the
 * dashboard reads. Used as the `WHERE` on `ON CONFLICT DO UPDATE`, which makes
 * Postgres skip untouched rows and report the rest via `RETURNING`.
 *
 * This replaced a `SELECT *` over the whole table that ran on every 30s poll.
 * That read pulled the `raw` jsonb of every task purely to diff it in JS, and
 * was burning the project's entire monthly Neon transfer allowance in days.
 *
 * Two consequences worth keeping in mind:
 *
 * - `IS DISTINCT FROM`, not `<>`: most of these columns are nullable, and `<>`
 *   yields NULL (falsy) when either side is NULL, so a value being cleared
 *   upstream would not register as a change.
 * - `raw` is deliberately absent. Todoist's payload carries fields that differ
 *   on every poll, so including it would mark every row changed and undo the
 *   whole point. The `raw` subtrees anything actually reads (`raw.due`,
 *   `raw.deadline`) are shadowed by the scalar columns compared here, so a
 *   change that matters still lands.
 */
const todoistTaskFieldsDiffer = sql`
  ${schema.todoistTasks.projectId} IS DISTINCT FROM excluded.project_id
  OR ${schema.todoistTasks.parentId} IS DISTINCT FROM excluded.parent_id
  OR ${schema.todoistTasks.content} IS DISTINCT FROM excluded.content
  OR ${schema.todoistTasks.description} IS DISTINCT FROM excluded.description
  OR ${schema.todoistTasks.dueDate} IS DISTINCT FROM excluded.due_date
  OR ${schema.todoistTasks.dueString} IS DISTINCT FROM excluded.due_string
  OR ${schema.todoistTasks.dueIsRecurring} IS DISTINCT FROM excluded.due_is_recurring
  OR ${schema.todoistTasks.deadline} IS DISTINCT FROM excluded.deadline
  OR ${schema.todoistTasks.priority} IS DISTINCT FROM excluded.priority
  OR ${schema.todoistTasks.checked} IS DISTINCT FROM excluded.checked
  OR ${schema.todoistTasks.labels} IS DISTINCT FROM excluded.labels
`;

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

  if (taskRows.length) {
    // `RETURNING` yields inserted rows plus rows the `setWhere` let through, and
    // nothing else — so these ids *are* the changed set. Unchanged rows are never
    // written, which also preserves their `updatedAt`: reconcile tie-breaks
    // conflicts by newer-side-wins, so that column must approximate when the task
    // last changed rather than when it was last polled.
    const changed = await db
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
        setWhere: todoistTaskFieldsDiffer,
      })
      .returning({ id: schema.todoistTasks.id });

    changedTaskIds.push(...changed.map((row) => row.id));
  }

  // Anything still open locally that the API no longer lists has been completed.
  // Guarded on a non-empty response: an API hiccup returning zero tasks would
  // otherwise mark the entire table complete and mirror that to Notion.
  if (tasks.length) {
    const completed = await db
      .update(schema.todoistTasks)
      .set({ checked: true, updatedAt: now })
      .where(
        and(
          eq(schema.todoistTasks.checked, false),
          notInArray(
            schema.todoistTasks.id,
            tasks.map((t) => t.id),
          ),
        ),
      )
      .returning({
        id: schema.todoistTasks.id,
        dueIsRecurring: schema.todoistTasks.dueIsRecurring,
      });

    for (const row of completed) {
      completedTaskIds.push(row.id);
      if (row.dueIsRecurring) completedRecurringTaskIds.push(row.id);
    }
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
