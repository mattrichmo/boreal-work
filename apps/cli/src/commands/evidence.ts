import {
  BorealError,
  EVIDENCE_ATTESTATION_SCHEMA_VERSION,
  hashContent,
  nowIso,
  previewDeclaredGate,
  workRevisionContentHash,
  type ContentHash,
  type EvidenceAttestation,
  type EvidenceKind,
  type EvidenceOutcome,
  type EvidenceRecord,
  type RequiredCloseoutGate,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { recordWitnessedEvidence } from "@boreal/evidence-engine";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

export interface EvidenceCommandDependencies {
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly resolveWorkId: (context: CliContext, value: string) => Promise<WorkId>;
  readonly parseEvidenceKind: (value: string | undefined) => EvidenceKind;
  readonly parseOutcome: (value: string | undefined) => EvidenceOutcome;
  readonly resultForEvidence: (evidence: EvidenceRecord) => object;
  readonly borealVersion: string;
}

export async function evidenceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: EvidenceCommandDependencies
): Promise<CommandResult> {
  if (action === "run") {
    return runWitnessedEvidence(rest, context, args, output, json, dependencies);
  }
  if (action !== "add") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown evidence command: ${action ?? ""}`);
  }

  const subjectId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
  const attestation = externalAttestationFromArgs(context, args);
  const evidence = await context.runtime.recordEvidence({
    subjectId,
    subjectType: "work",
    kind: dependencies.parseEvidenceKind(flagValue(args, "kind")),
    summary: requiredFlag(args, "summary"),
    outcome: dependencies.parseOutcome(flagValue(args, "outcome")),
    command: flagValue(args, "command"),
    uri: flagValue(args, "uri"),
    ...(attestation ? { attestation } : {})
  });
  const result = dependencies.resultForEvidence(evidence);
  output.write(formatRecord(result, json));
  return { exitCode: 0 };
}

async function runWitnessedEvidence(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: EvidenceCommandDependencies
): Promise<CommandResult> {
  const workId = await dependencies.resolveWorkId(context, dependencies.requiredPositional(rest, 0, "work reference"));
  const work = await context.store.read(async (reader) => reader.getWorkItem(workId));
  if (!work) throw new BorealError("BOREAL_NOT_FOUND", "Work item not found", { workId, domain: "work" });
  const gate = selectDeclaredGate(work, flagValue(args, "gate"));
  const policy = {
    enabled: true,
    timeoutMs: optionalPositiveInteger(flagValue(args, "timeout-ms"), "--timeout-ms"),
    stdoutMaxBytes: optionalPositiveInteger(flagValue(args, "stdout-max-bytes"), "--stdout-max-bytes"),
    stderrMaxBytes: optionalPositiveInteger(flagValue(args, "stderr-max-bytes"), "--stderr-max-bytes")
  };
  if (hasFlag(args, "dry-run")) {
    const preview = await previewDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: gate.declaredCommand as string,
      workspaceRoot: context.workspaceRoot,
      cwd: flagValue(args, "cwd"),
      policy
    });
    output.write(formatRecord({ dryRun: true, workId, gateId: gate.id, preview }, json));
    return { exitCode: 0 };
  }
  const witnessed = await recordWitnessedEvidence({
    subjectId: workId,
    subjectType: "work",
    subjectRevision: currentWorkRevision(work),
    declaredCommand: gate.declaredCommand as string,
    expectedObservable: gate.expectedObservable,
    workspaceRoot: context.workspaceRoot,
    cwd: flagValue(args, "cwd"),
    artifactPaths: flagValues(args, "artifact"),
    kind: "test",
    policy,
    actor: context.actor,
    now: nowIso(),
    borealVersion: dependencies.borealVersion
  });
  const persisted = await context.runtime.recordEvidence({
    subjectId: workId,
    subjectType: "work",
    kind: witnessed.evidence.kind,
    summary: witnessed.evidence.summary,
    outcome: witnessed.evidence.outcome,
    command: witnessed.evidence.command,
    observedAt: witnessed.evidence.observedAt,
    attestation: witnessed.evidence.attestation
  });
  output.write(formatRecord({
    ...dependencies.resultForEvidence(persisted),
    gateId: gate.id,
    preview: witnessed.preview,
    execution: witnessed.execution,
    expectedObservableMatched: witnessed.expectedObservableMatched,
    failureCode: witnessed.failureCode
  }, json));
  return { exitCode: persisted.outcome === "passed" ? 0 : 1 };
}

function selectDeclaredGate(work: WorkItem, selector: string | undefined): RequiredCloseoutGate {
  const declared = (work.requiredCloseoutGates ?? []).filter((gate) => gate.declaredCommand);
  const matches = selector
    ? declared.filter((gate) => gate.id === selector || `${gate.kind}:${gate.scope}` === selector || gate.kind === selector)
    : declared;
  if (matches.length !== 1) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Evidence run requires exactly one declared closeout gate", {
      workId: work.meta.id,
      selector,
      declaredGateIds: declared.map((gate) => gate.id),
      command: `bwrk evidence run ${work.meta.id} --gate <gate-id> --json`
    });
  }
  return matches[0] as RequiredCloseoutGate;
}

function currentWorkRevision(work: WorkItem): { contentHash: ContentHash; updatedAt: WorkItem["meta"]["updatedAt"] } {
  return {
    contentHash: workRevisionContentHash(work),
    updatedAt: work.meta.updatedAt
  };
}

function externalAttestationFromArgs(context: CliContext, args: ParsedArgs): EvidenceAttestation | undefined {
  const kind = flagValue(args, "attestation");
  const externalFlags = ["issuer", "result-uri", "verification-status", "attestation-id", "subject-revision", "subject-updated-at"]
    .filter((flag) => flagValue(args, flag) !== undefined);
  if (!kind && externalFlags.length === 0) return undefined;
  if (kind !== "external-ci" && kind !== "human") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--attestation must be external-ci or human");
  }
  const recordedAt = nowIso();
  const issuer = requiredFlag(args, "issuer");
  const resultUri = requiredFlag(args, "result-uri");
  const verificationStatus = requiredFlag(args, "verification-status");
  if (verificationStatus !== "unverified" && verificationStatus !== "verified" && verificationStatus !== "rejected") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--verification-status must be unverified, verified, or rejected");
  }
  const revision = flagValue(args, "subject-revision");
  if (revision && !/^sha256:[a-f0-9]{64}$/u.test(revision)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--subject-revision must be a sha256 content hash");
  }
  const witnessId = flagValue(args, "attestation-id") ?? `${kind}:${hashContent({ issuer, resultUri }).slice(-16)}`;
  return {
    schemaVersion: EVIDENCE_ATTESTATION_SCHEMA_VERSION,
    trustLevel: "external_attested",
    producer: context.actor,
    witness: { kind: kind === "external-ci" ? "external_ci" : "human", id: witnessId, issuer },
    recordedAt,
    witnessedAt: recordedAt,
    ...(revision ? { subjectRevision: { contentHash: revision as ContentHash, ...(flagValue(args, "subject-updated-at") ? { updatedAt: flagValue(args, "subject-updated-at") as WorkItem["meta"]["updatedAt"] } : {}) } } : {}),
    external: {
      issuer,
      resultUri,
      verificationStatus,
      ...(flagValue(args, "attestation-id") ? { attestationId: flagValue(args, "attestation-id") } : {})
    }
  };
}

function optionalPositiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${flag} must be a positive integer`, { value });
  }
  return parsed;
}
