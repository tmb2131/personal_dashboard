// Single source of truth for Notion <-> Todoist field translation.
// Keep this file flat and pure so M3 (sync engine) and M4 (write actions) can both depend on it.

import type { InferSelectModel } from "drizzle-orm";
import type { schema } from "@/lib/db";

export type NotionPage = InferSelectModel<typeof schema.notionPages>;
export type TodoistTask = InferSelectModel<typeof schema.todoistTasks>;

export const PRIORITY_NOTION_TO_TODOIST: Record<
  NonNullable<NotionPage["priority"]>,
  number
> = {
  Low: 2,
  Medium: 3,
  High: 4,
};

export const PRIORITY_TODOIST_TO_NOTION: Record<number, NotionPage["priority"]> = {
  1: null,
  2: "Low",
  3: "Medium",
  4: "High",
};

export const IN_PROGRESS_LABEL = "in-progress";

export function notionShouldMirrorToTodoist(p: NotionPage): boolean {
  if (p.archived || p.ignore) return false;
  if (p.status === "Done") return false;
  return Boolean(p.dateStart || p.deadline || p.focus === "Yes" || p.parentId);
}

export function notionStatusFromTodoist(t: TodoistTask): NotionPage["status"] {
  if (t.checked) return "Done";
  return t.labels.includes(IN_PROGRESS_LABEL) ? "In progress" : "Not started";
}

export function todoistCheckedFromNotion(p: NotionPage): boolean {
  return p.status === "Done";
}

export function syncHash(args: {
  title: string;
  status: NotionPage["status"] | null;
  date: Date | null;
  deadline: Date | null;
  priority: NotionPage["priority"] | null;
  categoryOrProjectId: string | null;
  /**
   * Todoist-side authoritative fields, folded into the hash so a change that
   * originates in Todoist (e.g. a due date moved to another day) busts the hash
   * even when the mirrored Notion page is untouched. Without this, the drift
   * detector — which only ever saw the Notion side — treated such a pair as
   * in-sync and never mirrored the change into Notion, so the dashboard kept
   * showing the stale Notion date.
   */
  todoist?: {
    content: string;
    checked: boolean;
    dueDate: Date | null;
    deadline: Date | null;
    priority: number;
  };
}): string {
  const parts = [
    args.title.trim().toLowerCase(),
    args.status ?? "",
    args.date?.toISOString() ?? "",
    args.deadline?.toISOString() ?? "",
    args.priority ?? "",
    args.categoryOrProjectId ?? "",
  ];
  if (args.todoist) {
    parts.push(
      args.todoist.content.trim().toLowerCase(),
      args.todoist.checked ? "1" : "0",
      args.todoist.dueDate?.toISOString() ?? "",
      args.todoist.deadline?.toISOString() ?? "",
      String(args.todoist.priority),
    );
  }
  // Lightweight hash; not cryptographic. djb2 variant.
  let h = 5381;
  const s = parts.join("");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
