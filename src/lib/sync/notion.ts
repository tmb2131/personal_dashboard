import { Client } from "@notionhq/client";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { notionStatusFromTodoist, PRIORITY_TODOIST_TO_NOTION, type TodoistTask } from "@/lib/sync/mappings";

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

export type NotionTodoRowInput = {
  id: string;
  archived: boolean;
  properties: AnyProp;
  raw: unknown;
} & { syncedAt?: Date };

/** Map a To-Dos data-source row or retrieved page into a DB insert shape. */
export function mapTodoPageRow(p: NotionTodoRowInput, syncedAt: Date) {
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
    raw: p.raw,
    updatedAt: syncedAt,
    lastSyncedAt: syncedAt,
  };
}

function mapCategoryRow(
  c: { id: string; archived: boolean; properties: AnyProp; raw?: unknown },
  syncedAt: Date,
) {
  return {
    id: c.id,
    title: readTitle(c.properties) || "(untitled)",
    archived: c.archived,
    raw: (c.raw ?? c) as unknown,
    updatedAt: syncedAt,
    lastSyncedAt: syncedAt,
  };
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
        categories.map((c) =>
          mapCategoryRow(
            { id: c.id, archived: c.archived, properties: c.properties, raw: c },
            now,
          ),
        ),
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
        todos.map((p) =>
          mapTodoPageRow({ id: p.id, archived: p.archived, properties: p.properties, raw: p }, now),
        ),
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

  await db
    .insert(schema.syncState)
    .values({
      source: "notion",
      lastFullSyncAt: now,
    })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { lastFullSyncAt: now },
    });

  return { categories: categories.length, todos: todos.length };
}

/** Upsert a single page retrieved from the Notion API (todo vs category by presence of `Status`). */
export async function syncNotionEntitiesByIds(
  pageIds: string[],
  hintById?: Map<string, "todo" | "category">,
) {
  const now = new Date();
  let todos = 0;
  let categories = 0;
  const errors: string[] = [];
  const c = client();

  for (const pageId of pageIds) {
    try {
      const hint = hintById?.get(pageId);
      const page = await c.pages.retrieve({ page_id: pageId });
      if (!("properties" in page) || !page.properties) continue;
      const props = page.properties as AnyProp;

      const isTodo =
        hint === "todo" ||
        (hint !== "category" &&
          Object.prototype.hasOwnProperty.call(props, "Status"));

      if (isTodo) {
        const row = mapTodoPageRow(
          {
            id: page.id,
            archived: Boolean(page.archived),
            properties: props,
            raw: page,
          },
          now,
        );
        await db
          .insert(schema.notionPages)
          .values(row)
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
        todos++;
      } else {
        const row = mapCategoryRow(
          {
            id: page.id,
            archived: Boolean(page.archived),
            properties: props,
            raw: page,
          },
          now,
        );
        await db
          .insert(schema.notionCategories)
          .values(row)
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
        categories++;
      }
    } catch (e) {
      errors.push(`${pageId}: ${(e as Error).message}`);
    }
  }

  await db
    .insert(schema.syncState)
    .values({ source: "notion", lastIncrementalAt: now })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { lastIncrementalAt: now },
    });

  return { todos, categories, errors };
}

export async function updateNotionTodoStatus(
  pageId: string,
  status: "Not started" | "In progress" | "Done",
) {
  await client().pages.update({
    page_id: pageId,
    properties: {
      Status: { status: { name: status } },
    },
  });
}

export async function updateNotionFocus(pageId: string, focus: "Yes" | "No") {
  await client().pages.update({
    page_id: pageId,
    properties: {
      Focus: { select: { name: focus } },
    },
  });
}

type DataSourceObjectResponse = {
  properties: Record<string, { type?: string; [k: string]: unknown }>;
};

function formatNotionDateProp(d: Date, isDatetime: boolean): { start: string } {
  if (isDatetime) return { start: d.toISOString() };
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { start: `${y}-${m}-${day}` };
}

/**
 * Resolves the To-Dos data source title property key (e.g. "Task name") for pages.create.
 */
export async function getTodosTitlePropertyName(): Promise<string> {
  if (!TODOS_DS) throw new Error("NOTION_TODOS_DATA_SOURCE_ID missing");
  const c = client() as unknown as {
    dataSources: { retrieve: (args: { data_source_id: string }) => Promise<DataSourceObjectResponse> };
  };
  const ds = await c.dataSources.retrieve({ data_source_id: TODOS_DS });
  for (const [key, cfg] of Object.entries(ds.properties ?? {})) {
    if (cfg && typeof cfg === "object" && "type" in cfg && cfg.type === "title") return key;
  }
  throw new Error("To-Dos data source has no title property");
}

export type CreateTodoFromTodoistMirrorInput = {
  title: string;
  notionParentPageId: string;
  /** Todoist-side task (DB row) used for Status / priority / dates on the new Notion page. */
  task: Pick<TodoistTask, "checked" | "labels" | "priority" | "dueDate" | "deadline">;
};

/**
 * Creates a sub-task page under the To-Dos data source with "Parent task" set.
 * Caller must validate the parent is a top-level project row; syncs the new page into `notion_pages`.
 */
export async function createTodoPageFromTodoistMirror(
  input: CreateTodoFromTodoistMirrorInput,
): Promise<{ pageId: string }> {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN missing");
  if (!TODOS_DS) throw new Error("NOTION_TODOS_DATA_SOURCE_ID missing");

  const titleKey = await getTodosTitlePropertyName();
  const t = {
    id: "temp",
    projectId: null,
    parentId: null,
    content: input.title,
    dueDate: input.task.dueDate,
    dueString: null,
    dueIsRecurring: false,
    deadline: input.task.deadline,
    priority: input.task.priority,
    checked: input.task.checked,
    labels: input.task.labels ?? [],
    description: null,
    raw: {},
    updatedAt: new Date(),
  } as unknown as TodoistTask;

  const status = notionStatusFromTodoist(t);
  const priorityName = PRIORITY_TODOIST_TO_NOTION[input.task.priority] ?? null;

  const properties: Record<string, unknown> = {
    [titleKey]: {
      title: [{ type: "text" as const, text: { content: input.title } }],
    },
    Status: { status: { name: status } },
    "Parent task": { relation: [{ id: input.notionParentPageId }] },
  };

  if (priorityName) {
    properties.Priority = { select: { name: priorityName } };
  }

  const due = input.task.dueDate;
  const dl = input.task.deadline;
  if (due) {
    properties.Date = {
      date: formatNotionDateProp(due, false),
    };
  }
  if (dl && (!due || dl.getTime() !== due.getTime())) {
    properties.Deadline = {
      date: formatNotionDateProp(dl, false),
    };
  }

  const created = await client().pages.create({
    parent: { type: "data_source_id", data_source_id: TODOS_DS },
    properties: properties as never,
  });

  const pageId = created.id;
  await syncNotionEntitiesByIds([pageId], new Map([[pageId, "todo"]]));
  return { pageId };
}
