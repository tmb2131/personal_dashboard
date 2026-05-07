import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
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
