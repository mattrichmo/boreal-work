#!/usr/bin/env node
import { BorealError, isBorealError } from "@boreal/core";

import { parseArgs } from "./args.js";
import { runCommand } from "./commands.js";
import type { CliOutput } from "./output.js";

export async function main(
  argv = process.argv.slice(2),
  output: CliOutput = processOutput(),
  cwd = process.cwd()
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    const result = await runCommand(parsed, output, cwd);
    return result.exitCode;
  } catch (error) {
    const json = argv.includes("--json");
    if (json) {
      output.error(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    } else {
      output.error(`${formatError(error)}\n`);
    }
    return isBorealError(error) && error.code === "BOREAL_INVALID_INPUT" ? 2 : 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main();
  process.exitCode = exitCode;
}

function processOutput(): CliOutput {
  return {
    write(text) {
      process.stdout.write(text);
    },
    error(text) {
      process.stderr.write(text);
    }
  };
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
