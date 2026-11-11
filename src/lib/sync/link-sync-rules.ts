/**
 * Rules for a linked Notion page and Todoist task, kept free of the database
 * and both APIs so they can be tested on their own. The orchestrator, the
 * reconcile scan and the Notion sync all act on these.
 */

/**
 * A Notion page that has left the task list: archived, marked Ignore, trashed
 * or deleted. The last two reach the cache as `archived`.
 *
 * Nothing about such a pair syncs any more. Its Todoist half is closed (see
 * `shouldCloseTodoistForRemovedPage`) and that is the end of it.
 */
export function isRemovedInNotion(page: { archived: boolean; ignore: boolean }): boolean {
  return page.archived || page.ignore;
}

/**
 * Whether to close the Todoist task of a pair whose Notion page was removed.
 *
 * A closed task needs nothing. A recurring one is left open: closing it in
 * Todoist only moves it to its next date, so every pass would push it one
 * occurrence further instead of retiring it.
 */
export function shouldCloseTodoistForRemovedPage(task: {
  checked: boolean;
  dueIsRecurring: boolean;
}): boolean {
  return !task.checked && !task.dueIsRecurring;
}

/**
 * The Notion API's answer for a page that was deleted, or is no longer shared
 * with the integration. Either way the page is gone as far as the sync can tell.
 */
export function isNotionObjectNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "object_not_found";
}

/**
 * Cached To-Do rows a full Notion sync did not see, to be checked one by one.
 *
 * The data source query never returns trashed or deleted pages, and an upsert
 * cannot notice a row that stopped coming back. Without this, a page deleted
 * while its webhook was missed stays live in the cache for good: still drawn
 * on the dashboard, still linked, and written to by every reconcile.
 *
 * Absence alone is not proof. A page created seconds ago may not be in the
 * query results yet, so rows synced after `syncedBefore` are skipped and the
 * caller confirms each candidate with Notion before changing anything.
 * `limit` keeps those confirmations inside Notion's rate budget; the rows
 * missing longest go first.
 */
export function selectVanishedTodoPageIds(args: {
  cached: { id: string; archived: boolean; lastSyncedAt: Date }[];
  seenIds: Set<string>;
  syncedBefore: Date;
  limit: number;
}): string[] {
  const cutoff = args.syncedBefore.getTime();
  return args.cached
    .filter((p) => !p.archived && !args.seenIds.has(p.id) && p.lastSyncedAt.getTime() < cutoff)
    .sort((a, b) => a.lastSyncedAt.getTime() - b.lastSyncedAt.getTime())
    .slice(0, Math.max(0, args.limit))
    .map((p) => p.id);
}
