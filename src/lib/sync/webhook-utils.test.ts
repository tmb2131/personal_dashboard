import { describe, expect, it } from "vitest";
import {
  collectNotionEventIdsFromPayload,
  collectNotionPageIdsFromPayload,
  webhookFingerprint,
} from "./webhook-utils";

describe("webhook utils", () => {
  it("collects and deduplicates notion page ids", () => {
    const ids = collectNotionPageIdsFromPayload({
      entity: { id: "page_123456789" },
      data: { object: "page", id: "page_abcdefghi", parent: { id: "parent_abcdefghi" } },
      events: [{ id: "page_123456789" }, { entity: { id: "page_xyzxyzxyz" } }],
    });

    expect(ids).toEqual([
      "page_123456789",
      "page_abcdefghi",
      "parent_abcdefghi",
      "page_xyzxyzxyz",
    ]);
  });

  it("creates deterministic fingerprints", () => {
    const a = webhookFingerprint('{"x":1}');
    const b = webhookFingerprint('{"x":1}');
    const c = webhookFingerprint('{"x":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("collects and deduplicates notion event ids", () => {
    const ids = collectNotionEventIdsFromPayload({
      event_id: "evt_123456789",
      events: [{ id: "evt_abcdefghi" }, { event_id: "evt_abcdefghi" }, { id: "evt_xyzxyzxyz" }],
    });

    expect(ids).toEqual(["evt_123456789", "evt_abcdefghi", "evt_xyzxyzxyz"]);
  });
});
