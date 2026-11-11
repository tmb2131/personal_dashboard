import { describe, expect, it } from "vitest";
import {
  isNotionObjectNotFound,
  isRemovedInNotion,
  selectVanishedTodoPageIds,
  shouldCloseTodoistForRemovedPage,
} from "./link-sync-rules";

describe("isRemovedInNotion", () => {
  it("treats archived and ignored pages as removed", () => {
    expect(isRemovedInNotion({ archived: true, ignore: false })).toBe(true);
    expect(isRemovedInNotion({ archived: false, ignore: true })).toBe(true);
  });

  it("keeps a live page", () => {
    expect(isRemovedInNotion({ archived: false, ignore: false })).toBe(false);
  });
});

describe("shouldCloseTodoistForRemovedPage", () => {
  it("closes an open one-off task", () => {
    expect(shouldCloseTodoistForRemovedPage({ checked: false, dueIsRecurring: false })).toBe(true);
  });

  it("leaves a task that is already closed", () => {
    expect(shouldCloseTodoistForRemovedPage({ checked: true, dueIsRecurring: false })).toBe(false);
  });

  it("leaves a recurring task, since closing it only moves it to the next date", () => {
    expect(shouldCloseTodoistForRemovedPage({ checked: false, dueIsRecurring: true })).toBe(false);
  });
});

describe("isNotionObjectNotFound", () => {
  it("recognises Notion's not-found error code", () => {
    const error = Object.assign(new Error("Could not find page with ID: abc"), {
      code: "object_not_found",
    });
    expect(isNotionObjectNotFound(error)).toBe(true);
  });

  it("ignores other failures", () => {
    expect(isNotionObjectNotFound(Object.assign(new Error("slow down"), { code: "rate_limited" }))).toBe(
      false,
    );
    expect(isNotionObjectNotFound(new Error("network down"))).toBe(false);
    expect(isNotionObjectNotFound(null)).toBe(false);
    expect(isNotionObjectNotFound("object_not_found")).toBe(false);
  });
});

describe("selectVanishedTodoPageIds", () => {
  const syncedBefore = new Date("2026-11-11T16:00:00.000Z");
  const at = (iso: string) => new Date(iso);

  function select(
    cached: { id: string; archived?: boolean; lastSyncedAt: Date }[],
    seen: string[] = [],
    limit = 10,
  ) {
    return selectVanishedTodoPageIds({
      cached: cached.map((p) => ({ archived: false, ...p })),
      seenIds: new Set(seen),
      syncedBefore,
      limit,
    });
  }

  it("picks a live row the sync did not see", () => {
    expect(select([{ id: "gone", lastSyncedAt: at("2026-11-10T09:00:00.000Z") }])).toEqual(["gone"]);
  });

  it("skips rows the sync saw", () => {
    expect(select([{ id: "seen", lastSyncedAt: at("2026-11-10T09:00:00.000Z") }], ["seen"])).toEqual(
      [],
    );
  });

  it("skips rows already archived", () => {
    expect(
      select([{ id: "old", archived: true, lastSyncedAt: at("2026-11-10T09:00:00.000Z") }]),
    ).toEqual([]);
  });

  it("skips rows synced recently, which the query may not list yet", () => {
    expect(select([{ id: "new", lastSyncedAt: at("2026-11-11T16:00:00.000Z") }])).toEqual([]);
    expect(select([{ id: "newer", lastSyncedAt: at("2026-11-11T16:03:00.000Z") }])).toEqual([]);
  });

  it("checks the longest-missing rows first and stops at the limit", () => {
    const result = select(
      [
        { id: "recent", lastSyncedAt: at("2026-11-11T12:00:00.000Z") },
        { id: "oldest", lastSyncedAt: at("2026-10-01T12:00:00.000Z") },
        { id: "middle", lastSyncedAt: at("2026-11-01T12:00:00.000Z") },
      ],
      [],
      2,
    );
    expect(result).toEqual(["oldest", "middle"]);
  });
});
