/**
 * Pure pairing for the link-adoption pass. Split out for the same reason as
 * `orphan-replay-utils.ts`: no database, no API client, so the rule that
 * decides what counts as "obviously the same task" can be tested directly.
 */

import { normalizeTitleForMatch } from "@/lib/sync/mappings";

export type AdoptionRow = { id: string; title: string };

export type AdoptedPair = {
  notionPageId: string;
  todoistTaskId: string;
  title: string;
};

export type AmbiguousTitle = {
  title: string;
  notionPageIds: string[];
  todoistTaskIds: string[];
};

export type AdoptionPairing = {
  /** One open Notion row, one open Todoist row, same title: link them. */
  adopt: AdoptedPair[];
  /** Two or more on either side — reported, never guessed at. */
  ambiguous: AmbiguousTitle[];
};

/**
 * Pair unlinked rows that share a title exactly one-for-one.
 *
 * Why this exists: both create passes hold back a row whose title an unlinked
 * row on the other side already carries, because creating a second copy is the
 * wrong answer to a lost link. Correct, but on its own it never resolves —
 * reconcile would report the same held-back rows every run and the two apps
 * would stay out of step, which is the opposite of what the button promises.
 *
 * A one-to-one title match is the case where "these are the same task" is not a
 * guess: exactly one open Notion row and exactly one open Todoist row carry
 * that title, and nothing else in either app is competing for it. Adopting the
 * pair writes the `task_links` row the mirror was always missing, and the drift
 * pass that runs next settles whose fields win.
 *
 * Anything else — two Notion rows called "Book flights", or one Notion row and
 * three Todoist ones — stays ambiguous and is reported. `link-backfill.ts` is
 * where a human resolves those, and this pass is not entitled to pick for them.
 *
 * Callers pass rows they have already filtered to open and unlinked; the
 * pairing itself has no opinion about status.
 */
export function pairExactTitleMatches(args: {
  notionPages: AdoptionRow[];
  todoistTasks: AdoptionRow[];
}): AdoptionPairing {
  const notionByTitle = groupByTitle(args.notionPages);
  const todoistByTitle = groupByTitle(args.todoistTasks);

  const adopt: AdoptedPair[] = [];
  const ambiguous: AmbiguousTitle[] = [];

  for (const [key, pages] of notionByTitle) {
    const tasks = todoistByTitle.get(key);
    if (!tasks?.length) continue;

    if (pages.length === 1 && tasks.length === 1) {
      adopt.push({
        notionPageId: pages[0].id,
        todoistTaskId: tasks[0].id,
        title: pages[0].title,
      });
      continue;
    }

    ambiguous.push({
      title: pages[0].title,
      notionPageIds: pages.map((p) => p.id),
      todoistTaskIds: tasks.map((t) => t.id),
    });
  }

  return { adopt, ambiguous };
}

function groupByTitle(rows: AdoptionRow[]): Map<string, AdoptionRow[]> {
  const byTitle = new Map<string, AdoptionRow[]>();
  for (const row of rows) {
    const key = normalizeTitleForMatch(row.title);
    if (!key) continue;
    const arr = byTitle.get(key) ?? [];
    arr.push(row);
    byTitle.set(key, arr);
  }
  return byTitle;
}
