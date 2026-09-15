import { describe, expect, it } from "vitest";
import {
  buildTodoistProjectIdByName,
  planRefileMoves,
  type RefileLink,
  type RefilePage,
  type RefileProject,
  type RefileTask,
} from "./project-refile-utils";

/**
 * Covers the half of the refile pass that decides *which* inbox tasks move and
 * *where* they go. The moving half is Todoist API calls and is not exercised
 * here.
 */

const INBOX_ID = "todoist-inbox";
const NOTION_PROJECT_ID = "todoist-notion";
const OCI_PROJECT_ID = "todoist-oci";

/** The Notion project row a to-do hangs from. */
function project(id: string, title: string, over: Partial<RefilePage> = {}): RefilePage {
  return {
    id,
    parentId: null,
    title,
    status: null,
    archived: false,
    ignore: false,
    ...over,
  };
}

/** A Notion to-do, filed under `parentId`. */
function page(id: string, parentId: string, over: Partial<RefilePage> = {}): RefilePage {
  return {
    id,
    parentId,
    title: id,
    status: "Not started",
    archived: false,
    ignore: false,
    ...over,
  };
}

function task(id: string, over: Partial<RefileTask> = {}): RefileTask {
  return {
    id,
    projectId: INBOX_ID,
    parentId: null,
    content: id,
    checked: false,
    ...over,
  };
}

function link(notionPageId: string, todoistTaskId: string): RefileLink {
  return { id: `link-${notionPageId}`, notionPageId, todoistTaskId };
}

function todoistProject(
  id: string,
  name: string,
  over: Partial<RefileProject> = {},
): RefileProject {
  return { id, name, archived: false, ...over };
}

const PROJECTS = [
  todoistProject(INBOX_ID, "Inbox"),
  todoistProject(NOTION_PROJECT_ID, "Notion"),
  todoistProject(OCI_PROJECT_ID, "OCI"),
];

function plan(
  over: {
    links?: RefileLink[];
    pages?: RefilePage[];
    tasks?: RefileTask[];
    todoistProjects?: RefileProject[];
    fallbackProject?: { id: string; name: string } | null;
    limit?: number;
  } = {},
) {
  return planRefileMoves({
    links: over.links ?? [],
    pages: over.pages ?? [],
    tasks: over.tasks ?? [],
    todoistProjects: over.todoistProjects ?? PROJECTS,
    inboxProjectId: INBOX_ID,
    notionInboxTitle: "Inbox",
    fallbackProject:
      over.fallbackProject === undefined
        ? { id: NOTION_PROJECT_ID, name: "Notion" }
        : over.fallbackProject,
    limit: over.limit ?? 30,
  });
}

/** One filed to-do, one inbox task, one link — the shape most cases start from. */
function filedUnder(projectTitle: string, over: { task?: Partial<RefileTask> } = {}) {
  return {
    links: [link("todo", "task")],
    pages: [project("proj", projectTitle), page("todo", "proj")],
    tasks: [task("task", over.task)],
  };
}

const destinations = (rows: { toProjectId: string }[]) => rows.map((m) => m.toProjectId);

describe("planRefileMoves", () => {
  it("moves an inbox task into the Todoist project sharing its Notion project's name", () => {
    // The whole point: filed under "OCI" in Notion, still in the inbox in
    // Todoist, and Todoist has an "OCI" to put it in.
    const result = plan(filedUnder("OCI"));
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0]).toMatchObject({
      todoistTaskId: "task",
      notionPageId: "todo",
      linkId: "link-todo",
      notionProjectTitle: "OCI",
      toProjectId: OCI_PROJECT_ID,
      toProjectName: "OCI",
      matchedByName: true,
    });
  });

  it("matches a project name case- and whitespace-insensitively", () => {
    const result = plan({
      ...filedUnder("  oci  "),
    });
    expect(destinations(result.moves)).toEqual([OCI_PROJECT_ID]);
    expect(result.moves[0].matchedByName).toBe(true);
  });

  it("falls back to the Notion project when no Todoist project shares the name", () => {
    const result = plan(filedUnder("Rosemary Works"));
    expect(result.moves[0]).toMatchObject({
      toProjectId: NOTION_PROJECT_ID,
      toProjectName: "Notion",
      matchedByName: false,
    });
  });

  it("reports a task as unresolved when there is no match and no fallback", () => {
    // What a renamed or deleted "Notion" project looks like: nowhere to put it,
    // so it is named rather than moved somewhere arbitrary.
    const result = plan({ ...filedUnder("Rosemary Works"), fallbackProject: null });
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatchObject({
      todoistTaskId: "task",
      notionProjectTitle: "Rosemary Works",
    });
  });

  it("leaves a task alone when its Notion project is Inbox", () => {
    // Unfiled on both sides says the same thing, so there is nothing to fix.
    const result = plan(filedUnder("Inbox"));
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("leaves a Notion to-do with no project at all alone", () => {
    const result = plan({
      links: [link("todo", "task")],
      pages: [page("todo", "proj", { parentId: null })],
      tasks: [task("task")],
    });
    expect(result.moves).toEqual([]);
  });

  it("never touches a task that is already filed somewhere in Todoist", () => {
    // Only ever moves things *out* of the inbox: a task the user put in a
    // project is one reconcile has no business re-filing.
    const result = plan({
      ...filedUnder("OCI"),
      tasks: [task("task", { projectId: "some-other-project" })],
    });
    expect(result.moves).toEqual([]);
  });

  it("skips completed tasks and finished, archived or ignored pages", () => {
    const cases: { label: string; pages?: RefilePage[]; tasks?: RefileTask[] }[] = [
      { label: "checked task", tasks: [task("task", { checked: true })] },
      { label: "done page", pages: [project("proj", "OCI"), page("todo", "proj", { status: "Done" })] },
      {
        label: "archived page",
        pages: [project("proj", "OCI"), page("todo", "proj", { archived: true })],
      },
      {
        label: "ignored page",
        pages: [project("proj", "OCI"), page("todo", "proj", { ignore: true })],
      },
    ];
    for (const c of cases) {
      const result = plan({ ...filedUnder("OCI"), ...c });
      expect(result.moves, c.label).toEqual([]);
    }
  });

  it("holds back a Todoist sub-task rather than detaching it from its parent", () => {
    // The move endpoint takes project *or* parent, so filing this would cut it
    // loose from the task it hangs under.
    const result = plan({
      ...filedUnder("OCI"),
      tasks: [task("task", { parentId: "parent-task" })],
    });
    expect(result.moves).toEqual([]);
    expect(result.skippedSubtasks).toHaveLength(1);
    expect(result.skippedSubtasks[0].todoistTaskId).toBe("task");
  });

  it("ignores a link whose page or task the cache does not have", () => {
    // A dangling link is the drift scan's to report, not this pass's to act on.
    const result = plan({
      links: [link("todo", "task"), link("ghost-page", "ghost-task")],
      pages: [project("proj", "OCI"), page("todo", "proj")],
      tasks: [task("task")],
    });
    expect(result.moves.map((m) => m.todoistTaskId)).toEqual(["task"]);
  });

  it("ignores a page whose parent row is missing or blank-titled", () => {
    const missingParent = plan({
      links: [link("todo", "task")],
      pages: [page("todo", "gone")],
      tasks: [task("task")],
    });
    expect(missingParent.moves).toEqual([]);

    const blankTitle = plan({
      links: [link("todo", "task")],
      pages: [project("proj", "   "), page("todo", "proj")],
      tasks: [task("task")],
    });
    expect(blankTitle.moves).toEqual([]);
  });

  it("does not plan a move whose destination is the inbox itself", () => {
    // A Notion project named for the inbox in another spelling would otherwise
    // produce a call that puts a task exactly where it already is.
    const result = plan({
      ...filedUnder("inbox "),
      todoistProjects: [...PROJECTS, todoistProject(INBOX_ID, "inbox ")],
      fallbackProject: { id: INBOX_ID, name: "Inbox" },
    });
    expect(result.moves).toEqual([]);
  });

  it("caps a run at the limit and reports the rest as remaining", () => {
    const links = [link("a", "ta"), link("b", "tb"), link("c", "tc")];
    const result = plan({
      links,
      pages: [project("proj", "OCI"), page("a", "proj"), page("b", "proj"), page("c", "proj")],
      tasks: [task("ta"), task("tb"), task("tc")],
      limit: 2,
    });
    expect(result.moves).toHaveLength(2);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].todoistTaskId).toBe("tc");
  });

  it("plans nothing at all when the limit is zero", () => {
    const result = plan({ ...filedUnder("OCI"), limit: 0 });
    expect(result.moves).toEqual([]);
    expect(result.remaining).toHaveLength(1);
  });
});

describe("buildTodoistProjectIdByName", () => {
  it("maps normalized names to ids", () => {
    const byName = buildTodoistProjectIdByName([todoistProject("p1", "  OCI  ")]);
    expect(byName.get("oci")).toBe("p1");
  });

  it("drops a name two projects share rather than picking one", () => {
    // Same reasoning as `buildProjectPageIdByTitle`: either choice is a coin
    // toss the user cannot see, and the fallback is defensible.
    const byName = buildTodoistProjectIdByName([
      todoistProject("p1", "Work"),
      todoistProject("p2", "work"),
    ]);
    expect(byName.has("work")).toBe(false);
  });

  it("does not offer an archived project as a destination", () => {
    const byName = buildTodoistProjectIdByName([
      todoistProject("p1", "OCI", { archived: true }),
    ]);
    expect(byName.size).toBe(0);
  });

  it("ignores a blank project name", () => {
    expect(buildTodoistProjectIdByName([todoistProject("p1", "   ")]).size).toBe(0);
  });
});
