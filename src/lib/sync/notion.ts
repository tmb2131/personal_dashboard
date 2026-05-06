import { Client } from "@notionhq/client";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";

const TODOS_DS = process.env.NOTION_TODOS_DATA_SOURCE_ID!;
const CATEGORIES_DS = process.env.NOTION_CATEGORIES_DATA_SOURCE_ID!;

let _client: Client | null = null;
function client() {
  if (!_client) _client = new Client({ auth: process.env.NOTION_TOKEN });
  return _client;
}

type AnyProp = Record<string, unknown>;

// Notion properties are wrapped in { type, [type]: ... }. These helpers
// reach inside the wrapper rather than assuming a property name, since the
// title property in particular is named differently per database (e.g.
// "Task name" on To-Dos, "Name" on Categories).

type Prop = { type?: string; [k: string]: unknown };

function readTitle(properties: AnyProp): string {
  for (const key in properties) {
    const v = properties[key] as Prop;
    if (v?.type === "title" && Array.isArray(v.title)) {
      return (v.title as { plain_text?: string }[])
        .map((r) => r.plain_text ?? "")
        .join("");
    }
  }
  return "";
}

function readSelect(p: AnyProp, key: string): string | null {
  const v = (p?.[key] as { select?: { name?: string } } | undefined)?.select;
  return v?.name ?? null;
}
function readStatus(p: AnyProp, key: string): string | null {
  const v = (p?.[key] as { status?: { name?: string } } | undefined)?.status;
  return v?.name ?? null;
}
function readCheckbox(p: AnyProp, key: string): boolean {
  return Boolean((p?.[key] as { checkbox?: boolean } | undefined)?.checkbox);
}
function readDate(p: AnyProp, key: string) {
  const v = (p?.[key] as { date?: { start?: string; end?: string } } | undefined)
    ?.date;
  if (!v?.start) return { start: null, end: null, isDatetime: false };
  const isDatetime = v.start.includes("T");
  return {
    start: v.start ? new Date(v.start) : null,
    end: v.end ? new Date(v.end) : null,
    isDatetime,
  };
}
function readRelationFirst(p: AnyProp, key: string): string | null {
  const v = (p?.[key] as { relation?: { id: string }[] } | undefined)?.relation;
  return v?.[0]?.id ?? null;
}
function readText(p: AnyProp, key: string): string | null {
  const v = (p?.[key] as { rich_text?: { plain_text?: string }[] } | undefined)
    ?.rich_text;
  if (!Array.isArray(v)) return null;
  const s = v.map((r) => r.plain_text ?? "").join("");
  return s || null;
}

type DataSourceQueryResp = {
  results: { id: string; archived: boolean; properties: AnyProp }[];
  next_cursor: string | null;
  has_more: boolean;
};

async function queryAll(dataSourceId: string): Promise<DataSourceQueryResp["results"]> {
  const out: DataSourceQueryResp["results"] = [];
  let cursor: string | undefined = undefined;
  // The Notion JS SDK exposes data sources at client.dataSources.query as of API 2025-09-03.
  // Cast is only needed because TS types lag the SDK; runtime call is correct.
  const c = client() as unknown as {
    dataSources: { query: (args: unknown) => Promise<DataSourceQueryResp> };
  };
  do {
    const resp: DataSourceQueryResp = await c.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    out.push(...resp.results);
    cursor = resp.next_cursor ?? undefined;
    if (!resp.has_more) break;
  } while (cursor);
  return out;
}

export async function syncNotion() {
  const [todos, categories] = await Promise.all([
    queryAll(TODOS_DS),
    queryAll(CATEGORIES_DS),
  ]);

  const now = new Date();

  if (categories.length) {
    await db
      .insert(schema.notionCategories)
      .values(
        categories.map((c) => ({
          id: c.id,
          title: readTitle(c.properties) || "(untitled)",
          archived: c.archived,
          raw: c as unknown,
          updatedAt: now,
          lastSyncedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: schema.notionCategories.id,
        set: {
          title: sql`excluded.title`,
          archived: sql`excluded.archived`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  }

  if (todos.length) {
    await db
      .insert(schema.notionPages)
      .values(
        todos.map((p) => {
          const props = p.properties;
          const date = readDate(props, "Date");
          const deadline = readDate(props, "Deadline");
          return {
            id: p.id,
            categoryId: readRelationFirst(props, "Category"),
            title: readTitle(props) || "(untitled)",
            status: (readStatus(props, "Status") ?? null) as never,
            dateStart: date.start,
            dateEnd: date.end,
            dateIsDatetime: date.isDatetime,
            deadline: deadline.start,
            priority: (readSelect(props, "Priority") ?? null) as never,
            focus: (readSelect(props, "Focus") ?? null) as never,
            tripStatus: (readStatus(props, "Trip Status") ?? null) as never,
            parentId: readRelationFirst(props, "Parent task"),
            keyNextStep: readText(props, "Key Next Step"),
            nextSteps: readText(props, "Next Steps"),
            notes: readText(props, "Notes"),
            archived: p.archived || readCheckbox(props, "Archived"),
            ignore: readCheckbox(props, "Ignore"),
            raw: p as unknown,
            updatedAt: now,
            lastSyncedAt: now,
          };
        }),
      )
      .onConflictDoUpdate({
        target: schema.notionPages.id,
        set: {
          categoryId: sql`excluded.category_id`,
          title: sql`excluded.title`,
          status: sql`excluded.status`,
          dateStart: sql`excluded.date_start`,
          dateEnd: sql`excluded.date_end`,
          dateIsDatetime: sql`excluded.date_is_datetime`,
          deadline: sql`excluded.deadline`,
          priority: sql`excluded.priority`,
          focus: sql`excluded.focus`,
          tripStatus: sql`excluded.trip_status`,
          parentId: sql`excluded.parent_id`,
          keyNextStep: sql`excluded.key_next_step`,
          nextSteps: sql`excluded.next_steps`,
          notes: sql`excluded.notes`,
          archived: sql`excluded.archived`,
          ignore: sql`excluded.ignore`,
          raw: sql`excluded.raw`,
          updatedAt: sql`excluded.updated_at`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  }

  return { categories: categories.length, todos: todos.length };
}
