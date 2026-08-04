/**
 * Pin the server clock to the dashboard's timezone.
 *
 * Todoist "floating" dues carry no offset: "every day 7pm" arrives as
 * `"2026-08-04T19:00:00"` and means 7pm on the owner's wall clock. Resolving
 * that to an instant uses the server's local zone — as does deciding which
 * tasks count as "today" (`parseDateOnlyLocal`). On Vercel that zone is UTC, so
 * during BST every timed task read an hour late and the day boundary sat an
 * hour off.
 *
 * Vercel reserves `TZ` as an environment variable name, so it cannot be set on
 * the project. Assigning it here does the same job — Node re-runs `tzset` on
 * assignment — and `register` is called once per server instance before any
 * request is handled.
 *
 * Edge is skipped deliberately: that runtime is fixed to UTC and ignores the
 * assignment. Nothing on the edge path (`src/proxy.ts`) touches dates.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  process.env.TZ = process.env.DASHBOARD_TIME_ZONE || "Europe/London";
}
