/**
 * Adopt the pairs that were obviously the same task all along.
 *
 * Runs first in a reconcile, before the drift scan and before either create
 * pass, because a link written here turns a would-be duplicate into a pair the
 * rest of the run can repair.
 */

import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { pairExactTitleMatches } from "@/lib/sync/link-adoption-utils";
import { collectRecurringProjectIds } from "@/lib/sync/todoist-projects";

/** Cap on how many rows an audit payload names, so one run can't write a novel. */
const AUDIT_SAMPLE = 40;

/**
 * A hash no `hashForPair` result can equal, since that returns a non-empty hex
 * string. Storing it means the drift scan later in the same run sees the pair
 * as changed and mirrors the newer side over the older one, rather than taking
 * a snapshot of two rows that disagree and calling it in-sync.
 */
const FORCE_DRIFT_HASH = "";

export type LinkAdoptionSummary = {
  /** Titles carried by unlinked rows on both sides. */
  candidates: number;
  adopted: number;
  /** Titles with more than one row on a side — left for a human to resolve. */
  ambiguous: number;
  errors: { notionPageId: string; todoistTaskId: string; error: string }[];
};

export async function adoptExactTitleMatches(): Promise<LinkAdoptionSummary> {
  const summary: LinkAdoptionSummary = {
    candidates: 0,
    adopted: 0,
    ambiguous: 0,
    errors: [],
  };

  const [links, pages, tasks, projects] = await Promise.all([
    db
      .select({
        notionPageId: schema.taskLinks.notionPageId,
        todoistTaskId: schema.taskLinks.todoistTaskId,
      })
      .from(schema.taskLinks),
    db
      .select({ id: schema.notionPages.id, title: schema.notionPages.title })
      .from(schema.notionPages)
      .where(
        and(
          // Sub-tasks only, to match what the Todoist side can ever be: a
          // top-level row is a project, and no Todoist task stands for one.
          isNotNull(schema.notionPages.parentId),
          eq(schema.notionPages.archived, false),
          eq(schema.notionPages.ignore, false),
          // `status` is nullable and SQL `<>` drops nulls, so an unset
          // status has to be spelled out rather than assumed open.
          or(ne(schema.notionPages.status, "Done"), isNull(schema.notionPages.status)),
        ),
      ),
    db
      .select({
        id: schema.todoistTasks.id,
        content: schema.todoistTasks.content,
        projectId: schema.todoistTasks.projectId,
      })
      .from(schema.todoistTasks)
      .where(eq(schema.todoistTasks.checked, false)),
    db
      .select({
        id: schema.todoistProjects.id,
        name: schema.todoistProjects.name,
        parentId: schema.todoistProjects.parentId,
      })
      .from(schema.todoistProjects),
  ]);

  const linkedNotionPageIds = new Set(links.map((l) => l.notionPageId));
  const linkedTodoistTaskIds = new Set(links.map((l) => l.todoistTaskId));
  // Habits are out of the sync entirely, so a habit that happens to share a
  // title with a Notion task must not be adopted into one.
  const recurringProjectIds = collectRecurringProjectIds(projects);

  const pairing = pairExactTitleMatches({
    notionPages: pages.filter((p) => !linkedNotionPageIds.has(p.id)),
    todoistTasks: tasks
      .filter(
        (t) =>
          !linkedTodoistTaskIds.has(t.id) &&
          !(t.projectId != null && recurringProjectIds.has(t.projectId)),
      )
      .map((t) => ({ id: t.id, title: t.content })),
  });

  summary.candidates = pairing.adopt.length + pairing.ambiguous.length;
  summary.ambiguous = pairing.ambiguous.length;

  if (pairing.ambiguous.length) {
    await logAudit({
      source: "reconcile",
      op: "link_adoption_ambiguous",
      payload: {
        count: pairing.ambiguous.length,
        titles: pairing.ambiguous.slice(0, AUDIT_SAMPLE),
      },
    });
  }

  for (const pair of pairing.adopt) {
    try {
      // One row at a time, and `onConflictDoNothing` on top: both sides carry a
      // unique index, so a concurrent run that got there first should be a
      // no-op rather than an aborted batch.
      const written = await db
        .insert(schema.taskLinks)
        .values({
          id: crypto.randomUUID(),
          notionPageId: pair.notionPageId,
          todoistTaskId: pair.todoistTaskId,
          lastSyncHash: FORCE_DRIFT_HASH,
          lastSyncAt: new Date(),
          pendingOrigin: null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.taskLinks.id });
      // Nothing returned means the conflict clause swallowed it; counting it
      // would tell the user a link was made when one already existed.
      if (written.length) summary.adopted++;
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({
        notionPageId: pair.notionPageId,
        todoistTaskId: pair.todoistTaskId,
        error: msg,
      });
      await logAudit({
        source: "reconcile",
        op: "link_adoption_error",
        payload: { ...pair },
        error: msg,
      });
    }
  }

  if (pairing.adopt.length) {
    await logAudit({
      source: "reconcile",
      op: "link_adoption_adopted",
      payload: {
        count: summary.adopted,
        pairs: pairing.adopt.slice(0, AUDIT_SAMPLE),
      },
    });
  }

  await logAudit({
    source: "reconcile",
    op: "link_adoption",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}
