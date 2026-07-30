import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/sync/audit", () => ({ logAudit: vi.fn() }));

const {
  calendarIds,
  DEFAULT_CALENDAR_IDS,
  describeGcalError,
  shouldRefreshWindow,
  WINDOW_REFRESH_INTERVAL_MS,
} = await import("./gcal");

const original = process.env.GCAL_CALENDAR_IDS;

afterEach(() => {
  if (original === undefined) delete process.env.GCAL_CALENDAR_IDS;
  else process.env.GCAL_CALENDAR_IDS = original;
});

describe("calendarIds", () => {
  it("parses a configured comma-separated list", () => {
    process.env.GCAL_CALENDAR_IDS = "a@example.com,b@example.com";

    expect(calendarIds()).toEqual(["a@example.com", "b@example.com"]);
  });

  it("trims whitespace and drops empty entries", () => {
    process.env.GCAL_CALENDAR_IDS = " a@example.com , , b@example.com ,";

    expect(calendarIds()).toEqual(["a@example.com", "b@example.com"]);
  });

  it("falls back to the default when unset", () => {
    delete process.env.GCAL_CALENDAR_IDS;

    expect(calendarIds()).toEqual(DEFAULT_CALENDAR_IDS);
  });

  it("falls back to the default when blank, rather than resolving empty", () => {
    // An empty list previously made every sync a silent no-op that still
    // reported success.
    process.env.GCAL_CALENDAR_IDS = "   ,  ,";

    expect(calendarIds()).toEqual(DEFAULT_CALENDAR_IDS);
    expect(calendarIds().length).toBeGreaterThan(0);
  });

  it("returns a copy so callers cannot mutate the default", () => {
    delete process.env.GCAL_CALENDAR_IDS;
    calendarIds().push("mutated@example.com");

    expect(calendarIds()).toEqual(DEFAULT_CALENDAR_IDS);
  });
});

describe("shouldRefreshWindow", () => {
  const now = new Date("2026-07-30T12:00:00.000Z");

  it("refreshes when a calendar has never had a full sync", () => {
    expect(shouldRefreshWindow(null, now)).toBe(true);
  });

  it("skips the refresh right after a full sync", () => {
    expect(shouldRefreshWindow(new Date(now.getTime() - 60_000), now)).toBe(false);
  });

  it("refreshes once the interval has elapsed", () => {
    const due = new Date(now.getTime() - WINDOW_REFRESH_INTERVAL_MS);

    expect(shouldRefreshWindow(due, now)).toBe(true);
  });

  it("refreshes a window frozen for months", () => {
    // The reported failure: incremental syncs alone never roll the window
    // forward, so the cached range stays in the past indefinitely.
    expect(shouldRefreshWindow(new Date("2026-05-14T00:00:00.000Z"), now)).toBe(true);
  });

  it("does not refresh just before the interval elapses", () => {
    const nearly = new Date(now.getTime() - WINDOW_REFRESH_INTERVAL_MS + 60_000);

    expect(shouldRefreshWindow(nearly, now)).toBe(false);
  });
});

describe("describeGcalError", () => {
  it("turns a revoked refresh token into an actionable message", () => {
    const message = describeGcalError(new Error("invalid_grant"));

    expect(message).toContain("revoked");
    expect(message).toContain("sign out");
  });

  it("recognises a 401 as a credential failure", () => {
    expect(describeGcalError({ code: 401, message: "Unauthorized" })).toContain("revoked");
  });

  it("explains a missing calendar scope", () => {
    const message = describeGcalError({ code: 403, message: "insufficientPermissions" });

    expect(message).toContain("permission");
  });

  it("passes other errors through unchanged", () => {
    expect(describeGcalError(new Error("ETIMEDOUT"))).toBe("ETIMEDOUT");
  });
});
