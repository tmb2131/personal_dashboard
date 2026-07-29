import { describe, expect, it } from "vitest";
import { isAllDaySpan, layoutDayEvents } from "./calendar-layout";

function at(hour: number, minute = 0): Date {
  return new Date(2026, 4, 7, hour, minute, 0, 0);
}

function item(name: string, startHour: number, endHour: number) {
  return { event: name, start: at(startHour), end: at(endHour) };
}

/** name -> "column/columns", for compact assertions. */
function placement(laid: ReturnType<typeof layoutDayEvents<string>>) {
  return Object.fromEntries(laid.map((l) => [l.event, `${l.column}/${l.columns}`]));
}

describe("layoutDayEvents", () => {
  it("gives sequential events a single full-width column each", () => {
    const laid = layoutDayEvents([item("a", 9, 10), item("b", 10, 11), item("c", 11, 12)]);

    expect(placement(laid)).toEqual({ "a": "0/1", "b": "0/1", "c": "0/1" });
  });

  it("splits two overlapping events into two columns", () => {
    const laid = layoutDayEvents([item("a", 9, 11), item("b", 10, 12)]);

    expect(placement(laid)).toEqual({ "a": "0/2", "b": "1/2" });
  });

  it("widens a cluster to hold three concurrent events", () => {
    const laid = layoutDayEvents([item("a", 9, 12), item("b", 9, 12), item("c", 9, 12)]);

    expect(placement(laid)).toEqual({ "a": "0/3", "b": "1/3", "c": "2/3" });
  });

  it("reuses a column once its previous event has ended", () => {
    // a spans the morning; b and c are sequential beside it, so 2 columns suffice.
    const laid = layoutDayEvents([item("a", 9, 12), item("b", 9, 10), item("c", 10, 11)]);

    const p = placement(laid);
    expect(p["a"]).toBe("0/2");
    expect(p["b"]).toBe("1/2");
    expect(p["c"]).toBe("1/2");
  });

  it("keeps separate clusters independent", () => {
    const laid = layoutDayEvents([
      item("a", 9, 11),
      item("b", 10, 12),
      item("later", 14, 15),
    ]);

    expect(placement(laid)).toEqual({ "a": "0/2", "b": "1/2", "later": "0/1" });
  });

  it("treats back-to-back events as non-overlapping", () => {
    const laid = layoutDayEvents([item("a", 9, 10), item("b", 10, 11)]);

    expect(placement(laid)).toEqual({ "a": "0/1", "b": "0/1" });
  });

  it("puts the longer event in the leftmost column on a shared start", () => {
    const laid = layoutDayEvents([item("short", 9, 10), item("long", 9, 12)]);

    expect(placement(laid)).toEqual({ "long": "0/2", "short": "1/2" });
  });

  it("still places a zero-length event", () => {
    const laid = layoutDayEvents([{ event: "point", start: at(9), end: at(9) }]);

    expect(placement(laid)).toEqual({ "point": "0/1" });
  });

  it("returns an empty list unchanged", () => {
    expect(layoutDayEvents([])).toEqual([]);
  });

  it("does not mutate or drop the input", () => {
    const input = [item("a", 9, 11), item("b", 10, 12)];
    const copy = [...input];
    const laid = layoutDayEvents(input);

    expect(laid).toHaveLength(2);
    expect(input).toEqual(copy);
  });
});

describe("isAllDaySpan", () => {
  it("detects a midnight-to-midnight span", () => {
    expect(isAllDaySpan(new Date(2026, 4, 7, 0, 0), new Date(2026, 4, 8, 0, 0))).toBe(true);
  });

  it("rejects a timed meeting", () => {
    expect(isAllDaySpan(at(9), at(10))).toBe(false);
  });

  it("rejects a span that starts at midnight but is short", () => {
    expect(isAllDaySpan(new Date(2026, 4, 7, 0, 0), new Date(2026, 4, 7, 1, 0))).toBe(false);
  });

  it("handles a missing end", () => {
    expect(isAllDaySpan(at(9), null)).toBe(false);
  });
});
