import { db, schema } from "@/lib/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { bucketKey, isTravelEventsCategory, makeDayBuckets, type DayBucket } from "@/lib/utils";
import { parseDateOnlyLocal } from "@/lib/date-utils";
import { extractMeetingUrl } from "@/lib/meeting-url";
import { getNotionDataVersion } from "@/lib/sync/data-version";

export type CalendarEvent = InferSelectModel<typeof schema.gcalEvents>;
export type NotionPage = InferSelectModel<typeof schema.notionPages>;
export type NotionCategory = InferSelectModel<typeof schema.notionCategories>;
export type TodoistTask = InferSelectModel<typeof schema.todoistTasks>;
export type TodoistProject = InferSelectModel<typeof schema.todoistProjects>;
export type TaskLink = InferSelectModel<typeof schema.taskLinks>;

export type Next3DaysOwner = "thomas" | "sriya" | "both" | "other";

export type Next3DaysEvent = {
  /**
   * Panel display identity for React keys.
   * Duplicates across calendars are collapsed into a single row.
   */
  id: string;
  owner: Next3DaysOwner;
  ownerLabel: string;
  /**
   * Lowercased calendar IDs that contributed to this row.
   * Useful if the same signature appears in more than one calendar.
   */
  calendarIds: string[];
  summary: CalendarEvent["summary"];
  location: CalendarEvent["location"];
  start: CalendarEvent["start"];
  end: CalendarEvent["end"];
  allDay: CalendarEvent["allDay"];
  meetingUrl: string | null;
  htmlLink: string | null;
};

export type Subtask = {
  key: string;
  title: string;
  description: string | null;
  status: NotionPage["status"] | null;
  done: boolean;
  date: Date | null;
  dateHasTime: boolean;
  deadline: Date | null;
  priority: NotionPage["priority"] | null;
  source: "notion" | "todoist" | "both";
  notionPageId: string | null;
  todoistTaskId: string | null;
  inProgress: boolean;
  // For tasks shown directly under TODAY · TASKS we need the project context
  projectId: string | null;
  projectTitle: string | null;
  categoryTitle: string | null;
  estimateMinutes: number | null;
  /** Todoist task from the Recurring project folder; hidden from Today by default, reveal via toggle */
  hasRecurringTag: boolean;
  /**
   * Whole days the task has slipped past its date/deadline (≥ 1), or null when
   * it is not overdue. Only set when every date the task has is before today.
   */
  overdueDays: number | null;
  /**
   * Row's last write time. Neither cache stores a completion timestamp, so this
   * stands in for "completed today" — both the dashboard toggle and the Todoist
   * sync bump it when `done`/`checked` flips.
   */
  updatedAt: Date | null;
};

export type Project = {
  id: string;
  title: string;
  status: NotionPage["status"] | null;
  focus: NotionPage["focus"] | null;
  tripStatus: NotionPage["tripStatus"] | null;
  isLifeArea: boolean;
  categoryId: string | null;
  categoryTitle: string | null;
  dateStart: Date | null;
  dateEnd: Date | null;
  deadline: Date | null;
  keyNextStep: string | null;
  notes: string | null;
  subtasks: Subtask[];
  totalSubtasks: number;
  doneSubtasks: number;
  openSubtasks: number;
  daysSinceUpdate: number | null;
};

export type ProjectGroups = {
  focus: Project[];
  nonFocus: Project[];
  all: Project[];
};

export type DayGroupedEvents = {
  bucket: DayBucket;
  events: Next3DaysEvent[];
};

export type SourceKey = "notion" | "todoist" | "gcal";

export type SourceHealth = {
  lastSyncAt: Date | null;
};

export type DashboardMeta = {
  /** Open tasks due today excluding Recurring project-folder tasks (default overview) */
  todayOpenCount: number;
  /** Open Recurring project-folder tasks due today (add to hero count when toggle is on) */
  todayOpenRecurringCount: number;
  /** Open overdue tasks excluding Recurring project-folder tasks */
  overdueOpenCount: number;
  /** Open overdue Recurring project-folder tasks (add to hero count when toggle is on) */
  overdueOpenRecurringCount: number;
  todayMeetingCount: number;
  nextEvent: { summary: string; start: Date } | null;
  sources: Record<SourceKey, SourceHealth>;
};

export type DashboardData = {
  now: Date;
  events: CalendarEvent[];
  todayEvents: CalendarEvent[];
  todayTasks: Subtask[];
  /** Open tasks whose date/deadline is entirely in the past, oldest first */
  overdueTasks: Subtask[];
  personalTasks: Subtask[];
  next7DaysTasks: Subtask[];
  /** Top-level Notion "Task name" rows for choosing a parent when posting Todoist → Notion. */
  notionProjectPicklist: { id: string; title: string }[];
  /** Active Notion categories (relation target) for the "+ New project" form. */
  notionCategoryPicklist: { id: string; title: string }[];
  next3Days: DayGroupedEvents[];
  projects: ProjectGroups;
  upcomingTrips: Project[];
  datelessTrips: Project[];
  lifeAreas: Project[];
  meta: DashboardMeta;
  lastSyncAt: Date | null;
  /** Newest Notion `updated_at` in epoch ms; open tabs poll for a higher value. */
  notionDataVersion: number | null;
  isEmpty: boolean;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateInRange(date: Date | null, start: Date, end: Date) {
  return Boolean(date && date >= start && date <= end);
}

function taskHasDateInRange(date: Date | null, deadline: Date | null, start: Date, end: Date) {
  return dateInRange(date, start, end) || dateInRange(deadline, start, end);
}

function taskRangeSortMs(date: Date | null, deadline: Date | null, start: Date, end: Date) {
  const inRange = [date, deadline].filter((d): d is Date => dateInRange(d, start, end));
  if (inRange.length > 0) return Math.min(...inRange.map((d) => d.getTime()));
  return (date ?? deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function parseTodoistDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseDateOnlyLocal(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizedTitle(title: string | null | undefined): string | null {
  const v = (title ?? "").trim();
  if (!v || v === "0" || v === "(untitled)") return null;
  return v;
}

function todoistRawDue(t: TodoistTask) {
  const raw = t.raw as {
    due?: {
      datetime?: string | null;
      date?: string | null;
      due_datetime?: string | null;
      due_date?: string | null;
    } | null;
  } | null;
  return raw?.due ?? null;
}

function todoistRawDeadline(t: TodoistTask) {
  const raw = t.raw as { deadline?: { date?: string | null } | null } | null;
  return raw?.deadline ?? null;
}

function todoistDueDate(t: TodoistTask): Date | null {
  const rawDue = todoistRawDue(t);
  return (
    t.dueDate ??
    parseTodoistDate(rawDue?.datetime) ??
    parseTodoistDate(rawDue?.due_datetime) ??
    parseTodoistDate(rawDue?.date) ??
    parseTodoistDate(rawDue?.due_date)
  );
}

function todoistDeadlineDate(t: TodoistTask): Date | null {
  const rawDeadline = todoistRawDeadline(t);
  return t.deadline ?? parseTodoistDate(rawDeadline?.date);
}

function todoistDueHasTime(t: TodoistTask): boolean {
  const rawDue = todoistRawDue(t);
  return Boolean(rawDue?.datetime ?? rawDue?.due_datetime);
}

function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase();
}

function isTodoistInboxProject(project: TodoistProject): boolean {
  const raw = project.raw as {
    inbox_project?: boolean;
    is_inbox_project?: boolean;
    isInboxProject?: boolean;
  } | null;

  return (
    normalizeProjectName(project.name) === "inbox" ||
    raw?.inbox_project === true ||
    raw?.is_inbox_project === true ||
    raw?.isInboxProject === true
  );
}

function todoistPriorityToNotion(priority: number): NotionPage["priority"] | null {
  return priority === 4 ? "High" : priority === 3 ? "Medium" : priority === 2 ? "Low" : null;
}

/**
 * Due timestamp for the open sub-item treated as "next step" in the Projects panel
 * (in-progress first, then soonest date/deadline). Projects with no dated next step sort last.
 */
function nextStepSubtaskDueMs(p: Project): number {
  const open = p.subtasks.filter((s) => !s.done);
  if (open.length === 0) return Number.MAX_SAFE_INTEGER;

  const sorted = [...open].sort((a, b) => {
    if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
    const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.title.localeCompare(b.title);
  });

  if (p.keyNextStep) {
    const match = sorted.find((s) => s.title === p.keyNextStep);
    if (match) {
      const t = (match.date ?? match.deadline)?.getTime();
      if (t != null) return t;
    }
  }

  const first = sorted[0];
  return (first.date ?? first.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function sortProjectsByNextStepDue(a: Project, b: Project): number {
  const at = nextStepSubtaskDueMs(a);
  const bt = nextStepSubtaskDueMs(b);
  if (at !== bt) return at - bt;
  const ad = a.daysSinceUpdate ?? 999;
  const bd = b.daysSinceUpdate ?? 999;
  if (ad !== bd) return ad - bd;
  return b.openSubtasks - a.openSubtasks;
}

export async function loadDashboard(now = new Date()): Promise<DashboardData> {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const tomorrowStart = startOfDay(addDays(now, 1));
  const next7DaysEnd = endOfDay(addDays(now, 7));
  const horizon = endOfDay(addDays(now, 2));

  const [
    events,
    pages,
    categories,
    tasks,
    links,
    todoistProjects,
    syncRows,
    notionDataVersion,
  ] = await Promise.all([
    db
      .select()
      .from(schema.gcalEvents)
      .where(and(gte(schema.gcalEvents.start, todayStart), lte(schema.gcalEvents.start, horizon)))
      .orderBy(asc(schema.gcalEvents.start)),
    db.select().from(schema.notionPages).where(eq(schema.notionPages.archived, false)),
    db.select().from(schema.notionCategories),
    db.select().from(schema.todoistTasks),
    db.select().from(schema.taskLinks),
    db.select().from(schema.todoistProjects),
    db.select().from(schema.syncState),
    getNotionDataVersion(),
  ]);
  const lastSyncAt = syncRows
    .map((s) => s.lastIncrementalAt ?? s.lastFullSyncAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  function pickSyncFor(predicate: (source: string) => boolean): Date | null {
    return (
      syncRows
        .filter((s) => predicate(s.source))
        .map((s) => s.lastIncrementalAt ?? s.lastFullSyncAt)
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    );
  }
  const sources: DashboardMeta["sources"] = {
    notion: { lastSyncAt: pickSyncFor((s) => s === "notion") },
    todoist: { lastSyncAt: pickSyncFor((s) => s === "todoist") },
    gcal: { lastSyncAt: pickSyncFor((s) => s === "gcal" || s.startsWith("gcal:")) },
  };

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const todoistProjectById = new Map(todoistProjects.map((p) => [p.id, p]));
  const todoistChildProjectIdsByParent = new Map<string, string[]>();
  for (const p of todoistProjects) {
    if (!p.parentId) continue;
    const arr = todoistChildProjectIdsByParent.get(p.parentId) ?? [];
    arr.push(p.id);
    todoistChildProjectIdsByParent.set(p.parentId, arr);
  }
  const recurringRootProjectIds = todoistProjects
    .filter((p) => normalizeProjectName(p.name) === "recurring")
    .map((p) => p.id);
  const recurringProjectIds = new Set<string>(recurringRootProjectIds);
  const queue = [...recurringRootProjectIds];
  while (queue.length) {
    const parentId = queue.shift()!;
    const childIds = todoistChildProjectIdsByParent.get(parentId) ?? [];
    for (const childId of childIds) {
      if (recurringProjectIds.has(childId)) continue;
      recurringProjectIds.add(childId);
      queue.push(childId);
    }
  }
  const isRecurringProjectTask = (projectId: string | null | undefined): boolean =>
    Boolean(projectId && recurringProjectIds.has(projectId));
  const linkByNotion = new Map(links.map((l) => [l.notionPageId, l]));
  const linkByTodoist = new Map(links.map((l) => [l.todoistTaskId, l]));
  const pageById = new Map(pages.map((p) => [p.id, p]));

  // A task counts as overdue only when every date it has is before today —
  // a passed scheduled date with a still-upcoming deadline stays in Next 7 Days.
  function overdueDaysFor(date: Date | null, deadline: Date | null): number | null {
    const ref = date ?? deadline;
    if (!ref) return null;
    if (date && date.getTime() >= todayStart.getTime()) return null;
    if (deadline && deadline.getTime() >= todayStart.getTime()) return null;
    return Math.max(
      1,
      Math.round((todayStart.getTime() - startOfDay(ref).getTime()) / 86_400_000),
    );
  }

  // Project = top-level "Task name" row (no parent task)
  // Subtask = row linked via "Parent task" (sub-item)
  const projectPages = pages.filter((p) => !p.ignore && !p.parentId);
  const notionProjectPicklist = projectPages
    .filter((p) => !p.archived && p.status !== "Done" && p.focus !== "Life Area")
    .map((p) => ({ id: p.id, title: p.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const notionCategoryPicklist = categories
    .filter((c) => !c.archived && c.title && c.title !== "(untitled)")
    .map((c) => ({ id: c.id, title: c.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const subtaskPages = pages.filter((p) => !p.ignore && Boolean(p.parentId));

  const subtasksByParent = new Map<string, Subtask[]>();

  function notionToSubtask(p: NotionPage, parentProject: NotionPage | undefined): Subtask {
    const link = linkByNotion.get(p.id);
    const matched = link ? tasks.find((t) => t.id === link.todoistTaskId) : undefined;
    const cat = parentProject?.categoryId
      ? categoryById.get(parentProject.categoryId)
      : p.categoryId
        ? categoryById.get(p.categoryId)
        : undefined;
    const date = p.dateStart ?? (matched ? todoistDueDate(matched) : null);
    const deadline = p.deadline ?? (matched ? todoistDeadlineDate(matched) : null);
    return {
      key: `n:${p.id}`,
      title: p.title,
      description: p.notes ?? matched?.description ?? null,
      status: p.status,
      done: p.status === "Done" || Boolean(matched?.checked),
      date,
      dateHasTime: Boolean(p.dateIsDatetime || (matched && todoistDueHasTime(matched))),
      deadline,
      priority: p.priority ?? null,
      source: matched ? "both" : "notion",
      notionPageId: p.id,
      todoistTaskId: matched?.id ?? null,
      inProgress: p.status === "In progress" || (matched?.labels.includes("in-progress") ?? false),
      projectId: parentProject?.id ?? null,
      projectTitle: parentProject?.title ?? null,
      categoryTitle: cat?.title ?? null,
      estimateMinutes: null,
      hasRecurringTag: isRecurringProjectTask(matched?.projectId),
      overdueDays: overdueDaysFor(date, deadline),
      updatedAt: p.updatedAt ?? null,
    };
  }

  for (const p of subtaskPages) {
    const parent = p.parentId ? pageById.get(p.parentId) : undefined;
    const sub = notionToSubtask(p, parent);
    if (p.parentId) {
      const arr = subtasksByParent.get(p.parentId) ?? [];
      arr.push(sub);
      subtasksByParent.set(p.parentId, arr);
    }
  }

  function buildProject(p: NotionPage): Project {
    const subs = subtasksByParent.get(p.id) ?? [];
    const doneSubtasks = subs.filter((s) => s.done).length;
    const cat = p.categoryId ? categoryById.get(p.categoryId) : undefined;
    const parentTitle = p.parentId ? pageById.get(p.parentId)?.title : null;
    const resolvedTitle =
      normalizedTitle(p.title) ??
      normalizedTitle(parentTitle) ??
      normalizedTitle(cat?.title) ??
      p.title;
    const days = p.updatedAt
      ? Math.max(0, Math.floor((now.getTime() - p.updatedAt.getTime()) / 86_400_000))
      : null;
    return {
      id: p.id,
      title: resolvedTitle,
      status: p.status,
      focus: p.focus,
      tripStatus: p.tripStatus,
      isLifeArea: p.focus === "Life Area",
      categoryId: p.categoryId,
      categoryTitle: cat?.title ?? null,
      dateStart: p.dateStart,
      dateEnd: p.dateEnd,
      deadline: p.deadline,
      keyNextStep: p.keyNextStep,
      notes: p.notes,
      subtasks: subs,
      totalSubtasks: subs.length,
      doneSubtasks,
      openSubtasks: subs.length - doneSubtasks,
      daysSinceUpdate: days,
    };
  }

  const allProjects = projectPages.map(buildProject);

  // ----- Today's tasks: sub-tasks (any project) due today, plus orphan Todoist
  const todayTasks: Subtask[] = [];
  const overdueTasks: Subtask[] = [];
  const personalProjectIds = new Set(
    todoistProjects
      .filter((p) => normalizeProjectName(p.name) === "personal" || isTodoistInboxProject(p))
      .map((p) => p.id),
  );
  const personalTasks: Subtask[] = [];
  const next7DaysTasks: Subtask[] = [];
  // Finished today, so it belongs in the Done group rather than vanishing —
  // see Subtask.updatedAt for why that timestamp stands in for completion time.
  const completedToday = (s: Subtask) =>
    s.done && Boolean(s.updatedAt && s.updatedAt.getTime() >= todayStart.getTime());

  for (const proj of allProjects) {
    for (const s of proj.subtasks) {
      if (taskHasDateInRange(s.date, s.deadline, todayStart, todayEnd)) {
        todayTasks.push(s);
      } else if (!s.done && s.overdueDays != null) {
        overdueTasks.push(s);
      } else if (s.overdueDays != null && completedToday(s)) {
        // Was overdue, ticked off today.
        todayTasks.push(s);
      } else if (
        !s.done &&
        !s.hasRecurringTag &&
        taskHasDateInRange(s.date, s.deadline, tomorrowStart, next7DaysEnd)
      ) {
        next7DaysTasks.push(s);
      }
    }
  }
  const openTodoistIdsAlreadyShown = new Set(
    [...todayTasks, ...overdueTasks]
      .filter((s) => !s.done && s.todoistTaskId)
      .map((s) => s.todoistTaskId!),
  );
  // Direct Todoist rows. Linked rows are used as a fallback when their Notion
  // mirror does not already produce an open Today item.
  for (const t of tasks) {
    const link = linkByTodoist.get(t.id);
    const linkedPage = link?.notionPageId ? pageById.get(link.notionPageId) : undefined;
    const linkedProject = linkedPage?.parentId ? pageById.get(linkedPage.parentId) : linkedPage;
    const todoistProject = t.projectId ? todoistProjectById.get(t.projectId) : undefined;
    const tDueDate = todoistDueDate(t);
    const tDeadline = todoistDeadlineDate(t);
    const isDueToday = taskHasDateInRange(tDueDate, tDeadline, todayStart, todayEnd);
    const tPastDueDays = overdueDaysFor(tDueDate, tDeadline);
    const tOverdueDays = t.checked ? null : tPastDueDays;
    const tCompletedToday = Boolean(
      t.checked && t.updatedAt && t.updatedAt.getTime() >= todayStart.getTime(),
    );

    if (!t.checked && t.projectId && personalProjectIds.has(t.projectId)) {
      // Overdue personal tasks surface in the Overdue block instead, mirroring
      // how due-today personal tasks only appear under Today.
      if (!isDueToday && tOverdueDays == null) {
        personalTasks.push({
          key: `p:${t.id}`,
          title: t.content,
          description: t.description ?? null,
          status: "Not started",
          done: false,
          date: tDueDate,
          dateHasTime: todoistDueHasTime(t),
          deadline: tDeadline,
          priority: todoistPriorityToNotion(t.priority),
          source: link ? "both" : "todoist",
          notionPageId: link?.notionPageId ?? null,
          todoistTaskId: t.id,
          inProgress: t.labels.includes("in-progress"),
          projectId: null,
          projectTitle: linkedProject?.title ?? null,
          categoryTitle: todoistProject?.name ?? null,
          estimateMinutes: null,
          hasRecurringTag: isRecurringProjectTask(t.projectId),
          overdueDays: null,
          updatedAt: t.updatedAt ?? null,
        });
      }
    }

    if (!tDueDate && !tDeadline) continue;

    if (link && (t.checked || openTodoistIdsAlreadyShown.has(t.id))) continue;

    // Unlinked, was overdue, ticked off today: keep it visible in the Done
    // group. Linked rows exited above and surface via their Notion mirror.
    if (tPastDueDays != null && tCompletedToday) {
      todayTasks.push({
        key: `t:${t.id}`,
        title: t.content,
        description: t.description ?? null,
        status: "Done",
        done: true,
        date: tDueDate,
        dateHasTime: todoistDueHasTime(t),
        deadline: tDeadline,
        priority: todoistPriorityToNotion(t.priority),
        source: "todoist",
        notionPageId: null,
        todoistTaskId: t.id,
        inProgress: false,
        projectId: null,
        projectTitle: linkedProject?.title ?? null,
        categoryTitle: todoistProject?.name ?? null,
        estimateMinutes: null,
        hasRecurringTag: isRecurringProjectTask(t.projectId),
        overdueDays: null,
        updatedAt: t.updatedAt ?? null,
      });
      continue;
    }

    if (tOverdueDays != null) {
      overdueTasks.push({
        key: `t:${t.id}`,
        title: t.content,
        description: t.description ?? null,
        status: "Not started",
        done: false,
        date: tDueDate,
        dateHasTime: todoistDueHasTime(t),
        deadline: tDeadline,
        priority: todoistPriorityToNotion(t.priority),
        source: link ? "both" : "todoist",
        notionPageId: link?.notionPageId ?? null,
        todoistTaskId: t.id,
        inProgress: t.labels.includes("in-progress"),
        projectId: null,
        projectTitle: linkedProject?.title ?? null,
        categoryTitle: todoistProject?.name ?? null,
        estimateMinutes: null,
        hasRecurringTag: isRecurringProjectTask(t.projectId),
        overdueDays: tOverdueDays,
        updatedAt: t.updatedAt ?? null,
      });
      continue;
    }

    if (
      !link &&
      !isDueToday &&
      taskHasDateInRange(tDueDate, tDeadline, tomorrowStart, next7DaysEnd) &&
      !t.checked &&
      !isRecurringProjectTask(t.projectId)
    ) {
      next7DaysTasks.push({
        key: `t:${t.id}`,
        title: t.content,
        description: t.description ?? null,
        status: "Not started",
        done: false,
        date: tDueDate,
        dateHasTime: todoistDueHasTime(t),
        deadline: tDeadline,
        priority: todoistPriorityToNotion(t.priority),
        source: "todoist",
        notionPageId: null,
        todoistTaskId: t.id,
        inProgress: t.labels.includes("in-progress"),
        projectId: null,
        projectTitle: null,
        categoryTitle: todoistProject?.name ?? null,
        estimateMinutes: null,
        hasRecurringTag: isRecurringProjectTask(t.projectId),
        overdueDays: null,
        updatedAt: t.updatedAt ?? null,
      });
    }
    if (!isDueToday) continue;
    todayTasks.push({
      key: `t:${t.id}`,
      title: t.content,
      description: t.description ?? null,
      status: t.checked ? "Done" : "Not started",
      done: t.checked,
      date: tDueDate,
      dateHasTime: todoistDueHasTime(t),
      deadline: tDeadline,
      priority: todoistPriorityToNotion(t.priority),
      source: link ? "both" : "todoist",
      notionPageId: link?.notionPageId ?? null,
      todoistTaskId: t.id,
      inProgress: t.labels.includes("in-progress"),
      projectId: null,
      projectTitle: linkedProject?.title ?? null,
      categoryTitle: todoistProject?.name ?? null,
      estimateMinutes: null,
      hasRecurringTag: isRecurringProjectTask(t.projectId),
      overdueDays: null,
      updatedAt: t.updatedAt ?? null,
    });

  }
  overdueTasks.sort((a, b) => {
    const ta = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
  todayTasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ta = taskRangeSortMs(a.date, a.deadline, todayStart, todayEnd);
    const tb = taskRangeSortMs(b.date, b.deadline, todayStart, todayEnd);
    return ta - tb;
  });
  personalTasks.sort((a, b) => {
    const ta = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
  next7DaysTasks.sort((a, b) => {
    const ta = taskRangeSortMs(a.date, a.deadline, tomorrowStart, next7DaysEnd);
    const tb = taskRangeSortMs(b.date, b.deadline, tomorrowStart, next7DaysEnd);
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
  // ----- Next 3 days events grouped
  const buckets = makeDayBuckets(now, 3);

  const THOMAS_CALENDAR_ID = "thomas.brosens@gmail.com";
  const SRIYA_CALENDAR_ID = "sriya.sundaresan@gmail.com";
  const thomasLower = THOMAS_CALENDAR_ID.toLowerCase();
  const sriyaLower = SRIYA_CALENDAR_ID.toLowerCase();

  function normalizeForDedupe(s: string | null): string {
    return (s ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function ownerFromCalendarIds(ids: Set<string>): Pick<Next3DaysEvent, "owner" | "ownerLabel"> {
    const hasThomas = ids.has(thomasLower);
    const hasSriya = ids.has(sriyaLower);
    if (hasThomas && hasSriya) {
      return {
        owner: "both",
        ownerLabel: `${THOMAS_CALENDAR_ID} + ${SRIYA_CALENDAR_ID}`,
      };
    }
    if (hasThomas) return { owner: "thomas", ownerLabel: THOMAS_CALENDAR_ID };
    if (hasSriya) return { owner: "sriya", ownerLabel: SRIYA_CALENDAR_ID };
    return { owner: "other", ownerLabel: [...ids][0] ?? "" };
  }

  type BucketMergedEntry = {
    id: string;
    start: Date | null;
    end: Date | null;
    allDay: boolean;
    summary: string | null;
    location: string | null;
    calendarIds: Set<string>;
    meetingUrl: string | null;
    htmlLink: string | null;
  };

  const bucketsByKey = new Set(buckets.map((b) => b.key));
  const mergedByBucket = new Map<string, Map<string, BucketMergedEntry>>();

  for (const e of events) {
    if (!e.start) continue;
    const dayKey = bucketKey(new Date(e.start));
    if (!bucketsByKey.has(dayKey)) continue;

    const startIso = e.start ? e.start.toISOString() : "null";
    const endIso = e.end ? e.end.toISOString() : "null";
    const sig = `${startIso}|${endIso}|${normalizeForDedupe(e.summary)}|${normalizeForDedupe(e.location)}`;

    const bucketMap = mergedByBucket.get(dayKey) ?? new Map<string, BucketMergedEntry>();
    const existing = bucketMap.get(sig);
    if (existing) {
      existing.calendarIds.add(e.calendarId.toLowerCase());
      continue;
    }

    bucketMap.set(sig, {
      id: sig,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      summary: e.summary ?? null,
      location: e.location ?? null,
      calendarIds: new Set([e.calendarId.toLowerCase()]),
      meetingUrl: extractMeetingUrl({ raw: e.raw, location: e.location ?? null }),
      htmlLink: e.htmlLink ?? null,
    });
    mergedByBucket.set(dayKey, bucketMap);
  }

  const next3Days: DayGroupedEvents[] = buckets.map((b) => {
    const bucketMap = mergedByBucket.get(b.key) ?? new Map<string, BucketMergedEntry>();

    const mergedEvents: Next3DaysEvent[] = [...bucketMap.values()].map((entry) => {
      const owner = ownerFromCalendarIds(entry.calendarIds);
      return {
        id: entry.id,
        owner: owner.owner,
        ownerLabel: owner.ownerLabel,
        calendarIds: [...entry.calendarIds],
        summary: entry.summary,
        location: entry.location,
        start: entry.start,
        end: entry.end,
        allDay: entry.allDay,
        meetingUrl: entry.meetingUrl,
        htmlLink: entry.htmlLink,
      };
    });

    mergedEvents.sort((a, b) => {
      const at = a.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = b.start?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return (a.summary ?? "").localeCompare(b.summary ?? "");
    });

    return { bucket: b, events: mergedEvents };
  });

  // ----- Project groups
  const isTrip = (p: Project) => /travel/i.test(p.categoryTitle ?? "");
  const isLifeArea = (p: Project) => p.isLifeArea;
  // Skip accidental empty rows in Notion (no title, no children, no notes/next step).
  // The DB still contains them but they're noise on the dashboard.
  const isEmptyShell = (p: Project) =>
    normalizedTitle(p.title) === null &&
    p.totalSubtasks === 0 &&
    !p.keyNextStep &&
    !p.notes;

  const nonTripNonArea = allProjects.filter(
    (p) => !isTrip(p) && !isLifeArea(p) && p.status !== "Done" && !isEmptyShell(p),
  );
  const sortedProjects = [...nonTripNonArea].sort(sortProjectsByNextStepDue);

  const projects: ProjectGroups = {
    focus: sortedProjects.filter((p) => p.focus === "Yes"),
    nonFocus: sortedProjects.filter((p) => p.focus !== "Yes"),
    all: sortedProjects,
  };

  // ----- Trips (Travel/Events only; include Done; start date today or later)
  const upcomingTrips = allProjects
    .filter((p) => isTravelEventsCategory(p.categoryTitle))
    .filter(
      (p) =>
        p.dateStart != null && startOfDay(p.dateStart).getTime() >= todayStart.getTime(),
    )
    .sort((a, b) => {
      const ad = a.dateStart?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bd = b.dateStart?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ad - bd;
    })
    .slice(0, 6);

  // ----- Dateless trips (Travel/Events with no start date; exclude Done and empty shells)
  const datelessTrips = allProjects
    .filter((p) => isTravelEventsCategory(p.categoryTitle))
    .filter((p) => p.dateStart == null && p.status !== "Done")
    .filter((p) => normalizedTitle(p.title) !== null)
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "In progress") return -1;
        if (b.status === "In progress") return 1;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, 8);

  // ----- Life areas (top-level pages with focus = Life Area)
  const lifeAreas = allProjects.filter((p) => p.isLifeArea).slice(0, 8);

  // ----- Meta for hero header
  const todayEvents = events.filter((e) => e.start && sameDay(new Date(e.start), now));
  const nextEvt = todayEvents.find((e) => e.start && new Date(e.start).getTime() > now.getTime());
  const openDueToday = todayTasks.filter((t) => !t.done);
  const todayOpenRecurringCount = openDueToday.filter((t) => t.hasRecurringTag).length;
  const overdueOpenRecurringCount = overdueTasks.filter((t) => t.hasRecurringTag).length;
  const meta: DashboardMeta = {
    todayOpenCount: openDueToday.length - todayOpenRecurringCount,
    todayOpenRecurringCount,
    overdueOpenCount: overdueTasks.length - overdueOpenRecurringCount,
    overdueOpenRecurringCount,
    todayMeetingCount: todayEvents.length,
    nextEvent: nextEvt && nextEvt.start
      ? { summary: nextEvt.summary ?? "(untitled)", start: new Date(nextEvt.start) }
      : null,
    sources,
  };

  const isEmpty = events.length === 0 && pages.length === 0 && tasks.length === 0;

  return {
    now,
    events,
    todayEvents,
    todayTasks,
    overdueTasks,
    personalTasks,
    next7DaysTasks,
    notionProjectPicklist,
    notionCategoryPicklist,
    next3Days,
    projects,
    upcomingTrips,
    datelessTrips,
    lifeAreas,
    meta,
    lastSyncAt,
    notionDataVersion,
    isEmpty,
  };
}

export async function loadDashboardSafe(now = new Date()):
  Promise<{ data: DashboardData | null; error: string | null }> {
  try {
    const data = await loadDashboard(now);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

export function daysUntil(d: Date, from = new Date()): number {
  const ms = startOfDay(d).getTime() - startOfDay(from).getTime();
  return Math.round(ms / 86_400_000);
}
