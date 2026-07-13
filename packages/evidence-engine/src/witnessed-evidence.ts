import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { arch, platform } from "node:os";
import { basename, relative, resolve } from "node:path";

import {
  BorealError,
  EVIDENCE_ATTESTATION_SCHEMA_VERSION,
  assertPathInside,
  assertRealPathInside,
  executeDeclaredGate,
  hashContent,
  isBorealError,
  previewDeclaredGate,
  runBoundedProcess,
  type ActorRef,
  type BoundedProcessResult,
  type BoundedProcessStream,
  type ContentHash,
  type DeclaredGateExecutionPolicy,
  type DeclaredGateExecutionPreview,
  type EvidenceKind,
  type EvidenceRecord,
  type IsoTimestamp
} from "@boreal/core";

import { recordEvidence } from "./evidence.js";

const DEFAULT_EXCERPT_BYTES = 4_096;
const VERSION_OUTPUT_BYTES = 4_096;

export interface WitnessedEvidenceInput {
  readonly subjectId: string;
  readonly subjectType: string;
  readonly subjectRevision: {
    readonly contentHash: ContentHash;
    readonly updatedAt?: IsoTimestamp;
  };
  readonly declaredCommand: string;
  readonly expectedObservable?: string;
  readonly workspaceRoot: string;
  readonly cwd?: string;
  readonly artifactPaths?: readonly string[];
  readonly kind?: Extract<EvidenceKind, "command" | "test">;
  readonly policy: DeclaredGateExecutionPolicy;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
  readonly witnessId?: string;
  readonly borealVersion?: string;
  readonly signal?: AbortSignal;
  readonly environment?: NodeJS.ProcessEnv;
  readonly excerptMaxBytes?: number;
}

export interface WitnessedEvidenceResult {
  readonly evidence: EvidenceRecord;
  readonly preview: DeclaredGateExecutionPreview;
  readonly execution: BoundedProcessResult;
  readonly expectedObservableMatched: boolean;
  readonly failureCode?: string;
}

export async function recordWitnessedEvidence(input: WitnessedEvidenceInput): Promise<WitnessedEvidenceResult> {
  const preview = await previewDeclaredGate({
    source: "required_closeout_gate",
    declaredCommand: input.declaredCommand,
    workspaceRoot: input.workspaceRoot,
    cwd: input.cwd,
    policy: input.policy,
    signal: input.signal,
    environment: input.environment
  });
  const environment = input.environment ?? process.env;
  validateArtifactPaths(input.workspaceRoot, input.artifactPaths ?? []);

  let execution: BoundedProcessResult;
  let failureCode: string | undefined;
  try {
    const run = await executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: input.declaredCommand,
      workspaceRoot: input.workspaceRoot,
      cwd: input.cwd,
      policy: input.policy,
      signal: input.signal,
      environment
    });
    if (run.dryRun) {
      throw new BorealError("BOREAL_INVARIANT", "Witnessed evidence execution unexpectedly returned a dry run");
    }
    execution = run.result;
  } catch (error) {
    failureCode = isBorealError(error) ? error.code : "BOREAL_STORAGE_ERROR";
    execution = executionFromError(error, preview);
  }

  const [git, tools, artifactResult] = await Promise.all([
    captureGitProvenance(preview.cwd, environment),
    captureToolVersions(preview, environment),
    captureArtifactsAfterRun(input.workspaceRoot, input.artifactPaths ?? [])
  ]);
  if (artifactResult.failureCode) {
    failureCode ??= artifactResult.failureCode;
  }
  const artifacts = artifactResult.artifacts;

  const combinedOutput = `${execution.stdout.text}\n${execution.stderr.text}`;
  const expectedObservableMatched = input.expectedObservable === undefined || combinedOutput.includes(input.expectedObservable);
  const passed =
    failureCode === undefined &&
    execution.exitCode === 0 &&
    !execution.timedOut &&
    !execution.cancelled &&
    expectedObservableMatched;
  const excerptMaxBytes = positiveInteger(input.excerptMaxBytes ?? DEFAULT_EXCERPT_BYTES, "excerptMaxBytes");
  const recordedAt = new Date().toISOString() as IsoTimestamp;
  const statusSummary = passed ? "passed" : failureSummary(execution, failureCode, expectedObservableMatched);
  const evidence = recordEvidence({
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    kind: input.kind ?? "command",
    summary: `Boreal witnessed ${input.declaredCommand} ${statusSummary}`,
    outcome: passed ? "passed" : "failed",
    command: input.declaredCommand,
    observedAt: execution.completedAt as IsoTimestamp,
    actor: input.actor,
    now: input.now,
    attestation: {
      schemaVersion: EVIDENCE_ATTESTATION_SCHEMA_VERSION,
      trustLevel: "boreal_witnessed",
      producer: input.actor,
      witness: {
        kind: "boreal",
        id: input.witnessId ?? "boreal-declared-gate-runner",
        issuer: "boreal-work"
      },
      recordedAt,
      witnessedAt: execution.completedAt as IsoTimestamp,
      subjectRevision: input.subjectRevision,
      environment: {
        platform: platform(),
        arch: arch(),
        nodeVersion: process.version,
        cwdHash: hashContent(preview.cwd)
      },
      command: {
        commandHash: hashContent({ executable: preview.executable, args: preview.args, cwd: preview.cwd }),
        startedAt: execution.startedAt as IsoTimestamp,
        completedAt: execution.completedAt as IsoTimestamp,
        durationMs: execution.durationMs,
        ...(execution.exitCode === null ? {} : { exitCode: execution.exitCode }),
        ...(execution.signal ? { signal: execution.signal } : {}),
        timedOut: execution.timedOut,
        cancelled: execution.cancelled,
        expectedObservableMatched
      },
      output: {
        stdoutHash: execution.stdout.sha256 as ContentHash,
        stderrHash: execution.stderr.sha256 as ContentHash,
        stdoutBytes: execution.stdout.bytes,
        stderrBytes: execution.stderr.bytes,
        truncated: execution.stdout.truncated || execution.stderr.truncated,
        stdoutExcerpt: boundedExcerpt(execution.stdout.text, excerptMaxBytes),
        stderrExcerpt: boundedExcerpt(execution.stderr.text, excerptMaxBytes)
      },
      ...(git ? { git } : {}),
      tools: [
        { name: "boreal-work", version: input.borealVersion ?? "development" },
        ...tools
      ],
      artifacts
    }
  });

  return {
    evidence,
    preview,
    execution,
    expectedObservableMatched,
    ...(failureCode ? { failureCode } : {})
  };
}

async function captureGitProvenance(cwd: string, environment: NodeJS.ProcessEnv) {
  try {
    const [branch, head, statusResult] = await Promise.all([
      runBoundedProcess({ command: "git", args: ["branch", "--show-current"], cwd, env: environment, timeoutMs: 5_000, stdoutMaxBytes: 8_192, stderrMaxBytes: 8_192 }),
      runBoundedProcess({ command: "git", args: ["rev-parse", "HEAD"], cwd, env: environment, timeoutMs: 5_000, stdoutMaxBytes: 8_192, stderrMaxBytes: 8_192 }),
      runBoundedProcess({ command: "git", args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd, env: environment, timeoutMs: 10_000, stdoutMaxBytes: 1024 * 1024, stderrMaxBytes: 8_192 })
    ]);
    if (branch.exitCode !== 0 || head.exitCode !== 0 || statusResult.exitCode !== 0) return undefined;
    const dirtyEntries = statusResult.stdout.text.split("\0").filter(Boolean);
    return {
      branch: branch.stdout.text.trim(),
      headSha: head.stdout.text.trim(),
      dirty: dirtyEntries.length > 0,
      dirtyFingerprint: statusResult.stdout.sha256 as ContentHash,
      dirtyFileCount: dirtyEntries.length
    };
  } catch {
    return undefined;
  }
}

async function captureToolVersions(
  preview: DeclaredGateExecutionPreview,
  environment: NodeJS.ProcessEnv
): Promise<readonly { readonly name: string; readonly version: string }[]> {
  const commands = new Map<string, { command: string; args: readonly string[] }>([
    ["node", { command: process.execPath, args: ["--version"] }],
    ["git", { command: "git", args: ["--version"] }],
    [basename(preview.executable), { command: preview.executable, args: ["--version"] }]
  ]);
  const versions = await Promise.all([...commands].map(async ([name, command]) => {
    try {
      const result = await runBoundedProcess({
        ...command,
        cwd: preview.cwd,
        env: environment,
        timeoutMs: 5_000,
        stdoutMaxBytes: VERSION_OUTPUT_BYTES,
        stderrMaxBytes: VERSION_OUTPUT_BYTES
      });
      const version = `${result.stdout.text}\n${result.stderr.text}`.trim();
      return result.exitCode === 0 && version ? { name, version: version.slice(0, VERSION_OUTPUT_BYTES) } : undefined;
    } catch {
      return undefined;
    }
  }));
  return versions.filter((value): value is { name: string; version: string } => value !== undefined);
}

function validateArtifactPaths(workspaceRoot: string, paths: readonly string[]): void {
  const root = resolve(workspaceRoot);
  for (const path of paths) {
    assertPathInside(root, resolve(root, path));
  }
}

async function captureArtifactsAfterRun(
  workspaceRoot: string,
  paths: readonly string[]
): Promise<{
  readonly artifacts: readonly { readonly path: string; readonly contentHash: ContentHash; readonly bytes: number }[];
  readonly failureCode?: string;
}> {
  const root = resolve(workspaceRoot);
  try {
    const artifacts = await Promise.all([...new Set(paths)].sort().map(async (path) => {
      const absolute = resolve(root, path);
      assertPathInside(root, absolute);
      await assertRealPathInside(root, absolute);
      const metadata = await stat(absolute);
      if (!metadata.isFile()) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Witnessed artifact must be a file", { path });
      }
      const bytes = await readFile(absolute);
      return {
        path: relative(root, absolute).replaceAll("\\", "/"),
        contentHash: rawContentHash(bytes),
        bytes: bytes.length
      };
    }));
    return { artifacts };
  } catch (error) {
    return {
      artifacts: [],
      failureCode: isBorealError(error) ? error.code : "BOREAL_STORAGE_ERROR"
    };
  }
}

function executionFromError(error: unknown, preview: DeclaredGateExecutionPreview): BoundedProcessResult {
  if (isBorealError(error) && isRecord(error.details) && isBoundedProcessResult(error.details.result)) {
    return error.details.result;
  }
  const timestamp = new Date().toISOString();
  return {
    command: preview.executable,
    args: preview.args,
    cwd: preview.cwd,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: isBorealError(error) && error.code === "BOREAL_COMMAND_TIMEOUT",
    cancelled: isBorealError(error) && error.code === "BOREAL_COMMAND_CANCELLED",
    stdout: emptyStream(),
    stderr: emptyStream()
  };
}

function isBoundedProcessResult(value: unknown): value is BoundedProcessResult {
  return isRecord(value) && typeof value.startedAt === "string" && typeof value.completedAt === "string" &&
    typeof value.durationMs === "number" && isBoundedProcessStream(value.stdout) && isBoundedProcessStream(value.stderr);
}

function isBoundedProcessStream(value: unknown): value is BoundedProcessStream {
  return isRecord(value) && typeof value.text === "string" && typeof value.bytes === "number" &&
    typeof value.sha256 === "string" && typeof value.truncated === "boolean";
}

function emptyStream(): BoundedProcessStream {
  return { text: "", bytes: 0, sha256: rawContentHash(Buffer.alloc(0)), truncated: false };
}

function rawContentHash(value: Buffer): ContentHash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as ContentHash;
}

function boundedExcerpt(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) return value;
  const half = Math.max(1, Math.floor((maxBytes - 32) / 2));
  return `${buffer.subarray(0, half).toString("utf8")}\n...<truncated>...\n${buffer.subarray(-half).toString("utf8")}`;
}

function failureSummary(
  execution: BoundedProcessResult,
  failureCode: string | undefined,
  expectedObservableMatched: boolean
): string {
  if (execution.cancelled) return "failed (cancelled)";
  if (execution.timedOut) return "failed (timeout)";
  if (failureCode) return `failed (${failureCode})`;
  if (!expectedObservableMatched) return "failed (expected observable missing)";
  return `failed (exit ${execution.exitCode ?? "unknown"})`;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${name} must be a positive integer`, { value });
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
