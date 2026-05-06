import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------- Notion ----------

export const notionStatus = pgEnum("notion_status", [
  "Not started",
  "In progress",
  "Done",
]);

export const notionFocus = pgEnum("notion_focus", ["Yes", "No", "Life Area"]);

export const notionTripStatus = pgEnum("notion_trip_status", [
  "Idea",
  "Planned",
  "Booked",
  "Deprioritized",
]);

export const notionPriority = pgEnum("notion_priority", [
  "Low",
  "Medium",
  "High",
]);

export const notionCategories = pgTable("notion_categories", {
  id: text("id").primaryKey(), // Notion page id (uuid)
  title: text("title").notNull(),
  kind: text("kind"), // project | trip | life_area | other — populated by a heuristic, refined in M1
  archived: boolean("archived").notNull().default(false),
  raw: jsonb("raw").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notionPages = pgTable(
  "notion_pages",
  {
    id: text("id").primaryKey(), // Notion page id
    categoryId: text("category_id"),
    title: text("title").notNull(),
    status: notionStatus("status"),
    dateStart: timestamp("date_start", { withTimezone: true }),
    dateEnd: timestamp("date_end", { withTimezone: true }),
    dateIsDatetime: boolean("date_is_datetime").notNull().default(false),
    deadline: timestamp("deadline", { withTimezone: true }),
    priority: notionPriority("priority"),
    focus: notionFocus("focus"),
    tripStatus: notionTripStatus("trip_status"),
    parentId: text("parent_id"),
    keyNextStep: text("key_next_step"),
    nextSteps: text("next_steps"),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    ignore: boolean("ignore").notNull().default(false),
    raw: jsonb("raw").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ---------- Todoist ----------

export const todoistProjects = pgTable("todoist_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  color: text("color"),
  archived: boolean("archived").notNull().default(false),
  raw: jsonb("raw").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const todoistTasks = pgTable("todoist_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  parentId: text("parent_id"),
  content: text("content").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  dueString: text("due_string"),
  dueIsRecurring: boolean("due_is_recurring").notNull().default(false),
  deadline: timestamp("deadline", { withTimezone: true }),
  priority: integer("priority").notNull().default(1), // 1..4 (4 = highest in Todoist)
  checked: boolean("checked").notNull().default(false),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  raw: jsonb("raw").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Google Calendar ----------

export const gcalEvents = pgTable("gcal_events", {
  id: text("id").primaryKey(), // calendarId + eventId composite is also stored separately for safety
  calendarId: text("calendar_id").notNull(),
  eventId: text("event_id").notNull(),
  summary: text("summary"),
  location: text("location"),
  start: timestamp("start", { withTimezone: true }),
  end: timestamp("end", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  attendees: jsonb("attendees").$type<unknown[]>().notNull().default([]),
  status: text("status"),
  htmlLink: text("html_link"),
  raw: jsonb("raw").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Link layer ----------

export const pendingOrigin = pgEnum("pending_origin", [
  "notion",
  "todoist",
  "dashboard",
]);

export const taskLinks = pgTable(
  "task_links",
  {
    id: text("id").primaryKey(), // generated nanoid; not surfaced in UI
    notionPageId: text("notion_page_id").notNull().unique(),
    todoistTaskId: text("todoist_task_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncHash: text("last_sync_hash").notNull(),
    pendingOrigin: pendingOrigin("pending_origin"),
  },
  (table) => ({
    byNotion: uniqueIndex("task_links_notion_idx").on(table.notionPageId),
    byTodoist: uniqueIndex("task_links_todoist_idx").on(table.todoistTaskId),
  }),
);

export const categoryProjectLinks = pgTable(
  "category_project_links",
  {
    notionCategoryId: text("notion_category_id").notNull(),
    todoistProjectId: text("todoist_project_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.notionCategoryId, table.todoistProjectId] }),
    byNotion: uniqueIndex("cpl_notion_idx").on(table.notionCategoryId),
    byTodoist: uniqueIndex("cpl_todoist_idx").on(table.todoistProjectId),
  }),
);

// ---------- Operational ----------

export const syncState = pgTable("sync_state", {
  source: text("source").primaryKey(), // 'notion' | 'todoist' | `gcal:${calendarId}`
  cursor: text("cursor"), // sync_token / nextSyncToken / page cursor
  channelId: text("channel_id"), // for gcal push channels
  /** Google channel `resourceId` (required to stop a watch) */
  resourceId: text("resource_id"),
  channelExpiresAt: timestamp("channel_expires_at", { withTimezone: true }),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
  lastIncrementalAt: timestamp("last_incremental_at", { withTimezone: true }),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull(),
  op: text("op").notNull(),
  payload: jsonb("payload"),
  error: text("error"),
});
