import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  gcalEvents: [] as unknown[],
  notionPages: [] as unknown[],
  notionCategories: [] as unknown[],
  todoistTasks: [] as unknown[],
  taskLinks: [] as unknown[],
  todoistProjects: [] as unknown[],
  syncState: [] as unknown[],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn(),
    asc: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
  };
});

vi.mock("@/lib/db", () => {
  function table(name: keyof typeof rows, columns: string[] = []) {
    return Object.fromEntries([
      ["__name", name],
      ...columns.map((column) => [column, `${name}.${column}`]),
    ]);
  }

  function queryFor(tableName: keyof typeof rows) {
    const builder = {
      where: () => builder,
      orderBy: () => builder,
      then: <TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(rows[tableName]).then(onfulfilled, onrejected),
    };
    return builder;
  }

  return {
    db: {
      select: () => ({
        from: (selectedTable: { __name: keyof typeof rows }) => queryFor(selectedTable.__name),
      }),
    },
    schema: {
      gcalEvents: table("gcalEvents", ["start"]),
      notionPages: table("notionPages", ["archived"]),
      notionCategories: table("notionCategories"),
      todoistTasks: table("todoistTasks"),
      taskLinks: table("taskLinks"),
      todoistProjects: table("todoistProjects"),
      syncState: table("syncState"),
    },
  };
});

vi.mock("@/lib/utils", () => ({
  bucketKey: (date: Date) => date.toISOString().slice(0, 10),
  isTravelEventsCategory: (value: string | null) => /travel/i.test(value ?? ""),
  makeDayBuckets: (now: Date, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(now);
      date.setDate(date.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return { key, date, label: key, shortLabel: key };
    }),
}));

vi.mock("@/lib/date-utils", () => ({
  parseDateOnlyLocal: (input: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  },
}));

vi.mock("@/lib/meeting-url", () => ({
  extractMeetingUrl: () => null,
}));

vi.mock("@/lib/sync/data-version", () => ({
  getNotionDataVersion: () => Promise.resolve(1_700_000_000_000),
}));

import { loadDashboard } from "./dashboard-data";

function notionPage(overrides: Record<string, unknown>) {
  return {
    id: "notion-page",
    categoryId: null,
    title: "Notion page",
    status: "Not started",
    dateStart: null,
    dateEnd: null,
    dateIsDatetime: false,
    deadline: null,
    priority: null,
    focus: null,
    tripStatus: null,
    parentId: null,
    keyNextStep: null,
    nextSteps: null,
    notes: null,
    archived: false,
    ignore: false,
    raw: {},
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    lastSyncedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

function todoistTask(overrides: Record<string, unknown>) {
  return {
    id: "todoist-task",
    projectId: "todoist-project",
    parentId: null,
    content: "Todoist task",
    description: null,
    dueDate: null,
    dueString: null,
    dueIsRecurring: false,
    deadline: null,
    priority: 1,
    checked: false,
    labels: [],
    raw: {},
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("loadDashboard", () => {
  beforeEach(() => {
    rows.gcalEvents = [];
    rows.notionPages = [];
    rows.notionCategories = [];
    rows.todoistTasks = [];
    rows.taskLinks = [];
    rows.todoistProjects = [];
    rows.syncState = [];
  });

  it("reports whichever sync ran most recently, not just the incremental one", async () => {
    // The window sync writes only lastFullSyncAt. Reading
    // `lastIncrementalAt ?? lastFullSyncAt` pinned Calendar at a months-old
    // timestamp while it was in fact syncing fine.
    rows.syncState = [
      {
        source: "gcal:thomas.brosens@gmail.com",
        lastIncrementalAt: new Date("2026-05-14T09:00:00.000Z"),
        lastFullSyncAt: new Date("2026-05-07T07:55:00.000Z"),
        cursor: null,
      },
      {
        source: "gcal:sriya.sundaresan@gmail.com",
        lastIncrementalAt: null,
        lastFullSyncAt: new Date("2026-05-07T07:50:00.000Z"),
        cursor: null,
      },
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    // Newest across both gcal rows wins, whichever column it came from.
    expect(data.meta.sources.gcal.lastSyncAt).toEqual(new Date("2026-05-14T09:00:00.000Z"));

    rows.syncState = [
      {
        source: "gcal:thomas.brosens@gmail.com",
        lastIncrementalAt: new Date("2026-05-01T09:00:00.000Z"),
        lastFullSyncAt: new Date("2026-05-07T07:55:00.000Z"),
        cursor: "token",
      },
    ];

    const fresher = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(fresher.meta.sources.gcal.lastSyncAt).toEqual(new Date("2026-05-07T07:55:00.000Z"));
  });

  it("carries the Notion data version so open tabs can detect webhook writes", async () => {
    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.notionDataVersion).toBe(1_700_000_000_000);
  });

  it("shows an open linked Todoist task due today when the Notion mirror is stale", async () => {
    rows.todoistProjects = [
      {
        id: "recurring",
        name: "Recurring",
        parentId: null,
        color: null,
        archived: false,
        raw: {},
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      {
        id: "home",
        name: "Home",
        parentId: "recurring",
        color: null,
        archived: false,
        raw: {},
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-riverford",
        projectId: "home",
        content: "Riverford boxes outside",
        dueDate: new Date("2026-05-07T18:00:00.000Z"),
        dueString: "every Thursday at 7pm",
        dueIsRecurring: true,
        checked: false,
        raw: { due: { datetime: "2026-05-07T18:00:00.000Z" } },
      }),
    ];
    rows.notionPages = [
      notionPage({
        id: "home-project",
        title: "Home",
      }),
      notionPage({
        id: "notion-riverford",
        title: "Riverford boxes outside",
        status: "Done",
        dateStart: new Date("2026-05-06T18:00:00.000Z"),
        parentId: "home-project",
      }),
    ];
    rows.taskLinks = [
      {
        id: "link-riverford",
        notionPageId: "notion-riverford",
        todoistTaskId: "todoist-riverford",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSyncAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSyncHash: "hash",
        pendingOrigin: null,
      },
    ];

    const data = await loadDashboard(new Date("2026-05-07T16:43:00.000Z"));

    expect(data.todayTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Riverford boxes outside",
          done: false,
          source: "both",
          notionPageId: "notion-riverford",
          todoistTaskId: "todoist-riverford",
          hasRecurringTag: true,
        }),
      ]),
    );
  });

  it("shows open tasks with a deadline today even when their scheduled date is later", async () => {
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-deadline-today",
        projectId: "todoist-project",
        content: "Todoist deadline today",
        dueDate: new Date("2026-05-09T09:00:00.000Z"),
        deadline: new Date("2026-05-07T17:00:00.000Z"),
      }),
    ];
    rows.notionPages = [
      notionPage({
        id: "project",
        title: "Project",
      }),
      notionPage({
        id: "notion-deadline-today",
        title: "Notion deadline today",
        dateStart: new Date("2026-05-09T09:00:00.000Z"),
        deadline: new Date("2026-05-07T12:00:00.000Z"),
        parentId: "project",
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.todayTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Notion deadline today",
          done: false,
          source: "notion",
          notionPageId: "notion-deadline-today",
        }),
        expect.objectContaining({
          title: "Todoist deadline today",
          done: false,
          source: "todoist",
          todoistTaskId: "todoist-deadline-today",
        }),
      ]),
    );
    expect(data.next7DaysTasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Notion deadline today" }),
        expect.objectContaining({ title: "Todoist deadline today" }),
      ]),
    );
    expect(data.meta.todayOpenCount).toBe(2);
  });

  it("shows open recurring Todoist tasks due today from the raw due payload", async () => {
    rows.todoistProjects = [
      {
        id: "recurring",
        name: "Recurring",
        parentId: null,
        color: null,
        archived: false,
        raw: {},
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      {
        id: "daily",
        name: "Daily",
        parentId: "recurring",
        color: null,
        archived: false,
        raw: {},
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-floss",
        projectId: "daily",
        content: "Floss",
        dueDate: null,
        dueString: "every day at 7pm",
        dueIsRecurring: true,
        checked: false,
        raw: {
          due: {
            datetime: "2026-05-07T19:00:00.000Z",
            date: "2026-05-07",
            string: "every day at 7pm",
            isRecurring: true,
          },
        },
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T20:08:00.000Z"));

    expect(data.todayTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Floss",
          done: false,
          source: "todoist",
          todoistTaskId: "todoist-floss",
          hasRecurringTag: true,
          // Todoist's actual repeat rule, distinct from the folder-based tag —
          // the Today row keeps the due time read-only when this is set.
          dueIsRecurring: true,
        }),
      ]),
    );
    expect(data.meta.todayOpenCount).toBe(0);
    expect(data.meta.todayOpenRecurringCount).toBe(1);
  });

  it("flags which today tasks carry a time of day, and which repeat", async () => {
    rows.todoistTasks = [
      // API v1 shape: no `datetime` key, the time rides along in `date`.
      todoistTask({
        id: "todoist-timed-v1",
        content: "Timed v1",
        dueDate: new Date("2026-05-07T13:30:00.000Z"),
        raw: { due: { date: "2026-05-07T14:30:00", string: "May 7 2:30 PM" } },
      }),
      // REST v2 shape, still present in rows cached before the SDK upgrade.
      todoistTask({
        id: "todoist-timed-v2",
        content: "Timed v2",
        dueDate: new Date("2026-05-07T13:30:00.000Z"),
        raw: { due: { date: "2026-05-07", datetime: "2026-05-07T13:30:00.000Z" } },
      }),
      todoistTask({
        id: "todoist-all-day",
        content: "All day",
        dueDate: new Date("2026-05-07T00:00:00.000Z"),
        raw: { due: { date: "2026-05-07" } },
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T20:08:00.000Z"));

    expect(data.todayTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Timed v1",
          dateHasTime: true,
          dueIsRecurring: false,
        }),
        expect.objectContaining({
          title: "Timed v2",
          dateHasTime: true,
          dueIsRecurring: false,
        }),
        expect.objectContaining({
          title: "All day",
          dateHasTime: false,
          dueIsRecurring: false,
        }),
      ]),
    );
  });

  it("surfaces open tasks whose dates are entirely in the past as overdue", async () => {
    rows.notionPages = [
      notionPage({ id: "project", title: "Project" }),
      notionPage({
        id: "notion-overdue",
        title: "Notion overdue",
        dateStart: new Date("2026-05-05T09:00:00.000Z"),
        parentId: "project",
      }),
      notionPage({
        id: "notion-done-past",
        title: "Notion done in the past",
        status: "Done",
        dateStart: new Date("2026-05-05T09:00:00.000Z"),
        parentId: "project",
      }),
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-overdue",
        content: "Todoist overdue",
        dueDate: new Date("2026-05-06T09:00:00.000Z"),
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.overdueTasks).toEqual([
      expect.objectContaining({
        title: "Notion overdue",
        done: false,
        overdueDays: 2,
      }),
      expect.objectContaining({
        title: "Todoist overdue",
        done: false,
        overdueDays: 1,
      }),
    ]);
    expect(data.todayTasks).toEqual([]);
    expect(data.next7DaysTasks).toEqual([]);
    expect(data.meta.overdueOpenCount).toBe(2);
    expect(data.meta.overdueOpenRecurringCount).toBe(0);
  });

  it("keeps a task with a passed date but upcoming deadline in Next 7 Days, not overdue", async () => {
    rows.notionPages = [
      notionPage({ id: "project", title: "Project" }),
      notionPage({
        id: "notion-deadline-ahead",
        title: "Passed date, deadline ahead",
        dateStart: new Date("2026-05-05T09:00:00.000Z"),
        deadline: new Date("2026-05-10T09:00:00.000Z"),
        parentId: "project",
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.overdueTasks).toEqual([]);
    expect(data.next7DaysTasks).toEqual([
      expect.objectContaining({ title: "Passed date, deadline ahead", overdueDays: null }),
    ]);
  });

  it("does not duplicate a linked Todoist task whose Notion mirror is already overdue", async () => {
    rows.notionPages = [
      notionPage({ id: "project", title: "Project" }),
      notionPage({
        id: "notion-linked-overdue",
        title: "Linked overdue",
        dateStart: new Date("2026-05-04T09:00:00.000Z"),
        parentId: "project",
      }),
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-linked-overdue",
        content: "Linked overdue",
        dueDate: new Date("2026-05-04T09:00:00.000Z"),
      }),
    ];
    rows.taskLinks = [
      {
        id: "link-overdue",
        notionPageId: "notion-linked-overdue",
        todoistTaskId: "todoist-linked-overdue",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSyncAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSyncHash: "hash",
        pendingOrigin: null,
      },
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.overdueTasks).toHaveLength(1);
    expect(data.overdueTasks[0]).toEqual(
      expect.objectContaining({
        title: "Linked overdue",
        source: "both",
        notionPageId: "notion-linked-overdue",
        todoistTaskId: "todoist-linked-overdue",
        overdueDays: 3,
      }),
    );
  });

  it("moves overdue Personal-project tasks into the overdue list instead of Personal", async () => {
    rows.todoistProjects = [
      {
        id: "personal",
        name: "Personal",
        parentId: null,
        color: null,
        archived: false,
        raw: {},
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-personal-overdue",
        projectId: "personal",
        content: "Personal overdue",
        dueDate: new Date("2026-05-06T09:00:00.000Z"),
      }),
      todoistTask({
        id: "todoist-personal-dateless",
        projectId: "personal",
        content: "Personal dateless",
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.overdueTasks).toEqual([
      expect.objectContaining({ title: "Personal overdue", overdueDays: 1 }),
    ]);
    expect(data.personalTasks).toEqual([
      expect.objectContaining({ title: "Personal dateless" }),
    ]);
  });

  it("keeps a task completed today visible after its due date has passed", async () => {
    rows.notionPages = [
      notionPage({ id: "project", title: "Project" }),
      notionPage({
        id: "notion-done-today",
        title: "Notion done today",
        status: "Done",
        dateStart: new Date("2026-05-05T09:00:00.000Z"),
        parentId: "project",
        updatedAt: new Date("2026-05-07T07:30:00.000Z"),
      }),
      notionPage({
        id: "notion-done-last-week",
        title: "Notion done last week",
        status: "Done",
        dateStart: new Date("2026-05-01T09:00:00.000Z"),
        parentId: "project",
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      }),
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-done-today",
        content: "Todoist done today",
        dueDate: new Date("2026-05-06T09:00:00.000Z"),
        checked: true,
        updatedAt: new Date("2026-05-07T07:45:00.000Z"),
      }),
      todoistTask({
        id: "todoist-done-last-week",
        content: "Todoist done last week",
        dueDate: new Date("2026-05-01T09:00:00.000Z"),
        checked: true,
        updatedAt: new Date("2026-05-01T10:00:00.000Z"),
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    const titles = data.todayTasks.map((t) => t.title);
    expect(titles).toContain("Notion done today");
    expect(titles).toContain("Todoist done today");
    expect(titles).not.toContain("Notion done last week");
    expect(titles).not.toContain("Todoist done last week");

    for (const title of ["Notion done today", "Todoist done today"]) {
      expect(data.todayTasks.find((t) => t.title === title)).toEqual(
        expect.objectContaining({ done: true }),
      );
    }
    expect(data.overdueTasks).toEqual([]);
    // Completed work must not inflate the hero's open counters.
    expect(data.meta.todayOpenCount).toBe(0);
    expect(data.meta.overdueOpenCount).toBe(0);
  });

  it("does not duplicate a linked task completed today across both sources", async () => {
    rows.notionPages = [
      notionPage({ id: "project", title: "Project" }),
      notionPage({
        id: "notion-linked-done",
        title: "Linked done today",
        status: "Done",
        dateStart: new Date("2026-05-05T09:00:00.000Z"),
        parentId: "project",
        updatedAt: new Date("2026-05-07T07:30:00.000Z"),
      }),
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-linked-done",
        content: "Linked done today",
        dueDate: new Date("2026-05-05T09:00:00.000Z"),
        checked: true,
        updatedAt: new Date("2026-05-07T07:30:00.000Z"),
      }),
    ];
    rows.taskLinks = [
      {
        id: "link-done",
        notionPageId: "notion-linked-done",
        todoistTaskId: "todoist-linked-done",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSyncAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSyncHash: "hash",
        pendingOrigin: null,
      },
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    const matches = data.todayTasks.filter((t) => t.title === "Linked done today");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(
      expect.objectContaining({ done: true, notionPageId: "notion-linked-done" }),
    );
  });

  it("flags overdue Recurring-folder tasks so the recurring toggle governs them", async () => {
    rows.todoistProjects = [
      {
        id: "recurring",
        name: "Recurring",
        parentId: null,
        color: null,
        archived: false,
        raw: {},
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
    ];
    rows.todoistTasks = [
      todoistTask({
        id: "todoist-recurring-overdue",
        projectId: "recurring",
        content: "Recurring overdue",
        dueDate: new Date("2026-05-06T09:00:00.000Z"),
      }),
    ];

    const data = await loadDashboard(new Date("2026-05-07T08:00:00.000Z"));

    expect(data.overdueTasks).toEqual([
      expect.objectContaining({
        title: "Recurring overdue",
        hasRecurringTag: true,
        overdueDays: 1,
      }),
    ]);
    expect(data.meta.overdueOpenCount).toBe(0);
    expect(data.meta.overdueOpenRecurringCount).toBe(1);
  });
});
