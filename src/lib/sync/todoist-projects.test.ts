import { describe, expect, it } from "vitest";
import { collectRecurringProjectIds, type TodoistProjectNode } from "./todoist-projects";

function project(over: Partial<TodoistProjectNode> & { id: string }): TodoistProjectNode {
  return { name: over.id, parentId: null, ...over };
}

describe("collectRecurringProjectIds", () => {
  it("finds the Recurring project by name, past case and padding", () => {
    const ids = collectRecurringProjectIds([
      project({ id: "r", name: "  ReCurRing " }),
      project({ id: "oci", name: "OCI" }),
    ]);
    expect([...ids]).toEqual(["r"]);
  });

  it("takes everything nested under it, however deep", () => {
    // Habits get filed into sub-projects; a task two levels down is still a habit.
    const ids = collectRecurringProjectIds([
      project({ id: "r", name: "Recurring" }),
      project({ id: "house", parentId: "r" }),
      project({ id: "kitchen", parentId: "house" }),
      project({ id: "work" }),
      project({ id: "work-sub", parentId: "work" }),
    ]);
    expect([...ids].sort()).toEqual(["house", "kitchen", "r"]);
  });

  it("survives a project cycle rather than looping forever", () => {
    // Todoist should never hand us one, but a walk that trusts the tree shape
    // hangs the whole reconcile if it ever does.
    const ids = collectRecurringProjectIds([
      project({ id: "r", name: "Recurring", parentId: "b" }),
      project({ id: "a", parentId: "r" }),
      project({ id: "b", parentId: "a" }),
    ]);
    expect([...ids].sort()).toEqual(["a", "b", "r"]);
  });

  it("returns nothing when there is no Recurring project", () => {
    expect(collectRecurringProjectIds([project({ id: "oci", name: "OCI" })]).size).toBe(0);
  });
});
