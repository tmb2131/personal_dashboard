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

/** Tasks with this Todoist label (or `#recurring` in title) skip the Today tasks panel. */
const RECURRING_TODAY_PANEL_TOKEN = "recurring";

function normalizeDashboardTagToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/u, "");
}

/** True if the synced Todoist labels or displayed title denote a `#recurring` tag. */
export function hasRecurringTagForTodayPanel(labels: readonly string[], title: string): boolean {
  if (labels.some((l) => normalizeDashboardTagToken(l) === RECURRING_TODAY_PANEL_TOKEN)) return true;
  return /(^|[\s/([{])#\s*recurring\b/iu.test(title);
}

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
}): string {
  const parts = [
    args.title.trim().toLowerCase(),
    args.status ?? "",
    args.date?.toISOString() ?? "",
    args.deadline?.toISOString() ?? "",
    args.priority ?? "",
    args.categoryOrProjectId ?? "",
  ];
  // Lightweight hash; not cryptographic. djb2 variant.
  let h = 5381;
  const s = parts.join("");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
