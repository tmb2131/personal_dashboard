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
        }),
      ]),
    );
    expect(data.meta.todayOpenCount).toBe(0);
    expect(data.meta.todayOpenRecurringCount).toBe(1);
  });
});
