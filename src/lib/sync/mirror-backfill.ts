/**
 * Create the Todoist side of Notion tasks that were never mirrored at all.
 *
 * Why this exists: every automatic Notion → Todoist path is link-aware, and a
 * task typed into Notion has no link yet. The webhook calls
 * `mirrorTodoistFromNotion`, which returns immediately when `task_links` has no
 * row; `reconcileAllLinks` walks `task_links` itself, so it never sees the page
 * either. The task therefore shows up on the dashboard — which reads the Notion
 * cache directly — while Todoist never hears about it, and the only cure was
 * running `scripts/push-notion-subtasks-to-notion-todoist-project.ts` by hand.
 * Reconcile now closes that gap on the same cadence it fixes drift.
 */

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, notionPageColumns, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mapBoundedConcurrent } from "@/lib/sync/concurrency";
import { pushNotionPageToTodoist } from "@/lib/sync/cross-post";
import { normalizeTitleForMatch } from "@/lib/sync/mappings";
import { selectMirrorCandidates } from "@/lib/sync/mirror-backfill-utils";
import { getInboxProjectId, getTodoistProjectIdByName } from "@/lib/sync/todoist";

/**
 * Where mirrored Notion tasks live in Todoist. Every mirror made so far sits in a
 * project called "Notion" — see
 * `scripts/push-notion-subtasks-to-notion-todoist-project.ts`, the manual version
 * of this pass — and that is worth keeping: the dashboard reads the Todoist inbox
 * as the "Personal" list, where a project's sub-tasks do not belong.
 *
 * The inbox is the fallback rather than the default, so a renamed or deleted
 * project degrades instead of throwing. Resolving a destination by name with no
 * fallback is what broke every Todoist write path when the "Personal" project was
 * deleted.
 */
export const MIRROR_PROJECT_NAME = "Notion";

/**
 * Most tasks one run will create. The first run after this shipped has a whole
 * backlog behind it, and emptying it into Todoist in one go — on an API budget
 * shared with the drift pass, inside a 60s function — is worse than spreading it
 * over a few runs. `remaining` reports what is left so the UI can say so.
 */
export const MIRROR_BACKFILL_LIMIT = 25;

const CREATE_CONCURRENCY = 3;

/** Cap on how many rows an audit payload names, so one run can't write a novel. */
const AUDIT_SAMPLE = 40;

export type MirrorBackfillSummary = {
  /** Unlinked Notion sub-tasks that should have a Todoist mirror. */
  candidates: number;
  created: number;
  /** Held back because an unlinked Todoist task already carries the title. */
  skippedTitleMatch: number;
  /** Candidates left for the next run after the per-run cap. */
  remaining: number;
  /** Run-level failure (no token, no reachable project) — nothing was created. */
  error: string | null;
  errors: { notionPageId: string; title: string; error: string }[];
};

function emptySummary(): MirrorBackfillSummary {
  return {
    candidates: 0,
    created: 0,
    skippedTitleMatch: 0,
    remaining: 0,
    error: null,
    errors: [],
  };
}

/**
 * How long a claim on a page holds. Notion sends several events for one new
 * page within seconds of each other; a few minutes covers that burst without
 * blocking a retry once it is clearly over.
 */
const CLAIM_WINDOW = sql`interval '2 minutes'`;

/**
 * Of `pageIds`, the ones this caller may create a Todoist task for.
 *
 * Webhook deliveries for one new page run concurrently, each on its own
 * function instance, and nothing else stops them all reading "no link yet" and
 * each calling `addTask`. The DB is Neon over HTTP, so there are no session
 * locks or transactions to lean on; instead each caller inserts a claim row and
 * then reads back the earliest one for the page. Both steps commit on their own,
 * so whoever reads second sees the first's row, and every caller that sees both
 * agrees on the same earliest `(ts, id)`.
 */
async function claimPagesForMirroring(pageIds: string[]): Promise<string[]> {
  const won: string[] = [];
  for (const notionPageId of pageIds) {
    const { id: claimId } = await logAudit({
      source: "webhook-notion",
      op: "mirror_claim",
      payload: { notionPageId },
    });
    const [first] = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.source, "webhook-notion"),
          eq(schema.auditLog.op, "mirror_claim"),
          sql`${schema.auditLog.payload}->>'notionPageId' = ${notionPageId}`,
          sql`${schema.auditLog.ts} > now() - ${CLAIM_WINDOW}`,
        ),
      )
      .orderBy(asc(schema.auditLog.ts), asc(schema.auditLog.id))
      .limit(1);
    if (first?.id === claimId) won.push(notionPageId);
  }
  return won;
}

/**
 * `onlyPageIds` narrows the pass to pages a webhook just synced, so a new Notion
 * task reaches Todoist in seconds rather than at the next reconcile. It is the
 * same selection — same eligibility and title-match guard — plus the claim above.
 */
export async function createMissingTodoistMirrors(options?: {
  onlyPageIds?: string[];
}): Promise<MirrorBackfillSummary> {
  const summary = emptySummary();
  const onlyPageIds = options?.onlyPageIds;

  if (!process.env.TODOIST_TOKEN) {
    summary.error = "TODOIST_TOKEN missing";
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill_skipped",
      payload: { reason: summary.error },
    });
    return summary;
  }

  const [links, pages, openTasks] = await Promise.all([
    db
      .select({
        notionPageId: schema.taskLinks.notionPageId,
        todoistTaskId: schema.taskLinks.todoistTaskId,
      })
      .from(schema.taskLinks),
    db
      .select(notionPageColumns)
      .from(schema.notionPages)
      .where(
        and(
          isNotNull(schema.notionPages.parentId),
          eq(schema.notionPages.archived, false),
          eq(schema.notionPages.ignore, false),
          onlyPageIds ? inArray(schema.notionPages.id, onlyPageIds) : undefined,
        ),
      ),
    db
      .select({ id: schema.todoistTasks.id, content: schema.todoistTasks.content })
      .from(schema.todoistTasks)
      .where(eq(schema.todoistTasks.checked, false)),
  ]);

  const linkedNotionPageIds = new Set(links.map((l) => l.notionPageId));
  const linkedTodoistTaskIds = new Set(links.map((l) => l.todoistTaskId));
  const unlinkedTodoistTitles = new Set(
    openTasks
      .filter((t) => !linkedTodoistTaskIds.has(t.id))
      .map((t) => normalizeTitleForMatch(t.content)),
  );

  const selection = selectMirrorCandidates({
    pages,
    linkedNotionPageIds,
    unlinkedTodoistTitles,
    limit: MIRROR_BACKFILL_LIMIT,
  });

  summary.candidates =
    selection.create.length + selection.titleMatched.length + selection.remaining.length;
  summary.skippedTitleMatch = selection.titleMatched.length;
  summary.remaining = selection.remaining.length;

  if (selection.titleMatched.length) {
    // Worth naming: each one is either a link that went missing or a task the
    // user keeps in both apps by hand, and only they can tell which.
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill_title_match_skipped",
      payload: {
        count: selection.titleMatched.length,
        pages: selection.titleMatched
          .slice(0, AUDIT_SAMPLE)
          .map((p) => ({ notionPageId: p.id, title: p.title })),
      },
    });
  }

  if (onlyPageIds && selection.create.length) {
    const claimed = new Set(
      await claimPagesForMirroring(selection.create.map((p) => p.id)),
    );
    selection.create = selection.create.filter((p) => claimed.has(p.id));
  }

  if (!selection.create.length) {
    // A scoped run fires on every webhook; only log the ones that found something.
    if (onlyPageIds && summary.candidates === 0) return summary;
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill",
      payload: summary as unknown as Record<string, unknown>,
    });
    return summary;
  }

  // Resolved once for the run: `pushNotionPageToTodoist` otherwise fetches the
  // whole project list per task just to find its destination.
  let destination: { id: string; name: string };
  try {
    destination = await resolveMirrorProjectId();
  } catch (e) {
    summary.error = (e as Error).message;
    await logAudit({
      source: "reconcile",
      op: "mirror_backfill_error",
      payload: { candidates: summary.candidates },
      error: summary.error,
    });
    return summary;
  }
  await logAudit({
    source: "reconcile",
    op: "mirror_backfill_destination",
    payload: {
      project: destination.name,
      projectId: destination.id,
      creating: selection.create.length,
    },
  });

  await mapBoundedConcurrent(selection.create, CREATE_CONCURRENCY, async (p) => {
    try {
      await pushNotionPageToTodoist(p.id, { todoistProjectId: destination.id });
      summary.created++;
      await logAudit({
        source: "reconcile",
        op: "mirror_backfill_created",
        payload: { notionPageId: p.id, title: p.title },
      });
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ notionPageId: p.id, title: p.title, error: msg });
      await logAudit({
        source: "reconcile",
        op: "mirror_backfill_error",
        payload: { notionPageId: p.id, title: p.title },
        error: msg,
      });
    }
  });

  await logAudit({
    source: "reconcile",
    op: "mirror_backfill",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}

/** The "Notion" project when it exists, the inbox when it doesn't. */
async function resolveMirrorProjectId(): Promise<{ id: string; name: string }> {
  try {
    return {
      id: await getTodoistProjectIdByName(MIRROR_PROJECT_NAME),
      name: MIRROR_PROJECT_NAME,
    };
  } catch {
    return { id: await getInboxProjectId(), name: "Inbox" };
  }
}
