import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

interface CliErrorEnvelope {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

interface RuntimeWorkItemForDirectiveTest {
  readonly meta: { readonly id: string; readonly [key: string]: unknown };
  readonly requiredCloseoutGates?: readonly Array<{
    readonly id: string;
    readonly satisfiedBy?: Record<string, unknown>;
    readonly [key: string]: unknown;
  }>;
  readonly [key: string]: unknown;
}

interface RuntimeStateForDirectiveTest {
  readonly workItems: readonly RuntimeWorkItemForDirectiveTest[];
  readonly [key: string]: unknown;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI agent directive envelopes", () => {
  it("lists and shows trusted directive registry entries", async () => {
    const rootDir = await makeTempWorkspace();

    const listed = parseEnvelope<{
      readonly schemaVersion: string;
      readonly registryVersion: string;
      readonly sourcePath: string;
      readonly filters: Record<string, never>;
      readonly families: readonly Array<{ readonly family: string; readonly total: number; readonly active: number }>;
      readonly directives: readonly Array<{
        readonly id: string;
        readonly family: string;
        readonly status: string;
        readonly lifecycle: string;
        readonly title: string;
        readonly deprecatedBy: readonly string[];
      }>;
    }>((await runCli(rootDir, ["directives", "list", "--json"])).stdout);
    const activeCloseout = parseEnvelope<{
      readonly filters: { readonly family: string; readonly status: string };
      readonly directives: readonly Array<{ readonly id: string; readonly family: string; readonly status: string }>;
    }>((await runCli(rootDir, ["directives", "list", "--family", "closeout", "--status", "active", "--json"])).stdout);
    const removed = parseEnvelope<{
      readonly filters: { readonly status: string };
      readonly directives: readonly unknown[];
    }>((await runCli(rootDir, ["directives", "list", "--status", "removed", "--json"])).stdout);
    const shown = parseEnvelope<{
      readonly schemaVersion: string;
      readonly directive: {
        readonly id: string;
        readonly family: string;
        readonly status: string;
        readonly instruction: string;
        readonly dataRequirements: readonly Array<{ readonly key: string; readonly required: boolean }>;
        readonly replacementMetadata: {
          readonly status: string;
          readonly removed: boolean;
          readonly supersedes: readonly string[];
          readonly deprecatedBy: readonly string[];
        };
      };
    }>((await runCli(rootDir, ["directives", "show", "closeout.summary-required", "--json"])).stdout);

    expect(Object.keys(listed)).toEqual(["ok", "data"]);
    expect(listed.agentDirectives).toBeUndefined();
    expect(listed.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.directives.list.v1",
        registryVersion: "directives.v1",
        sourcePath: "packages/core/src/agent-directive-registry.ts"
      })
    );
    expect(listed.data.directives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "closeout.summary-required",
          family: "closeout",
          status: "active",
          lifecycle: "active"
        })
      ])
    );
    expect(listed.data.families).toEqual(
      expect.arrayContaining([expect.objectContaining({ family: "closeout", total: expect.any(Number), active: expect.any(Number) })])
    );
    expect(activeCloseout.data.filters).toEqual({ family: "closeout", status: "active" });
    expect(activeCloseout.data.directives.length).toBeGreaterThan(0);
    expect(activeCloseout.data.directives.every((directive) => directive.family === "closeout" && directive.status === "active")).toBe(true);
    expect(removed.data.filters).toEqual({ status: "removed" });
    expect(removed.data.directives).toEqual([]);
    expect(shown.data.schemaVersion).toBe("boreal.cli.directives.show.v1");
    expect(shown.data.directive).toEqual(
      expect.objectContaining({
        id: "closeout.summary-required",
        family: "closeout",
        status: "active",
        replacementMetadata: {
          status: "active",
          removed: false,
          supersedes: [],
          deprecatedBy: []
        }
      })
    );
    expect(shown.data.directive.instruction).toContain("Respond to the user");
    expect(shown.data.directive.dataRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "summaryId", required: true }),
        expect.objectContaining({ key: "summaryUri", required: true }),
        expect.objectContaining({ key: "evidenceIds", required: true })
      ])
    );
  });

  it("records and exposes durable directive acknowledgements", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const work = parseEnvelope<{
      readonly meta: { readonly id: string };
      readonly title: string;
    }>(
      (await runCli(rootDir, ["work", "create", "Directive acknowledgement CLI target", "--ready", "--json"])).stdout
    );
    const evidence = parseEnvelope<{
      readonly meta: { readonly id: string };
    }>(
      (
        await runCli(rootDir, [
          "evidence",
          "add",
          work.data.meta.id,
          "--summary",
          "Directive acknowledgement proof.",
          "--kind",
          "note",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );

    const created = parseEnvelope<{
      readonly schemaVersion: string;
      readonly created: boolean;
      readonly acknowledgement: {
        readonly meta: { readonly id: string };
        readonly directiveId: string;
        readonly directiveRegistryId: string;
        readonly outcome: string;
        readonly subjectType: string;
        readonly subjectId: string;
        readonly evidenceIds: readonly string[];
        readonly reason: string;
        readonly bundleSource: {
          readonly bundleId: string;
          readonly registryVersion: string;
          readonly commandPath: string;
          readonly envelopeSchema: string;
          readonly sourceSnapshotHash: string;
          readonly generatedAt: string;
        };
      };
      readonly event: { readonly type: string; readonly subjectId: string };
    }>(
      (
        await runCli(rootDir, [
          "directives",
          "ack",
          "create",
          "directive.closeout.summary-required.deadbeefdead",
          "--registry-id",
          "closeout.summary-required",
          "--outcome",
          "satisfied",
          "--subject-type",
          "work",
          "--subject-id",
          work.data.meta.id,
          "--command",
          "agent finish",
          "--bundle-id",
          "bundle.agent.finish.deadbeefdead",
          "--registry-version",
          "directives.v1",
          "--envelope-schema",
          "boreal.cli.agent.finish.v1",
          "--source-hash",
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "--generated-at",
          "2026-01-01T00:00:00.000Z",
          "--evidence",
          evidence.data.meta.id,
          "--reason",
          "Responded to the user with a closeout summary.",
          "--json"
        ])
      ).stdout
    );

    expect(created.agentDirectives).toBeUndefined();
    expect(created.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.directives.ack.create.v1",
        created: true
      })
    );
    expect(created.data.acknowledgement).toEqual(
      expect.objectContaining({
        directiveId: "directive.closeout.summary-required.deadbeefdead",
        directiveRegistryId: "closeout.summary-required",
        outcome: "satisfied",
        subjectType: "work",
        subjectId: work.data.meta.id,
        evidenceIds: [evidence.data.meta.id],
        reason: "Responded to the user with a closeout summary.",
        bundleSource: expect.objectContaining({
          bundleId: "bundle.agent.finish.deadbeefdead",
          registryVersion: "directives.v1",
          commandPath: "agent finish",
          envelopeSchema: "boreal.cli.agent.finish.v1",
          sourceSnapshotHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          generatedAt: "2026-01-01T00:00:00.000Z"
        })
      })
    );
    expect(created.data.event).toEqual(
      expect.objectContaining({
        type: "directive_acknowledgement.created",
        subjectId: created.data.acknowledgement.meta.id
      })
    );

    const listed = parseEnvelope<{
      readonly schemaVersion: string;
      readonly filters: { readonly subjectId: string; readonly outcome: string };
      readonly acknowledgements: readonly Array<{ readonly meta: { readonly id: string }; readonly outcome: string }>;
    }>(
      (
        await runCli(rootDir, [
          "directives",
          "ack",
          "list",
          "--subject-id",
          work.data.meta.id,
          "--outcome",
          "satisfied",
          "--json"
        ])
      ).stdout
    );
    expect(listed.data.schemaVersion).toBe("boreal.cli.directives.ack.list.v1");
    expect(listed.data.filters).toEqual({ subjectId: work.data.meta.id, outcome: "satisfied" });
    expect(listed.data.acknowledgements).toEqual([
      expect.objectContaining({
        meta: expect.objectContaining({ id: created.data.acknowledgement.meta.id }),
        outcome: "satisfied"
      })
    ]);

    const shown = parseEnvelope<{
      readonly schemaVersion: string;
      readonly acknowledgement: { readonly meta: { readonly id: string }; readonly subjectId: string };
    }>(
      (
        await runCli(rootDir, ["directives", "ack", "show", created.data.acknowledgement.meta.id, "--json"])
      ).stdout
    );
    expect(shown.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.directives.ack.show.v1",
        acknowledgement: expect.objectContaining({
          meta: expect.objectContaining({ id: created.data.acknowledgement.meta.id }),
          subjectId: work.data.meta.id
        })
      })
    );

    const missingReason = await runCli(rootDir, [
      "directives",
      "ack",
      "create",
      "directive.blocked.resolve-blockers.deadbeefdead",
      "--registry-id",
      "blocked.resolve-blockers",
      "--outcome",
      "deferred",
      "--subject-type",
      "work",
      "--subject-id",
      work.data.meta.id,
      "--command",
      "work show",
      "--json"
    ]);
    expect(missingReason.exitCode).toBe(2);
    expect(parseErrorEnvelope(missingReason.stderr)).toEqual(
      expect.objectContaining({
        ok: false,
        code: "BOREAL_INVALID_INPUT",
        message: "Deferred, noncompliant, and not-applicable acknowledgements require --reason or --reason-code"
      })
    );
  });

  it("compiles, renders, and explains directive debug bundles", async () => {
    const rootDir = await makeTempWorkspace();

    const compiled = parseEnvelope<{
      readonly schemaVersion: string;
      readonly fixture: string;
      readonly commandPath: string;
      readonly selectedRegistryIds: readonly string[];
      readonly selections: readonly Array<{ readonly registryId: string; readonly selectedBy: readonly string[] }>;
      readonly bundle: AgentDirectiveBundle;
    }>((await runCli(rootDir, ["directives", "compile", "--fixture", "blocked-work", "--json"])).stdout);
    const rendered = parseEnvelope<{
      readonly schemaVersion: string;
      readonly fixture: string;
      readonly format: string;
      readonly content: string;
      readonly compile: { readonly bundle: AgentDirectiveBundle };
    }>((await runCli(rootDir, ["directives", "render", "--fixture", "doctor-recovery", "--json"])).stdout);
    const explained = parseEnvelope<{
      readonly schemaVersion: string;
      readonly directiveId: string;
      readonly selected: boolean;
      readonly emitted: boolean;
      readonly selectedBy: readonly string[];
      readonly selectorChecks: { readonly commandMatches: boolean; readonly subjectTypeMatches: boolean; readonly workStatusMatches: boolean };
    }>((await runCli(rootDir, ["directives", "explain", "blocked.resolve-blockers", "--fixture", "blocked-work", "--json"])).stdout);
    const custom = parseEnvelope<{
      readonly schemaVersion: string;
      readonly commandPath: string;
      readonly selectedRegistryIds: readonly string[];
      readonly bundle: AgentDirectiveBundle;
    }>(
      (
        await runCli(rootDir, [
          "directives",
          "compile",
          "--command",
          "work show",
          "--subject-type",
          "work",
          "--subject-id",
          "bw_work_custom0000001",
          "--subject-title",
          "Custom blocked work",
          "--status",
          "blocked",
          "--active-blocker",
          "bw_work_blocker000001",
          "--json"
        ])
      ).stdout
    );

    expect(Object.keys(compiled)).toEqual(["ok", "data"]);
    expect(compiled.agentDirectives).toBeUndefined();
    expect(compiled.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.directives.compile.v1",
        fixture: "blocked-work",
        commandPath: "work show"
      })
    );
    expect(compiled.data.selectedRegistryIds).toEqual(
      expect.arrayContaining(["blocked.resolve-blockers", "workflow_next.canonical-next-step"])
    );
    expect(compiled.data.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registryId: "blocked.resolve-blockers",
          selectedBy: expect.arrayContaining(["applies.command_path", "applies.subject_type", "applies.work_status"])
        })
      ])
    );
    expect(compiled.data.bundle.directives.map((directive) => directive.registryId)).toEqual(
      expect.arrayContaining(["blocked.resolve-blockers", "workflow_next.canonical-next-step"])
    );
    expect(() => assertAgentDirectiveBundle(compiled.data.bundle)).not.toThrow();

    expect(rendered.data.schemaVersion).toBe("boreal.cli.directives.render.v1");
    expect(rendered.data.fixture).toBe("doctor-recovery");
    expect(rendered.data.format).toBe("markdown");
    expect(rendered.data.content).toContain("doctor.recovery-required");
    expect(() => assertAgentDirectiveBundle(rendered.data.compile.bundle)).not.toThrow();

    expect(explained.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.directives.explain.v1",
        directiveId: "blocked.resolve-blockers",
        selected: true,
        emitted: true
      })
    );
    expect(explained.data.selectedBy).toEqual(
      expect.arrayContaining(["applies.command_path", "applies.subject_type", "applies.work_status"])
    );
    expect(explained.data.selectorChecks).toEqual(
      expect.objectContaining({
        commandMatches: true,
        subjectTypeMatches: true,
        workStatusMatches: true
      })
    );

    expect(custom.data.schemaVersion).toBe("boreal.cli.directives.compile.v1");
    expect(custom.data.commandPath).toBe("work show");
    expect(custom.data.selectedRegistryIds).toContain("blocked.resolve-blockers");
    expect(() => assertAgentDirectiveBundle(custom.data.bundle)).not.toThrow();
  });

  it("surfaces missing required directive data from CLI debug compilation", async () => {
    const rootDir = await makeTempWorkspace();

    const compiled = parseEnvelope<{
      readonly schemaVersion: string;
      readonly commandPath: string;
      readonly selectedRegistryIds: readonly string[];
      readonly issueCount: number;
      readonly missingRequired: readonly Array<{
        readonly registryId: string;
        readonly requirement: string;
        readonly message: string;
      }>;
      readonly bundle?: AgentDirectiveBundle;
    }>(
      (
        await runCli(rootDir, [
          "directives",
          "compile",
          "--command",
          "agent finish",
          "--subject-type",
          "work",
          "--subject-id",
          "bw_work_missingreq000001",
          "--subject-title",
          "Missing directive closeout data",
          "--status",
          "closed",
          "--json"
        ])
      ).stdout
    );

    expect(compiled.data.schemaVersion).toBe("boreal.cli.directives.compile.v1");
    expect(compiled.data.commandPath).toBe("agent finish");
    expect(compiled.data.selectedRegistryIds).toEqual(
      expect.arrayContaining(["closeout.summary-required", "git.checkpoint-required"])
    );
    expect(compiled.data.missingRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registryId: "closeout.summary-required",
          requirement: "summaryId",
          message: "missing required directive data"
        }),
        expect.objectContaining({
          registryId: "handoff.session-summary",
          requirement: "summaryUri",
          message: "missing required directive data"
        })
      ])
    );
    expect(compiled.data.issueCount).toBeGreaterThan(0);
    expect(compiled.data.bundle?.missingRequired).toEqual(compiled.data.missingRequired);
    expect(compiled.data.bundle?.directives.map((directive) => directive.registryId)).toEqual(
      expect.arrayContaining(["git.checkpoint-required", "workflow_next.canonical-next-step"])
    );
    expect(() => assertAgentDirectiveBundle(compiled.data.bundle)).not.toThrow();
  });

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
    const doctor = parseEnvelope<{
      readonly ok: boolean;
      readonly diagnostics: readonly Array<{
        readonly code: string;
        readonly severity: string;
        readonly details?: {
          readonly checkedBundles?: number;
          readonly issueCounts?: Record<string, number>;
        };
      }>;
    }>(
      (await runCli(rootDir, ["doctor", "--strict", "--json"])).stdout
    );
    const directiveRegistryDiagnostic = doctor.data.diagnostics.find(
      (diagnostic) => diagnostic.code === "agent_directives.registry"
    );
    const directiveBundleDiagnostic = doctor.data.diagnostics.find(
      (diagnostic) => diagnostic.code === "agent_directives.emitted_bundles"
    );

    expect(refresh.data.postRefreshStatusOk).toBe(true);
    expect(doctor.data.ok).toBe(true);
    expect(directiveRegistryDiagnostic).toEqual(
      expect.objectContaining({
        severity: "ok"
      })
    );
    expect(directiveBundleDiagnostic).toEqual(
      expect.objectContaining({
        severity: "ok"
      })
    );
    expect(directiveBundleDiagnostic?.details?.checkedBundles).toBeGreaterThan(0);
    expect(directiveBundleDiagnostic?.details?.issueCounts).toEqual(
      expect.objectContaining({
        unknown_id: 0,
        deprecated_emission: 0,
        duplicate_id: 0,
        invalid_data: 0,
        unsafe_dynamic_instruction: 0,
        stale_registry_version: 0,
        missing_required_directive: 0,
        conflict: 0
      })
    );
    expect(registryIds(refresh.agentDirectives)).not.toContain("memory.reconcile-source");
    expect(refresh.agentDirectives?.[0]?.missingRequired).toEqual([]);
    expect(registryIds(doctor.agentDirectives)).not.toContain("doctor.recovery-required");
    expect(doctor.agentDirectives?.[0]?.missingRequired).toEqual([]);
    expect(doctor.agentDirectives?.[0]?.conflicts).toEqual([]);
  });

  it("fails doctor and closeout gates on invalid directive-linked closeout metadata", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, [
      "init",
      "--setup-memory",
      "--memory-root",
      "memory",
      "--memory-layout",
      "in-repo",
      "--memory-git-mode",
      "shared",
      "--json"
    ]);
    const created = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Invalid directive-linked gate",
          "--required-gate",
          "review",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await updateRuntimeState(rootDir, (state) => ({
      ...state,
      workItems: state.workItems.map((work) =>
        work.meta.id === created.data.meta.id
          ? {
              ...work,
              requiredCloseoutGates: (work.requiredCloseoutGates ?? []).map((gate, index) =>
                index === 0
                  ? {
                      ...gate,
                      satisfiedBy: {
                        ...(gate.satisfiedBy ?? {}),
                        directiveIds: ["bad directive id"]
                      }
                    }
                  : gate
              )
            }
          : work
      )
    }));

    const doctorResult = await runCli(rootDir, ["doctor", "--strict", "--json"]);
    const doctorError = parseErrorEnvelope(doctorResult.stderr);

    expect(doctorResult.exitCode).not.toBe(0);
    expect(doctorResult.stdout).toBe("");
    expect(doctorError.ok).toBe(false);
    expect(JSON.stringify(doctorError)).toContain(".directiveIds[0]");

    const gateResult = await runCli(rootDir, ["gate", "closeout", "--strict", "--json"]);
    const gateError = parseErrorEnvelope(gateResult.stderr);

    expect(gateResult.exitCode).not.toBe(0);
    expect(gateResult.stdout).toBe("");
    expect(gateError.ok).toBe(false);
    expect(JSON.stringify(gateError)).toContain(".directiveIds[0]");
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

function parseErrorEnvelope(text: string): CliErrorEnvelope {
  return JSON.parse(text) as CliErrorEnvelope;
}

function parseLegacyData<T>(text: string): T {
  return (JSON.parse(text) as { readonly data: T }).data;
}

function registryIds(agentDirectives: readonly AgentDirectiveBundle[] | undefined): readonly string[] {
  return agentDirectives?.flatMap((bundle) => bundle.directives.map((directive) => directive.registryId)) ?? [];
}

async function updateRuntimeState(
  rootDir: string,
  update: (state: RuntimeStateForDirectiveTest) => RuntimeStateForDirectiveTest
): Promise<void> {
  const statePath = join(rootDir, ".boreal/runtime/state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as RuntimeStateForDirectiveTest;
  await writeFile(statePath, `${JSON.stringify(update(state), null, 2)}\n`, "utf8");
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
