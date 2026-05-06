import { TodoistApi } from "@doist/todoist-api-typescript";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";

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
      .values(
        tasks.map((t) => ({
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
          updatedAt: now,
        })),
      )
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

  return { projects: projects.length, tasks: tasks.length };
}
