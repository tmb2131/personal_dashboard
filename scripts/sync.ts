// CLI sync runner. Bypasses auth — only run locally with creds in .env.local.
//   npx tsx scripts/sync.ts
import "dotenv/config";
import { syncNotion } from "../src/lib/sync/notion";
import { syncTodoist } from "../src/lib/sync/todoist";

async function main() {
  const t0 = Date.now();
  const [notion, todoist] = await Promise.allSettled([syncNotion(), syncTodoist()]);
  console.log("notion:", notion);
  console.log("todoist:", todoist);
  console.log(`done in ${Date.now() - t0}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
