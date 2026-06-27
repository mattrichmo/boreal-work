import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { BorealError } from "./errors.js";

export const DEFAULT_BOUNDED_PROCESS_TIMEOUT_MS = 30_000;
export const DEFAULT_BOUNDED_PROCESS_STREAM_MAX_BYTES = 256 * 1024;

export interface BoundedProcessOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly input?: string | Buffer;
  readonly timeoutMs?: number;
  readonly stdoutMaxBytes?: number;
  readonly stderrMaxBytes?: number;
}

export interface BoundedProcessStream {
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface BoundedProcessResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: BoundedProcessStream;
  readonly stderr: BoundedProcessStream;
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

  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.command, args, {
      cwd: input.cwd,
      stdio: [input.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    const stdout = createBoundedCapture("stdout", stdoutMaxBytes);
    const stderr = createBoundedCapture("stderr", stderrMaxBytes);
    let timedOut = false;
    let closed = false;
    let outputError: BorealError | undefined;

    if (!child.stdout || !child.stderr || (input.input !== undefined && !child.stdin)) {
      reject(new BorealError("BOREAL_INVARIANT", "Child process streams were not initialized"));
      return;
    }
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    const stdinStream = child.stdin;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!closed) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, timeoutMs);
    timer.unref();

    stdoutStream.on("data", (chunk: Buffer) => {
      outputError ??= stdout.push(chunk);
      if (outputError) {
        child.kill("SIGTERM");
      }
    });
    stderrStream.on("data", (chunk: Buffer) => {
      outputError ??= stderr.push(chunk);
      if (outputError) {
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      closed = true;
      clearTimeout(timer);
      const result: BoundedProcessResult = {
        command: input.command,
        args,
        cwd: input.cwd,
        exitCode,
        signal,
        timedOut,
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
            stderrBytes: result.stderr.bytes
          })
        );
        return;
      }
      if (outputError) {
        reject(outputError);
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

function createBoundedCapture(name: "stdout" | "stderr", maxBytes: number): {
  push(chunk: Buffer): BorealError | undefined;
  value(): BoundedProcessStream;
} {
  const chunks: Buffer[] = [];
  const hash = createHash("sha256");
  let bytes = 0;

  return {
    push(chunk) {
      bytes += chunk.length;
      hash.update(chunk);
      if (bytes > maxBytes) {
        return new BorealError("BOREAL_COMMAND_OUTPUT_LIMIT", "Child process output exceeded byte cap", {
          stream: name,
          maxBytes,
          observedBytes: bytes
        });
      }
      chunks.push(chunk);
      return undefined;
    },
    value() {
      return {
        text: Buffer.concat(chunks).toString("utf8"),
        bytes,
        sha256: `sha256:${hash.digest("hex")}`
      };
    }
  };
}

function boundedPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a positive integer`, { value });
  }
  return value;
}
