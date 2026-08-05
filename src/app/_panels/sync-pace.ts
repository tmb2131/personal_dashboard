/**
 * Pacing for the dashboard's background sync loop.
 *
 * Split out from `auto-todoist-sync.tsx` so the ladder can be unit-tested — the
 * component around it is all timers and listeners, and there is no DOM
 * environment configured for vitest.
 */

/**
 * Poll delays, fastest first. A quiet round advances one rung; a change, or any
 * sign of the user, drops straight back to the first.
 *
 * The ceiling is the whole point. Neon suspends a compute after five idle
 * minutes and bills for every hour it stays awake, so a tab parked on a fixed
 * 30s timer held the database open for its entire time on screen.
 *
 * The last rung is deliberately *double* that suspend window rather than equal
 * to it: polling every five minutes lands on the boundary and re-wakes the
 * compute each time, which costs the same as never backing off at all. At ten
 * it sleeps for roughly half of every cycle.
 */
export const SYNC_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000] as const;

export const FASTEST_RUNG = 0;
export const SLOWEST_RUNG = SYNC_DELAYS_MS.length - 1;

/** Delay for a rung, clamped so a stray index can never stall the loop. */
export function delayForRung(rung: number): number {
  return SYNC_DELAYS_MS[Math.min(Math.max(rung, FASTEST_RUNG), SLOWEST_RUNG)];
}

/** A quiet round — or a failed one — backs off one rung, never past the floor. */
export function slower(rung: number): number {
  return Math.min(rung + 1, SLOWEST_RUNG);
}

/**
 * How long to wait before the next poll when the user reappears mid-backoff,
 * measured from the last completed poll.
 *
 * Touching the page resets the pace but must never fire a request of its own,
 * or every keystroke would be a sync. A tab that polled two seconds ago waits
 * out the remainder of the fast interval instead of polling twice in a row.
 */
export function resumeDelayMs(lastRunAt: number, now: number): number {
  return Math.max(lastRunAt + delayForRung(FASTEST_RUNG) - now, 0);
}
