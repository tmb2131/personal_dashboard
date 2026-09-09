/**
 * Shared reading of the Todoist project tree.
 *
 * Pure and database-free so the dashboard, the sync passes and their tests can
 * all agree on what "the Recurring project" means without each carrying its own
 * copy of the walk.
 */

export type TodoistProjectNode = {
  id: string;
  name: string;
  parentId: string | null;
};

export function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Todoist's own inbox is called "Inbox" in every locale we care about, and its
 * name is what both the dashboard grouping and the Notion destination lookup
 * key off when the API flag is missing.
 */
export const TODOIST_INBOX_PROJECT_NAME = "inbox";

export const RECURRING_PROJECT_NAME = "recurring";

/**
 * The "Recurring" project plus everything nested under it.
 *
 * These are habits — floss, bin night, "Charlie's birthday upcoming" — not
 * tasks. The dashboard already files them as their own collapsible class, and
 * the Notion backfill leaves them out for the same reason: fifty-odd daily
 * repeats in the To-Dos database would bury the work it exists to surface.
 */
export function collectRecurringProjectIds(projects: TodoistProjectNode[]): Set<string> {
  const childIdsByParent = new Map<string, string[]>();
  for (const p of projects) {
    if (!p.parentId) continue;
    const arr = childIdsByParent.get(p.parentId) ?? [];
    arr.push(p.id);
    childIdsByParent.set(p.parentId, arr);
  }

  const ids = new Set<string>();
  const queue: string[] = [];
  for (const p of projects) {
    if (normalizeProjectName(p.name) !== RECURRING_PROJECT_NAME) continue;
    ids.add(p.id);
    queue.push(p.id);
  }

  while (queue.length) {
    const parentId = queue.shift()!;
    for (const childId of childIdsByParent.get(parentId) ?? []) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      queue.push(childId);
    }
  }

  return ids;
}
