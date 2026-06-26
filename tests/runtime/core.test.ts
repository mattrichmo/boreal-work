import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BorealError,
  canonicalJson,
  deterministicId,
  detectSuspiciousUnicode,
  hashContent,
  normalizeActorId,
  normalizeLabel,
  normalizeMachineString,
  normalizeSearchQuery,
  randomId,
  readJsonFile,
  safeParseJson,
  type EventId,
  type WorkId
} from "@boreal/core";

describe("core hashing and ids", () => {
  it("canonicalizes object keys before hashing", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashContent(left)).toBe(hashContent(right));
  });

  it("creates deterministic typed ids", () => {
    const first = deterministicId<WorkId>("work", { title: "Build runtime" });
    const second = deterministicId<WorkId>("work", { title: "Build runtime" });

    expect(first).toBe(second);
    expect(first).toMatch(/^bw_work_[a-f0-9]{16}$/);
  });

  it("creates random event ids for append-only event streams", () => {
    const first = randomId<EventId>("event");
    const second = randomId<EventId>("event");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^bw_event_[a-f0-9]{32}$/);
  });

  it("reports structured JSON parse failures", () => {
    expect(() => safeParseJson("{", { path: "state.json", schemaName: "boreal.file-store.v1" })).toThrow(BorealError);
    expect(() => safeParseJson("{", { path: "state.json", schemaName: "boreal.file-store.v1" })).toThrow(
      expect.objectContaining({
        code: "BOREAL_JSON_PARSE",
        details: expect.objectContaining({
          path: "state.json",
          schemaName: "boreal.file-store.v1"
        })
      })
    );
  });

  it("enforces JSON file size limits before parsing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "boreal-json-"));
    try {
      const path = join(dir, "large.json");
      await writeFile(path, JSON.stringify({ ok: true }), "utf8");
      await expect(readJsonFile(path, { maxBytes: 2 })).rejects.toMatchObject({
        code: "BOREAL_INVALID_INPUT"
      } satisfies Partial<BorealError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes machine-facing strings and rejects invisible unicode", () => {
    expect(normalizeMachineString("  Ｓｈｉｐ   runtime  ", "title")).toBe("Ship runtime");
    expect(normalizeLabel("  CLI  Work ")).toBe("cli work");
    expect(normalizeActorId(" Agent-A ")).toBe("agent-a");
    expect(normalizeSearchQuery("  content   hash  ")).toBe("content hash");

    const findings = detectSuspiciousUnicode("bad\u200btitle");
    expect(findings).toEqual([expect.objectContaining({ codePoint: "U+200B", kind: "invisible_format" })]);
    expect(() => normalizeMachineString("bad\u202etitle", "title")).toThrow(
      expect.objectContaining({ code: "BOREAL_UNSAFE_UNICODE" })
    );
  });
});
