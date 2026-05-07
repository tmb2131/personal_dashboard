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
