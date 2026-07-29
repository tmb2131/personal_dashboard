import { describe, expect, it } from "vitest";
import { extractPriority, extractProject, toTodoistApiPriority } from "./quick-add";

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

describe("extractPriority", () => {
  it("extracts a trailing p1 token", () => {
    expect(extractPriority("pay rent p1")).toEqual({ text: "pay rent", priority: 1 });
  });

  it("extracts a leading bang token", () => {
    expect(extractPriority("!3 water plants")).toEqual({ text: "water plants", priority: 3 });
  });

  it("extracts a mid-string token without leaving double spaces", () => {
    expect(extractPriority("buy p2 batteries")).toEqual({
      text: "buy p2 batteries".replace(" p2", ""),
      priority: 2,
    });
    expect(extractPriority("buy p2 batteries").text).toBe("buy batteries");
  });

  it("is case insensitive", () => {
    expect(extractPriority("Ship release P4")).toEqual({ text: "Ship release", priority: 4 });
  });

  it("leaves ordinary words that merely contain p-digit alone", () => {
    expect(extractPriority("stop 15 min")).toEqual({ text: "stop 15 min", priority: null });
    expect(extractPriority("op1 review")).toEqual({ text: "op1 review", priority: null });
    expect(extractPriority("call p5 team")).toEqual({ text: "call p5 team", priority: null });
    expect(extractPriority("read chapter p12")).toEqual({
      text: "read chapter p12",
      priority: null,
    });
  });

  it("takes only the first token when several are present", () => {
    expect(extractPriority("triage p1 then p2")).toEqual({ text: "triage then p2", priority: 1 });
  });

  it("composes with project extraction", () => {
    const { text: afterProject, projectName } = extractProject("Call mom @{Family Admin} p2 tomorrow");
    expect(projectName).toBe("Family Admin");
    expect(extractPriority(afterProject)).toEqual({
      text: "Call mom tomorrow",
      priority: 2,
    });
  });

  it("maps quick-add priorities onto the Todoist API's inverted scale", () => {
    expect(toTodoistApiPriority(1)).toBe(4);
    expect(toTodoistApiPriority(4)).toBe(1);
  });
});
