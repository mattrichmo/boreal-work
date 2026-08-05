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
  readonly operationId?: string;
  readonly sessionId?: string;
  readonly phase?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly stateOutcome?: string;
  readonly data: T;
  readonly agentDirectives?: readonly AgentDirectiveBundle[];
}

interface CliErrorEnvelope {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

type NextCommandDirectiveForTest = AgentDirectiveBundle["directives"][number];

interface NextCommandResultForTest {
  readonly schemaVersion: "boreal.cli.next.v1";
  readonly state: "active_reservation" | "ready_work" | "workspace_health" | "idle";
  readonly command?: string;
  readonly displayCommand?: string;
  readonly executableAction?: {
    readonly source: "agent_directive_registry" | "boreal_runtime";
    readonly trust: "trusted";
    readonly runner: "boreal_cli" | "bounded_declared_gate";
    readonly registryId?: string;
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly shell: false;
  };
  readonly directive: NextCommandDirectiveForTest | null;
  readonly selectionKey?: string;
  readonly checked: {
    readonly activeReservationIds: readonly string[];
    readonly expiredActiveReservationIds: readonly string[];
    readonly readyWorkCount: number;
    readonly readyWorkId?: string;
    readonly syncOk: boolean;
  };
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
        readonly payloadFields: readonly Array<{ readonly key: string; readonly required: boolean }>;
        readonly replacementMetadata: {
          readonly status: string;
          readonly removed: boolean;
          readonly supersedes: readonly string[];
          readonly deprecatedBy: readonly string[];
        };
      };
    }>((await runCli(rootDir, ["directives", "show", "closeout.summary-required", "--json"])).stdout);

    expect(Object.keys(listed)).toEqual(["ok", "ledgerSeq", "data"]);
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
    expect(shown.data.directive.payloadFields).toEqual(
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
    const verification = parseEnvelope<{
      readonly meta: { readonly id: string };
    }>(
      (
        await runCli(rootDir, [
          "work",
          "verify",
          work.data.meta.id,
          "--evidence",
          evidence.data.meta.id,
          "--verdict",
          "passed",
          "--notes",
          "Directive acknowledgement verification.",
          "--json"
        ])
      ).stdout
    );
    const artifactUri = `memory://agent-summaries/works/${work.data.meta.id}/bw_summary_ackproof.md`;
    const summary = parseEnvelope<{
      readonly summary: { readonly meta: { readonly id: string }; readonly artifactUri: string };
    }>(
      (
        await runCli(rootDir, [
          "summary",
          "create",
          work.data.meta.id,
          "--body",
          "Directive acknowledgement summary artifact.",
          "--status",
          "final",
          "--outcome",
          "completed",
          "--evidence",
          evidence.data.meta.id,
          "--verification",
          verification.data.meta.id,
          "--artifact-uri",
          artifactUri,
          "--no-render",
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
        readonly agentSummaryIds: readonly string[];
        readonly verificationIds: readonly string[];
        readonly artifactUris: readonly string[];
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
          "--summary",
          summary.data.summary.meta.id,
          "--verification",
          verification.data.meta.id,
          "--artifact-uri",
          artifactUri,
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
        agentSummaryIds: [summary.data.summary.meta.id],
        verificationIds: [verification.data.meta.id],
        artifactUris: [artifactUri],
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

    const missingVerification = await runCli(rootDir, [
      "directives",
      "ack",
      "create",
      "directive.closeout.summary-required.badverification",
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
      "--verification",
      "bw_verification_deadbeef0001",
      "--json"
    ]);
    expect(missingVerification.exitCode).toBe(1);
    expect(parseErrorEnvelope(missingVerification.stderr)).toEqual(
      expect.objectContaining({
        ok: false,
        code: "BOREAL_NOT_FOUND",
        message: "Directive acknowledgement references missing verification"
      })
    );
  });

  it("doctors dangling directive acknowledgement proof links", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const work = parseEnvelope<{
      readonly meta: { readonly id: string };
    }>(
      (await runCli(rootDir, ["work", "create", "Dangling acknowledgement proof target", "--ready", "--json"])).stdout
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
          "Dangling acknowledgement proof seed.",
          "--kind",
          "note",
          "--outcome",
          "passed",
          "--json"
        ])
      ).stdout
    );
    const created = parseEnvelope<{
      readonly acknowledgement: { readonly meta: { readonly id: string } };
    }>(
      (
        await runCli(rootDir, [
          "directives",
          "ack",
          "create",
          "directive.closeout.summary-required.deadbeef0002",
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
          "--evidence",
          evidence.data.meta.id,
          "--json"
        ])
      ).stdout
    );

    await updateRuntimeState(rootDir, (state) => ({
      ...state,
      directiveAcknowledgements: ((state.directiveAcknowledgements as readonly Record<string, unknown>[] | undefined) ?? []).map((record) =>
        (record.meta as { readonly id?: string } | undefined)?.id === created.data.acknowledgement.meta.id
          ? {
              ...record,
              verificationIds: ["bw_verification_deadbeef0001"],
              artifactUris: ["memory://agent-summaries/works/bw_work_deadbeef0001/bw_summary_deadbeef0001.md"],
              handoffIds: ["bw_operation_deadbeef0001"]
            }
          : record
      )
    }));

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    expect(doctor.stderr).toBe("");
    expect(doctor.stdout).not.toBe("");
    const payload = parseEnvelope<{
      readonly ok: boolean;
      readonly diagnostics: readonly Array<{ readonly code: string; readonly severity: string; readonly details?: unknown }>;
    }>(doctor.stdout);
    const diagnostic = (code: string) => payload.data.diagnostics.find((entry) => entry.code === code);
    expect(doctor.exitCode).toBe(1);
    expect(payload.data.ok).toBe(false);
    expect(diagnostic("directive_acknowledgement.dangling_verification")).toEqual(
      expect.objectContaining({
        severity: "error",
        details: expect.arrayContaining([
          expect.objectContaining({
            acknowledgementId: created.data.acknowledgement.meta.id,
            verificationId: "bw_verification_deadbeef0001"
          })
        ])
      })
    );
    expect(diagnostic("directive_acknowledgement.dangling_artifact")).toEqual(
      expect.objectContaining({
        severity: "error",
        details: expect.arrayContaining([
          expect.objectContaining({
            acknowledgementId: created.data.acknowledgement.meta.id,
            artifactUri: "memory://agent-summaries/works/bw_work_deadbeef0001/bw_summary_deadbeef0001.md"
          })
        ])
      })
    );
    expect(diagnostic("directive_acknowledgement.dangling_handoff")).toEqual(
      expect.objectContaining({
        severity: "error",
        details: expect.arrayContaining([
          expect.objectContaining({
            acknowledgementId: created.data.acknowledgement.meta.id,
            handoffId: "bw_operation_deadbeef0001"
          })
        ])
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

    expect(Object.keys(compiled)).toEqual(["ok", "ledgerSeq", "data"]);
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
          selectedBy: expect.arrayContaining(["gap.work.blocked.open-dependency"])
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
      expect.arrayContaining(["gap.work.blocked.open-dependency"])
    );
    expect(explained.data.selectorChecks).toEqual(
      expect.objectContaining({
        lifecycleActive: true,
        matchedTriggerCodes: ["work.blocked.open-dependency"]
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
    expect(compiled.data.selectedRegistryIds).toEqual(expect.arrayContaining(["closeout.summary-required"]));
    expect(compiled.data.missingRequired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registryId: "closeout.summary-required",
          requirement: "summaryId",
          message: "missing required directive data"
        }),
        expect.objectContaining({
          registryId: "closeout.summary-required",
          requirement: "summaryUri",
          message: "missing required directive data"
        })
      ])
    );
    expect(compiled.data.issueCount).toBeGreaterThan(0);
    expect(compiled.data.bundle?.missingRequired).toEqual(compiled.data.missingRequired);
    expect(compiled.data.bundle?.directives.map((directive) => directive.registryId)).toEqual(
      expect.arrayContaining(["workflow_next.canonical-next-step"])
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
    expect(Object.keys(envelope)).toEqual(["ok", "ledgerSeq", "data", "agentDirectives"]);
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

  it("dedupes unchanged directive bundles within one session by source hash", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const created = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Directive dedup target", "--label", "agent-directive-dedup", "--ready", "--json"])).stdout
    );

    const first = parseEnvelope<{ readonly id: string }>(
      (await runCli(rootDir, ["work", "show", created.data.meta.id, "--session", "dedup-session", "--json"])).stdout
    );
    const firstBundle = first.agentDirectives?.[0];
    expect(firstBundle).toBeDefined();
    expect(() => assertAgentDirectiveBundle(firstBundle)).not.toThrow();
    const firstHash = firstBundle?.meta.sourceSnapshotHash;
    expect(firstHash).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const second = JSON.parse(
      (await runCli(rootDir, ["work", "show", created.data.meta.id, "--session", "dedup-session", "--json"])).stdout
    ) as {
      readonly data: { readonly id: string };
      readonly agentDirectives?: readonly AgentDirectiveBundle[] | { readonly unchanged: true; readonly sourceHash: string };
    };
    expect(second.data.id).toBe(created.data.meta.id);
    expect(second.agentDirectives).toEqual({ unchanged: true, sourceHash: firstHash });

    const otherSession = parseEnvelope<{ readonly id: string }>(
      (await runCli(rootDir, ["work", "show", created.data.meta.id, "--session", "other-session", "--json"])).stdout
    );
    expect(otherSession.agentDirectives?.[0]?.meta.sourceSnapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => assertAgentDirectiveBundle(otherSession.agentDirectives?.[0])).not.toThrow();
  });

  it("skips read-only directive sync probes and scopes subject reservations", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const target = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Read-only directive scope target", "--ready", "--json"])).stdout
    );
    const unrelated = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Unrelated reserved work", "--ready", "--json"])).stdout
    );
    const targetReservation = parseEnvelope<{ readonly reservation: { readonly meta: { readonly id: string } } }>(
      (
        await runCli(rootDir, [
          "work",
          "reserve",
          target.data.meta.id,
          "--agent",
          "scope-target-agent",
          "--purpose",
          "subject reservation",
          "--json"
        ])
      ).stdout
    );
    const unrelatedReservation = parseEnvelope<{ readonly reservation: { readonly meta: { readonly id: string } } }>(
      (
        await runCli(rootDir, [
          "work",
          "reserve",
          unrelated.data.meta.id,
          "--agent",
          "scope-unrelated-agent",
          "--purpose",
          "unrelated reservation",
          "--json"
        ])
      ).stdout
    );

    const shown = parseEnvelope<{ readonly id: string }>(
      (await runCli(rootDir, ["work", "show", target.data.meta.id, "--session", "read-only-scope", "--json"])).stdout
    );
    const directives = shown.agentDirectives?.flatMap((bundle) => bundle.directives) ?? [];
    const workflowNext = directives.find((directive) => directive.registryId === "workflow_next.canonical-next-step");
    const activeReservationIds = (workflowNext?.data as { readonly activeReservationIds?: readonly string[] } | undefined)
      ?.activeReservationIds;

    expect(shown.data.id).toBe(target.data.meta.id);
    expect(directives.map((directive) => directive.registryId)).toContain("workflow_next.canonical-next-step");
    expect(directives.map((directive) => directive.registryId)).not.toContain("doctor.recovery-required");
    expect(activeReservationIds).toEqual([targetReservation.data.reservation.meta.id]);
    expect(activeReservationIds).not.toContain(unrelatedReservation.data.reservation.meta.id);
  });

  it("surfaces declared gate directives from work show, work claim, and agent start", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const declaredCommand = "pnpm test --filter declared-directive";
    const expectedObservable = "declared directive passed";
    const createDeclaredWork = async (label: string) =>
      parseEnvelope<{ readonly meta: { readonly id: string } }>(
        (
          await runCli(rootDir, [
            "work",
            "create",
            `Declared directive ${label}`,
            "--label",
            label,
            "--required-gate",
            "verification",
            "--gate-command",
            declaredCommand,
            "--gate-expect",
            expectedObservable,
            "--ready",
            "--json"
          ])
        ).stdout
      );

    const showWork = await createDeclaredWork("declared-show");
    const shown = parseEnvelope<{ readonly id: string }>(
      (await runCli(rootDir, ["work", "show", showWork.data.meta.id, "--json"])).stdout
    );
    expectDeclaredGateDirective(shown.agentDirectives, declaredCommand, expectedObservable);

    await createDeclaredWork("declared-claim");
    const claimed = parseEnvelope<{ readonly claimed: boolean }>(
      (await runCli(rootDir, ["work", "claim", "--agent", "declared-claim-agent", "--label", "declared-claim", "--json"])).stdout
    );
    expect(claimed.data.claimed).toBe(true);
    expectDeclaredGateDirective(claimed.agentDirectives, declaredCommand, expectedObservable);

    await createDeclaredWork("declared-start");
    const started = parseEnvelope<{ readonly started: boolean; readonly action: string }>(
      (
        await runCli(rootDir, [
          "agent",
          "start",
          "--agent",
          "declared-start-agent",
          "--label",
          "declared-start",
          "--json"
        ])
      ).stdout
    );
    expect(started.data).toEqual(expect.objectContaining({ started: true, action: "claimed_work" }));
    expectDeclaredGateDirective(started.agentDirectives, declaredCommand, expectedObservable);
  });

  it("returns one next directive across ready, active, blocked, and idle states", async () => {
    const readyRoot = await makeTempWorkspace();
    await runCli(readyRoot, ["init", "--json"]);
    await runCli(readyRoot, [
      "work",
      "create",
      "Ready next target",
      "--label",
      "next-ready",
      "--required-gate",
      "verification",
      "--gate-command",
      "echo ready next passed",
      "--gate-expect",
      "ready next passed",
      "--ready",
      "--json"
    ]);
    await runCli(readyRoot, ["vault", "init", "--json"]);
    await runCli(readyRoot, ["sync", "refresh", "--json"]);
    const ready = parseEnvelope<NextCommandResultForTest>(
      (await runCli(readyRoot, ["next", "--agent", "next-agent", "--label", "next-ready", "--json"])).stdout
    );
    const readyDirective = expectSingleNextDirective(ready);
    expect(ready.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.next.v1",
        state: "ready_work",
        command: `bwrk work claim ${ready.data.checked.readyWorkId} --agent next-agent --label next-ready --json`
      })
    );
    expect(readyDirective.registryId).toBe("workflow_next.canonical-next-step");
    expect(ready.data.directive?.registryId).toBe(readyDirective.registryId);

    const readyText = await runCli(readyRoot, ["next", "--agent", "next-agent", "--label", "next-ready"]);
    expect(readyText.stdout.trim().split("\n").at(-1)).toBe(
      `bwrk work claim ${ready.data.checked.readyWorkId} --agent next-agent --label next-ready --json`
    );

    const activeRoot = await makeTempWorkspace();
    await runCli(activeRoot, ["init", "--json"]);
    const declaredCommand = "pnpm test --filter next-active";
    const activeWork = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(activeRoot, [
          "work",
          "create",
          "Active next target",
          "--required-gate",
          "verification",
          "--gate-command",
          declaredCommand,
          "--gate-expect",
          "next active passed",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(activeRoot, ["work", "reserve", activeWork.data.meta.id, "--agent", "next-active", "--json"]);
    await runCli(activeRoot, ["vault", "init", "--json"]);
    await runCli(activeRoot, ["sync", "refresh", "--json"]);
    const active = parseEnvelope<NextCommandResultForTest>(
      (await runCli(activeRoot, ["next", "--agent", "next-active", "--json"])).stdout
    );
    const activeDirective = expectSingleNextDirective(active);
    expect(active.data.state).toBe("active_reservation");
    expect(activeDirective.registryId).toBe("verification.evidence-required");
    const gateId = (activeDirective.data?.gateIds as readonly string[] | undefined)?.[0];
    expect(gateId).toMatch(/^bw_gate_/);
    expect(active.data.displayCommand).toBe(declaredCommand);
    expect(active.data.command).toBe(
      `bwrk evidence run ${activeWork.data.meta.id} --gate ${gateId} --json`
    );
    expect(active.data.executableAction).toEqual({
      source: "agent_directive_registry",
      trust: "trusted",
      runner: "bounded_declared_gate",
      registryId: "verification.evidence-required",
      argv: ["bwrk", "evidence", "run", activeWork.data.meta.id, "--gate", gateId, "--json"],
      cwd: activeRoot,
      shell: false
    });
    expect(active.data.executableAction?.argv.join(" ")).not.toContain(declaredCommand);

    const blockedRoot = await makeTempWorkspace();
    await runCli(blockedRoot, ["init", "--json"]);
    const blocker = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(blockedRoot, ["work", "create", "Blocked next blocker", "--ready", "--json"])).stdout
    );
    const blocked = parseEnvelope<{ readonly meta: { readonly id: string } }>(
      (await runCli(blockedRoot, ["work", "create", "Blocked next target", "--ready", "--json"])).stdout
    );
    await runCli(blockedRoot, ["dep", "add", blocked.data.meta.id, blocker.data.meta.id, "--json"]);
    await runCli(blockedRoot, [
      "work",
      "reserve",
      blocked.data.meta.id,
      "--agent",
      "next-blocked",
      "--force",
      "--reason",
      "next blocked fixture",
      "--json"
    ]);
    await runCli(blockedRoot, ["vault", "init", "--json"]);
    await runCli(blockedRoot, ["sync", "refresh", "--json"]);
    const blockedNext = parseEnvelope<NextCommandResultForTest>(
      (await runCli(blockedRoot, ["next", "--agent", "next-blocked", "--json"])).stdout
    );
    const blockedDirective = expectSingleNextDirective(blockedNext);
    expect(blockedNext.data.state).toBe("active_reservation");
    expect(blockedDirective.registryId).toBe("blocked.resolve-blockers");
    expect(blockedNext.data.command).toBe(`bwrk dep tree ${blocked.data.meta.id} --json`);

    const idleRoot = await makeTempWorkspace();
    await runCli(idleRoot, ["init", "--json"]);
    await runCli(idleRoot, ["vault", "init", "--json"]);
    await runCli(idleRoot, ["sync", "refresh", "--json"]);
    const idle = parseEnvelope<NextCommandResultForTest>(
      (await runCli(idleRoot, ["next", "--agent", "idle-agent", "--json"])).stdout
    );
    expect(idle.agentDirectives).toBeUndefined();
    expect(idle.data).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.next.v1",
        state: "idle",
        directive: null
      })
    );
    expect(idle.data.checked.readyWorkCount).toBe(0);
  }, 30_000);

  it("selects the same next directive on repeat invocation for identical state", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Repeat next target", "--label", "next-repeat", "--ready", "--json"]);
    await runCli(rootDir, ["vault", "init", "--json"]);
    await runCli(rootDir, ["sync", "refresh", "--json"]);

    const first = parseEnvelope<NextCommandResultForTest>(
      (await runCli(rootDir, ["next", "--agent", "repeat-agent", "--label", "next-repeat", "--json"])).stdout
    );
    const second = parseEnvelope<NextCommandResultForTest>(
      (await runCli(rootDir, ["next", "--agent", "repeat-agent", "--label", "next-repeat", "--json"])).stdout
    );

    expect(stableNextSelection(first)).toEqual(stableNextSelection(second));
    expect(expectSingleNextDirective(first).registryId).toBe(expectSingleNextDirective(second).registryId);
  });

  it("terminates seeded next-loop simulations from canonical and randomized states", async () => {
    const readyRoot = await makeTempWorkspace();
    await initializeNextLoopWorkspace(readyRoot);
    await runCli(readyRoot, ["work", "create", "Loop ready target", "--label", "loop-ready", "--ready", "--json"]);
    await runCli(readyRoot, ["sync", "refresh", "--json"]);
    await expect(runNextLoopSimulation(readyRoot, "loop-ready-agent", ["--label", "loop-ready"])).resolves.toEqual(
      expect.objectContaining({ terminal: "closed" })
    );

    const declaredRoot = await makeTempWorkspace();
    await initializeNextLoopWorkspace(declaredRoot);
    await runCli(declaredRoot, [
      "work",
      "create",
      "Loop declared gate target",
      "--label",
      "loop-declared",
      "--required-gate",
      "verification",
      "--gate-command",
      "echo loop declared passed",
      "--gate-expect",
      "loop declared passed",
      "--ready",
      "--json"
    ]);
    await runCli(declaredRoot, ["sync", "refresh", "--json"]);
    await expect(runNextLoopSimulation(declaredRoot, "loop-declared-agent", ["--label", "loop-declared"])).resolves.toEqual(
      expect.objectContaining({ terminal: "closed" })
    );

    const blockedRoot = await makeTempWorkspace();
    await initializeNextLoopWorkspace(blockedRoot);
    const blocker = await createLoopWork(blockedRoot, "Loop blocker");
    const blocked = await createLoopWork(blockedRoot, "Loop blocked target");
    await runCli(blockedRoot, ["dep", "add", blocked, blocker, "--json"]);
    await runCli(blockedRoot, ["work", "reserve", blocked, "--agent", "loop-blocked-agent", "--force", "--reason", "blocked fixture", "--json"]);
    await runCli(blockedRoot, ["sync", "refresh", "--json"]);
    await expect(runNextLoopSimulation(blockedRoot, "loop-blocked-agent")).resolves.toEqual(
      expect.objectContaining({ terminal: "escalation" })
    );

    const idleRoot = await makeTempWorkspace();
    await initializeNextLoopWorkspace(idleRoot);
    await expect(runNextLoopSimulation(idleRoot, "loop-idle-agent")).resolves.toEqual(
      expect.objectContaining({ terminal: "idle" })
    );

    const random = seededRandom(20260702);
    for (let index = 0; index < 4; index += 1) {
      const rootDir = await makeTempWorkspace();
      const agentId = `loop-random-${index}`;
      await initializeNextLoopWorkspace(rootDir);
      const chainLength = 2 + Math.floor(random() * 4);
      const ids: string[] = [];
      for (let step = 0; step < chainLength; step += 1) {
        ids.push(await createLoopWork(rootDir, `Loop random ${index}.${step}`));
      }
      for (let step = 0; step < ids.length - 1; step += 1) {
        await runCli(rootDir, ["dep", "add", ids[step] as string, ids[step + 1] as string, "--json"]);
      }
      await runCli(rootDir, ["work", "reserve", ids[0] as string, "--agent", agentId, "--force", "--reason", "random dependency fixture", "--json"]);
      await runCli(rootDir, ["sync", "refresh", "--json"]);
      await expect(runNextLoopSimulation(rootDir, agentId)).resolves.toEqual(expect.objectContaining({ terminal: "escalation" }));
    }
  }, 60_000);

  it("keeps non-directive JSON command envelopes compatible with existing data consumers", async () => {
    const rootDir = await makeTempWorkspace();
    const initialized = parseEnvelope<{ readonly initialized: boolean; readonly workspaceRoot: string }>(
      (await runCli(rootDir, ["init", "--json"])).stdout
    );
    const created = await runCli(rootDir, ["work", "create", "Non directive command target", "--ready", "--json"]);
    const createdEnvelope = parseEnvelope<{ readonly meta: { readonly id: string }; readonly title: string }>(created.stdout);
    const legacyData = parseLegacyData<{ readonly meta: { readonly id: string }; readonly title: string }>(created.stdout);

    expect(Object.keys(initialized)).toEqual(["ok", "ledgerSeq", "data", "operationId", "sessionId", "phase", "startedAt", "finishedAt", "stateOutcome"]);
    expect(initialized.agentDirectives).toBeUndefined();
    expect(initialized.data.initialized).toBe(true);
    expect(Object.keys(createdEnvelope)).toEqual(["ok", "ledgerSeq", "data", "operationId", "sessionId", "phase", "startedAt", "finishedAt", "stateOutcome"]);
    expect(createdEnvelope.agentDirectives).toBeUndefined();
    expect(createdEnvelope.data.title).toBe("Non directive command target");
    expect(legacyData).toEqual(createdEnvelope.data);
    expect(initialized.operationId).toMatch(/^bw_operation_[a-f0-9]{32}$/u);
    expect(createdEnvelope.operationId).toMatch(/^bw_operation_[a-f0-9]{32}$/u);
    expect(initialized.sessionId).toBe("local");
    expect(createdEnvelope.sessionId).toBe("local");
    expect(initialized.phase).toBe("completed");
    expect(createdEnvelope.phase).toBe("completed");
    expect(initialized.startedAt).toBeTruthy();
    expect(initialized.finishedAt).toBeTruthy();
    expect(createdEnvelope.stateOutcome).toBe("changed");
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
    expect(directiveRegistryDiagnostic?.details?.issueCounts).toEqual(
      expect.objectContaining({
        duplicate_id: 0,
        unsafe_dynamic_instruction: 0,
        registry_invalid: 0
      })
    );
    expect(directiveBundleDiagnostic).toBeUndefined();
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
    const doctorEnvelope = parseEnvelope<{
      readonly ok: boolean;
      readonly diagnostics: readonly unknown[];
    }>(doctorResult.stdout);

    expect(doctorResult.exitCode).not.toBe(0);
    expect(doctorResult.stderr).toBe("");
    expect(doctorEnvelope.data.ok).toBe(false);
    expect(JSON.stringify(doctorEnvelope)).toContain(".directiveIds[0]");

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
  const previousInitStorage = process.env.BOREAL_INIT_STORAGE;
  process.env.BOREAL_INIT_STORAGE = "file-v2";
  try {
    const exitCode = await main([...argv], output, cwd);
    return { exitCode, stdout, stderr };
  } finally {
    if (previousInitStorage === undefined) {
      delete process.env.BOREAL_INIT_STORAGE;
    } else {
      process.env.BOREAL_INIT_STORAGE = previousInitStorage;
    }
  }
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

function expectSingleNextDirective(envelope: CliEnvelope<NextCommandResultForTest>): NextCommandDirectiveForTest {
  const directives = envelope.agentDirectives?.flatMap((bundle) => bundle.directives) ?? [];
  expect(directives).toHaveLength(1);
  expect(envelope.agentDirectives).toHaveLength(1);
  expect(envelope.agentDirectives?.[0]?.directives).toHaveLength(1);
  expect(envelope.data.directive?.registryId).toBe(directives[0]?.registryId);
  return directives[0] as NextCommandDirectiveForTest;
}

function stableNextSelection(envelope: CliEnvelope<NextCommandResultForTest>): {
  readonly state: NextCommandResultForTest["state"];
  readonly command: string | undefined;
  readonly directiveRegistryId: string | undefined;
  readonly triggerCodes: readonly string[];
  readonly subjectId: string | undefined;
  readonly selectionKey: string | undefined;
} {
  return {
    state: envelope.data.state,
    command: envelope.data.command,
    directiveRegistryId: envelope.data.directive?.registryId,
    triggerCodes: envelope.data.directive?.triggerCodes ?? [],
    subjectId: envelope.data.directive?.subject?.id,
    selectionKey: envelope.data.selectionKey
  };
}

async function initializeNextLoopWorkspace(rootDir: string): Promise<void> {
  await runCli(rootDir, ["init", "--json"]);
  await runCli(rootDir, ["vault", "init", "--json"]);
  await runCli(rootDir, ["sync", "refresh", "--json"]);
}

async function createLoopWork(rootDir: string, title: string): Promise<string> {
  return parseEnvelope<{ readonly meta: { readonly id: string } }>(
    (await runCli(rootDir, ["work", "create", title, "--ready", "--json"])).stdout
  ).data.meta.id;
}

async function runNextLoopSimulation(
  rootDir: string,
  agentId: string,
  extraArgs: readonly string[] = [],
  maxSteps = 8
): Promise<{ readonly terminal: "closed" | "escalation" | "idle"; readonly steps: number; readonly commands: readonly string[] }> {
  const seen = new Set<string>();
  const commands: string[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const envelope = parseEnvelope<NextCommandResultForTest>(
      (await runCli(rootDir, ["next", "--agent", agentId, ...extraArgs, "--json"])).stdout
    );
    const command = envelope.data.command;
    const registryId = envelope.data.directive?.registryId;
    const stateKey = `${envelope.data.state}|${registryId ?? "none"}|${envelope.data.directive?.subject?.id ?? "none"}|${command ?? "none"}`;
    expect(seen.has(stateKey), `next loop repeated state ${stateKey}`).toBe(false);
    seen.add(stateKey);

    if (envelope.data.state === "idle") {
      return { terminal: "idle", steps: step + 1, commands };
    }
    if (!command || envelope.data.directive?.severity === "blocking" || registryId === "blocked.resolve-blockers") {
      return { terminal: "escalation", steps: step + 1, commands };
    }

    commands.push(command);
    if (command.startsWith("bwrk work claim ")) {
      await runCli(rootDir, bwrkCommandArgv(command));
      continue;
    }
    if (command.startsWith("bwrk sync refresh")) {
      await runCli(rootDir, ["sync", "refresh", "--json"]);
      continue;
    }
    if (command.startsWith("bwrk doctor ")) {
      await runCli(rootDir, command.includes("--fix") ? ["doctor", "--fix", "--json"] : ["doctor", "--json"]);
      continue;
    }
    if (command.startsWith("bwrk dep tree ")) {
      return { terminal: "escalation", steps: step + 1, commands };
    }

    const subjectId = envelope.data.directive?.subject?.id;
    if (!subjectId) {
      return { terminal: "escalation", steps: step + 1, commands };
    }
    await simulateNextLoopWorkCompletion(rootDir, agentId, subjectId, command);
    return { terminal: "closed", steps: step + 1, commands };
  }
  throw new Error(`next loop did not terminate within ${maxSteps} steps: ${commands.join(" -> ")}`);
}

async function simulateNextLoopWorkCompletion(
  rootDir: string,
  agentId: string,
  workId: string,
  command: string
): Promise<void> {
  const evidence = parseEnvelope<{ readonly meta: { readonly id: string } }>(
    (
      await runCli(rootDir, [
        "evidence",
        "add",
        workId,
        "--kind",
        "command",
        "--outcome",
        "passed",
        "--command",
        command,
        "--summary",
        `next loop simulated executor completed ${workId}`,
        "--json"
      ])
    ).stdout
  );
  await runCli(rootDir, ["work", "verify", workId, "--evidence", evidence.data.meta.id, "--verdict", "passed", "--json"]);
  await runCli(rootDir, [
    "agent",
    "finish",
    workId,
    "--agent",
    agentId,
    "--summary",
    `next loop property simulation closed ${workId}`,
    "--close",
    "--reason",
    "completed",
    "--kind",
    "note",
    "--outcome",
    "passed",
    "--verdict",
    "passed",
    "--dirty-path",
    "no_repo_changes:next_loop_property_fixture_uses_temp_workspace",
    "--json"
  ]);
}

function bwrkCommandArgv(command: string): readonly string[] {
  const tokens = command.trim().split(/\s+/u);
  expect(tokens[0]).toBe("bwrk");
  return tokens.slice(1);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function expectDeclaredGateDirective(
  agentDirectives: readonly AgentDirectiveBundle[] | undefined,
  declaredCommand: string,
  expectedObservable: string
): void {
  const directive = agentDirectives
    ?.flatMap((bundle) => bundle.directives)
    .find((candidate) => candidate.registryId === "verification.evidence-required");
  expect(directive).toBeDefined();
  expect(directive?.triggerCodes).toEqual(
    expect.arrayContaining(["gate.declared-command.missing", "gate.expected-observable.missing"])
  );
  expect(directive?.data).toEqual(
    expect.objectContaining({
      command: declaredCommand,
      expectedObservable,
      expectedObservables: [expectedObservable],
      declaredCommands: [declaredCommand],
      gateIds: [expect.stringMatching(/^bw_gate_[a-f0-9]{16}$/)]
    })
  );
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
        title: "Respond with closeout summary",
        instruction: "Respond to the user with the verified closeout summary in your own words.",
        triggerCodes: ["closeout.user-summary.required"],
        nextCommandTemplate: "bwrk summary show <subjectId> --json",
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
