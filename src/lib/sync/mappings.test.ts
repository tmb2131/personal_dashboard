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
});
