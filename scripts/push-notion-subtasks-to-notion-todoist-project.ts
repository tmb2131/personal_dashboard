// Push Notion sub-task rows (child pages) that are not yet linked to Todoist into
// the Todoist project named "Notion", with the parent row title as a Todoist label.
//   npx tsx scripts/push-notion-subtasks-to-notion-todoist-project.ts
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { and, eq, isNotNull } = await import("drizzle-orm");
  const { db, schema } = await import("../src/lib/db");
  const { pushNotionPageToTodoist } = await import("../src/lib/sync/cross-post");
  const { notionShouldMirrorToTodoist } = await import("../src/lib/sync/mappings");
  const { getTodoistProjectIdByName, syncTodoist } = await import("../src/lib/sync/todoist");
  const { syncNotion } = await import("../src/lib/sync/notion");

  const t0 = Date.now();
  await Promise.all([syncNotion(), syncTodoist()]);

  const [links, rows] = await Promise.all([
    db.select({ id: schema.taskLinks.notionPageId }).from(schema.taskLinks),
    db
      .select()
      .from(schema.notionPages)
      .where(
        and(
          isNotNull(schema.notionPages.parentId),
          eq(schema.notionPages.archived, false),
          eq(schema.notionPages.ignore, false),
        ),
      ),
  ]);

  const linked = new Set(links.map((l) => l.id));
  const candidates = rows.filter((p) => !linked.has(p.id) && notionShouldMirrorToTodoist(p));

  const notionProjectId = await getTodoistProjectIdByName("Notion");
  console.log(`Found ${candidates.length} Notion sub-tasks to push into Todoist project "Notion".`);

  const ok: string[] = [];
  const failed: { id: string; title: string; error: string }[] = [];

  for (const p of candidates) {
    try {
      await pushNotionPageToTodoist(p.id, { todoistProjectId: notionProjectId });
      ok.push(`${p.title} (${p.id})`);
    } catch (e) {
      failed.push({ id: p.id, title: p.title, error: (e as Error).message });
    }
  }

  for (const line of ok) console.log("  +", line);
  for (const f of failed) console.error("  !", f.title, f.id, "—", f.error);

  console.log(`Done in ${Date.now() - t0}ms — pushed ${ok.length}, skipped/errors ${failed.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
