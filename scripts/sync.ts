// CLI sync runner. Bypasses auth — only run locally with creds in .env.local.
//   npx tsx scripts/sync.ts
import dotenv from "dotenv";

// `.env.local` first: plain `dotenv/config` reads only `.env`, so the setup the
// README describes went unseen. Imports below are dynamic so these run before
// any module reads process.env at load time.
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { syncNotion } = await import("../src/lib/sync/notion");
  const { syncTodoist } = await import("../src/lib/sync/todoist");

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
