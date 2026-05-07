import { describe, expect, it } from "vitest";
import {
  formatDateOnlyLocal,
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
