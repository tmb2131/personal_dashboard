import { describe, expect, it } from "vitest";
import {
  IN_PROGRESS_LABEL,
  notionStatusFromTodoist,
  syncHash,
  todoistCheckedFromNotion,
} from "./mappings";

describe("sync mappings", () => {
  it("maps todoist states to notion statuses", () => {
    expect(notionStatusFromTodoist({ checked: true, labels: [] } as never)).toBe("Done");
    expect(notionStatusFromTodoist({ checked: false, labels: [IN_PROGRESS_LABEL] } as never)).toBe(
      "In progress",
    );
    expect(notionStatusFromTodoist({ checked: false, labels: [] } as never)).toBe("Not started");
  });

  it("maps notion done state to todoist checked", () => {
    expect(todoistCheckedFromNotion({ status: "Done" } as never)).toBe(true);
    expect(todoistCheckedFromNotion({ status: "Not started" } as never)).toBe(false);
  });

  it("keeps hash stable across identical input", () => {
    const args = {
      title: "Task one",
      status: "In progress" as const,
      date: new Date("2026-05-07T09:00:00.000Z"),
      deadline: new Date("2026-05-08T09:00:00.000Z"),
      priority: "High" as const,
      categoryOrProjectId: "proj_1",
    };
    expect(syncHash(args)).toBe(syncHash(args));
  });

  it("busts the hash when the Todoist due date moves even if the Notion side is unchanged", () => {
    // Reproduces the dashboard-stuck-on-today bug: the user reschedules a
    // Todoist task (today -> Friday) but the mirrored Notion page is untouched,
    // so the Notion-derived fields are identical for both hashes. The folded
    // Todoist fields must still make the two hashes differ so the drift detector
    // mirrors the new date into Notion instead of treating the pair as in-sync.
    const notionSide = {
      title: "Pay Liberty",
      status: "Not started" as const,
      date: new Date("2026-06-24T00:00:00.000Z"),
      deadline: null,
      priority: null,
      categoryOrProjectId: "proj_1",
    };
    const before = syncHash({
      ...notionSide,
      todoist: {
        content: "Pay Liberty",
        checked: false,
        dueDate: new Date("2026-06-24T00:00:00.000Z"),
        deadline: null,
        priority: 1,
      },
    });
    const after = syncHash({
      ...notionSide,
      todoist: {
        content: "Pay Liberty",
        checked: false,
        dueDate: new Date("2026-06-26T00:00:00.000Z"),
        deadline: null,
        priority: 1,
      },
    });
    expect(after).not.toBe(before);
  });
});
