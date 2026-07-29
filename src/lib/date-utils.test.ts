import { describe, expect, it } from "vitest";
import {
  formatDateOnlyLocal,
  msUntilNextLocalMidnight,
  parseDateOnlyLocal,
  parseDateOnlyLocalStrict,
  parseDateTimeLocal,
} from "./date-utils";

describe("date-utils", () => {
  it("parses date-only inputs as local calendar days", () => {
    const parsed = parseDateOnlyLocal("2026-05-08");

    expect(parsed).toBeInstanceOf(Date);
    expect(formatDateOnlyLocal(parsed!)).toBe("2026-05-08");
    expect(parsed!.getHours()).toBe(0);
    expect(parsed!.getMinutes()).toBe(0);
  });

  it("rejects invalid date-only inputs", () => {
    expect(parseDateOnlyLocal("2026-02-31")).toBeNull();
    expect(parseDateOnlyLocal("05/08/2026")).toBeNull();
    expect(() => parseDateOnlyLocalStrict("2026-02-31")).toThrow("Invalid date");
  });

  it("combines date and time inputs without UTC date shifting", () => {
    const parsed = parseDateTimeLocal("2026-05-08", "09:30");

    expect(parsed).toBeInstanceOf(Date);
    expect(formatDateOnlyLocal(parsed!)).toBe("2026-05-08");
    expect(parsed!.getHours()).toBe(9);
    expect(parsed!.getMinutes()).toBe(30);
  });
});

describe("msUntilNextLocalMidnight", () => {
  function landsOnNextLocalDay(now: Date) {
    const target = new Date(now.getTime() + msUntilNextLocalMidnight(now));
    const expectedDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return {
      dayKey: formatDateOnlyLocal(target),
      expectedDayKey: formatDateOnlyLocal(expectedDay),
      hours: target.getHours(),
      minutes: target.getMinutes(),
    };
  }

  it("lands just past midnight on the next local day", () => {
    const result = landsOnNextLocalDay(new Date(2026, 4, 8, 14, 30, 0));

    expect(result.dayKey).toBe(result.expectedDayKey);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
  });

  it("rolls over correctly from one minute before midnight", () => {
    const result = landsOnNextLocalDay(new Date(2026, 4, 8, 23, 59, 0));

    expect(result.dayKey).toBe("2026-05-09");
    expect(result.hours).toBe(0);
  });

  it("crosses month and year boundaries", () => {
    expect(landsOnNextLocalDay(new Date(2026, 11, 31, 22, 0, 0)).dayKey).toBe("2027-01-01");
    expect(landsOnNextLocalDay(new Date(2026, 1, 28, 22, 0, 0)).dayKey).toBe("2026-03-01");
  });

  it("stays within a day even across a DST transition", () => {
    // 2026-03-29 is the UK/EU spring-forward date; that local day is 23h long.
    const ms = msUntilNextLocalMidnight(new Date(2026, 2, 28, 12, 0, 0));

    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(25 * 3_600_000);
    expect(landsOnNextLocalDay(new Date(2026, 2, 28, 12, 0, 0)).dayKey).toBe("2026-03-29");
  });

  it("never returns a non-positive delay", () => {
    const atMidnight = new Date(2026, 4, 8, 0, 0, 0);

    expect(msUntilNextLocalMidnight(atMidnight)).toBeGreaterThan(0);
  });
});
