import { TodoistApi } from "@doist/todoist-api-typescript";
import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

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

/** Todoist project whose name is exactly `Personal` (case-insensitive). */
export async function getPersonalProjectId(): Promise<string> {
  const result = (await (api() as unknown as {
    getProjects: () => Promise<TodoistProject[] | { results: TodoistProject[] }>;
  }).getProjects()) as TodoistProject[] | { results: TodoistProject[] };
  const list = Array.isArray(result) ? result : result.results;
  const personal = list.find((p) => (p.name ?? "").trim().toLowerCase() === "personal");
  if (!personal) throw new Error('Todoist project named "Personal" not found');
  return personal.id;
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
  const result = (await (api() as unknown as {
    getTasks: () => Promise<TodoistTask[] | { results: TodoistTask[] }>;
  }).getTasks()) as TodoistTask[] | { results: TodoistTask[] };
  return Array.isArray(result) ? result : result.results;
}

function dueToDate(t: TodoistTask): Date | null {
  if (t.due?.datetime) return new Date(t.due.datetime);
  if (t.due?.date) return new Date(t.due.date);
  return null;
}

function deadlineToDate(t: TodoistTask): Date | null {
  if (t.deadline?.date) return new Date(t.deadline.date);
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

export async function syncTodoist() {
  const [projects, tasks] = await Promise.all([fetchAllProjects(), fetchAllTasks()]);
  const now = new Date();

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

  if (tasks.length) {
    await db
      .insert(schema.todoistTasks)
      .values(tasks.map((t) => mapTodoistTaskToRow(t, now)))
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

  return { projects: projects.length, tasks: tasks.length };
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
