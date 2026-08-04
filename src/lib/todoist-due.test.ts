import { describe, expect, it } from "vitest";
import {
  parseTodoistDue,
  todoistDueHasTime,
  todoistDueValue,
  todoistRecurrenceDateArg,
} from "./todoist-due";

describe("todoist due payloads", () => {
  it("reads the API v1 shape, where the time rides in `date`", () => {
    const due = {
      date: "2026-08-04T11:00:00",
      string: "Aug 4 11:00 AM",
      isRecurring: false,
    };
    expect(todoistDueValue(due)).toBe("2026-08-04T11:00:00");
    expect(todoistDueHasTime(due)).toBe(true);
    // Floating (no offset) means local time, so this is 11:00 wherever we run.
    const parsed = parseTodoistDue(due)!;
    expect(parsed.getHours()).toBe(11);
    expect(parsed.getMinutes()).toBe(0);
  });

  it("reads the REST v2 shape still present in older cached rows", () => {
    const due = { date: "2026-08-04", datetime: "2026-08-04T10:00:00.000Z" };
    expect(todoistDueHasTime(due)).toBe(true);
    expect(parseTodoistDue(due)?.toISOString()).toBe("2026-08-04T10:00:00.000Z");
  });

  it("treats a bare date as all-day and lands it on local midnight", () => {
    const due = { date: "2026-08-04", string: "Aug 4" };
    expect(todoistDueHasTime(due)).toBe(false);
    const parsed = parseTodoistDue(due)!;
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getDate()).toBe(4);
  });

  it("handles the snake_case variants", () => {
    expect(todoistDueHasTime({ due_date: "2026-08-04" })).toBe(false);
    expect(todoistDueHasTime({ due_datetime: "2026-08-04T10:00:00Z" })).toBe(true);
  });

  it("returns null for an absent or empty due", () => {
    expect(parseTodoistDue(null)).toBeNull();
    expect(parseTodoistDue(undefined)).toBeNull();
    expect(parseTodoistDue({})).toBeNull();
    expect(parseTodoistDue({ date: "   " })).toBeNull();
    expect(todoistDueHasTime(null)).toBe(false);
  });

  it("returns null rather than an Invalid Date for junk", () => {
    expect(parseTodoistDue({ date: "not-a-date" })).toBeNull();
  });
});

describe("todoistRecurrenceDateArg", () => {
  const dueAt = new Date("2026-08-05T18:00:00.000Z");

  it("sends a bare date for an all-day rule", () => {
    expect(
      todoistRecurrenceDateArg({ dueDate: "2026-08-05", dueTime: null, dueAt, timezone: null }),
    ).toBe("2026-08-05");
  });

  it("keeps a floating rule floating — local wall clock, no offset", () => {
    expect(
      todoistRecurrenceDateArg({ dueDate: "2026-08-05", dueTime: "19:00", dueAt, timezone: null }),
    ).toBe("2026-08-05T19:00:00");
  });

  it("pins a zoned rule to an absolute instant", () => {
    expect(
      todoistRecurrenceDateArg({
        dueDate: "2026-08-05",
        dueTime: "19:00",
        dueAt,
        timezone: "Europe/London",
      }),
    ).toBe("2026-08-05T18:00:00.000Z");
  });
});
