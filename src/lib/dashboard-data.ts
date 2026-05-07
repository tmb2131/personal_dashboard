import { db, schema } from "@/lib/db";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { bucketKey, isTravelEventsCategory, makeDayBuckets, type DayBucket } from "@/lib/utils";

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

export type DashboardMeta = {
  /** Open tasks due today excluding Recurring project-folder tasks (default overview) */
  todayOpenCount: number;
  /** Open Recurring project-folder tasks due today (add to hero count when toggle is on) */
  todayOpenRecurringCount: number;
  todayMeetingCount: number;
  nextEvent: { summary: string; start: Date } | null;
};

export type DashboardData = {
  now: Date;
  events: CalendarEvent[];
  todayEvents: CalendarEvent[];
  todayTasks: Subtask[];
  personalTasks: Subtask[];
  next7DaysTasks: Subtask[];
  /** Top-level Notion "Task name" rows for choosing a parent when posting Todoist → Notion. */
  notionProjectPicklist: { id: string; title: string }[];
  /** Active Notion categories (relation target) for the "+ New project" form. */
  notionCategoryPicklist: { id: string; title: string }[];
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

function normalizedTitle(title: string | null | undefined): string | null {
  const v = (title ?? "").trim();
  if (!v || v === "0" || v === "(untitled)") return null;
  return v;
}

function todoistDueHasTime(t: TodoistTask): boolean {
  const raw = t.raw as { due?: { datetime?: string | null } } | null;
  return Boolean(raw?.due?.datetime);
}

function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase();
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
  const tomorrowStart = startOfDay(addDays(now, 1));
  const next7DaysEnd = endOfDay(addDays(now, 7));
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
    return {
      key: `n:${p.id}`,
      title: p.title,
      description: matched?.description ?? null,
      status: p.status,
      done: p.status === "Done" || Boolean(matched?.checked),
      date: p.dateStart ?? matched?.dueDate ?? null,
      dateHasTime: Boolean(p.dateIsDatetime || (matched && todoistDueHasTime(matched))),
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
      hasRecurringTag: isRecurringProjectTask(matched?.projectId),
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
  const personalProject = todoistProjects.find((p) => p.name.toLowerCase() === "personal");
  const personalProjectId = personalProject?.id ?? null;
  const personalTasks: Subtask[] = [];
  const next7DaysTasks: Subtask[] = [];
  for (const proj of allProjects) {
    for (const s of proj.subtasks) {
      const ref = s.date ?? s.deadline;
      if (!ref) continue;
      if (ref >= todayStart && ref <= endOfDay(now)) {
        todayTasks.push(s);
      } else if (!s.done && !s.hasRecurringTag && ref >= tomorrowStart && ref <= next7DaysEnd) {
        next7DaysTasks.push(s);
      }
    }
  }
  // Orphan Todoist tasks (no Notion link)
  for (const t of tasks) {
    if (!t.checked && personalProjectId && t.projectId === personalProjectId) {
      const personalRef = t.dueDate ?? t.deadline;
      const isDueToday = Boolean(
        personalRef &&
        personalRef >= todayStart &&
        personalRef <= endOfDay(now),
      );
      const link = linkByTodoist.get(t.id);
      const linkedPage = link?.notionPageId ? pageById.get(link.notionPageId) : undefined;
      const linkedProject = linkedPage?.parentId ? pageById.get(linkedPage.parentId) : linkedPage;
      if (!isDueToday) {
        personalTasks.push({
          key: `p:${t.id}`,
          title: t.content,
          description: t.description ?? null,
          status: "Not started",
          done: false,
          date: t.dueDate,
          dateHasTime: todoistDueHasTime(t),
          deadline: t.deadline,
          priority: t.priority === 4 ? "High" : t.priority === 3 ? "Medium" : t.priority === 2 ? "Low" : null,
          source: "todoist",
          notionPageId: link?.notionPageId ?? null,
          todoistTaskId: t.id,
          inProgress: t.labels.includes("in-progress"),
          projectId: null,
          projectTitle: linkedProject?.title ?? null,
          categoryTitle: personalProject?.name ?? "Personal",
          estimateMinutes: null,
          hasRecurringTag: isRecurringProjectTask(t.projectId),
        });
      }
    }

    if (linkByTodoist.has(t.id)) continue;
    const ref = t.dueDate ?? t.deadline;
    if (!ref) continue;
    if (ref >= tomorrowStart && ref <= next7DaysEnd && !t.checked && !isRecurringProjectTask(t.projectId)) {
      const project = t.projectId ? todoistProjectById.get(t.projectId) : undefined;
      next7DaysTasks.push({
        key: `t:${t.id}`,
        title: t.content,
        description: t.description ?? null,
        status: "Not started",
        done: false,
        date: t.dueDate,
        dateHasTime: todoistDueHasTime(t),
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
        hasRecurringTag: isRecurringProjectTask(t.projectId),
      });
    }
    if (ref < todayStart || ref > endOfDay(now)) continue;
    const project = t.projectId ? todoistProjectById.get(t.projectId) : undefined;
    todayTasks.push({
      key: `t:${t.id}`,
      title: t.content,
      description: t.description ?? null,
      status: t.checked ? "Done" : "Not started",
      done: t.checked,
      date: t.dueDate,
      dateHasTime: todoistDueHasTime(t),
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
      hasRecurringTag: isRecurringProjectTask(t.projectId),
    });

  }
  todayTasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ta = (a.date ?? a.deadline ?? new Date(0)).getTime();
    const tb = (b.date ?? b.deadline ?? new Date(0)).getTime();
    return ta - tb;
  });
  personalTasks.sort((a, b) => {
    const ta = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
  next7DaysTasks.sort((a, b) => {
    const ta = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
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
    personalTasks,
    next7DaysTasks,
    notionProjectPicklist,
    notionCategoryPicklist,
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
