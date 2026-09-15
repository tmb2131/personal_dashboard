/**
 * Pure planning for the project-refile pass: which linked tasks the Todoist
 * inbox is holding on to, and which project each one belongs in. Split out for
 * the same reason as `notion-backfill-utils.ts` — no database and no API
 * client, so the rule that decides where a task goes can be tested directly.
 *
 * The rule is the mirror image of `chooseNotionParent`. That one files a
 * Todoist task under the Notion project row sharing its project's name, and
 * under Notion's Inbox row when nothing matches. This one reads a Notion page's
 * project and finds the Todoist project sharing *its* title, falling back to
 * the one project every Notion mirror already lives in. Both sides therefore
 * agree on what "the same project" means: an exact, case-insensitive title
 * match, with a named home for everything that doesn't have one.
 */

import { normalizeTitleForMatch, type NotionPage } from "@/lib/sync/mappings";

/** A `task_links` row as the pass reads it. */
export type RefileLink = {
  id: string;
  notionPageId: string;
  todoistTaskId: string;
};

/**
 * A cached Notion page, whether it is a to-do or one of the top-level rows the
 * dashboard draws as a project. Both come out of the same table and the pass
 * needs both: the to-do to know it is filed, its parent to know where.
 */
export type RefilePage = {
  id: string;
  parentId: string | null;
  title: string;
  status: NotionPage["status"];
  archived: boolean;
  ignore: boolean;
};

export type RefileTask = {
  id: string;
  projectId: string | null;
  parentId: string | null;
  content: string;
  checked: boolean;
};

export type RefileProject = {
  id: string;
  name: string;
  archived: boolean;
};

export type RefileCandidate = {
  linkId: string;
  notionPageId: string;
  todoistTaskId: string;
  /** Todoist content, so the audit trail and error rows name something human. */
  title: string;
  /** Title of the Notion project row the page hangs from. */
  notionProjectTitle: string;
};

export type RefileMove = RefileCandidate & {
  toProjectId: string;
  toProjectName: string;
  /** A Todoist project of the same name, rather than the shared fallback. */
  matchedByName: boolean;
};

export type RefilePlan = {
  /** To move now, capped at `limit`. */
  moves: RefileMove[];
  /** Left for the next run once `limit` is spent. */
  remaining: RefileMove[];
  /** No same-named Todoist project, and no fallback project to land in. */
  unresolved: RefileCandidate[];
  /**
   * Todoist sub-tasks, left where they are. The move endpoint takes exactly one
   * of project, section or parent, so filing one into a project would cut it
   * loose from the task it hangs under — a bigger change to someone's Todoist
   * than "reconcile tidied my inbox" is entitled to make.
   */
  skippedSubtasks: RefileCandidate[];
};

/**
 * Normalized project name → id, skipping any name two projects share.
 *
 * Duplicate names are dropped rather than guessed at, exactly as
 * `buildProjectPageIdByTitle` drops duplicate Notion titles: picking either one
 * would be a coin toss the user cannot see, and the fallback project is an
 * answer that can be defended. Archived projects are not destinations at all.
 */
export function buildTodoistProjectIdByName(projects: RefileProject[]): Map<string, string> {
  const byName = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const p of projects) {
    if (p.archived) continue;
    const key = normalizeTitleForMatch(p.name);
    if (!key) continue;
    if (byName.has(key)) {
      ambiguous.add(key);
      continue;
    }
    byName.set(key, p.id);
  }
  for (const key of ambiguous) byName.delete(key);
  return byName;
}

/**
 * Plan every move this run should make.
 *
 * Only tasks currently sitting in the Todoist inbox are considered, and only
 * ever to move them out: a task already filed somewhere is one the user put
 * there, and re-filing it would make reconcile argue with them. The Notion side
 * is what says where it belongs, so a page filed under Notion's own Inbox row —
 * or under nothing at all — leaves its task in the Todoist inbox, which is the
 * same statement in both apps.
 *
 * Nothing here is remembered between runs, which is deliberate: drag a filed
 * task back into the inbox and the next run files it again. Notion's filing is
 * the one source of truth, and a pass that could be talked out of it by a drag
 * would go quiet exactly when the two apps had drifted apart.
 *
 * `notionInboxTitle` and `fallbackProject` are passed in rather than read from
 * a constant so this file stays free of the modules that own them — and so a
 * test can state both outright instead of inheriting them.
 */
export function planRefileMoves(args: {
  links: RefileLink[];
  /** Every cached page the links might reach: the to-dos and their parents. */
  pages: RefilePage[];
  tasks: RefileTask[];
  todoistProjects: RefileProject[];
  /** The Todoist inbox: the only project this pass ever moves a task out of. */
  inboxProjectId: string;
  /** Notion project title meaning "not filed yet" — its tasks stay put. */
  notionInboxTitle: string;
  /** Where a Notion project with no same-named Todoist project sends its tasks. */
  fallbackProject: { id: string; name: string } | null;
  limit: number;
}): RefilePlan {
  const pageById = new Map(args.pages.map((p) => [p.id, p]));
  const taskById = new Map(args.tasks.map((t) => [t.id, t]));
  const projectIdByName = buildTodoistProjectIdByName(args.todoistProjects);
  const inboxKey = normalizeTitleForMatch(args.notionInboxTitle);

  const planned: RefileMove[] = [];
  const unresolved: RefileCandidate[] = [];
  const skippedSubtasks: RefileCandidate[] = [];

  for (const link of args.links) {
    const page = pageById.get(link.notionPageId);
    const task = taskById.get(link.todoistTaskId);
    // A link naming a row neither cache has is the drift scan's to report, not
    // this pass's to act on.
    if (!page || !task) continue;

    // Only what the inbox is currently holding, and only if it is still work.
    if (task.projectId !== args.inboxProjectId) continue;
    if (task.checked) continue;
    if (page.archived || page.ignore || page.status === "Done") continue;

    // Filed in Notion, under a project that isn't Inbox.
    if (!page.parentId) continue;
    const project = pageById.get(page.parentId);
    const projectTitle = project?.title.trim();
    if (!projectTitle) continue;
    if (normalizeTitleForMatch(projectTitle) === inboxKey) continue;

    const candidate: RefileCandidate = {
      linkId: link.id,
      notionPageId: page.id,
      todoistTaskId: task.id,
      title: task.content,
      notionProjectTitle: projectTitle,
    };

    if (task.parentId != null) {
      skippedSubtasks.push(candidate);
      continue;
    }

    const matchedId = projectIdByName.get(normalizeTitleForMatch(projectTitle));
    const destination = matchedId
      ? { id: matchedId, name: projectTitle, matchedByName: true }
      : args.fallbackProject
        ? { ...args.fallbackProject, matchedByName: false }
        : null;

    if (!destination) {
      unresolved.push(candidate);
      continue;
    }
    // A destination that resolves back to the inbox is not a move. It takes a
    // Notion project named for the inbox in another spelling to get here, and
    // calling the API to put a task where it already is would burn a request to
    // report work that never happened.
    if (destination.id === args.inboxProjectId) continue;

    planned.push({
      ...candidate,
      toProjectId: destination.id,
      toProjectName: destination.name,
      matchedByName: destination.matchedByName,
    });
  }

  const limit = Math.max(args.limit, 0);
  return {
    moves: planned.slice(0, limit),
    remaining: planned.slice(limit),
    unresolved,
    skippedSubtasks,
  };
}
