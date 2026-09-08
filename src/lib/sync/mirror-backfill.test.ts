import { describe, expect, it } from "vitest";
import { selectMirrorCandidates, type MirrorCandidate } from "./mirror-backfill-utils";

/**
 * Covers the half of the missing-mirror backfill that decides *what* to create.
 * The creating half is Todoist API calls and is not exercised here.
 */

const DAY = 86_400_000;
const T0 = new Date("2026-09-08T09:00:00.000Z");

function page(over: Partial<MirrorCandidate> & { id: string }): MirrorCandidate {
  return {
    categoryId: null,
    title: over.id,
    status: "Not started",
    dateStart: null,
    dateEnd: null,
    dateIsDatetime: false,
    deadline: null,
    priority: null,
    focus: null,
    tripStatus: null,
    parentId: "project-1",
    keyNextStep: null,
    nextSteps: null,
    notes: null,
    archived: false,
    ignore: false,
    updatedAt: T0,
    lastSyncedAt: T0,
    ...over,
  };
}

function select(
  pages: MirrorCandidate[],
  over: {
    linked?: string[];
    unlinkedTodoistTitles?: string[];
    limit?: number;
  } = {},
) {
  return selectMirrorCandidates({
    pages,
    linkedNotionPageIds: new Set(over.linked ?? []),
    unlinkedTodoistTitles: new Set(over.unlinkedTodoistTitles ?? []),
    limit: over.limit ?? 25,
  });
}

const ids = (rows: MirrorCandidate[]) => rows.map((p) => p.id);

describe("selectMirrorCandidates", () => {
  it("picks up a sub-task that has no Todoist mirror at all", () => {
    // The bug this backfill exists for: written in Notion, visible on the
    // dashboard, never seen by any link-aware sync path.
    const result = select([page({ id: "oci-docs", dateStart: new Date(T0.getTime() + DAY) })]);
    expect(ids(result.create)).toEqual(["oci-docs"]);
    expect(result.titleMatched).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("picks up an undated sub-task — a parent is reason enough to mirror", () => {
    expect(ids(select([page({ id: "no-date" })]).create)).toEqual(["no-date"]);
  });

  it("leaves top-level rows alone: those are projects, not tasks", () => {
    const rows = [
      page({ id: "project", parentId: null, dateStart: T0, focus: "Yes" }),
      page({ id: "subtask" }),
    ];
    expect(ids(select(rows).create)).toEqual(["subtask"]);
  });

  it("skips pages that already have a link", () => {
    const rows = [page({ id: "linked" }), page({ id: "unlinked" })];
    expect(ids(select(rows, { linked: ["linked"] }).create)).toEqual(["unlinked"]);
  });

  it("skips archived, ignored and done rows", () => {
    const rows = [
      page({ id: "archived", archived: true }),
      page({ id: "ignored", ignore: true }),
      page({ id: "done", status: "Done" }),
      page({ id: "open" }),
    ];
    expect(ids(select(rows).create)).toEqual(["open"]);
  });

  it("holds back a row whose title an unlinked Todoist task already carries", () => {
    // Either a link that went missing or a task kept in both apps by hand.
    // Creating a second Todoist task is the wrong answer to both.
    const rows = [page({ id: "dupe", title: "Book Reload appointment" }), page({ id: "fresh" })];
    const result = select(rows, { unlinkedTodoistTitles: ["book reload appointment"] });
    expect(ids(result.create)).toEqual(["fresh"]);
    expect(ids(result.titleMatched)).toEqual(["dupe"]);
  });

  it("matches titles past case and whitespace differences", () => {
    const rows = [page({ id: "dupe", title: "  Submit   OCI   application " })];
    const result = select(rows, { unlinkedTodoistTitles: ["submit oci application"] });
    expect(result.create).toEqual([]);
    expect(ids(result.titleMatched)).toEqual(["dupe"]);
  });

  it("creates the soonest work first when the run is capped", () => {
    const rows = [
      page({ id: "next-week", dateStart: new Date(T0.getTime() + 7 * DAY) }),
      page({ id: "tomorrow", dateStart: new Date(T0.getTime() + DAY) }),
      page({ id: "by-deadline", deadline: new Date(T0.getTime() + 2 * DAY) }),
    ];
    const result = select(rows, { limit: 2 });
    expect(ids(result.create)).toEqual(["tomorrow", "by-deadline"]);
    expect(ids(result.remaining)).toEqual(["next-week"]);
  });

  it("sorts undated rows last, freshest first", () => {
    const rows = [
      page({ id: "stale", updatedAt: new Date(T0.getTime() - 30 * DAY) }),
      page({ id: "just-added", updatedAt: T0 }),
      page({ id: "dated", dateStart: new Date(T0.getTime() + 90 * DAY) }),
    ];
    expect(ids(select(rows).create)).toEqual(["dated", "just-added", "stale"]);
  });

  it("counts every skipped row so a capped run can report what is left", () => {
    const rows = [
      page({ id: "a", dateStart: new Date(T0.getTime() + DAY) }),
      page({ id: "b", dateStart: new Date(T0.getTime() + 2 * DAY) }),
      page({ id: "c", dateStart: new Date(T0.getTime() + 3 * DAY) }),
      page({ id: "dupe", title: "already there" }),
      page({ id: "linked" }),
    ];
    const result = select(rows, {
      linked: ["linked"],
      unlinkedTodoistTitles: ["already there"],
      limit: 1,
    });
    expect(ids(result.create)).toEqual(["a"]);
    expect(ids(result.remaining)).toEqual(["b", "c"]);
    expect(ids(result.titleMatched)).toEqual(["dupe"]);
  });

  it("creates nothing when the limit is zero", () => {
    const rows = [page({ id: "a" }), page({ id: "b" })];
    const result = select(rows, { limit: 0 });
    expect(result.create).toEqual([]);
    expect(ids(result.remaining)).toEqual(["a", "b"]);
  });
});
