import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDaemonWatchOnce } from "@boreal/daemon";
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
}

interface ReservationPayload {
  readonly reservationId: string;
  readonly reservation: {
    readonly meta: { readonly id: string };
    readonly workId: string;
    readonly agentId: string;
    readonly expiresAt?: string;
  };
}

interface ReservationRow {
  readonly id: string;
  readonly workId: string;
  readonly agentId: string;
  readonly expiresAt?: string;
}

interface AgentRenewPayload {
  readonly schemaVersion: string;
  readonly agentId: string;
  readonly extend: string;
  readonly expiresAt: string;
  readonly renewed: readonly Array<{
    readonly workId: string;
    readonly reservationId: string;
    readonly expiresAt: string;
    readonly previousExpiresAt?: string;
  }>;
  readonly skipped: readonly unknown[];
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent renew --all", () => {
  it("renews all active reservations for one agent without touching other agents", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const first = await createWork(rootDir, "Renew all first");
    const second = await createWork(rootDir, "Renew all second");
    const other = await createWork(rootDir, "Renew all other");
    const firstReservation = await reserve(rootDir, first.meta.id, "agent-x", "5m");
    const secondReservation = await reserve(rootDir, second.meta.id, "agent-x", "5m");
    const otherReservation = await reserve(rootDir, other.meta.id, "agent-y", "5m");

    const renewed = parseData<AgentRenewPayload>(
      (await runCli(rootDir, ["agent", "renew", "--all", "--agent", "agent-x", "--extend", "30m", "--json"])).stdout
    );

    expect(renewed.schemaVersion).toBe("boreal.cli.agent.renew.v1");
    expect(renewed.agentId).toBe("agent-x");
    expect(renewed.extend).toBe("30m");
    expect(renewed.skipped).toEqual([]);
    expect(renewed.renewed.map((row) => row.reservationId).sort()).toEqual(
      [firstReservation.reservationId, secondReservation.reservationId].sort()
    );
    expect(renewed.renewed.map((row) => row.expiresAt)).toEqual([renewed.expiresAt, renewed.expiresAt]);
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(String(firstReservation.reservation.expiresAt)));

    const otherRows = parseData<ReservationRow[]>(
      (await runCli(rootDir, ["reservation", "list", "--agent", "agent-y", "--status", "active", "--json"])).stdout
    );
    expect(otherRows).toEqual([
      expect.objectContaining({
        id: otherReservation.reservationId,
        workId: other.meta.id,
        agentId: "agent-y",
        expiresAt: otherReservation.reservation.expiresAt
      })
    ]);
  });

  it("rejects unsupported extension durations", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const result = await runCli(rootDir, ["agent", "renew", "--all", "--agent", "agent-x", "--extend", "fortnight", "--json"], {
      expectFailure: true
    });

    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      code: "BOREAL_INVALID_INPUT",
      message: "--extend must be a positive duration like 30m or 2h"
    });
  });

  it("renews near-expiry reservations during daemon watch", async () => {
    const rootDir = await createTestWorkspace();
    const registryRoot = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const nearWork = await createWork(rootDir, "Daemon near expiry");
    const farWork = await createWork(rootDir, "Daemon far expiry");
    const nearReservation = await reserve(rootDir, nearWork.meta.id, "daemon-agent", "1h");
    const farReservation = await reserve(rootDir, farWork.meta.id, "far-agent", "2h");
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const nearExpiry = new Date(nowMs + 30_000).toISOString();
    await runCli(rootDir, ["work", "renew", nearWork.meta.id, "--expires-at", nearExpiry, "--json"]);

    const watch = await runDaemonWatchOnce({
      workspaceRoot: rootDir,
      registryRoot,
      now: () => now
    });

    expect(watch.action).toBe("observed");
    expect(watch.reservationRenewals.renewed).toEqual([
      expect.objectContaining({
        workId: nearWork.meta.id,
        reservationId: nearReservation.reservationId,
        agentId: "daemon-agent",
        previousExpiresAt: nearExpiry
      })
    ]);
    expect(watch.reservationRenewals.skipped).toEqual([]);
    expect(Date.parse(watch.reservationRenewals.renewed[0]?.expiresAt ?? "")).toBeGreaterThan(Date.parse(nearExpiry));

    const farRows = parseData<ReservationRow[]>(
      (await runCli(rootDir, ["reservation", "list", "--agent", "far-agent", "--status", "active", "--json"])).stdout
    );
    expect(farRows).toEqual([
      expect.objectContaining({
        id: farReservation.reservationId,
        workId: farWork.meta.id,
        expiresAt: farReservation.reservation.expiresAt
      })
    ]);
  });
});

async function createTestWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-agent-renew-all-"));
  tempDirs.push(rootDir);
  return rootDir;
}

async function createWork(rootDir: string, title: string): Promise<CreatedWork> {
  return parseData<CreatedWork>((await runCli(rootDir, ["work", "create", title, "--ready", "--json"])).stdout);
}

async function reserve(rootDir: string, workId: string, agentId: string, ttl: string): Promise<ReservationPayload> {
  return parseData<ReservationPayload>(
    (await runCli(rootDir, ["work", "reserve", workId, "--agent", agentId, "--ttl", ttl, "--json"])).stdout
  );
}

async function runCli(
  cwd: string,
  argv: readonly string[],
  options: { readonly expectFailure?: boolean } = {}
): Promise<CommandRun> {
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
  if (options.expectFailure) {
    expect(exitCode).not.toBe(0);
    expect(stderr).not.toBe("");
  } else {
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }
  return { exitCode, stdout, stderr };
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}
