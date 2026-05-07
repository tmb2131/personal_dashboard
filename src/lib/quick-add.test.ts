import { describe, expect, it } from "vitest";
import { extractProject } from "./quick-add";

describe("quick add parser", () => {
  it("extracts bracketed project mention", () => {
    expect(extractProject("Call mom @{Family Admin} tomorrow")).toEqual({
      text: "Call mom tomorrow",
      projectName: "Family Admin",
    });
  });

  it("extracts simple @project mention", () => {
    expect(extractProject("Pay rent @home-admin")).toEqual({
      text: "Pay rent",
      projectName: "home admin",
    });
  });

  it("returns trimmed text when no mention is present", () => {
    expect(extractProject("  Plan weekend  ")).toEqual({
      text: "Plan weekend",
      projectName: null,
    });
  });
});
