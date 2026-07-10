import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withContentHash } from "@boreal/core";
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface JsonEnvelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

interface CreatedWork {
  readonly meta: { readonly id: string };
  readonly title: string;
  readonly status: string;
}

interface SprintStatusPayload {
  readonly schemaVersion: string;
  readonly sprintId: string;
  readonly title: string;
  readonly counts: {
    readonly total: number;
    readonly closed: number;
    readonly verified: number;
    readonly ready: number;
    readonly blocked: number;
    readonly inProgress: number;
  };
  readonly reservations: readonly Array<{
    readonly workId: string;
    readonly title: string;
    readonly agentId: string;
    readonly expiresAt?: string;
    readonly branch?: string;
  }>;
  readonly topBlockers: readonly Array<{
    readonly workId: string;
    readonly title: string;
    readonly blocksCount: number;
  }>;
  readonly staleClaims: readonly Array<{
    readonly workId: string;
    readonly agentId: string;
    readonly expiresAt: string;
  }>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sprint status", () => {
  it("reports scoped counts, reservations, blockers, and stale claims in JSON and table output", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const sprint = await createWork(rootDir, "Sprint Status Fixture", "sprint");
    const blocker = await createWork(rootDir, "Shared Status Blocker", "task");
    const claimed = await createWork(rootDir, "Claimed Status Task", "task");
    const blockedA = await createWork(rootDir, "Blocked Status A", "task");
    const blockedB = await createWork(rootDir, "Blocked Status B", "task");

    await runCli(rootDir, ["dep", "add", sprint.meta.id, blocker.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, claimed.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, blockedA.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", sprint.meta.id, blockedB.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", blockedA.meta.id, blocker.meta.id, "--json"]);
    await runCli(rootDir, ["dep", "add", blockedB.meta.id, blocker.meta.id, "--json"]);

    const started = parseData<{
      readonly work?: { readonly id: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string } };
    }>(
      (
        await runCli(rootDir, [
          "agent",
          "start",
          claimed.meta.id,
          "--agent",
          "status-agent",
          "--ttl",
          "1h",
          "--no-branch",
          "--json"
        ])
      ).stdout
    );
    const reservationId = started.reservation?.meta.id ?? started.work?.activeReservationId;
    expect(reservationId).toMatch(/^bw_reservation_/);
    await setReservationExpiresAt(rootDir, String(reservationId), "2000-01-01T00:00:00.000Z");
    await runCli(rootDir, ["sprint", "activate", sprint.meta.id, "--json"]);

    const status = parseData<SprintStatusPayload>((await runCli(rootDir, ["sprint", "status", "--json"])).stdout);

    expect(status).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.sprint.status.v1",
        sprintId: sprint.meta.id,
        title: "Sprint Status Fixture"
      })
    );
    expect(status.counts).toEqual({
      total: 4,
      closed: 0,
      verified: 0,
      ready: 1,
      blocked: 2,
      inProgress: 1
    });
    expect(status.reservations).toEqual([
      expect.objectContaining({
        workId: claimed.meta.id,
        title: "Claimed Status Task",
        agentId: "status-agent",
        expiresAt: "2000-01-01T00:00:00.000Z"
      })
    ]);
    expect(status.topBlockers[0]).toEqual(
      expect.objectContaining({
        workId: blocker.meta.id,
        title: "Shared Status Blocker",
        blocksCount: 2
      })
    );
    expect(status.staleClaims).toEqual([
      {
        workId: claimed.meta.id,
        agentId: "status-agent",
        expiresAt: "2000-01-01T00:00:00.000Z"
      }
    ]);

    const human = (await runCli(rootDir, ["sprint", "status", sprint.meta.id])).stdout;
    expect(human).toContain("Sprint status: Sprint Status Fixture");
    expect(human).toContain("Counts");
    expect(human).toContain("Reservations");
    expect(human).toContain("Top blockers");
    expect(human).toContain("Stale claims");
    expect(human).toContain("status-agent");
    expect(human).toContain("Shared Status Blocker");
  });
});

async function createTestWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-sprint-status-"));
  tempDirs.push(rootDir);
  return rootDir;
}

async function createWork(rootDir: string, title: string, kind: string): Promise<CreatedWork> {
  return parseData<CreatedWork>((await runCli(rootDir, ["work", "create", title, "--kind", kind, "--ready", "--json"])).stdout);
}

async function setReservationExpiresAt(rootDir: string, reservationId: string, expiresAt: string): Promise<void> {
  const statePath = join(rootDir, ".boreal/runtime/state.json");
  if (!existsSync(statePath)) {
    const objectPath = join(rootDir, ".boreal/objects/reservations", `${reservationId}.json`);
    const reservation = parseJson<{ readonly meta: { readonly id: string }; readonly [key: string]: unknown }>(
      await readFile(objectPath, "utf8")
    );
    await writeFile(objectPath, `${JSON.stringify(withContentHash({ ...reservation, expiresAt }))}\n`, "utf8");
    return;
  }
  const state = parseJson<{
    readonly reservations: Array<{ readonly meta: { readonly id: string }; readonly [key: string]: unknown }>;
    readonly [key: string]: unknown;
  }>(await readFile(statePath, "utf8"));
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        ...state,
        reservations: state.reservations.map((reservation) =>
          reservation.meta.id === reservationId ? { ...reservation, expiresAt } : reservation
        )
      },
      null,
      2
    )}\n`,
    "utf8"
  );
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
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}
