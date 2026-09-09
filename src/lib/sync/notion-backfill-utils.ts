/**
 * Pure candidate selection and destination-picking for the Todoist → Notion
 * backfill. Split out for the same reason as `mirror-backfill-utils.ts`: it can
 * be unit-tested without a database or either API client.
 */

import { normalizeTitleForMatch, type TodoistTask } from "@/lib/sync/mappings";
import type { MirrorSelection } from "@/lib/sync/mirror-backfill-utils";

/**
 * A cached Todoist task as the backfill reads it. `raw` is excluded from the
 * contract rather than from the rows — the creating half still reads
 * `raw.due` to tell a timed task from an all-day one — so that this file has
 * nothing to say about the upstream payload shape.
 */
export type NotionMirrorCandidate = Omit<TodoistTask, "raw">;

/**
 * Open Todoist tasks with no Notion counterpart, minus the ones a Notion page
 * may already cover.
 *
 * `excludedProjectIds` is how habits stay out: see `collectRecurringProjectIds`.
 *
 * `unlinkedNotionTitles` is the duplicate guard, and it is the mirror image of
 * the one in `mirror-backfill-utils.ts` — deliberately so. Both passes now run
 * in the same reconcile, and without the symmetry a title collision would make
 * one of them create the very row the other is holding back for, leaving a
 * duplicate in the app that was already fine. A collision means a link went
 * missing or the task is kept in both apps by hand; `adoptExactTitleMatches`
 * resolves the unambiguous ones into real links before either pass runs, so
 * what reaches here is genuinely ambiguous and belongs in a report, not in a
 * `pages.create` call.
 */
export function selectNotionMirrorCandidates<T extends NotionMirrorCandidate>(args: {
  tasks: T[];
  linkedTodoistTaskIds: Set<string>;
  /** Projects whose tasks are never mirrored (Recurring and its children). */
  excludedProjectIds: Set<string>;
  /** Normalized titles of open Notion to-dos that no `task_links` row claims. */
  unlinkedNotionTitles: Set<string>;
  limit: number;
}): MirrorSelection<T> {
  const eligible = args.tasks.filter(
    (t) =>
      !t.checked &&
      !args.linkedTodoistTaskIds.has(t.id) &&
      !(t.projectId != null && args.excludedProjectIds.has(t.projectId)),
  );

  const titleMatched: T[] = [];
  const creatable: T[] = [];
  for (const t of eligible) {
    if (args.unlinkedNotionTitles.has(normalizeTitleForMatch(t.content))) titleMatched.push(t);
    else creatable.push(t);
  }

  creatable.sort(bySoonestThenRecent);

  const limit = Math.max(args.limit, 0);
  return {
    create: creatable.slice(0, limit),
    titleMatched,
    remaining: creatable.slice(limit),
  };
}

/** When the run is capped, the tasks that are actually due should be the ones that make it. */
function bySoonestThenRecent(a: NotionMirrorCandidate, b: NotionMirrorCandidate): number {
  const da = scheduledAtMs(a);
  const dbb = scheduledAtMs(b);
  if (da != null && dbb != null) return da - dbb;
  if (da != null) return -1;
  if (dbb != null) return 1;
  // Undated tasks last, freshest first — one captured minutes ago is the one
  // being waited on.
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

function scheduledAtMs(t: NotionMirrorCandidate): number | null {
  const d = t.dueDate ?? t.deadline;
  return d ? d.getTime() : null;
}

export type NotionParentChoice = {
  notionParentPageId: string;
  /** The Notion project row's title when the Todoist project matched one. */
  matchedProjectTitle: string | null;
};

/**
 * Where a Todoist task's Notion row should hang.
 *
 * A Notion to-do is a sub-task of exactly one top-level row, and that row is
 * what the dashboard draws as a project — so every mirrored task needs one.
 * When the Todoist project shares a name with a Notion project row (an "OCI"
 * project either side of the sync, say) that row is the honest home; anything
 * else lands in the Notion project named Inbox, the same way Todoist's own
 * inbox holds what has not been filed yet.
 *
 * Todoist's inbox is itself called "Inbox", so it reaches the Notion Inbox
 * through the name match rather than through the fallback. Both roads lead to
 * the same page; `matchedProjectTitle` is only there so the audit trail can say
 * which one a task took.
 */
export function chooseNotionParent(args: {
  projectName: string | null;
  /** Normalized title → page id, for unambiguously-named top-level rows only. */
  projectPageIdByTitle: Map<string, string>;
  inboxPageId: string;
}): NotionParentChoice {
  const name = args.projectName?.trim();
  if (name) {
    const matched = args.projectPageIdByTitle.get(normalizeTitleForMatch(name));
    if (matched) return { notionParentPageId: matched, matchedProjectTitle: name };
  }
  return { notionParentPageId: args.inboxPageId, matchedProjectTitle: null };
}

/**
 * Normalized title → page id for top-level Notion rows, skipping any title two
 * rows share.
 *
 * A duplicate title is not a destination: picking either row would be a coin
 * toss the user cannot see, and Inbox is the answer we can defend.
 */
export function buildProjectPageIdByTitle(
  pages: { id: string; title: string }[],
): Map<string, string> {
  const byTitle = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const p of pages) {
    const key = normalizeTitleForMatch(p.title);
    if (!key) continue;
    if (byTitle.has(key)) {
      ambiguous.add(key);
      continue;
    }
    byTitle.set(key, p.id);
  }
  for (const key of ambiguous) byTitle.delete(key);
  return byTitle;
}
