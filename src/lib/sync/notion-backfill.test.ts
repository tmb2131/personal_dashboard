import { describe, expect, it } from "vitest";
import {
  buildProjectPageIdByTitle,
  chooseNotionParent,
  selectNotionMirrorCandidates,
  type NotionMirrorCandidate,
} from "./notion-backfill-utils";

/**
 * Covers the half of the Todoist → Notion backfill that decides *what* to
 * create and *where* it goes. The creating half is Notion API calls and is not
 * exercised here.
 */

const DAY = 86_400_000;
const T0 = new Date("2026-09-09T09:00:00.000Z");

function task(over: Partial<NotionMirrorCandidate> & { id: string }): NotionMirrorCandidate {
  return {
    projectId: "inbox-project",
    parentId: null,
    content: over.id,
    description: null,
    dueDate: null,
    dueString: null,
    dueIsRecurring: false,
    deadline: null,
    priority: 1,
    checked: false,
    labels: [],
    updatedAt: T0,
    ...over,
  };
}

function select(
  tasks: NotionMirrorCandidate[],
  over: {
    linked?: string[];
    excludedProjectIds?: string[];
    unlinkedNotionTitles?: string[];
    limit?: number;
  } = {},
) {
  return selectNotionMirrorCandidates({
    tasks,
    linkedTodoistTaskIds: new Set(over.linked ?? []),
    excludedProjectIds: new Set(over.excludedProjectIds ?? []),
    unlinkedNotionTitles: new Set(over.unlinkedNotionTitles ?? []),
    limit: over.limit ?? 20,
  });
}

const ids = (rows: NotionMirrorCandidate[]) => rows.map((t) => t.id);

describe("selectNotionMirrorCandidates", () => {
  it("picks up a task that has no Notion mirror at all", () => {
    // The gap this backfill exists for: captured in Todoist, never carried
    // across, invisible to every link-aware path because it has no link.
    const result = select([task({ id: "ar-glasses" })]);
    expect(ids(result.create)).toEqual(["ar-glasses"]);
    expect(result.titleMatched).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("skips tasks that already have a link", () => {
    const rows = [task({ id: "linked" }), task({ id: "unlinked" })];
    expect(ids(select(rows, { linked: ["linked"] }).create)).toEqual(["unlinked"]);
  });

  it("skips completed tasks", () => {
    const rows = [task({ id: "done", checked: true }), task({ id: "open" })];
    expect(ids(select(rows).create)).toEqual(["open"]);
  });

  it("leaves habits out: the Recurring project is not part of the sync", () => {
    const rows = [
      task({ id: "floss", projectId: "recurring" }),
      task({ id: "bins", projectId: "recurring-house" }),
      task({ id: "real-task" }),
    ];
    const result = select(rows, { excludedProjectIds: ["recurring", "recurring-house"] });
    expect(ids(result.create)).toEqual(["real-task"]);
    // Excluded, not deferred: they must not show up as work left to do.
    expect(result.remaining).toEqual([]);
    expect(result.titleMatched).toEqual([]);
  });

  it("mirrors a task with no project at all", () => {
    expect(ids(select([task({ id: "loose", projectId: null })]).create)).toEqual(["loose"]);
  });

  it("holds back a task whose title an unlinked Notion row already carries", () => {
    // Either a link that went missing or a task kept in both apps by hand.
    // Creating a second Notion page is the wrong answer to both.
    const rows = [task({ id: "dupe", content: "Book Reload appointment" }), task({ id: "fresh" })];
    const result = select(rows, { unlinkedNotionTitles: ["book reload appointment"] });
    expect(ids(result.create)).toEqual(["fresh"]);
    expect(ids(result.titleMatched)).toEqual(["dupe"]);
  });

  it("matches titles past case and whitespace differences", () => {
    const rows = [task({ id: "dupe", content: "  Submit   OCI   application " })];
    const result = select(rows, { unlinkedNotionTitles: ["submit oci application"] });
    expect(result.create).toEqual([]);
    expect(ids(result.titleMatched)).toEqual(["dupe"]);
  });

  it("creates the soonest work first when the run is capped", () => {
    const rows = [
      task({ id: "next-week", dueDate: new Date(T0.getTime() + 7 * DAY) }),
      task({ id: "tomorrow", dueDate: new Date(T0.getTime() + DAY) }),
      task({ id: "by-deadline", deadline: new Date(T0.getTime() + 2 * DAY) }),
    ];
    const result = select(rows, { limit: 2 });
    expect(ids(result.create)).toEqual(["tomorrow", "by-deadline"]);
    expect(ids(result.remaining)).toEqual(["next-week"]);
  });

  it("sorts undated tasks last, freshest first", () => {
    const rows = [
      task({ id: "stale", updatedAt: new Date(T0.getTime() - 30 * DAY) }),
      task({ id: "just-added", updatedAt: T0 }),
      task({ id: "dated", dueDate: new Date(T0.getTime() + 90 * DAY) }),
    ];
    expect(ids(select(rows).create)).toEqual(["dated", "just-added", "stale"]);
  });

  it("counts every skipped task so a capped run can report what is left", () => {
    const rows = [
      task({ id: "a", dueDate: new Date(T0.getTime() + DAY) }),
      task({ id: "b", dueDate: new Date(T0.getTime() + 2 * DAY) }),
      task({ id: "dupe", content: "already there" }),
      task({ id: "linked" }),
    ];
    const result = select(rows, {
      linked: ["linked"],
      unlinkedNotionTitles: ["already there"],
      limit: 1,
    });
    expect(ids(result.create)).toEqual(["a"]);
    expect(ids(result.remaining)).toEqual(["b"]);
    expect(ids(result.titleMatched)).toEqual(["dupe"]);
  });

  it("creates nothing when the limit is zero", () => {
    const result = select([task({ id: "a" }), task({ id: "b" })], { limit: 0 });
    expect(result.create).toEqual([]);
    expect(ids(result.remaining)).toEqual(["a", "b"]);
  });
});

describe("buildProjectPageIdByTitle", () => {
  it("keys top-level rows by their normalized title", () => {
    const byTitle = buildProjectPageIdByTitle([
      { id: "p1", title: "  OCI " },
      { id: "p2", title: "Inbox" },
    ]);
    expect(byTitle.get("oci")).toBe("p1");
    expect(byTitle.get("inbox")).toBe("p2");
  });

  it("drops a title two rows share rather than picking one", () => {
    // Either choice would be a coin toss the user cannot see; Inbox is the
    // answer we can defend.
    const byTitle = buildProjectPageIdByTitle([
      { id: "p1", title: "Travel" },
      { id: "p2", title: "travel" },
      { id: "p3", title: "OCI" },
    ]);
    expect(byTitle.has("travel")).toBe(false);
    expect(byTitle.get("oci")).toBe("p3");
  });

  it("ignores a row with a blank title", () => {
    expect(buildProjectPageIdByTitle([{ id: "p1", title: "   " }]).size).toBe(0);
  });
});

describe("chooseNotionParent", () => {
  const projectPageIdByTitle = new Map([
    ["oci", "notion-oci"],
    ["inbox", "notion-inbox"],
  ]);

  it("files a task under the Notion project sharing its Todoist project name", () => {
    expect(
      chooseNotionParent({ projectName: "OCI", projectPageIdByTitle, inboxPageId: "notion-inbox" }),
    ).toEqual({ notionParentPageId: "notion-oci", matchedProjectTitle: "OCI" });
  });

  it("falls back to Inbox when no Notion project carries that name", () => {
    expect(
      chooseNotionParent({
        projectName: "Notion",
        projectPageIdByTitle,
        inboxPageId: "notion-inbox",
      }),
    ).toEqual({ notionParentPageId: "notion-inbox", matchedProjectTitle: null });
  });

  it("sends a task with no project to Inbox", () => {
    expect(
      chooseNotionParent({ projectName: null, projectPageIdByTitle, inboxPageId: "notion-inbox" }),
    ).toEqual({ notionParentPageId: "notion-inbox", matchedProjectTitle: null });
  });

  it("routes Todoist's own inbox to the Notion Inbox by name", () => {
    // Both apps call it "Inbox", so this goes through the name match rather
    // than the fallback — same destination either way.
    const choice = chooseNotionParent({
      projectName: "Inbox",
      projectPageIdByTitle,
      inboxPageId: "notion-inbox",
    });
    expect(choice.notionParentPageId).toBe("notion-inbox");
  });

  it("treats a whitespace-only project name as no project", () => {
    expect(
      chooseNotionParent({ projectName: "   ", projectPageIdByTitle, inboxPageId: "fallback" }),
    ).toEqual({ notionParentPageId: "fallback", matchedProjectTitle: null });
  });
});
