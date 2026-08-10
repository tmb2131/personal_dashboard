import { eq } from "drizzle-orm";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { db, schema } from "@/lib/db";
import { notionShouldMirrorToTodoist, PRIORITY_NOTION_TO_TODOIST } from "@/lib/sync/mappings";
import { createTodoPageFromTodoistMirror } from "@/lib/sync/notion";
import {
  insertTaskLinkForPair,
  mirrorNotionFromTodoist,
  mirrorTodoistFromNotion,
} from "@/lib/sync/orchestrator";
import { getInboxProjectId, syncTodoistTasksByIds } from "@/lib/sync/todoist";

function todoistApi() {
  const token = process.env.TODOIST_TOKEN;
  if (!token) throw new Error("TODOIST_TOKEN missing");
  return new TodoistApi(token);
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Sub-task → parent row title; top-level → category title when set (Notion “project” context). */
async function notionProjectNameLabel(
  p: typeof schema.notionPages.$inferSelect,
): Promise<string | null> {
  if (p.parentId) {
    const [parent] = await db
      .select()
      .from(schema.notionPages)
      .where(eq(schema.notionPages.id, p.parentId));
    const name = parent?.title?.trim();
    return name || null;
  }
  if (p.categoryId) {
    const [cat] = await db
      .select()
      .from(schema.notionCategories)
      .where(eq(schema.notionCategories.id, p.categoryId));
    return cat?.title?.trim() || null;
  }
  return null;
}

function truncateTodoistLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Create a Todoist task from a Notion to-do row and insert `task_links`. */
export async function pushNotionPageToTodoist(
  notionPageId: string,
  options?: { todoistProjectId?: string },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.taskLinks)
    .where(eq(schema.taskLinks.notionPageId, notionPageId));
  if (existing) throw new Error("This Notion task is already linked to Todoist");

  const [p] = await db.select().from(schema.notionPages).where(eq(schema.notionPages.id, notionPageId));
  if (!p) throw new Error("Notion page not found");
  if (p.archived || p.ignore) throw new Error("Cannot sync archived or ignored tasks");
  if (!notionShouldMirrorToTodoist(p)) {
    throw new Error(
      "This task needs a date, deadline, focus, or parent before it can appear in Todoist",
    );
  }
  if (p.status === "Done") throw new Error("Done tasks are not pushed to Todoist");

  const projectId = options?.todoistProjectId ?? (await getInboxProjectId());

  const api = todoistApi();
  const args: Record<string, unknown> = {
    content: p.title,
    projectId,
  };
  if (p.notes?.trim()) {
    args.description = p.notes.trim();
  }
  if (p.dateStart) {
    if (p.dateIsDatetime) args.dueDatetime = p.dateStart.toISOString();
    else args.dueDate = toYmd(p.dateStart);
  }
  if (p.priority) {
    const pr = PRIORITY_NOTION_TO_TODOIST[p.priority];
    if (pr) args.priority = pr;
  }

  const projectLabel = await notionProjectNameLabel(p);
  if (projectLabel) {
    args.labels = [truncateTodoistLabel(projectLabel)];
  }

  const created = await api.addTask(args as never);
  await syncTodoistTasksByIds([created.id]);
  await insertTaskLinkForPair(notionPageId, created.id);
  await mirrorTodoistFromNotion(notionPageId);
}

/** Create a Notion sub-task under a top-level project row and insert `task_links`. */
export async function pushTodoistTaskToNotion(
  todoistTaskId: string,
  notionParentPageId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.taskLinks)
    .where(eq(schema.taskLinks.todoistTaskId, todoistTaskId));
  if (existing) throw new Error("This Todoist task is already linked to Notion");

  const [row] = await db.select().from(schema.todoistTasks).where(eq(schema.todoistTasks.id, todoistTaskId));
  if (!row) throw new Error("Todoist task not found");

  const [parentPage] = await db
    .select()
    .from(schema.notionPages)
    .where(eq(schema.notionPages.id, notionParentPageId));
  if (!parentPage) throw new Error("Parent Notion page not found");
  if (parentPage.archived || parentPage.ignore) {
    throw new Error("Parent task cannot be archived or ignored");
  }
  if (parentPage.parentId) {
    throw new Error("Choose a top-level Notion project row as the parent");
  }

  const { pageId } = await createTodoPageFromTodoistMirror({
    title: row.content,
    notionParentPageId,
    task: row,
  });

  await insertTaskLinkForPair(pageId, todoistTaskId);
  await mirrorNotionFromTodoist(todoistTaskId);
}
