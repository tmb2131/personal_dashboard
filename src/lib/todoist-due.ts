import { parseDateOnlyLocal } from "./date-utils";

/**
 * A Todoist `due` payload, across the API versions we have cached rows from.
 *
 * REST v2 split the two cases into `date` ("2026-08-04") and `datetime`
 * ("2026-08-04T11:00:00"). API v1 — what `@doist/todoist-sdk` talks to now —
 * dropped `datetime` entirely and packs the time into `date`, so a timed task
 * and an all-day task are told apart purely by whether `date` has a `T` in it.
 *
 * `raw` blobs written before the SDK upgrade still carry the v2 shape, and the
 * snake_case variants show up in payloads that skipped the SDK's camelCasing,
 * so every reader goes through here rather than picking one key.
 */
export type TodoistDueLike =
  | {
      date?: string | null;
      datetime?: string | null;
      due_date?: string | null;
      due_datetime?: string | null;
    }
  | null
  | undefined;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The most specific date string the payload carries, preferring a datetime. */
export function todoistDueValue(due: TodoistDueLike): string | null {
  for (const value of [due?.datetime, due?.due_datetime, due?.date, due?.due_date]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** True when the due carries a time of day rather than being an all-day date. */
export function todoistDueHasTime(due: TodoistDueLike): boolean {
  const value = todoistDueValue(due);
  return Boolean(value && !DATE_ONLY_RE.test(value));
}

/**
 * The `due.date` to hand the Sync API when moving a repeating task's next
 * occurrence.
 *
 * A zoned rule wants an absolute UTC instant. A floating one ("every day 7pm",
 * `timezone: null`) wants the bare local wall clock, with no offset, so that it
 * keeps floating rather than being pinned to whatever zone we happen to run in.
 */
export function todoistRecurrenceDateArg(args: {
  dueDate: string;
  dueTime: string | null;
  dueAt: Date | null;
  timezone: string | null;
}): string {
  if (!args.dueTime) return args.dueDate;
  if (args.timezone && args.dueAt) return args.dueAt.toISOString();
  return `${args.dueDate}T${args.dueTime}:00`;
}

/**
 * Resolve the due to a Date. All-day dates land at local midnight; a datetime
 * without an offset is local (Todoist's "floating" time), and one ending in `Z`
 * carries its own zone.
 */
export function parseTodoistDue(due: TodoistDueLike): Date | null {
  const value = todoistDueValue(due);
  if (!value) return null;
  if (DATE_ONLY_RE.test(value)) return parseDateOnlyLocal(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
