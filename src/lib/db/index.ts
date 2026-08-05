import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function missingDatabaseUrlError() {
  return new Error("DATABASE_URL missing");
}

function createSqlClient(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return neon(databaseUrl);

  return Object.assign(
    () => Promise.reject(missingDatabaseUrlError()),
    {
      query: () => Promise.reject(missingDatabaseUrlError()),
      unsafe: () => {
        throw missingDatabaseUrlError();
      },
      transaction: () => Promise.reject(missingDatabaseUrlError()),
    },
  ) as unknown as NeonQueryFunction<false, false>;
}

const sql = createSqlClient();

export const db = drizzle(sql, { schema });
export { schema };

/**
 * Every-column-but-`raw` projections for the tables read in bulk.
 *
 * `raw` holds the full upstream API object per row and dwarfs everything else.
 * Nothing reads the Notion ones — they are written by the sync and never looked
 * at again — so a plain `db.select()` on these tables ships megabytes of dead
 * jsonb over the wire on every dashboard render. Pass these to `db.select()`
 * instead. Derived via `getTableColumns` so new columns are picked up
 * automatically; only `raw` has to be opted out.
 *
 * Note that the Todoist and gcal `raw` columns *are* read (`raw.due`,
 * `raw.deadline`, meeting URLs), so no equivalent exists for those tables.
 */
function withoutRaw<T extends { raw: unknown }>(columns: T): Omit<T, "raw"> {
  const rest = { ...columns };
  delete (rest as { raw?: unknown }).raw;
  return rest;
}

export const notionPageColumns = withoutRaw(getTableColumns(schema.notionPages));
export const notionCategoryColumns = withoutRaw(getTableColumns(schema.notionCategories));
