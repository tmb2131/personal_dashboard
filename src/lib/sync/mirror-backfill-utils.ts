/**
 * Pure candidate selection for the missing-mirror backfill. Split out so it can
 * be unit-tested without a database or the Todoist client — same reason as
 * `orphan-replay-utils.ts`.
 */

import {
  normalizeTitleForMatch,
  notionShouldMirrorToTodoist,
  type NotionPage,
} from "@/lib/sync/mappings";

/** A cached Notion page as the backfill reads it: every column except `raw`. */
export type MirrorCandidate = Omit<NotionPage, "raw">;

export type MirrorSelection<T> = {
  /** To create now, in creation order. */
  create: T[];
  /** Held back: an unlinked Todoist task already carries this title. */
  titleMatched: T[];
  /** Left for the next run once `limit` is spent. */
  remaining: T[];
};

/**
 * Sub-tasks whose mirror was never created, minus the ones a Todoist task may
 * already cover.
 *
 * Only rows with a `parentId` are eligible: a top-level Notion row models a
 * *project* on the dashboard rather than a task, and turning one into a Todoist
 * task is a judgement call left to the per-row "Add to Todoist" button.
 *
 * `unlinkedTodoistTitles` is the duplicate guard. A title collision means one of
 * two things — a mirror whose `task_links` row was lost, or a task typed into
 * both apps by hand — and creating a second Todoist task is the wrong answer to
 * either. Title matching is too weak to link on (see `link-backfill.ts`, where
 * proposals wait for approval), so these are reported and skipped instead. The
 * guard doubles as crash safety: a run cut off between `addTask` and the link
 * insert leaves an unlinked Todoist task behind, and the next run sees its title
 * rather than making a duplicate.
 */
export function selectMirrorCandidates<T extends MirrorCandidate>(args: {
  pages: T[];
  linkedNotionPageIds: Set<string>;
  /** Normalized titles of open Todoist tasks that no `task_links` row claims. */
  unlinkedTodoistTitles: Set<string>;
  limit: number;
}): MirrorSelection<T> {
  const eligible = args.pages.filter(
    (p) =>
      p.parentId != null &&
      !args.linkedNotionPageIds.has(p.id) &&
      notionShouldMirrorToTodoist(p),
  );

  const titleMatched: T[] = [];
  const creatable: T[] = [];
  for (const p of eligible) {
    if (args.unlinkedTodoistTitles.has(normalizeTitleForMatch(p.title))) titleMatched.push(p);
    else creatable.push(p);
  }

  creatable.sort(bySoonestThenRecent);

  return {
    create: creatable.slice(0, Math.max(args.limit, 0)),
    titleMatched,
    remaining: creatable.slice(Math.max(args.limit, 0)),
  };
}

/** When the run is capped, the tasks that are actually due should be the ones that make it. */
function bySoonestThenRecent(a: MirrorCandidate, b: MirrorCandidate): number {
  const da = scheduledAtMs(a);
  const dbb = scheduledAtMs(b);
  if (da != null && dbb != null) return da - dbb;
  if (da != null) return -1;
  if (dbb != null) return 1;
  // Undated rows last, freshest first — a sub-task added minutes ago is the one
  // being waited on.
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

function scheduledAtMs(p: MirrorCandidate): number | null {
  const d = p.dateStart ?? p.deadline;
  return d ? d.getTime() : null;
}
