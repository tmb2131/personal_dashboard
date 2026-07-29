import { describe, expect, it } from "vitest";
import { flagCodec, jsonCodec } from "./use-persisted-state";

describe("flagCodec", () => {
  it("round-trips booleans", () => {
    expect(flagCodec.decode(flagCodec.encode(true))).toBe(true);
    expect(flagCodec.decode(flagCodec.encode(false))).toBe(false);
  });

  it("keeps the legacy 1/0 encoding so stored preferences survive", () => {
    expect(flagCodec.encode(true)).toBe("1");
    expect(flagCodec.encode(false)).toBe("0");
    expect(flagCodec.decode("1")).toBe(true);
    expect(flagCodec.decode("0")).toBe(false);
  });

  it("returns null for anything unrecognised so the fallback applies", () => {
    expect(flagCodec.decode("")).toBeNull();
    expect(flagCodec.decode("true")).toBeNull();
    expect(flagCodec.decode("garbage")).toBeNull();
  });
});

describe("jsonCodec", () => {
  type Flags = Record<string, true>;
  const isFlags = (v: unknown): v is Flags =>
    Boolean(v) && typeof v === "object" && Object.values(v as object).every((x) => x === true);

  const codec = jsonCodec(isFlags);

  it("round-trips a valid value", () => {
    expect(codec.decode(codec.encode({ "next-3-days": true }))).toEqual({
      "next-3-days": true,
    });
  });

  it("rejects values failing the guard", () => {
    expect(codec.decode(JSON.stringify({ "next-3-days": false }))).toBeNull();
    expect(codec.decode(JSON.stringify("nope"))).toBeNull();
  });

  it("survives corrupt stored JSON", () => {
    expect(codec.decode("{not json")).toBeNull();
  });
});
