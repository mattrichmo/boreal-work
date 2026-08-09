import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import { BorealError } from "./errors.js";

export const DEFAULT_BOUNDED_PROCESS_TIMEOUT_MS = 30_000;
export const DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES = 256 * 1024;
export const DEFAULT_TRUSTED_EXECUTABLE_NAMES = ["bwrk", "git", "node", "npm", "pnpm"] as const;

const BLOCKED_PROCESS_ENVIRONMENT_KEYS = new Set([
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "GIT_ASKPASS",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_USERCONFIG",
  "SSH_ASKPASS",
  "SSH_AUTH_SOCK"
]);

export interface BoundedProcessOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly input?: string | Buffer;
  readonly timeoutMs?: number;
  readonly stdoutMaxBytes?: number;
  readonly stderrMaxBytes?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  /** Start a dedicated process group and terminate descendants on timeout/cancel. */
  readonly killProcessGroup?: boolean;
}

export interface BoundedProcessStream {
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly truncated: boolean;
}

export interface BoundedProcessResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly stdout: BoundedProcessStream;
  readonly stderr: BoundedProcessStream;
}

/**
 * Keep execution subprocesses from inheriting configuration that can load code,
 * replace Git configuration, inject libraries, or redirect credentials.
 */
export function sanitizeProcessEnvironment(
  environment: NodeJS.ProcessEnv,
  keys: readonly string[]
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [...new Set(keys)].flatMap((key) => {
      const normalizedKey = key.toUpperCase();
      if (
        BLOCKED_PROCESS_ENVIRONMENT_KEYS.has(normalizedKey) ||
        normalizedKey.startsWith("GIT_CONFIG_") ||
        normalizedKey.startsWith("NPM_CONFIG_")
      ) {
        return [];
      }
      return environment[key] === undefined ? [] : [[key, environment[key]]];
    })
  ) as NodeJS.ProcessEnv;
}

export function normalizedExecutableName(executable: string): string {
  return basename(executable).replace(/\.(?:cmd|exe)$/iu, "");
}

/**
 * A capability may be a bare executable from the approved set. The current
 * Node runtime is also accepted for tests and direct local execution, but an
 * imported snapshot must not carry an absolute machine-specific path.
 */
export function isTrustedExecutableCapability(
  executable: string,
  allowedNames: readonly string[] = DEFAULT_TRUSTED_EXECUTABLE_NAMES,
  options: { readonly allowRuntimePath?: boolean } = {}
): boolean {
  if (!executable || /[\0\n\r]/u.test(executable)) return false;
  const executableName = normalizedExecutableName(executable);
  if (!allowedNames.some((allowedName) => allowedName === executableName)) return false;
  if (!/[\\/]/u.test(executable)) return true;
  return options.allowRuntimePath === true && executableName === "node" && resolve(executable) === resolve(process.execPath);
}

const UNSAFE_EXECUTION_ARGUMENTS = new Set([
  "-e",
  "--eval",
  "--experimental-loader",
  "--import",
  "--loader",
  "--print",
  "-p",
  "--require",
  "-r"
]);

/** Arguments that turn an otherwise approved executable into a code loader. */
export function hasUnsafeExecutionArguments(executable: string, args: readonly string[]): boolean {
  const executableName = normalizedExecutableName(executable);
  if (executableName === "node") {
    return args.some((arg) => UNSAFE_EXECUTION_ARGUMENTS.has(arg) || [...UNSAFE_EXECUTION_ARGUMENTS].some((flag) => arg.startsWith(`${flag}=`)));
  }
  if (executableName === "npm" || executableName === "pnpm") {
    return args.some((arg) => ["exec", "dlx", "run", "run-script", "install", "ci", "create"].includes(arg));
  }
  return false;
}

export async function runBoundedProcess(input: BoundedProcessOptions): Promise<BoundedProcessResult> {
  const args = input.args ?? [];
  const timeoutMs = boundedPositiveInteger(input.timeoutMs ?? DEFAULT_BOUNDED_PROCESS_TIMEOUT_MS, "timeoutMs");
  const stdoutMaxBytes = boundedPositiveInteger(
    input.stdoutMaxBytes ?? DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES,
    "stdoutMaxBytes"
  );
  const stderrMaxBytes = boundedPositiveInteger(
    input.stderrMaxBytes ?? DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES,
    "stderrMaxBytes"
  );
  if (input.signal?.aborted) {
    throw new BorealError("BOREAL_COMMAND_CANCELLED", "Child process was cancelled before start", { command: input.command });
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.command, args, {
      cwd: input.cwd,
      env: input.env,
      stdio: [input.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: input.killProcessGroup === true
    });
    const stdout = createBoundedCapture("stdout", stdoutMaxBytes);
    const stderr = createBoundedCapture("stderr", stderrMaxBytes);
    let timedOut = false;
    let cancelled = false;
    let closed = false;
    let outputError: BorealError | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;

    if (!child.stdout || !child.stderr || (input.input !== undefined && !child.stdin)) {
      reject(new BorealError("BOREAL_INVARIANT", "Child process streams were not initialized"));
      return;
    }
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    const stdinStream = child.stdin;

    const requestTermination = (signal: NodeJS.Signals): void => {
      terminateChild(child, signal, input.killProcessGroup === true);
      if (signal === "SIGTERM" && escalationTimer === undefined) {
        escalationTimer = setTimeout(() => {
          if (!closed) terminateChild(child, "SIGKILL", input.killProcessGroup === true);
        }, 1_000);
        escalationTimer.unref();
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      requestTermination("SIGTERM");
    }, timeoutMs);
    timer.unref();
    const cancel = () => {
      cancelled = true;
      requestTermination("SIGTERM");
    };
    input.signal?.addEventListener("abort", cancel, { once: true });

    stdoutStream.on("data", (chunk: Buffer) => {
      outputError ??= stdout.push(chunk);
      if (outputError) {
        requestTermination("SIGTERM");
      }
    });
    stderrStream.on("data", (chunk: Buffer) => {
      outputError ??= stderr.push(chunk);
      if (outputError) {
        requestTermination("SIGTERM");
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      input.signal?.removeEventListener("abort", cancel);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      closed = true;
      clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      input.signal?.removeEventListener("abort", cancel);
      const completedAtMs = Date.now();
      const result: BoundedProcessResult = {
        command: input.command,
        args,
        cwd: input.cwd,
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        durationMs: Math.max(0, completedAtMs - startedAtMs),
        exitCode,
        signal,
        timedOut,
        cancelled,
        stdout: stdout.value(),
        stderr: stderr.value()
      };
      if (timedOut) {
        reject(
          new BorealError("BOREAL_COMMAND_TIMEOUT", "Child process timed out", {
            command: input.command,
            args,
            cwd: input.cwd,
            timeoutMs,
            exitCode,
            signal,
            stdoutBytes: result.stdout.bytes,
            stderrBytes: result.stderr.bytes,
            result
          })
        );
        return;
      }
      if (cancelled) {
        reject(
          new BorealError("BOREAL_COMMAND_CANCELLED", "Child process was cancelled", {
            command: input.command,
            args,
            cwd: input.cwd,
            exitCode,
            signal,
            stdoutBytes: result.stdout.bytes,
            stderrBytes: result.stderr.bytes,
            stdoutHash: result.stdout.sha256,
            stderrHash: result.stderr.sha256,
            result
          })
        );
        return;
      }
      if (outputError) {
        reject(
          new BorealError(outputError.code, outputError.message, {
            ...(isRecord(outputError.details) ? outputError.details : {}),
            result
          })
        );
        return;
      }
      resolvePromise(result);
    });

    if (input.input !== undefined) {
      if (!stdinStream) {
        reject(new BorealError("BOREAL_INVARIANT", "Child process stdin was not initialized"));
        return;
      }
      stdinStream.end(input.input);
    }
  });
}

function terminateChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals, processGroup: boolean): void {
  if (processGroup && process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may already have exited; fall back to the direct child.
    }
  }
  child.kill(signal);
}

function createBoundedCapture(name: "stdout" | "stderr", maxBytes: number): {
  push(chunk: Buffer): BorealError | undefined;
  value(): BoundedProcessStream;
} {
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let bytes = 0;
  let capturedBytes = 0;
  let truncated = false;

  return {
    push(chunk) {
      bytes += chunk.length;
      hash.update(chunk);
      const remaining = Math.max(0, maxBytes - capturedBytes);
      if (remaining > 0) {
        const captured = chunk.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
      if (bytes > maxBytes) {
        truncated = true;
        return new BorealError("BOREAL_COMMAND_OUTPUT_LIMIT", "Child process output exceeded byte cap", {
          stream: name,
          maxBytes,
          observedBytes: bytes
        });
      }
      return undefined;
    },
    value() {
      return {
        text: Buffer.concat(chunks).toString("utf8"),
        bytes,
        sha256: `sha256:${hash.digest("hex")}`,
        truncated
      };
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a positive integer`, { value });
  }
  return value;
}
