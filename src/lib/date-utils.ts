const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseDateOnlyLocal(input: string): Date | null {
  const match = DATE_ONLY_RE.exec(input);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, monthIndex, day, 0, 0, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function parseDateOnlyLocalStrict(input: string): Date {
  const parsed = parseDateOnlyLocal(input);
  if (!parsed) throw new Error("Invalid date");
  return parsed;
}

export function parseDateTimeLocal(dateInput: string, timeInput: string): Date | null {
  const date = parseDateOnlyLocal(dateInput);
  const time = TIME_ONLY_RE.exec(timeInput);
  if (!date || !time) return null;

  date.setHours(Number(time[1]), Number(time[2]), 0, 0);
  return date;
}

export function formatDateOnlyLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Milliseconds from `now` until just past the next local midnight.
 *
 * The 5s buffer absorbs server/client clock skew so the refresh that follows
 * lands on the new day. Building the target through the local Date constructor
 * keeps this correct across DST shifts, where a day is 23 or 25 hours long.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    5,
    0,
  );
  return Math.max(1_000, nextMidnight.getTime() - now.getTime());
}
