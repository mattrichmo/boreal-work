import { basename, resolve } from "node:path";

import { BorealError } from "./errors.js";
import {
  DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES,
  DEFAULT_BOUNDED_PROCESS_TIMEOUT_MS,
  runBoundedProcess,
  type BoundedProcessResult
} from "./process-runner.js";
import { assertPathInside, assertRealPathInside } from "./workspace.js";

export const DEFAULT_DECLARED_GATE_EXECUTABLES = ["bwrk", "git", "node", "npm", "pnpm"] as const;
export const DEFAULT_DECLARED_GATE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "CI",
  "NODE_ENV",
  "SystemRoot",
  "ComSpec",
  "PATHEXT"
] as const;

export interface DeclaredGateExecutionPolicy {
  readonly enabled: boolean;
  readonly allowedExecutables?: readonly string[];
  readonly environmentKeys?: readonly string[];
  readonly timeoutMs?: number;
  readonly stdoutMaxBytes?: number;
  readonly stderrMaxBytes?: number;
}

export interface DeclaredGateExecutionInput {
  readonly source: "required_closeout_gate";
  readonly declaredCommand: string;
  readonly workspaceRoot: string;
  readonly cwd?: string;
  readonly policy: DeclaredGateExecutionPolicy;
  readonly dryRun?: boolean;
  readonly signal?: AbortSignal;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface DeclaredGateExecutionPreview {
  readonly source: "required_closeout_gate";
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: false;
  readonly environmentKeys: readonly string[];
  readonly excludedEnvironmentKeyCount: number;
  readonly limits: {
    readonly timeoutMs: number;
    readonly stdoutMaxBytes: number;
    readonly stderrMaxBytes: number;
  };
}

export type DeclaredGateExecutionResult =
  | { readonly dryRun: true; readonly preview: DeclaredGateExecutionPreview }
  | { readonly dryRun: false; readonly preview: DeclaredGateExecutionPreview; readonly result: BoundedProcessResult };

export async function executeDeclaredGate(input: DeclaredGateExecutionInput): Promise<DeclaredGateExecutionResult> {
  const preview = await previewDeclaredGate(input);
  if (input.dryRun) return { dryRun: true, preview };
  const environment = selectedEnvironment(input.environment ?? process.env, preview.environmentKeys);
  const result = await runBoundedProcess({
    command: preview.executable,
    args: preview.args,
    cwd: preview.cwd,
    env: environment,
    signal: input.signal,
    ...preview.limits
  });
  return { dryRun: false, preview, result };
}

export async function previewDeclaredGate(input: DeclaredGateExecutionInput): Promise<DeclaredGateExecutionPreview> {
  if (!input.policy.enabled) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Declared gate execution is disabled by runtime policy");
  }
  if (input.source !== "required_closeout_gate") {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Only required closeout gate declarations may execute");
  }
  const [executable, ...args] = parseDeclaredCommand(input.declaredCommand);
  if (!executable) throw new BorealError("BOREAL_INVALID_INPUT", "Declared gate command is empty");
  const allowed = new Set(input.policy.allowedExecutables ?? DEFAULT_DECLARED_GATE_EXECUTABLES);
  const executableName = basename(executable).replace(/\.(?:cmd|exe)$/iu, "");
  if (!allowed.has(executableName)) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Declared gate executable is not policy-approved", {
      executable: executableName,
      allowedExecutables: [...allowed].sort()
    });
  }
  const workspaceRoot = resolve(input.workspaceRoot);
  const cwd = resolve(workspaceRoot, input.cwd ?? ".");
  assertPathInside(workspaceRoot, cwd);
  await assertRealPathInside(workspaceRoot, cwd);
  const environment = input.environment ?? process.env;
  const environmentKeys = [...new Set(input.policy.environmentKeys ?? DEFAULT_DECLARED_GATE_ENV_KEYS)]
    .filter((key) => environment[key] !== undefined)
    .sort();
  return {
    source: input.source,
    executable,
    args,
    cwd,
    shell: false,
    environmentKeys,
    excludedEnvironmentKeyCount: Object.keys(environment).filter((key) => !environmentKeys.includes(key)).length,
    limits: {
      timeoutMs: input.policy.timeoutMs ?? DEFAULT_BOUNDED_PROCESS_TIMEOUT_MS,
      stdoutMaxBytes: input.policy.stdoutMaxBytes ?? DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES,
      stderrMaxBytes: input.policy.stderrMaxBytes ?? DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES
    }
  };
}

export function parseDeclaredCommand(command: string): readonly string[] {
  if (/[\n\r\0]/u.test(command)) throw unsafeCommand("control characters are not allowed");
  const values: string[] = [];
  let value = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of command.trim()) {
    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else value += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/[;&|<>`]/u.test(character) || character === "$" || character === "(" || character === ")") {
      throw unsafeCommand("shell operators and expansion are not allowed");
    }
    if (/\s/u.test(character)) {
      if (value) {
        values.push(value);
        value = "";
      }
      continue;
    }
    value += character;
  }
  if (escaped || quote) throw unsafeCommand("unterminated quote or escape");
  if (value) values.push(value);
  if (values[0]?.includes("=")) throw unsafeCommand("environment assignments are not allowed");
  return values;
}

function selectedEnvironment(environment: NodeJS.ProcessEnv, keys: readonly string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(keys.flatMap((key) => environment[key] === undefined ? [] : [[key, environment[key]]])) as NodeJS.ProcessEnv;
}

function unsafeCommand(reason: string): BorealError {
  return new BorealError("BOREAL_POLICY_VIOLATION", `Unsafe declared gate command: ${reason}`);
}
