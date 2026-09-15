/**
 * File linked tasks out of the Todoist inbox into the project Notion says they
 * belong in.
 *
 * Why this exists: nothing in the sync has ever moved a task between Todoist
 * projects. The create passes choose a project once, at creation, and every
 * repair path after that touches fields only — `syncHash` folds in
 * `page.categoryId ?? task.projectId`, never both, so a page and its task
 * disagreeing about which project they are in does not even register as drift.
 *
 * That leaves one gap wide open, and it is the common one.
 * `createMissingNotionMirrors` files a task captured in the Todoist inbox under
 * Notion's own Inbox row, because that is the honest place for something not
 * yet filed. File it properly in Notion later — drag the page into a real
 * project, which is the whole point of having projects — and the Todoist side
 * never hears about it. The task sits in the inbox for good, and the dashboard
 * goes on drawing it in the "Personal" list it reads straight off that inbox.
 *
 * So this pass runs last in a reconcile, once the links it needs exist and the
 * drift scan has settled everything else, and moves each such task into the
 * Todoist project whose name matches its Notion project — falling back to the
 * "Notion" project that every mirror already lives in.
 */

import { eq, isNull } from "drizzle-orm";
import { TodoistApi } from "@doist/todoist-api-typescript";
import { db, schema } from "@/lib/db";
import { logAudit } from "@/lib/sync/audit";
import { mapBoundedConcurrent } from "@/lib/sync/concurrency";
import { MIRROR_PROJECT_NAME } from "@/lib/sync/mirror-backfill";
import { NOTION_INBOX_PROJECT_TITLE } from "@/lib/sync/notion-backfill";
import { refreshTaskLinkHash } from "@/lib/sync/orchestrator";
import {
  buildTodoistProjectIdByName,
  planRefileMoves,
  type RefileMove,
} from "@/lib/sync/project-refile-utils";
import { getInboxProjectId, syncTodoistTasksByIds } from "@/lib/sync/todoist";
import { normalizeProjectName } from "@/lib/sync/todoist-projects";

/**
 * Most tasks one run will move. Each costs a move plus the read that syncs the
 * new project back, on an API budget already shared with a full refresh, the
 * drift scan and both create passes inside a 60s function. The first run after
 * this ships has however long the inbox has been drifting behind it; every run
 * after that has a handful at most. `remaining` reports what is left so the UI
 * can say "run it again" rather than quietly truncating.
 */
export const PROJECT_REFILE_LIMIT = 30;

const MOVE_CONCURRENCY = 3;

/** Cap on how many rows an audit payload names, so one run can't write a novel. */
const AUDIT_SAMPLE = 40;

export type ProjectRefileSummary = {
  /** Inbox tasks whose Notion project says they belong somewhere else. */
  candidates: number;
  moved: number;
  /** Landed in a same-named Todoist project rather than the fallback. */
  matchedByName: number;
  /** Todoist sub-tasks left alone — a project move would detach them. */
  skippedSubtasks: number;
  /** Nowhere to go: no same-named project, and no fallback project either. */
  unresolved: number;
  /** Candidates left for the next run after the per-run cap. */
  remaining: number;
  /** Run-level failure (no token, no reachable inbox) — nothing was moved. */
  error: string | null;
  errors: { todoistTaskId: string; title: string; error: string }[];
};

function emptySummary(): ProjectRefileSummary {
  return {
    candidates: 0,
    moved: 0,
    matchedByName: 0,
    skippedSubtasks: 0,
    unresolved: 0,
    remaining: 0,
    error: null,
    errors: [],
  };
}

function todoistApi() {
  const token = process.env.TODOIST_TOKEN;
  if (!token) throw new Error("TODOIST_TOKEN missing");
  return new TodoistApi(token);
}

export async function refileInboxTasks(): Promise<ProjectRefileSummary> {
  const summary = emptySummary();

  if (!process.env.TODOIST_TOKEN) {
    summary.error = "TODOIST_TOKEN missing";
    await logAudit({
      source: "reconcile",
      op: "project_refile_skipped",
      payload: { reason: summary.error },
    });
    return summary;
  }

  const [links, pages, tasks, projects] = await Promise.all([
    // Links with a write in flight are left for the next run. The destination
    // is read from `page.parentId`, so a dashboard "move to project" mid-flight
    // — which marks the link and then re-parents the page — would otherwise be
    // read at its old parent and the task filed into the project it is being
    // moved out of. No freshness check is needed: the drift scan runs earlier
    // in the same reconcile and clears every stale marker, so a marker still
    // standing here is one set during this run.
    db
      .select({
        id: schema.taskLinks.id,
        notionPageId: schema.taskLinks.notionPageId,
        todoistTaskId: schema.taskLinks.todoistTaskId,
      })
      .from(schema.taskLinks)
      .where(isNull(schema.taskLinks.pendingOrigin)),
    // Every page, project rows included: a to-do's destination is its parent's
    // title, so the parents have to be in the map the planner walks.
    db
      .select({
        id: schema.notionPages.id,
        parentId: schema.notionPages.parentId,
        title: schema.notionPages.title,
        status: schema.notionPages.status,
        archived: schema.notionPages.archived,
        ignore: schema.notionPages.ignore,
      })
      .from(schema.notionPages),
    db
      .select({
        id: schema.todoistTasks.id,
        projectId: schema.todoistTasks.projectId,
        parentId: schema.todoistTasks.parentId,
        content: schema.todoistTasks.content,
        checked: schema.todoistTasks.checked,
      })
      .from(schema.todoistTasks)
      .where(eq(schema.todoistTasks.checked, false)),
    db
      .select({
        id: schema.todoistProjects.id,
        name: schema.todoistProjects.name,
        archived: schema.todoistProjects.archived,
      })
      .from(schema.todoistProjects),
  ]);

  // Asked of the API rather than read off the cached rows: the inbox flag is
  // spelled four different ways across API versions and `getInboxProjectId`
  // already knows all of them. Getting this wrong would be expensive in the one
  // direction that matters — a project misread as the inbox is a project this
  // pass would start emptying.
  let inboxProjectId: string;
  try {
    inboxProjectId = await getInboxProjectId();
  } catch (e) {
    summary.error = (e as Error).message;
    await logAudit({
      source: "reconcile",
      op: "project_refile_error",
      payload: { links: links.length },
      error: summary.error,
    });
    return summary;
  }

  // Resolved from the cache the run has just refreshed, rather than through
  // `resolveMirrorProjectId`: that one falls back to the inbox when the "Notion"
  // project is missing, which for a pass whose whole job is emptying the inbox
  // would turn every unmatched task into a move to where it already is. No
  // "Notion" project means those tasks are reported as unresolved instead.
  const fallbackId = buildTodoistProjectIdByName(projects).get(
    normalizeProjectName(MIRROR_PROJECT_NAME),
  );
  const fallbackProject =
    fallbackId && fallbackId !== inboxProjectId
      ? { id: fallbackId, name: MIRROR_PROJECT_NAME }
      : null;

  const plan = planRefileMoves({
    links,
    pages,
    tasks,
    todoistProjects: projects,
    inboxProjectId,
    notionInboxTitle: NOTION_INBOX_PROJECT_TITLE,
    fallbackProject,
    limit: PROJECT_REFILE_LIMIT,
  });

  summary.candidates =
    plan.moves.length +
    plan.remaining.length +
    plan.unresolved.length +
    plan.skippedSubtasks.length;
  summary.skippedSubtasks = plan.skippedSubtasks.length;
  summary.unresolved = plan.unresolved.length;
  summary.remaining = plan.remaining.length;

  if (plan.unresolved.length) {
    // Worth naming: every one of these is a Notion project with no Todoist home
    // and no fallback, which only happens when the "Notion" project has been
    // renamed or deleted. Silence would read as "nothing to file".
    await logAudit({
      source: "reconcile",
      op: "project_refile_unresolved",
      payload: {
        count: plan.unresolved.length,
        fallback: fallbackProject?.name ?? null,
        tasks: plan.unresolved.slice(0, AUDIT_SAMPLE).map((c) => ({
          todoistTaskId: c.todoistTaskId,
          title: c.title,
          notionProject: c.notionProjectTitle,
        })),
      },
    });
  }

  if (plan.skippedSubtasks.length) {
    await logAudit({
      source: "reconcile",
      op: "project_refile_skipped_subtasks",
      payload: {
        count: plan.skippedSubtasks.length,
        tasks: plan.skippedSubtasks.slice(0, AUDIT_SAMPLE).map((c) => ({
          todoistTaskId: c.todoistTaskId,
          title: c.title,
        })),
      },
    });
  }

  if (!plan.moves.length) {
    await logAudit({
      source: "reconcile",
      op: "project_refile",
      payload: summary as unknown as Record<string, unknown>,
    });
    return summary;
  }

  const api = todoistApi();
  await mapBoundedConcurrent(plan.moves, MOVE_CONCURRENCY, async (move) => {
    try {
      await applyMove(api, move);
      summary.moved++;
      if (move.matchedByName) summary.matchedByName++;
      await logAudit({
        source: "reconcile",
        op: "project_refile_moved",
        payload: {
          todoistTaskId: move.todoistTaskId,
          notionPageId: move.notionPageId,
          title: move.title,
          notionProject: move.notionProjectTitle,
          toProject: move.toProjectName,
          matchedByName: move.matchedByName,
        },
      });
    } catch (e) {
      const msg = (e as Error).message;
      summary.errors.push({ todoistTaskId: move.todoistTaskId, title: move.title, error: msg });
      await logAudit({
        source: "reconcile",
        op: "project_refile_error",
        payload: {
          todoistTaskId: move.todoistTaskId,
          title: move.title,
          toProject: move.toProjectName,
        },
        error: msg,
      });
    }
  });

  await logAudit({
    source: "reconcile",
    op: "project_refile",
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}

/**
 * Move one task, then put the cache and the link's hash back in step with it.
 *
 * The refresh is not bookkeeping for its own sake. `hashForPair` reads
 * `page.categoryId ?? task.projectId`, so for a page with no category the
 * project this pass just changed is *in* the hash: leave the cached row stale
 * and the next run's drift scan reads the pair as changed and mirrors one side
 * over the other to discover nothing differs. Re-reading the task and
 * recomputing the hash here costs one request and spares that round trip.
 *
 * Doing it after the drift scan in the same run is what makes rewriting the
 * hash safe — any real drift has already been repaired and the hash freshly
 * written, so the only field this changes is the project.
 */
async function applyMove(api: TodoistApi, move: RefileMove): Promise<void> {
  await api.moveTask(move.todoistTaskId, { projectId: move.toProjectId });
  await syncTodoistTasksByIds([move.todoistTaskId]);
  await refreshTaskLinkHash(move.linkId);
}
