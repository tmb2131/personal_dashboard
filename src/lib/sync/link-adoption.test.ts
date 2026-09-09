import { describe, expect, it } from "vitest";
import { pairExactTitleMatches, type AdoptionRow } from "./link-adoption-utils";

/**
 * Covers the rule that decides which unlinked rows are obviously the same task.
 * Writing the `task_links` rows is a database call and is not exercised here.
 */

const row = (id: string, title: string): AdoptionRow => ({ id, title });

function pair(notionPages: AdoptionRow[], todoistTasks: AdoptionRow[]) {
  return pairExactTitleMatches({ notionPages, todoistTasks });
}

describe("pairExactTitleMatches", () => {
  it("adopts one Notion row and one Todoist row sharing a title", () => {
    const result = pair([row("n1", "Book flights")], [row("t1", "Book flights")]);
    expect(result.adopt).toEqual([
      { notionPageId: "n1", todoistTaskId: "t1", title: "Book flights" },
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  it("matches past case and whitespace, and keeps the Notion spelling", () => {
    const result = pair([row("n1", "Book  Flights")], [row("t1", "book flights ")]);
    expect(result.adopt).toEqual([
      { notionPageId: "n1", todoistTaskId: "t1", title: "Book  Flights" },
    ]);
  });

  it("refuses to guess when two Notion rows carry the title", () => {
    const result = pair([row("n1", "Pay bill"), row("n2", "Pay bill")], [row("t1", "Pay bill")]);
    expect(result.adopt).toEqual([]);
    expect(result.ambiguous).toEqual([
      { title: "Pay bill", notionPageIds: ["n1", "n2"], todoistTaskIds: ["t1"] },
    ]);
  });

  it("refuses to guess when two Todoist tasks carry the title", () => {
    const result = pair([row("n1", "Pay bill")], [row("t1", "Pay bill"), row("t2", "Pay bill")]);
    expect(result.adopt).toEqual([]);
    expect(result.ambiguous[0].todoistTaskIds).toEqual(["t1", "t2"]);
  });

  it("leaves a title only one side has alone — that is a backfill's job", () => {
    const result = pair([row("n1", "Notion only")], [row("t1", "Todoist only")]);
    expect(result.adopt).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("pairs each title independently", () => {
    const result = pair(
      [row("n1", "Alpha"), row("n2", "Beta"), row("n3", "Beta")],
      [row("t1", "Alpha"), row("t2", "Beta"), row("t3", "Gamma")],
    );
    expect(result.adopt).toEqual([{ notionPageId: "n1", todoistTaskId: "t1", title: "Alpha" }]);
    expect(result.ambiguous.map((a) => a.title)).toEqual(["Beta"]);
  });

  it("ignores blank titles rather than pairing every empty row with itself", () => {
    const result = pair([row("n1", "   ")], [row("t1", "")]);
    expect(result.adopt).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("does nothing with empty input", () => {
    expect(pair([], [])).toEqual({ adopt: [], ambiguous: [] });
  });
});
