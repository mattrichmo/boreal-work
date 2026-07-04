import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  BorealError,
  hashContent,
  nowIso,
  readJsonFile,
  type ContentHash,
  type EnforcementGap,
  type IsoTimestamp
} from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

import type { CliContext } from "../context.js";

const CIRCUIT_BREAKER_SCHEMA_VERSION = "boreal.cli.circuit-breakers.v1";
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 2;

export interface CommandResult {
  readonly exitCode: number;
}

interface CircuitBreakerEntry {
  readonly commandPath: "sync refresh" | "vault init";
  readonly errorSignature: ContentHash;
  readonly consecutiveFailures: number;
  readonly firstFailureAt: IsoTimestamp;
  readonly lastFailureAt: IsoTimestamp;
  readonly lastError: {
    readonly code: string;
    readonly message: string;
  };
}

interface CircuitBreakerState {
  readonly schemaVersion: typeof CIRCUIT_BREAKER_SCHEMA_VERSION;
  readonly updatedAt: IsoTimestamp;
  readonly entries: Record<string, CircuitBreakerEntry>;
}

export async function assertCircuitBreakerAllows(
  context: CliContext,
  command: CircuitBreakerEntry["commandPath"]
): Promise<void> {
  const state = await readCircuitBreakerState(context);
  const entry = state.entries[command];
  if (!entry || entry.consecutiveFailures < CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    return;
  }
  const gaps = [
    {
      code: "doctor.recovery.required",
      subjectType: "command",
      subjectId: command,
      data: {
        reason: `circuit breaker open after ${entry.consecutiveFailures} identical failures`
      }
    }
  ] satisfies readonly EnforcementGap[];
  throw new BorealError(
    "BOREAL_POLICY_VIOLATION",
    `${command} is circuit-broken after repeated identical failures; run \`bwrk doctor --strict --json\``,
    {
      doNotRetry: true,
      commandPath: command,
      consecutiveFailures: entry.consecutiveFailures,
      firstFailureAt: entry.firstFailureAt,
      lastFailureAt: entry.lastFailureAt,
      lastError: entry.lastError,
      repairCommand: "bwrk doctor --strict --json",
      resetCommands: ["bwrk doctor --fix --json", `bwrk ${command} --json`],
      gaps,
      domain: "workflow"
    },
    gaps
  );
}

export async function recordCircuitBreakerSuccess(
  context: CliContext,
  command: CircuitBreakerEntry["commandPath"]
): Promise<void> {
  const state = await readCircuitBreakerState(context);
  if (!state.entries[command]) {
    return;
  }
  const entries = { ...state.entries };
  delete entries[command];
  await writeCircuitBreakerState(context, entries);
}

export async function recordCircuitBreakerFailure(
  context: CliContext,
  command: CircuitBreakerEntry["commandPath"],
  error: unknown
): Promise<void> {
  const state = await readCircuitBreakerState(context);
  const current = nowIso();
  const signature = circuitBreakerSignature(error);
  const existing = state.entries[command];
  const consecutiveFailures = existing?.errorSignature === signature ? existing.consecutiveFailures + 1 : 1;
  await writeCircuitBreakerState(context, {
    ...state.entries,
    [command]: {
      commandPath: command,
      errorSignature: signature,
      consecutiveFailures,
      firstFailureAt: existing?.errorSignature === signature ? existing.firstFailureAt : current,
      lastFailureAt: current,
      lastError: circuitBreakerError(error)
    }
  });
}

export async function clearCircuitBreakers(context: CliContext): Promise<void> {
  await writeCircuitBreakerState(context, {});
}

function circuitBreakerPath(context: CliContext): string {
  return join(context.paths.runtimeDir, "circuit-breakers.json");
}

async function readCircuitBreakerState(context: CliContext): Promise<CircuitBreakerState> {
  const path = circuitBreakerPath(context);
  if (!existsSync(path)) {
    return emptyCircuitBreakerState();
  }
  try {
    const parsed = await readJsonFile(path, {
      schemaName: CIRCUIT_BREAKER_SCHEMA_VERSION,
      expectedObject: true,
      maxBytes: 256 * 1024
    });
    if (!isCircuitBreakerState(parsed)) {
      return emptyCircuitBreakerState();
    }
    return parsed;
  } catch {
    return emptyCircuitBreakerState();
  }
}

async function writeCircuitBreakerState(
  context: CliContext,
  entries: Record<string, CircuitBreakerEntry>
): Promise<void> {
  await mkdir(context.paths.runtimeDir, { recursive: true });
  await writeTextFileAtomic(circuitBreakerPath(context), `${JSON.stringify({
    schemaVersion: CIRCUIT_BREAKER_SCHEMA_VERSION,
    updatedAt: nowIso(),
    entries
  } satisfies CircuitBreakerState)}\n`);
}

function emptyCircuitBreakerState(): CircuitBreakerState {
  return {
    schemaVersion: CIRCUIT_BREAKER_SCHEMA_VERSION,
    updatedAt: nowIso(),
    entries: {}
  };
}

function isCircuitBreakerState(value: unknown): value is CircuitBreakerState {
  if (!isRecord(value) || value.schemaVersion !== CIRCUIT_BREAKER_SCHEMA_VERSION || !isRecord(value.entries)) {
    return false;
  }
  return Object.values(value.entries).every(isCircuitBreakerEntry);
}

function isCircuitBreakerEntry(value: unknown): value is CircuitBreakerEntry {
  return (
    isRecord(value) &&
    (value.commandPath === "sync refresh" || value.commandPath === "vault init") &&
    typeof value.errorSignature === "string" &&
    typeof value.consecutiveFailures === "number" &&
    typeof value.firstFailureAt === "string" &&
    typeof value.lastFailureAt === "string" &&
    isRecord(value.lastError) &&
    typeof value.lastError.code === "string" &&
    typeof value.lastError.message === "string"
  );
}

function circuitBreakerSignature(error: unknown): ContentHash {
  const fields = circuitBreakerError(error);
  const details = error instanceof BorealError ? error.details : undefined;
  return hashContent({ ...fields, details }) as ContentHash;
}

function circuitBreakerError(error: unknown): CircuitBreakerEntry["lastError"] {
  if (error instanceof BorealError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "BOREAL_UNEXPECTED_ERROR", message: error.message };
  }
  return { code: "BOREAL_UNEXPECTED_ERROR", message: String(error) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
