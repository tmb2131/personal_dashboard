import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Change detection lives in Postgres now: the upsert carries a `setWhere` that
 * skips rows whose meaningful columns are unchanged, and `RETURNING` reports
 * whatever it did touch. These tests cover the TypeScript half of that contract
 * — that `syncTodoist` reports what the database returned rather than recomputing
 * it, and that the completion sweep is properly guarded. The SQL semantics of
 * `IS DISTINCT FROM` need a real Postgres and are not exercised here.
 */

const state = vi.hoisted(() => ({
  projects: [] as unknown[],
  tasks: [] as unknown[],
  /** Ids the fake DB reports back from the task upsert's RETURNING. */
  upsertReturns: [] as { id: string }[],
  /** Rows the fake DB reports back from the completion sweep's RETURNING. */
  completionReturns: [] as { id: string; dueIsRecurring: boolean }[],
  calls: [] as string[],
}));

vi.mock("@/lib/db", () => {
  function insertBuilder(tableName: string) {
    const builder = {
      values: () => builder,
      onConflictDoUpdate: (config: Record<string, unknown>) => {
        state.calls.push(
          `insert:${tableName}${config.setWhere ? ":conditional" : ":unconditional"}`,
        );
        return builder;
      },
      returning: () => Promise.resolve(state.upsertReturns),
      then: <T>(onfulfilled?: ((value: unknown) => T) | null) =>
        Promise.resolve(undefined).then(onfulfilled),
    };
    return builder;
  }

  function updateBuilder(tableName: string) {
    const builder = {
      set: () => builder,
      where: () => builder,
      returning: () => {
        state.calls.push(`update:${tableName}`);
        return Promise.resolve(state.completionReturns);
      },
    };
    return builder;
  }

  return {
    db: {
      insert: (table: { __name: string }) => insertBuilder(table.__name),
      update: (table: { __name: string }) => updateBuilder(table.__name),
    },
    schema: {
      todoistTasks: { __name: "todoistTasks", id: "id", checked: "checked" },
      todoistProjects: { __name: "todoistProjects", id: "id" },
      syncState: { __name: "syncState", source: "source" },
    },
  };
});

vi.mock("@doist/todoist-api-typescript", () => ({
  TodoistApi: class {
    getProjects() {
      return Promise.resolve(state.projects);
    }
    getTasks() {
      return Promise.resolve(state.tasks);
    }
  },
}));

const { syncTodoist } = await import("./todoist");

function task(id: string, overrides: Record<string, unknown> = {}) {
  return { id, content: `task ${id}`, priority: 1, ...overrides };
}

beforeEach(() => {
  process.env.TODOIST_TOKEN = "test-token";
  state.projects = [];
  state.tasks = [];
  state.upsertReturns = [];
  state.completionReturns = [];
  state.calls = [];
});

describe("syncTodoist change detection", () => {
  it("reports only the ids the upsert returned as changed", async () => {
    state.tasks = [task("1"), task("2"), task("3")];
    // Postgres skipped 1 and 3 via setWhere; only 2 actually differed.
    state.upsertReturns = [{ id: "2" }];

    const result = await syncTodoist();

    expect(result.changedTaskIds).toEqual(["2"]);
    expect(result.tasks).toBe(3);
  });

  it("reports nothing changed when the upsert touched no rows", async () => {
    state.tasks = [task("1"), task("2")];
    state.upsertReturns = [];

    const result = await syncTodoist();

    expect(result.changedTaskIds).toEqual([]);
    expect(result.completedTaskIds).toEqual([]);
  });

  it("sends the task upsert with a conditional setWhere", async () => {
    state.tasks = [task("1")];

    await syncTodoist();

    expect(state.calls).toContain("insert:todoistTasks:conditional");
  });

  it("skips the upsert entirely when the API returns no tasks", async () => {
    state.tasks = [];

    await syncTodoist();

    expect(state.calls).not.toContain("insert:todoistTasks:conditional");
  });
});

describe("syncTodoist completion sweep", () => {
  it("splits swept rows into completed and completed-recurring", async () => {
    state.tasks = [task("1")];
    state.completionReturns = [
      { id: "9", dueIsRecurring: false },
      { id: "10", dueIsRecurring: true },
    ];

    const result = await syncTodoist();

    expect(result.completedTaskIds).toEqual(["9", "10"]);
    // Recurring completions also appear in the plain completed list — the
    // recurring-link repair in reconcile runs in addition to the mirror, not
    // instead of it.
    expect(result.completedRecurringTaskIds).toEqual(["10"]);
  });

  it("does not sweep when the API returns zero tasks", async () => {
    // An API hiccup returning an empty list must not mark the whole table
    // complete and mirror that to Notion.
    state.tasks = [];
    state.completionReturns = [{ id: "9", dueIsRecurring: false }];

    const result = await syncTodoist();

    expect(state.calls).not.toContain("update:todoistTasks");
    expect(result.completedTaskIds).toEqual([]);
    expect(result.completedRecurringTaskIds).toEqual([]);
  });
});
