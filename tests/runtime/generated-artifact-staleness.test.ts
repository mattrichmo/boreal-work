import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ObjectDirBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";
import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import {
  createRecordMeta,
  deterministicId,
  projectRollupSchemaIssues,
  withContentHash,
  type ActorRef,
  type AgentReservation,
  type IsoTimestamp,
  type ProjectRollupDocument,
  type ReservationId,
  type WorkId,
  type WorkItem,
  type WorkStatus
} from "../../packages/core/src/index.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface JsonEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

const tempDirs: string[] = [];
const TEST_ACTOR = { id: "rollup-test", kind: "agent", displayName: "Rollup Test" } satisfies ActorRef;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generated artifacts after mutation", () => {
  it("writes a fresh schema-valid project rollup after mutations", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Rollup ready work", "--kind", "task", "--ready", "--json"]);
    await runCli(rootDir, ["work", "create", "Rollup draft work", "--kind", "issue", "--json"]);

    const rollupPath = join(rootDir, ".boreal", "rollup.json");
    const rollup = JSON.parse(await readFile(rollupPath, "utf8")) as ProjectRollupDocument;
    const rows = parseData<Array<{ readonly kind: string; readonly status: string }>>(
      (await runCli(rootDir, ["work", "list", "--limit", "10", "--json"])).stdout
    );
    const freshReadyCount = rows.filter((row) => row.status === "ready").length;
    const freshDraftCount = rows.filter((row) => row.status === "draft").length;

    expect(projectRollupSchemaIssues(rollup)).toEqual([]);
    expect(rollup.counts.work.total).toBe(rows.length);
    expect(rollup.counts.work.byStatus.ready).toBe(freshReadyCount);
    expect(rollup.counts.work.byStatus.draft).toBe(freshDraftCount);
    expect(rollup.counts.work.byKind.task).toBe(rows.filter((row) => row.kind === "task").length);

    const shown = parseData<{
      readonly ok: boolean;
      readonly inspection: { readonly exists: boolean; readonly stale: boolean };
      readonly rollup: ProjectRollupDocument;
    }>((await runCli(rootDir, ["rollup", "show", "--json"])).stdout);
    expect(shown.ok).toBe(true);
    expect(shown.inspection).toEqual(expect.objectContaining({ exists: true, stale: false }));
    expect(shown.rollup.stateContentHash).toBe(rollup.stateContentHash);

    const status = parseData<{ readonly projectRollup: { readonly ok: boolean; readonly stale: boolean } }>(
      (await runCli(rootDir, ["sync", "status", "--json"])).stdout
    );
    expect(status.projectRollup).toEqual(expect.objectContaining({ ok: true, stale: false }));
  });

  it("writes ready, limbo, and expired reservation aging metrics from backdated records", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const readySince = iso("2026-01-01T00:00:00.000Z");
    const needsVerificationSince = iso("2026-01-02T00:00:00.000Z");
    const verifiedSince = iso("2026-01-03T00:00:00.000Z");
    const reservedAt = iso("2026-01-04T00:00:00.000Z");
    const expiresAt = iso("2026-01-05T00:00:00.000Z");
    const ready = fixtureWork("Backdated ready rollup work", "ready", readySince, 1);
    const needsVerification = fixtureWork("Backdated needs-verification rollup work", "needs_verification", needsVerificationSince, 2);
    const verified = fixtureWork("Backdated verified rollup work", "verified", verifiedSince, 3);
    const reserved = fixtureWork("Backdated reserved rollup work", "reserved", reservedAt, 4);
    const expiredReservation = fixtureReservation(reserved.meta.id, reservedAt, expiresAt);

    await new ObjectDirBorealStore({ rootDir }).write(async (writer) => {
      for (const work of [ready, needsVerification, verified, reserved]) {
        await writer.putWorkItem(work);
      }
      await writer.putReservation(expiredReservation);
    });

    await runCli(rootDir, ["sync", "refresh", "--json"]);
    const rollup = await readProjectRollup(rootDir);

    expect(projectRollupSchemaIssues(rollup)).toEqual([]);
    expect(rollup.schemaVersion).toBe("boreal.project-rollup.v2");
    expect(rollup.aging.approximation).toEqual({
      readySinceSource: "work.meta.updatedAt",
      limboSinceSource: "work.meta.updatedAt",
      expiredReservationSinceSource: "reservation.expiresAt_or_meta.updatedAt",
      eventHistoryScanned: false
    });
    expect(rollup.aging.ready.count).toBe(1);
    expect(rollup.aging.ready.items).toEqual([
      expect.objectContaining({
        workId: ready.meta.id,
        status: "ready",
        since: readySince,
        ageMs: expectedAgeMs(rollup, readySince),
        ageDays: expectedAgeDays(rollup, readySince)
      })
    ]);
    expect(rollup.aging.limbo.count).toBe(2);
    expect(rollup.aging.limbo.items.map((entry) => entry.workId)).toEqual([
      needsVerification.meta.id,
      verified.meta.id
    ]);
    expect(rollup.aging.expiredReservations.count).toBe(1);
    expect(rollup.aging.expiredReservations.items).toEqual([
      expect.objectContaining({
        reservationId: expiredReservation.meta.id,
        workId: reserved.meta.id,
        status: "active",
        expiresAt,
        since: expiresAt,
        ageMs: expectedAgeMs(rollup, expiresAt),
        ageDays: expectedAgeDays(rollup, expiresAt)
      })
    ]);
    expect(rollup.aging.maxima).toEqual({
      readyAgeMs: expectedAgeMs(rollup, readySince),
      limboAgeMs: expectedAgeMs(rollup, needsVerificationSince),
      expiredReservationAgeMs: expectedAgeMs(rollup, expiresAt)
    });
  });

  it("keeps rollup aging projection bounded for hundreds of ready records", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const readyItems = Array.from({ length: 350 }, (_, index) =>
      fixtureWork(`Bounded aging ready work ${index.toString().padStart(3, "0")}`, "ready", new Date(base + index * 1000).toISOString() as IsoTimestamp, index)
    );

    await new ObjectDirBorealStore({ rootDir }).write(async (writer) => {
      for (const work of readyItems) {
        await writer.putWorkItem(work);
      }
    });

    await runCli(rootDir, ["sync", "refresh", "--json"]);
    const rollup = await readProjectRollup(rootDir);

    expect(projectRollupSchemaIssues(rollup)).toEqual([]);
    expect(rollup.counts.work.total).toBe(readyItems.length);
    expect(rollup.aging.ready.count).toBe(readyItems.length);
    expect(rollup.aging.ready.items).toHaveLength(10);
    expect(rollup.aging.ready.items[0]?.workId).toBe(readyItems[0]?.meta.id);
    expect(rollup.aging.ready.oldestAgeMs).toBe(expectedAgeMs(rollup, readyItems[0]?.meta.updatedAt ?? rollup.generatedAt));
    expect(rollup.aging.limbo.items).toHaveLength(0);
    expect(rollup.aging.expiredReservations.items).toHaveLength(0);
  });

  it("flags stale project rollups in doctor", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Rollup stale doctor work", "--ready", "--json"]);

    const rollupPath = join(rootDir, ".boreal", "rollup.json");
    const rollup = JSON.parse(await readFile(rollupPath, "utf8")) as ProjectRollupDocument;
    await writeFile(rollupPath, `${JSON.stringify({ ...rollup, stateContentHash: `sha256:${"0".repeat(64)}` }, null, 2)}\n`);

    const doctor = parseData<{
      readonly diagnostics: readonly Array<{ readonly code: string; readonly severity: string; readonly details?: { readonly stale?: boolean } }>;
    }>((await runCli(rootDir, ["doctor", "--json"])).stdout);

    expect(doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "project.rollup",
          severity: "info",
          details: expect.objectContaining({ stale: true })
        })
      ])
    );
  });

  it("does not rewrite the search index inline on work close", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Generated artifact staleness target", "--kind", "task", "--ready", "--json"]))
        .stdout
    );

    await runCli(rootDir, ["sync", "refresh", "--json"]);
    const indexPath = join(rootDir, ".boreal", "runtime", "search-index.json");

    await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--json"]);
    const before = statSync(indexPath).mtimeMs;
    await waitForDistinctMtime();
    await runCli(rootDir, [
      "agent",
      "finish",
      created.meta.id,
      "--agent",
      "a1",
      "--summary",
      "Generated artifact staleness closeout.",
      "--kind",
      "command",
      "--outcome",
      "passed",
      "--command",
      "pnpm test",
      "--verdict",
      "passed",
      "--notes",
      "Generated artifact staleness evidence.",
      "--close",
      "--reason",
      "generated artifact staleness test",
      "--dirty-path",
      "no_repo_changes: generated artifact staleness test",
      "--json"
    ]);

    expect(statSync(indexPath).mtimeMs).toBe(before);
    const status = parseData<{
      readonly searchIndex: { readonly ok: boolean; readonly stale: boolean };
    }>((await runCli(rootDir, ["sync", "status", "--json"])).stdout);
    expect(status.searchIndex).toEqual(expect.objectContaining({ ok: false, stale: true }));

    const doctor = parseData<{
      readonly diagnostics: readonly Array<{ readonly code: string; readonly severity: string }>;
    }>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "search.index", severity: "info" }),
        expect.objectContaining({ code: "ledger.export_drift", severity: "info" }),
        expect.objectContaining({ code: "cache.sqlite", severity: "ok" }),
        expect.objectContaining({ code: "cache.sqlite.retired", severity: "ok" })
      ])
    );
  });
});

async function createTestWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-generated-artifacts-"));
  tempDirs.push(rootDir);
  return rootDir;
}

async function readProjectRollup(rootDir: string): Promise<ProjectRollupDocument> {
  return JSON.parse(await readFile(join(rootDir, ".boreal", "rollup.json"), "utf8")) as ProjectRollupDocument;
}

function fixtureWork(title: string, status: WorkStatus, now: IsoTimestamp, nonce: number): WorkItem {
  return withContentHash({
    ...createWorkItem({
      title,
      kind: "task",
      actor: TEST_ACTOR,
      now,
      nonce
    }),
    status
  });
}

function fixtureReservation(workId: WorkId, reservedAt: IsoTimestamp, expiresAt: IsoTimestamp): AgentReservation {
  return withContentHash({
    meta: createRecordMeta({
      id: deterministicId<ReservationId>("reservation", { workId, reservedAt, expiresAt }),
      now: reservedAt,
      actor: TEST_ACTOR
    }),
    workId,
    agentId: "rollup-test",
    status: "active",
    reservedAt,
    expiresAt
  });
}

function expectedAgeMs(rollup: ProjectRollupDocument, since: IsoTimestamp): number {
  return Math.max(0, Date.parse(rollup.generatedAt) - Date.parse(since));
}

function expectedAgeDays(rollup: ProjectRollupDocument, since: IsoTimestamp): number {
  return Math.floor(expectedAgeMs(rollup, since) / (24 * 60 * 60 * 1000));
}

function iso(value: string): IsoTimestamp {
  return value as IsoTimestamp;
}

async function runCli(cwd: string, argv: readonly string[]): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  const output: CliOutput = {
    write(text) {
      stdout += text;
    },
    error(text) {
      stderr += text;
    }
  };
  const exitCode = await main([...argv], output, cwd);
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function waitForDistinctMtime(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
