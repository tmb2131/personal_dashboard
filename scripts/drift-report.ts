// Read-only drift report between Notion To-Dos and Todoist, using neither the
// Neon cache nor task_links (both unavailable while the Neon quota is blown).
// Pairs by normalized title, the same heuristic as sync/link-backfill.ts.
//   TZ=UTC npx tsx scripts/drift-report.ts
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * The handful of Notion property shapes the accessors below reach into. Kept
 * loose on purpose — every key is optional, so reading the wrong variant for a
 * property yields undefined rather than a type error.
 */
type NotionProp = {
  title?: { plain_text?: string }[];
  status?: { name?: string };
  select?: { name?: string };
  date?: { start?: string | null };
  checkbox?: boolean;
  relation?: unknown[];
};

type NPage = {
  id: string;
  archived?: boolean;
  properties: Record<string, NotionProp | undefined>;
  last_edited_time: string;
};

type TTask = {
  id: string;
  content: string;
  priority: number;
  due?: { date?: string; string?: string } | null;
  deadline?: { date?: string } | null;
  labels?: string[];
  projectId?: string;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function notionPages(): Promise<NPage[]> {
  const { Client } = await import("@notionhq/client");
  const c = new Client({ auth: process.env.NOTION_TOKEN! }) as unknown as {
    dataSources: { query: (a: unknown) => Promise<{ results: NPage[]; has_more: boolean; next_cursor: string | null }> };
  };
  const out: NPage[] = [];
  let cursor: string | undefined;
  do {
    const r = await c.dataSources.query({
      data_source_id: process.env.NOTION_TODOS_DATA_SOURCE_ID!,
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...r.results);
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function todoistTasks(): Promise<TTask[]> {
  const { TodoistApi } = await import("@doist/todoist-api-typescript");
  const a = new TodoistApi(process.env.TODOIST_TOKEN!) as unknown as {
    getTasks: (a: { cursor?: string | null; limit?: number }) => Promise<{ results: TTask[]; nextCursor: string | null }>;
  };
  const out: TTask[] = [];
  let cursor: string | null = null;
  do {
    const r = await a.getTasks({ cursor, limit: 200 });
    out.push(...r.results);
    cursor = r.nextCursor;
  } while (cursor);
  return out;
}

const title = (p: NPage) => p.properties["Task name"]?.title?.[0]?.plain_text ?? "";
const status = (p: NPage) => p.properties["Status"]?.status?.name ?? null;
const prio = (p: NPage) => p.properties["Priority"]?.select?.name ?? null;
const dateStart = (p: NPage) => p.properties["Date"]?.date?.start ?? null;
const deadline = (p: NPage) => p.properties["Deadline"]?.date?.start ?? null;
const flag = (p: NPage, k: string) => Boolean(p.properties[k]?.checkbox);
const focus = (p: NPage) => p.properties["Focus"]?.select?.name ?? null;
const hasParent = (p: NPage) => (p.properties["Parent task"]?.relation?.length ?? 0) > 0;

const P_N2T: Record<string, number> = { Low: 2, Medium: 3, High: 4 };
const P_T2N: Record<number, string | null> = { 1: null, 2: "Low", 3: "Medium", 4: "High" };

// mirrors notionShouldMirrorToTodoist in src/lib/sync/mappings.ts
function shouldMirror(p: NPage) {
  if (p.archived || flag(p, "Archived") || flag(p, "Ignore")) return false;
  if (status(p) === "Done") return false;
  return Boolean(dateStart(p) || deadline(p) || focus(p) === "Yes" || hasParent(p));
}

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

async function main() {
  const [pages, tasks] = await Promise.all([notionPages(), todoistTasks()]);

  const byTitle = new Map<string, TTask[]>();
  for (const t of tasks) {
    const k = norm(t.content);
    byTitle.set(k, [...(byTitle.get(k) ?? []), t]);
  }

  const live = pages.filter((p) => !p.archived && !flag(p, "Archived") && !flag(p, "Ignore"));
  const matched: string[] = [];
  const drifted: string[] = [];
  const ambiguous: string[] = [];
  const notionOnly: string[] = [];
  const usedTodoist = new Set<string>();

  for (const p of live) {
    const k = norm(title(p));
    if (!k) continue;
    const m = byTitle.get(k) ?? [];
    if (m.length > 1) {
      ambiguous.push(`${title(p)}  (${m.length} Todoist matches)`);
      m.forEach((t) => usedTodoist.add(t.id));
      continue;
    }
    if (m.length === 0) {
      if (shouldMirror(p)) notionOnly.push(`${title(p)}  [${status(p)}] date=${day(dateStart(p))} dl=${day(deadline(p))}`);
      continue;
    }
    const t = m[0];
    usedTodoist.add(t.id);
    matched.push(k);

    const diffs: string[] = [];
    const nDone = status(p) === "Done";
    if (nDone) diffs.push(`status: Notion=Done / Todoist=open`);
    const nIP = status(p) === "In progress";
    const tIP = (t.labels ?? []).includes("in-progress");
    if (nIP !== tIP) diffs.push(`in-progress: Notion=${nIP} Todoist=${tIP}`);
    if (day(dateStart(p)) !== day(t.due?.date)) diffs.push(`date: Notion=${day(dateStart(p))} Todoist=${day(t.due?.date)}`);
    if (day(deadline(p)) !== day(t.deadline?.date)) diffs.push(`deadline: Notion=${day(deadline(p))} Todoist=${day(t.deadline?.date)}`);
    const nP = prio(p);
    if ((nP ? P_N2T[nP] : 1) !== t.priority) diffs.push(`priority: Notion=${nP ?? "none"} Todoist=${P_T2N[t.priority] ?? "none"}`);
    if (diffs.length) drifted.push(`${title(p)}\n    ${diffs.join("\n    ")}\n    notion=${p.id} todoist=${t.id} notion_edited=${p.last_edited_time}`);
  }

  const todoistOnly = tasks.filter((t) => !usedTodoist.has(t.id));

  const section = (name: string, rows: string[]) => {
    console.log(`\n## ${name} (${rows.length})`);
    rows.forEach((r) => console.log(`  - ${r}`));
  };

  console.log(`Notion live pages: ${live.length}   Todoist open tasks: ${tasks.length}`);
  console.log(`Title-matched pairs: ${matched.length}`);
  section("DRIFTED — matched pair, fields disagree", drifted);
  section("AMBIGUOUS — duplicate titles, cannot pair safely", ambiguous);
  section("NOTION ONLY — qualifies for mirroring, no Todoist task", notionOnly);
  section("TODOIST ONLY — no Notion page with this title", todoistOnly.map((t) => `${t.content}  due=${day(t.due?.date)} todoist=${t.id}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
