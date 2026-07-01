import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import { createResultSpoolingOutput, formatRecord, type CliOutput } from "../../apps/cli/src/output.ts";
import { AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION, assertAgentDirectiveBundle, type AgentDirectiveBundle } from "@boreal/core";

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
    const legacyData = parseLegacyData<{ readonly id: string; readonly title: string }>(shown.stdout);
    const bundle = envelope.agentDirectives?.[0];

    expect(shown.exitCode).toBe(0);
    expect(Object.keys(envelope)).toEqual(["ok", "data", "agentDirectives"]);
    expect(envelope.data).toEqual(expect.objectContaining({ id: created.data.meta.id, title: "Directive envelope target" }));
    expect(legacyData).toEqual(envelope.data);
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

  it("keeps non-directive JSON command envelopes compatible with existing data consumers", async () => {
    const rootDir = await makeTempWorkspace();
    const initialized = parseEnvelope<{ readonly initialized: boolean; readonly workspaceRoot: string }>(
      (await runCli(rootDir, ["init", "--json"])).stdout
    );
    const created = await runCli(rootDir, ["work", "create", "Non directive command target", "--ready", "--json"]);
    const createdEnvelope = parseEnvelope<{ readonly meta: { readonly id: string }; readonly title: string }>(created.stdout);
    const legacyData = parseLegacyData<{ readonly meta: { readonly id: string }; readonly title: string }>(created.stdout);

    expect(Object.keys(initialized)).toEqual(["ok", "data"]);
    expect(initialized.agentDirectives).toBeUndefined();
    expect(initialized.data.initialized).toBe(true);
    expect(Object.keys(createdEnvelope)).toEqual(["ok", "data"]);
    expect(createdEnvelope.agentDirectives).toBeUndefined();
    expect(createdEnvelope.data.title).toBe("Non directive command target");
    expect(legacyData).toEqual(createdEnvelope.data);
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

  it("keeps directive bundles in spooled results and previews directive obligations", async () => {
    const rootDir = await makeTempWorkspace();
    const bundle = agentDirectiveBundleFixture();
    const largeData = Array.from({ length: 40 }, (_, index) => ({
      title: `Spooled directive result ${index}`,
      body: "x".repeat(500)
    }));
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
    const spoolingOutput = createResultSpoolingOutput(output, {
      workspaceRoot: rootDir,
      command: "agent finish",
      maxResultSizeChars: 1_000
    });

    spoolingOutput.write(formatRecord(largeData, true, { agentDirectives: [bundle] }));
    await spoolingOutput.flush();

    const payload = parseEnvelope<{
      readonly truncated: boolean;
      readonly command: string;
      readonly fullResultPath: string;
      readonly preview: {
        readonly data: { readonly kind: string; readonly length: number };
        readonly agentDirectives: {
          readonly bundleCount: number;
          readonly bundles: readonly Array<{
            readonly meta: {
              readonly schemaVersion: string;
              readonly registryVersion: string;
              readonly commandPath: string;
              readonly envelopeSchema: string;
            };
            readonly directiveCount: number;
            readonly directives: readonly Array<{
              readonly registryId: string;
              readonly severity: string;
              readonly instruction: string;
              readonly blocksCloseout?: boolean;
              readonly acknowledgement?: { readonly requiredBefore: string; readonly message: string };
              readonly data: unknown;
            }>;
            readonly missingRequiredCount: number;
            readonly missingRequired: readonly unknown[];
          }>;
        };
      };
    }>(stdout).data;

    expect(stderr).toBe("");
    expect(payload.truncated).toBe(true);
    expect(payload.command).toBe("agent finish");
    expect(payload.preview.data).toEqual(expect.objectContaining({ kind: "array", length: 40 }));
    expect(payload.preview.agentDirectives.bundleCount).toBe(1);
    expect(payload.preview.agentDirectives.bundles[0]).toEqual(
      expect.objectContaining({
        meta: expect.objectContaining({
          schemaVersion: "boreal.agent-directives.v1",
          registryVersion: "directives.v1",
          commandPath: "agent finish",
          envelopeSchema: "boreal.cli.agent.finish.v1"
        }),
        directiveCount: 1,
        missingRequiredCount: 0,
        missingRequired: []
      })
    );
    expect(payload.preview.agentDirectives.bundles[0]?.directives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registryId: "closeout.summary-required",
          severity: "required",
          instruction: "Respond to the user with the verified closeout summary in your own words.",
          blocksCloseout: true,
          acknowledgement: expect.objectContaining({
            requiredBefore: "close",
            message: "A final user-facing closeout summary is required before close."
          }),
          data: expect.objectContaining({
            workId: "bw_work_deadbeefdead",
            summaryUri: "memory://agent-summaries/works/bw_work_deadbeefdead/bw_summary_deadbeefdead.md"
          })
        })
      ])
    );

    const fullResult = parseEnvelope<readonly { readonly title: string }[]>(
      await readFile(join(rootDir, payload.fullResultPath), "utf8")
    );
    const legacyFullResultData = parseLegacyData<readonly { readonly title: string }[]>(
      await readFile(join(rootDir, payload.fullResultPath), "utf8")
    );
    expect(fullResult.data).toHaveLength(40);
    expect(legacyFullResultData).toEqual(fullResult.data);
    expect(fullResult.agentDirectives).toEqual([bundle]);
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

function parseLegacyData<T>(text: string): T {
  return (JSON.parse(text) as { readonly data: T }).data;
}

function registryIds(agentDirectives: readonly AgentDirectiveBundle[] | undefined): readonly string[] {
  return agentDirectives?.flatMap((bundle) => bundle.directives.map((directive) => directive.registryId)) ?? [];
}

function agentDirectiveBundleFixture(): AgentDirectiveBundle {
  return {
    meta: {
      id: "bundle.closeout-summary",
      schemaVersion: AGENT_DIRECTIVE_BUNDLE_SCHEMA_VERSION,
      registryVersion: "directives.v1",
      generatedAt: "2026-01-01T00:00:00.000Z",
      commandPath: "agent finish",
      envelopeSchema: "boreal.cli.agent.finish.v1"
    },
    directives: [
      {
        id: "closeout.summary-required",
        registryId: "closeout.summary-required",
        version: "v1",
        family: "closeout",
        severity: "required",
        audience: "agent",
        kind: "summary",
        lifecycle: "active",
        title: "Respond with closeout summary",
        instruction: "Respond to the user with the verified closeout summary in your own words.",
        data: {
          workId: "bw_work_deadbeefdead",
          summaryUri: "memory://agent-summaries/works/bw_work_deadbeefdead/bw_summary_deadbeefdead.md"
        },
        source: {
          registryVersion: "directives.v1",
          registryPath: "packages/core/src/agent-directive-registry.ts",
          selectedBy: ["closeout.final-summary"],
          snapshotHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        subject: {
          type: "work",
          id: "bw_work_deadbeefdead",
          title: "Close work"
        },
        appliesTo: {
          commandPaths: ["agent finish", "work close"],
          subjectTypes: ["work"],
          workStatuses: ["in_progress"]
        },
        blocksCloseout: true,
        acknowledgement: {
          requiredBefore: "close",
          evidenceKind: "note",
          message: "A final user-facing closeout summary is required before close."
        }
      }
    ],
    conflicts: [],
    deprecations: [],
    missingRequired: []
  } as AgentDirectiveBundle;
}
