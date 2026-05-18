import { describe, expect, it } from "vitest";
import {
  NOTION_COMPLETION_OPS,
  TODOIST_COMPLETION_OPS,
  pairOrphans,
  pickId,
  type AuditRowLite,
} from "./orphan-replay-utils";

describe("pairOrphans", () => {
  it("flags an event_received without a paired completion", () => {
    const rows: AuditRowLite[] = [
      { op: "event_received", payload: { fingerprint: "abc", pageIds: ["p1"] } },
    ];
    const orphans = pairOrphans(rows, NOTION_COMPLETION_OPS);
    expect(orphans).toEqual([{ fingerprint: "abc", payload: { fingerprint: "abc", pageIds: ["p1"] } }]);
  });

  it("does not flag when a completion row exists for the fingerprint", () => {
    const rows: AuditRowLite[] = [
      { op: "event_received", payload: { fingerprint: "abc", pageIds: ["p1"] } },
      { op: "incremental", payload: { fingerprint: "abc", pageIds: ["p1"] } },
    ];
    expect(pairOrphans(rows, NOTION_COMPLETION_OPS)).toEqual([]);
  });

  it("treats a previous replay as completion (idempotency on repeat runs)", () => {
    const rows: AuditRowLite[] = [
      { op: "event_received", payload: { fingerprint: "abc", pageIds: ["p1"] } },
      { op: "replay", payload: { fingerprint: "abc" } },
    ];
    expect(pairOrphans(rows, NOTION_COMPLETION_OPS)).toEqual([]);
  });

  it("ignores rows without a fingerprint", () => {
    const rows: AuditRowLite[] = [
      { op: "event_received", payload: { pageIds: ["p1"] } },
      { op: "event_received", payload: null },
    ];
    expect(pairOrphans(rows, NOTION_COMPLETION_OPS)).toEqual([]);
  });

  it("returns multiple orphans when several event_received rows lack completion", () => {
    const rows: AuditRowLite[] = [
      { op: "event_received", payload: { fingerprint: "f1", eventName: "item:added" } },
      { op: "event_received", payload: { fingerprint: "f2", eventName: "project:updated" } },
      { op: "incremental", payload: { fingerprint: "f3" } }, // unmatched completion (ignore)
    ];
    const orphans = pairOrphans(rows, TODOIST_COMPLETION_OPS);
    expect(orphans.map((o) => o.fingerprint).sort()).toEqual(["f1", "f2"]);
  });

  it("recognises every documented Todoist completion op", () => {
    for (const op of TODOIST_COMPLETION_OPS) {
      const rows: AuditRowLite[] = [
        { op: "event_received", payload: { fingerprint: "x" } },
        { op, payload: { fingerprint: "x" } },
      ];
      expect(pairOrphans(rows, TODOIST_COMPLETION_OPS), `op=${op}`).toEqual([]);
    }
  });
});

describe("pickId", () => {
  it("extracts id from the direct keys, in order", () => {
    expect(pickId({ id: "abc" }, ["id", "project_id"], "project")).toBe("abc");
    expect(pickId({ project_id: "xyz" }, ["id", "project_id"], "project")).toBe("xyz");
  });

  it("falls back to nested object", () => {
    expect(pickId({ project: { id: "nested" } }, ["id", "project_id"], "project")).toBe("nested");
  });

  it("stringifies numeric ids", () => {
    expect(pickId({ id: 12345 }, ["id"], "item")).toBe("12345");
  });

  it("returns undefined when no id present", () => {
    expect(pickId({ unrelated: "x" }, ["id"], "item")).toBeUndefined();
  });

  it("skips blank strings", () => {
    expect(pickId({ id: "   " }, ["id"], "item")).toBeUndefined();
  });
});
