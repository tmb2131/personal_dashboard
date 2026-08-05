import { describe, expect, it } from "vitest";
import {
  FASTEST_RUNG,
  SLOWEST_RUNG,
  SYNC_DELAYS_MS,
  delayForRung,
  resumeDelayMs,
  slower,
} from "./sync-pace";

describe("the delay ladder", () => {
  it("starts at 30s and tops out past the 5 minute suspend window", () => {
    expect(delayForRung(FASTEST_RUNG)).toBe(30_000);
    expect(delayForRung(SLOWEST_RUNG)).toBe(600_000);
  });

  it("idles slower than the suspend window, so the compute actually sleeps", () => {
    // Equal to it would re-wake the compute on the boundary every time and
    // save nothing, which is the bug this ladder exists to avoid.
    expect(delayForRung(SLOWEST_RUNG)).toBeGreaterThan(300_000);
  });

  it("only ever gets slower", () => {
    const climbing = SYNC_DELAYS_MS.every(
      (delay, i) => i === 0 || delay > SYNC_DELAYS_MS[i - 1],
    );
    expect(climbing).toBe(true);
  });

  it("clamps out-of-range rungs rather than returning undefined", () => {
    expect(delayForRung(-5)).toBe(delayForRung(FASTEST_RUNG));
    expect(delayForRung(99)).toBe(delayForRung(SLOWEST_RUNG));
  });
});

describe("slower", () => {
  it("walks the ladder one rung at a time", () => {
    expect(slower(0)).toBe(1);
    expect(slower(1)).toBe(2);
  });

  it("sticks at the floor instead of drifting past it", () => {
    expect(slower(SLOWEST_RUNG)).toBe(SLOWEST_RUNG);
    expect(slower(SLOWEST_RUNG + 10)).toBe(SLOWEST_RUNG);
  });

  it("reaches the floor from a standing start in under a ladder's length", () => {
    let rung = FASTEST_RUNG;
    for (let i = 0; i < SYNC_DELAYS_MS.length; i += 1) rung = slower(rung);
    expect(rung).toBe(SLOWEST_RUNG);
  });
});

describe("resumeDelayMs", () => {
  it("waits out the rest of the fast interval after a recent poll", () => {
    // Polled 2s ago, so 28s of the 30s interval is still owed.
    expect(resumeDelayMs(1_000_000, 1_002_000)).toBe(28_000);
  });

  it("fires immediately once the fast interval has already elapsed", () => {
    expect(resumeDelayMs(1_000_000, 1_400_000)).toBe(0);
  });

  it("never returns a negative delay", () => {
    expect(resumeDelayMs(0, Date.now())).toBe(0);
  });
});
