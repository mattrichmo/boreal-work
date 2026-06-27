#!/usr/bin/env node
import { BorealError, isBorealError } from "@boreal/core";

import { parseArgs, wantsJsonOutput } from "./args.js";
import { runCommand } from "./commands.js";
import { formatRecord } from "./output.js";
import type { CliOutput } from "./output.js";
import { formatVersionInfo, getVersionInfo } from "./version.js";

export async function main(
  argv = process.argv.slice(2),
  output: CliOutput = processOutput(),
  cwd = process.cwd()
): Promise<number> {
  const json = wantsJsonOutput(argv);
  const stdoutGuard = installJsonStdoutGuard({ enabled: json });
  const guardedOutput = json ? guardedJsonOutput(output, stdoutGuard) : output;
  try {
    if (argv.includes("--version")) {
      guardedOutput.write(json ? formatRecord(getVersionInfo(), true) : formatVersionInfo());
      return 0;
    }
    const parsed = parseArgs(argv);
    const result = await runCommand(parsed, guardedOutput, cwd);
    return result.exitCode;
  } catch (error) {
    if (isBrokenPipeError(error)) {
      return 0;
    }
    if (json) {
      guardedOutput.error(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    } else {
      guardedOutput.error(`${formatError(error)}\n`);
    }
    return isBorealError(error) && (error.code === "BOREAL_INVALID_INPUT" || error.code === "BOREAL_UNSAFE_UNICODE")
      ? 2
      : 1;
  } finally {
    stdoutGuard.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  installBrokenPipeHandler(process.stdout);
  installBrokenPipeHandler(process.stderr);
  const exitCode = await main();
  process.exitCode = exitCode;
}

function processOutput(): CliOutput {
  return {
    write(text) {
      writeProcessStream(process.stdout, text);
    },
    error(text) {
      writeProcessStream(process.stderr, text);
    }
  };
}

function writeProcessStream(stream: NodeJS.WriteStream, text: string): void {
  try {
    stream.write(text);
  } catch (error) {
    if (isBrokenPipeError(error)) {
      return;
    }
    throw error;
  }
}

function installBrokenPipeHandler(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: Error & { readonly code?: string }) => {
    if (isBrokenPipeError(error)) {
      process.exitCode = 0;
      return;
    }
    throw error;
  });
}

export function isBrokenPipeError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "EPIPE";
}

export interface JsonStdoutGuard {
  allowStdoutWrite<T>(operation: () => T): T;
  release(): void;
}

export interface JsonStdoutGuardOptions {
  readonly enabled: boolean;
  readonly stderrWrite?: (text: string) => void;
}

export function installJsonStdoutGuard(options: JsonStdoutGuardOptions): JsonStdoutGuard {
  if (!options.enabled) {
    return {
      allowStdoutWrite<T>(operation: () => T): T {
        return operation();
      },
      release() {
        return;
      }
    };
  }

  const stderrWrite = options.stderrWrite ?? ((text: string) => process.stderr.write(text));
  const originalWrite = process.stdout.write;
  let allowDepth = 0;
  let released = false;

  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
    if (allowDepth > 0) {
      return originalWrite.apply(process.stdout, args);
    }

    stderrWrite(stdoutChunkToString(args[0], args[1]));
    const callback = stdoutWriteCallback(args);
    callback?.();
    return true;
  }) as typeof process.stdout.write;

  return {
    allowStdoutWrite<T>(operation: () => T): T {
      allowDepth += 1;
      try {
        return operation();
      } finally {
        allowDepth -= 1;
      }
    },
    release() {
      if (released) {
        return;
      }
      process.stdout.write = originalWrite;
      released = true;
    }
  };
}

function guardedJsonOutput(output: CliOutput, guard: JsonStdoutGuard): CliOutput {
  return {
    write(text) {
      guard.allowStdoutWrite(() => output.write(text));
    },
    error(text) {
      output.error(text);
    }
  };
}

function stdoutChunkToString(chunk: unknown, encoding: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString(typeof encoding === "string" ? (encoding as BufferEncoding) : undefined);
  }
  return String(chunk);
}

function stdoutWriteCallback(args: Parameters<typeof process.stdout.write>): (() => void) | undefined {
  const callback = typeof args[1] === "function" ? args[1] : typeof args[2] === "function" ? args[2] : undefined;
  return callback ? () => callback() : undefined;
}

function formatError(error: unknown): string {
  if (error instanceof BorealError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof BorealError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  if (error instanceof Error) {
    return {
      ok: false,
      code: "BOREAL_UNEXPECTED",
      message: error.message
    };
  }
  return {
    ok: false,
    code: "BOREAL_UNEXPECTED",
    message: String(error)
  };
}
