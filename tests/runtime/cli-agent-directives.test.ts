import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import { assertAgentDirectiveBundle, type AgentDirectiveBundle } from "@boreal/core";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CliEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly agentDirectives?: readonly AgentDirectiveBundle[];
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI agent directive envelopes", () => {
  it("adds validated agentDirectives to directive-aware JSON output without changing data", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const created = parseEnvelope<{ readonly meta: { readonly id: string }; readonly title: string }>(
      (await runCli(rootDir, ["work", "create", "Directive envelope target", "--label", "agent-directives", "--ready", "--json"])).stdout
    );

    const shown = await runCli(rootDir, ["work", "show", created.data.meta.id, "--json"]);
    const envelope = parseEnvelope<{ readonly id: string; readonly title: string }>(shown.stdout);
    const bundle = envelope.agentDirectives?.[0];

    expect(shown.exitCode).toBe(0);
    expect(envelope.data).toEqual(expect.objectContaining({ id: created.data.meta.id, title: "Directive envelope target" }));
    expect(envelope.data).not.toHaveProperty("agentDirectives");
    expect(bundle).toBeDefined();
    expect(bundle?.meta).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.agent-directives.v1",
        registryVersion: "directives.v1",
        commandPath: "work show",
        envelopeSchema: "boreal.cli.work.show.v1"
      })
    );
    expect(bundle?.directives.map((directive) => directive.registryId)).toContain("workflow_next.canonical-next-step");
    expect(bundle?.conflicts).toEqual(expect.any(Array));
    expect(bundle?.missingRequired).toEqual(expect.any(Array));
    expect(() => assertAgentDirectiveBundle(bundle)).not.toThrow();
  });

  it("exposes blocked-work recovery directives from work show", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const blocker = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Directive blocker", "--ready", "--json"])).stdout
    );
    const blocked = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Directive blocked work", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["dep", "add", blocked.data.meta.id, blocker.data.meta.id, "--json"]);

    const shown = parseEnvelope<{ readonly id: string; readonly status: string }>(
      (await runCli(rootDir, ["work", "show", blocked.data.meta.id, "--json"])).stdout
    );
    const bundle = shown.agentDirectives?.[0];

    expect(shown.data.status).toBe("blocked");
    expect(bundle?.directives.map((directive) => directive.registryId)).toEqual(
      expect.arrayContaining(["blocked.resolve-blockers", "workflow_next.canonical-next-step"])
    );
    expect(bundle?.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolution: "blocking_wins",
          severity: "blocking"
        })
      ])
    );
    expect(() => assertAgentDirectiveBundle(bundle)).not.toThrow();
  });

  it("keeps green health command envelopes free of false recovery instructions", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);

    const refresh = parseEnvelope<{ readonly postRefreshStatusOk: boolean }>(
      (await runCli(rootDir, ["sync", "refresh", "--json"])).stdout
    );
    const doctor = parseEnvelope<{ readonly ok: boolean }>(
      (await runCli(rootDir, ["doctor", "--strict", "--json"])).stdout
    );

    expect(refresh.data.postRefreshStatusOk).toBe(true);
    expect(doctor.data.ok).toBe(true);
    expect(registryIds(refresh.agentDirectives)).not.toContain("memory.reconcile-source");
    expect(refresh.agentDirectives?.[0]?.missingRequired).toEqual([]);
    expect(registryIds(doctor.agentDirectives)).not.toContain("doctor.recovery-required");
    expect(doctor.agentDirectives?.[0]?.missingRequired).toEqual([]);
    expect(doctor.agentDirectives?.[0]?.conflicts).toEqual([]);
  });
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-cli-directives-"));
  tempDirs.push(dir);
  return dir;
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

function parseEnvelope<T>(text: string): CliEnvelope<T> {
  return JSON.parse(text) as CliEnvelope<T>;
}

function registryIds(agentDirectives: readonly AgentDirectiveBundle[] | undefined): readonly string[] {
  return agentDirectives?.flatMap((bundle) => bundle.directives.map((directive) => directive.registryId)) ?? [];
}
