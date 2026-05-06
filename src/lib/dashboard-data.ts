import { db, schema } from "@/lib/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { hasRecurringTagForTodayPanel } from "@/lib/sync/mappings";
import { bucketKey, isTravelEventsCategory, makeDayBuckets, type DayBucket } from "@/lib/utils";

export type CalendarEvent = InferSelectModel<typeof schema.gcalEvents>;
export type NotionPage = InferSelectModel<typeof schema.notionPages>;
export type NotionCategory = InferSelectModel<typeof schema.notionCategories>;
export type TodoistTask = InferSelectModel<typeof schema.todoistTasks>;
export type TodoistProject = InferSelectModel<typeof schema.todoistProjects>;
export type TaskLink = InferSelectModel<typeof schema.taskLinks>;

export type Subtask = {
  key: string;
  title: string;
  status: NotionPage["status"] | null;
  done: boolean;
  date: Date | null;
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
  /** Todoist label / title `#recurring`; hidden from Today by default, reveal via toggle */
  hasRecurringTag: boolean;
};

export type Project = {
  id: string;
  title: string;
  status: NotionPage["status"] | null;
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
  active: Project[];
  onHold: Project[];
  someday: Project[];
  all: Project[];
};

export type DayGroupedEvents = {
  bucket: DayBucket;
  events: CalendarEvent[];
};

export type DashboardMeta = {
  /** Open tasks due today excluding recurring-tag (default overview) */
  todayOpenCount: number;
  /** Open recurring-tag tasks due today (add to hero count when toggle is on) */
  todayOpenRecurringCount: number;
  todayMeetingCount: number;
  nextEvent: { summary: string; start: Date } | null;
};

export type DashboardData = {
  now: Date;
  events: CalendarEvent[];
  todayEvents: CalendarEvent[];
  todayTasks: Subtask[];
  next3Days: DayGroupedEvents[];
  projects: ProjectGroups;
  upcomingTrips: Project[];
  lifeAreas: Project[];
  meta: DashboardMeta;
  lastSyncAt: Date | null;
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

export async function loadDashboard(now = new Date()): Promise<DashboardData> {
  const todayStart = startOfDay(now);
  const horizon = endOfDay(addDays(now, 2));

  const [events, pages, categories, tasks, links, todoistProjects, syncRows] = await Promise.all([
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
  ]);
  const lastSyncAt = syncRows
    .map((s) => s.lastIncrementalAt ?? s.lastFullSyncAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const todoistProjectById = new Map(todoistProjects.map((p) => [p.id, p]));
  const todoistTaskById = new Map(tasks.map((t) => [t.id, t]));
  const linkByNotion = new Map(links.map((l) => [l.notionPageId, l]));
  const linkByTodoist = new Map(links.map((l) => [l.todoistTaskId, l]));
  const pageById = new Map(pages.map((p) => [p.id, p]));

  // Subtask = a Notion page with parentId set (a task under a project)
  // Project = a Notion page with parentId null (a top-level to-do)
  const projectPages = pages.filter((p) => !p.parentId);
  const subtaskPages = pages.filter((p) => Boolean(p.parentId));

  const subtasksByParent = new Map<string, Subtask[]>();

  function notionToSubtask(p: NotionPage, parentProject: NotionPage | undefined): Subtask {
    const link = linkByNotion.get(p.id);
    const matched = link ? tasks.find((t) => t.id === link.todoistTaskId) : undefined;
    const cat = parentProject?.categoryId
      ? categoryById.get(parentProject.categoryId)
      : p.categoryId
        ? categoryById.get(p.categoryId)
        : undefined;
    return {
      key: `n:${p.id}`,
      title: p.title,
      status: p.status,
      done: p.status === "Done" || Boolean(matched?.checked),
      date: p.dateStart ?? matched?.dueDate ?? null,
      deadline: p.deadline ?? matched?.deadline ?? null,
      priority: p.priority ?? null,
      source: matched ? "both" : "notion",
      notionPageId: p.id,
      todoistTaskId: matched?.id ?? null,
      inProgress: p.status === "In progress" || (matched?.labels.includes("in-progress") ?? false),
      projectId: parentProject?.id ?? null,
      projectTitle: parentProject?.title ?? null,
      categoryTitle: cat?.title ?? null,
      estimateMinutes: null,
      hasRecurringTag: hasRecurringTagForTodayPanel(matched?.labels ?? [], p.title),
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
    const days = p.updatedAt
      ? Math.max(0, Math.floor((now.getTime() - p.updatedAt.getTime()) / 86_400_000))
      : null;
    return {
      id: p.id,
      title: p.title,
      status: p.status,
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
  for (const proj of allProjects) {
    for (const s of proj.subtasks) {
      const ref = s.date ?? s.deadline;
      if (!ref) continue;
      if (ref >= todayStart && ref <= endOfDay(now)) {
        todayTasks.push(s);
      }
    }
  }
  // Orphan Todoist tasks (no Notion link)
  for (const t of tasks) {
    if (linkByTodoist.has(t.id)) continue;
    const ref = t.dueDate ?? t.deadline;
    if (!ref) continue;
    if (ref < todayStart || ref > endOfDay(now)) continue;
    const project = t.projectId ? todoistProjectById.get(t.projectId) : undefined;
    todayTasks.push({
      key: `t:${t.id}`,
      title: t.content,
      status: t.checked ? "Done" : "Not started",
      done: t.checked,
      date: t.dueDate,
      deadline: t.deadline,
      priority: t.priority === 4 ? "High" : t.priority === 3 ? "Medium" : t.priority === 2 ? "Low" : null,
      source: "todoist",
      notionPageId: null,
      todoistTaskId: t.id,
      inProgress: t.labels.includes("in-progress"),
      projectId: null,
      projectTitle: null,
      categoryTitle: project?.name ?? null,
      estimateMinutes: null,
      hasRecurringTag: hasRecurringTagForTodayPanel(t.labels, t.content),
    });
  }
  todayTasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ta = (a.date ?? a.deadline ?? new Date(0)).getTime();
    const tb = (b.date ?? b.deadline ?? new Date(0)).getTime();
    return ta - tb;
  });
  // ----- Next 3 days events grouped
  const buckets = makeDayBuckets(now, 3);
  const next3Days: DayGroupedEvents[] = buckets.map((b) => ({
    bucket: b,
    events: events.filter((e) => e.start && bucketKey(new Date(e.start)) === b.key),
  }));

  // ----- Project groups
  const isTrip = (p: Project) =>
    Boolean(p.tripStatus && p.tripStatus !== "Deprioritized") ||
    /travel/i.test(p.categoryTitle ?? "");
  const isLifeArea = (p: Project) => p.isLifeArea;

  const nonTripNonArea = allProjects.filter((p) => !isTrip(p) && !isLifeArea(p));

  const active = nonTripNonArea
    .filter((p) => p.status !== "Done" && p.openSubtasks > 0)
    .sort((a, b) => {
      const ad = a.daysSinceUpdate ?? 999;
      const bd = b.daysSinceUpdate ?? 999;
      if (ad !== bd) return ad - bd;
      return b.openSubtasks - a.openSubtasks;
    });

  const onHold = nonTripNonArea.filter((p) => p.status === "Not started" && p.openSubtasks === 0);
  const someday = nonTripNonArea.filter(
    (p) => p.status !== "Done" && p.openSubtasks === 0 && !p.dateStart && !p.deadline,
  );

  const projects: ProjectGroups = {
    active,
    onHold,
    someday,
    all: nonTripNonArea,
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

  // ----- Life areas (top-level pages with focus = Life Area)
  const lifeAreas = allProjects.filter((p) => p.isLifeArea).slice(0, 8);

  // ----- Meta for hero header
  const todayEvents = events.filter((e) => e.start && sameDay(new Date(e.start), now));
  const nextEvt = todayEvents.find((e) => e.start && new Date(e.start).getTime() > now.getTime());
  const openDueToday = todayTasks.filter((t) => !t.done);
  const todayOpenRecurringCount = openDueToday.filter((t) => t.hasRecurringTag).length;
  const meta: DashboardMeta = {
    todayOpenCount: openDueToday.length - todayOpenRecurringCount,
    todayOpenRecurringCount,
    todayMeetingCount: todayEvents.length,
    nextEvent: nextEvt && nextEvt.start
      ? { summary: nextEvt.summary ?? "(untitled)", start: new Date(nextEvt.start) }
      : null,
  };

  const isEmpty = events.length === 0 && pages.length === 0 && tasks.length === 0;

  return {
    now,
    events,
    todayEvents,
    todayTasks,
    next3Days,
    projects,
    upcomingTrips,
    lifeAreas,
    meta,
    lastSyncAt,
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
