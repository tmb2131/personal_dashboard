import { db, notionPageColumns, schema } from "@/lib/db";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { syncHash } from "./mappings";

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns proposed title-match links between Notion pages and Todoist tasks
// that aren't already linked. The caller (a UI screen) approves them before
// they're written via `writeProposedLinks`.
export async function proposeLinks() {
  const [pages, tasks, existing] = await Promise.all([
    db
      .select(notionPageColumns)
      .from(schema.notionPages)
      .where(eq(schema.notionPages.archived, false)),
    db.select().from(schema.todoistTasks).where(eq(schema.todoistTasks.checked, false)),
    db.select().from(schema.taskLinks),
  ]);

  const linkedNotion = new Set(existing.map((l) => l.notionPageId));
  const linkedTodoist = new Set(existing.map((l) => l.todoistTaskId));

  const tasksByTitle = new Map<string, typeof tasks>();
  for (const t of tasks) {
    if (linkedTodoist.has(t.id)) continue;
    const k = normalize(t.content);
    const arr = tasksByTitle.get(k) ?? [];
    arr.push(t);
    tasksByTitle.set(k, arr);
  }

  type Proposal = {
    notionPageId: string;
    notionTitle: string;
    todoistTaskId: string;
    todoistContent: string;
    confidence: "exact" | "ambiguous";
  };
  const proposals: Proposal[] = [];

  for (const p of pages) {
    if (linkedNotion.has(p.id) || p.status === "Done") continue;
    const matches = tasksByTitle.get(normalize(p.title));
    if (!matches?.length) continue;
    if (matches.length === 1) {
      proposals.push({
        notionPageId: p.id,
        notionTitle: p.title,
        todoistTaskId: matches[0].id,
        todoistContent: matches[0].content,
        confidence: "exact",
      });
    } else {
      for (const m of matches) {
        proposals.push({
          notionPageId: p.id,
          notionTitle: p.title,
          todoistTaskId: m.id,
          todoistContent: m.content,
          confidence: "ambiguous",
        });
      }
    }
  }

  return proposals;
}

export async function writeProposedLinks(
  pairs: { notionPageId: string; todoistTaskId: string }[],
) {
  if (!pairs.length) return { written: 0 };
  const [pages, tasks] = await Promise.all([
    db.select(notionPageColumns).from(schema.notionPages),
    db.select().from(schema.todoistTasks),
  ]);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const rows = pairs
    .map((p) => {
      const np = pageById.get(p.notionPageId);
      const tt = taskById.get(p.todoistTaskId);
      if (!np || !tt) return null;
      return {
        id: crypto.randomUUID(),
        notionPageId: np.id,
        todoistTaskId: tt.id,
        lastSyncHash: syncHash({
          title: np.title,
          status: np.status,
          date: np.dateStart,
          deadline: np.deadline,
          priority: np.priority,
          categoryOrProjectId: np.categoryId ?? tt.projectId ?? null,
          todoist: {
            content: tt.content,
            checked: tt.checked,
            dueDate: tt.dueDate,
            deadline: tt.deadline,
            priority: tt.priority,
          },
        }),
        pendingOrigin: null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!rows.length) return { written: 0 };
  await db.insert(schema.taskLinks).values(rows).onConflictDoNothing();
  return { written: rows.length };
}

// Helper to find Notion pages without a Todoist mirror that should have one,
// per the propagation rules in mappings.ts. The actual creation runs in M3.
export async function listMissingMirrors() {
  const linked = await db.select({ id: schema.taskLinks.notionPageId }).from(schema.taskLinks);
  const linkedIds = linked.map((l) => l.id);
  return db
    .select()
    .from(schema.notionPages)
    .where(
      and(
        eq(schema.notionPages.archived, false),
        eq(schema.notionPages.ignore, false),
        linkedIds.length ? notInArray(schema.notionPages.id, linkedIds) : isNull(schema.notionPages.id),
      ),
    );
}
