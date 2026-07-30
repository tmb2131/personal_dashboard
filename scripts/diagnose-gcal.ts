// Google Calendar sync diagnostics. Bypasses auth — only run locally with
// creds in .env.local.
//   npx tsx scripts/diagnose-gcal.ts
//
// Written after a 77-day silent outage: an empty calendar list made every sync
// a no-op that still reported success, so nothing surfaced in the UI. This
// prints the state needed to tell the failure modes apart.
import dotenv from "dotenv";

// `.env.local` first — that is what the README's setup creates, and plain
// `dotenv/config` reads only `.env`. Earlier calls win, so `.env` fills gaps
// without overriding. Everything else is imported dynamically inside main() so
// these run before any module reads process.env at load time.
const envFilesLoaded = [".env.local", ".env"].filter(
  (path) => !dotenv.config({ path }).error,
);

function ageLabel(d: Date | null, now: Date): string {
  if (!d) return "never";
  const mins = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function main() {
  const { and, gte, like, lte } = await import("drizzle-orm");
  const { db, schema } = await import("../src/lib/db");
  const {
    calendarIds,
    DEFAULT_CALENDAR_IDS,
    shouldRefreshWindow,
    WINDOW_REFRESH_INTERVAL_MS,
  } = await import("../src/lib/sync/gcal");

  const now = new Date();

  console.log("=== env files ===");
  console.log(
    `  loaded: ${envFilesLoaded.join(", ") || "(none found in the current directory)"}`,
  );
  if (envFilesLoaded.length === 0) {
    console.log("  Run this from the repo root, where .env.local lives.");
  }

  console.log("\n=== credentials ===");
  for (const key of [
    "DATABASE_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GCAL_CALENDAR_IDS",
    "APP_URL",
    "VERCEL_URL",
  ]) {
    console.log(`  ${key.padEnd(22)} ${process.env[key] ? "set" : "MISSING"}`);
  }

  const resolved = calendarIds();
  const usingDefault = !process.env.GCAL_CALENDAR_IDS?.trim();
  console.log("\n=== calendars ===");
  console.log(`  resolved: ${resolved.join(", ") || "(none)"}`);
  if (usingDefault) {
    console.log(`  NOTE: GCAL_CALENDAR_IDS unset — using built-in default`);
    console.log(`        (${DEFAULT_CALENDAR_IDS.join(", ")})`);
    console.log(`        Set it explicitly in the deployed environment.`);
  }

  if (!process.env.DATABASE_URL) {
    console.log("\nDATABASE_URL is not set, so the cached sync state cannot be read.");
    console.log("Fill it in .env.local, or pull it down with: vercel env pull .env.local");
    return;
  }

  console.log("\n=== sync_state (gcal%) ===");
  let rows;
  try {
    rows = await db
      .select()
      .from(schema.syncState)
      .where(like(schema.syncState.source, "gcal%"));
  } catch (e) {
    // A stack trace is the wrong output for a tool meant to explain problems.
    console.log(`  could not reach the database: ${(e as Error).message}`);
    console.log("  Check DATABASE_URL points at a reachable Postgres instance.");
    return;
  }

  if (rows.length === 0) {
    console.log("  no gcal rows — this calendar has never synced in this database");
  }
  for (const r of rows) {
    const staleWindow = shouldRefreshWindow(r.lastFullSyncAt ?? null, now);
    console.log(`  ${r.source}`);
    console.log(`    lastFullSyncAt    ${ageLabel(r.lastFullSyncAt ?? null, now)}`);
    console.log(`    lastIncrementalAt ${ageLabel(r.lastIncrementalAt ?? null, now)}`);
    console.log(`    cursor            ${r.cursor ? "set" : "none"}`);
    console.log(
      `    window refresh    ${staleWindow ? "DUE" : "fresh"} (interval ${
        WINDOW_REFRESH_INTERVAL_MS / 3_600_000
      }h)`,
    );
  }

  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 14);

  const events = await db
    .select()
    .from(schema.gcalEvents)
    .where(and(gte(schema.gcalEvents.start, windowStart), lte(schema.gcalEvents.start, windowEnd)));

  console.log("\n=== cached events in the next 14 days ===");
  console.log(`  ${events.length} row(s)`);
  for (const e of events.slice(0, 10)) {
    console.log(`    ${e.start?.toISOString() ?? "(no start)"}  ${e.summary ?? "(no title)"}`);
  }
  if (events.length > 10) console.log(`    …and ${events.length - 10} more`);
  if (events.length === 0) {
    console.log("  Empty while the calendar has events means the sync is not writing.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
