/**
 * Create the Notion side of Todoist tasks that were never mirrored at all.
 *
 * The mirror image of `mirror-backfill.ts`, and the half that was missing.
 * Reconcile could already carry a Notion task into Todoist; a task typed
 * straight into Todoist had nowhere to go, because every Notion-side write path
 * is link-aware and an unlinked task has no link to be aware of. So Todoist
 * quietly accumulated work Notion had never heard of, and the dashboard — which
 * reads the Notion cache for everything except the two Todoist lists it draws
 * directly — could not show it in a project either.
 *
 * A mirrored task lands under the Notion project row whose title matches its
 * Todoist project, and under the project row named "Inbox" when nothing
 * matches — which is also where Todoist's own inbox ends up, that project being
 * called "Inbox" on both sides.
 */

import { and, eq } from "drizzle-orm";
import { db, notionPageColumns, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mapBoundedConcurrent } from "@/lib/sync/concurrency";
import { createNotionMirrorForTodoistTask } from "@/lib/sync/cross-post";
import { normalizeTitleForMatch } from "@/lib/sync/mappings";
import {
  buildProjectPageIdByTitle,
  chooseNotionParent,
  selectNotionMirrorCandidates,
} from "@/lib/sync/notion-backfill-utils";
import { createNotionTopLevelTodo } from "@/lib/sync/notion";
import { collectRecurringProjectIds } from "@/lib/sync/todoist-projects";

/**
 * The Notion project row unfiled work lands in. Named to match Todoist's own
 * inbox, so "it's in my inbox" means the same sentence in both apps.
 */
export const NOTION_INBOX_PROJECT_TITLE = "Inbox";

/**
 * Lower than the Todoist-side cap (25) on purpose. Creating one Notion page
 * costs a `pages.create` plus the read that syncs it back, against a rate limit
 * of roughly three requests a second, and this pass shares a 60s function with
 * a full refresh, the drift scan and the other backfill. `remaining` reports
 * what is left so the UI can say "run it again" rather than quietly truncating.
 */
export const NOTION_BACKFILL_LIMIT = 20;

const CREATE_CONCURRENCY = 2;

/** Cap on how many rows an audit payload names, so one run can't write a novel. */
const AUDIT_SAMPLE = 40;

export type NotionBackfillSummary = {
  /** Unlinked open Todoist tasks that should have a Notion row. */
  candidates: number;
  created: number;
  /** Filed under a Notion project row matching their Todoist project. */
  matchedProject: number;
  /** Held back because an unlinked Notion to-do already carries the title. */
  skippedTitleMatch: number;
  /** Candidates left for the next run after the per-run cap. */
  remaining: number;
  /** Run-level failure (no token, no reachable Inbox) — nothing was created. */
  error: string | null;
  errors: { todoistTaskId: string; title: string; error: string }[];
};

function emptySummary(): NotionBackfillSummary {
  return {
    candidates: 0,
    created: 0,
    matchedProject: 0,
    skippedTitleMatch: 0,
    remaining: 0,
    error: null,
    errors: [],
  };
}

export async function createMissingNotionMirrors(): Promise<NotionBackfillSummary> {
  const summary = emptySummary();

  if (!process.env.NOTION_TOKEN) {
    summary.error = "NOTION_TOKEN missing";
    await logAudit({
      source: "reconcile",
      op: "notion_backfill_skipped",
      payload: { reason: summary.error },
    });
    return summary;
  }

  const [links, tasks, projects, pages] = await Promise.all([
    db
      .select({
        notionPageId: schema.taskLinks.notionPageId,
        todoistTaskId: schema.taskLinks.todoistTaskId,
      })
      .from(schema.taskLinks),
    db.select().from(schema.todoistTasks).where(eq(schema.todoistTasks.checked, false)),
    db
      .select({
        id: schema.todoistProjects.id,
        name: schema.todoistProjects.name,
        parentId: schema.todoistProjects.parentId,
      })
      .from(schema.todoistProjects),
    db
      .select(notionPageColumns)
      .from(schema.notionPages)
      .where(
        and(
          eq(schema.notionPages.archived, false),
          eq(schema.notionPages.ignore, false),
        ),
      ),
  ]);

  const linkedNotionPageIds = new Set(links.map((l) => l.notionPageId));
  const linkedTodoistTaskIds = new Set(links.map((l) => l.todoistTaskId));
  // Project rows keep their Done ones: a finished project is still where its
  // name points, and dropping it would only mean a second row by that name.
  const projectRows = pages.filter((p) => p.parentId == null);
  const unlinkedNotionTitles = new Set(
    pages
      .filter((p) => p.parentId != null && p.status !== "Done" && !linkedNotionPageIds.has(p.id))
      .map((p) => normalizeTitleForMatch(p.title)),
  );

  const selection = selectNotionMirrorCandidates({
    tasks,
    linkedTodoistTaskIds,
    excludedProjectIds: collectRecurringProjectIds(projects),
    unlinkedNotionTitles,
    limit: NOTION_BACKFILL_LIMIT,
  });

  summary.candidates =
    selection.create.length + selection.titleMatched.length + selection.remaining.length;
  summary.skippedTitleMatch = selection.titleMatched.length;
  summary.remaining = selection.remaining.length;

  if (selection.titleMatched.length) {
    // These survived `adoptExactTitleMatches`, so each is a title more than one
    // row on a side lays claim to. Only the user can say which is which.
    await logAudit({
      source: "reconcile",
      op: "notion_backfill_title_match_skipped",
      payload: {
        count: selection.titleMatched.length,
        tasks: selection.titleMatched
          .slice(0, AUDIT_SAMPLE)
          .map((t) => ({ todoistTaskId: t.id, title: t.content })),
      },
    });
  }

  if (!selection.create.length) {
    await logAudit({
      source: "reconcile",
      op: "notion_backfill",
      payload: summary as unknown as Record<string, unknown>,
    });
    return summary;
  }

  let inboxPageId: string;
  try {
    inboxPageId = await resolveInboxPageId(projectRows);
  } catch (e) {
    summary.error = (e as Error).message;
    await logAudit({
      source: "reconcile",
      op: "notion_backfill_error",
      payload: { candidates: summary.candidates },
      error: summary.error,
    });
    return summary;
  }

  // Inbox needs no special case in the name map — it is one of these rows, and
  // a Todoist project called "Inbox" finds it by name like any other.
  const projectPageIdByTitle = buildProjectPageIdByTitle(
    projectRows.map((p) => ({ id: p.id, title: p.title })),
  );
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  await mapBoundedConcurrent(selection.create, CREATE_CONCURRENCY, async (t) => {
    const choice = chooseNotionParent({
      projectName: t.projectId ? projectNameById.get(t.projectId) ?? null : null,
      projectPageIdByTitle,
      inboxPageId,
    });
    try {
      await createNotionMirrorForTodoistTask(t, choice.notionParentPageId);
      summary.created++;
      if (choice.matchedProjectTitle) summary.matchedProject++;
      await logAudit({
        source: "reconcile",
        op: "notion_backfill_created",
        payload: {
          todoistTaskId: t.id,
          title: t.content,
          notionParentPageId: choice.notionParentPageId,
          matchedProject: choice.matchedProjectTitle,
        },
      });
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ todoistTaskId: t.id, title: t.content, error: msg });
      await logAudit({
        source: "reconcile",
        op: "notion_backfill_error",
        payload: { todoistTaskId: t.id, title: t.content },
        error: msg,
      });
    }
  });

  await logAudit({
    source: "reconcile",
    op: "notion_backfill",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}

/**
 * The top-level Notion row named "Inbox", created if the workspace has none.
 *
 * Sorted by id before picking, so two rows sharing the name always resolve to
 * the same one run after run — tasks scattering across duplicates depending on
 * row order would be worse than either choice.
 */
async function resolveInboxPageId(
  projectRows: { id: string; title: string }[],
): Promise<string> {
  const want = normalizeTitleForMatch(NOTION_INBOX_PROJECT_TITLE);
  const existing = projectRows
    .filter((p) => normalizeTitleForMatch(p.title) === want)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (existing.length) return existing[0].id;

  const { pageId } = await createNotionTopLevelTodo(NOTION_INBOX_PROJECT_TITLE);
  await logAudit({
    source: "reconcile",
    op: "notion_backfill_created_inbox",
    payload: { notionPageId: pageId, title: NOTION_INBOX_PROJECT_TITLE },
  });
  return pageId;
}
