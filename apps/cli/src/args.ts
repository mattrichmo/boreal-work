import { BorealError } from "@boreal/core";

import { isTopLevelGroup, registryValueFlagNames } from "./command-registry.js";

// `bwrk global <group> ...` is sugar for `bwrk <group> ... --global`. Bare
// `bwrk global` (and `global init/next/link/unlink`, `global --web/--json`)
// stay as the global dashboard command and are left untouched.
const GLOBAL_OWN_SUBCOMMANDS = new Set(["init", "next", "link", "unlink"]);

export function expandGlobalNamespace(argv: readonly string[]): readonly string[] {
  const [first, second] = argv;
  if (
    first === "global" &&
    typeof second === "string" &&
    !second.startsWith("-") &&
    !GLOBAL_OWN_SUBCOMMANDS.has(second) &&
    isTopLevelGroup(second)
  ) {
    return [...argv.slice(1), "--global"];
  }
  return argv;
}

export interface ParsedArgs {
  readonly command: readonly string[];
  readonly flags: ReadonlyMap<string, readonly string[]>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const flags = new Map<string, string[]>();
  const valueFlags = registryValueFlagNames();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--") {
      command.push(...argv.slice(index + 1));
      break;
    }

    if (arg === "-y") {
      addFlag(flags, "yes", "true");
      continue;
    }

    if (!arg.startsWith("--")) {
      command.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex >= 0) {
      addFlag(flags, raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1));
      continue;
    }

    if (valueFlags.has(raw)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new BorealError("BOREAL_INVALID_INPUT", `--${raw} requires a value`);
      }
      addFlag(flags, raw, value);
      index += 1;
      continue;
    }

    addFlag(flags, raw, "true");
  }

  return { command, flags };
}

export function wantsJsonOutput(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (arg === "--") {
      return false;
    }
    if (arg === "--json") {
      return true;
    }
    if (arg.startsWith("--json=")) {
      return arg.slice("--json=".length) !== "false";
    }
    if (arg === "--brief") {
      return true;
    }
    if (arg.startsWith("--brief=")) {
      return arg.slice("--brief=".length) !== "false";
    }
  }
  return false;
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  const values = args.flags.get(name);
  return values !== undefined && values.at(-1) !== "false";
}

export function flagValue(args: ParsedArgs, name: string): string | undefined {
  const values = args.flags.get(name);
  return values?.at(values.length - 1);
}

export function flagValues(args: ParsedArgs, name: string): readonly string[] {
  return args.flags.get(name) ?? [];
}

export function requiredFlag(args: ParsedArgs, name: string): string {
  const value = flagValue(args, name);
  if (!value) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Missing required --${name}`);
  }
  return value;
}

function addFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Flag name cannot be empty");
  }
  const values = flags.get(normalized) ?? [];
  values.push(value);
  flags.set(normalized, values);
}
