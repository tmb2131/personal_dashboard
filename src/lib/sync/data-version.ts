import { max } from "drizzle-orm";
import { db, schema } from "@/lib/db";

function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Newest `updated_at` across every Notion row, as epoch ms.
 *
 * An open tab compares this against the version baked into its rendered payload
 * to notice Notion writes that arrived by webhook. Both sides must come from
 * this one helper over *all* rows — archived included. `loadDashboard` only
 * selects `archived = false`, and computing the version from that filtered set
 * would leave this value permanently ahead once a page is archived, refreshing
 * the page forever.
 *
 * `sync_state` is deliberately not used: `syncTodoist` bumps `lastFullSyncAt`
 * on every run even when nothing changed.
 */
export async function getNotionDataVersion(): Promise<number | null> {
  const [pages, categories] = await Promise.all([
    db.select({ value: max(schema.notionPages.updatedAt) }).from(schema.notionPages),
    db.select({ value: max(schema.notionCategories.updatedAt) }).from(schema.notionCategories),
  ]);

  const stamps = [toEpochMs(pages[0]?.value), toEpochMs(categories[0]?.value)].filter(
    (ms): ms is number => ms != null,
  );

  return stamps.length > 0 ? Math.max(...stamps) : null;
}
