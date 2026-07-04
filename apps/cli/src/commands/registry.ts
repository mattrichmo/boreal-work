import { BorealError } from "@boreal/core";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import {
  addProjectRegistryEntry,
  doctorProjectRegistry,
  importProjectSetupRegistryEntry,
  listProjectRegistry,
  removeProjectRegistryEntry,
  type RegistryAddResult,
  type RegistryDoctorResult,
  type RegistryImportSetupResult,
  type RegistryListResult,
  type RegistryRemoveResult
} from "../registry.js";
import type { CommandResult } from "./shared.js";

export interface RegistryCommandDependencies {
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
}

export async function registryCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: RegistryCommandDependencies
): Promise<CommandResult> {
  const options = { registryRoot: flagValue(args, "registry-root") };
  switch (action) {
    case "list": {
      const result = await listProjectRegistry(options);
      output.write(json ? formatRecord(result, true) : formatRegistryList(result));
      return { exitCode: 0 };
    }
    case "add": {
      const result = await addProjectRegistryEntry({
        ...options,
        workspaceRoot: requiredFlag(args, "workspace"),
        name: flagValue(args, "name"),
        labels: flagValues(args, "label")
      });
      output.write(json ? formatRecord(result, true) : formatRegistryAdd(result));
      return { exitCode: 0 };
    }
    case "import-setup": {
      const result = await importProjectSetupRegistryEntry({
        ...options,
        workspaceRoot: context.workspaceRoot,
        name: flagValue(args, "name"),
        labels: flagValues(args, "label")
      });
      output.write(json ? formatRecord(result, true) : formatRegistryImport(result));
      return { exitCode: 0 };
    }
    case "remove": {
      const result = await removeProjectRegistryEntry(dependencies.requiredPositional(rest, 0, "project id"), {
        ...options,
        purge: hasFlag(args, "purge")
      });
      output.write(json ? formatRecord(result, true) : formatRegistryRemove(result));
      return { exitCode: 0 };
    }
    case "doctor": {
      const result = await doctorProjectRegistry(options);
      output.write(json ? formatRecord(result, true) : formatRegistryDoctor(result));
      return { exitCode: result.ok ? 0 : 1 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown registry command: ${action ?? ""}`);
  }
}

function formatRegistryList(result: RegistryListResult): string {
  if (result.entries.length === 0) {
    return `No registered projects at ${result.storage.registryFile}\n`;
  }
  return table(
    result.entries.map((entry) => ({
      id: entry.id,
      name: entry.display.name,
      lifecycle: entry.lifecycle,
      projectRoot: entry.projectRoot,
      memoryRoot: entry.memoryRoot,
      git: entry.memoryGitMode
    }))
  );
}

export function formatRegistryAdd(result: RegistryAddResult): string {
  return `${result.added ? "Added" : result.replaced ? "Updated" : "Registered"} ${result.entry.display.name} (${result.entry.id})\n`;
}

function formatRegistryImport(result: RegistryImportSetupResult): string {
  const action = result.changed ? result.added ? "Imported" : "Updated" : "Already registered";
  return `${action} ${result.entry.display.name} (${result.entry.id})\n`;
}

export function formatRegistryRemove(result: RegistryRemoveResult): string {
  const action = result.purged ? "Purged" : "Archived";
  return `${action} ${result.entry.display.name} (${result.entry.id})\n`;
}

function formatRegistryDoctor(result: RegistryDoctorResult): string {
  const header = `[${result.ok ? "ok" : "error"}] registry: ${result.entryCount} project(s) at ${result.storage.registryFile}`;
  if (result.findings.length === 0) {
    return `${header}\n`;
  }
  return `${header}\n${result.findings.map((finding) => {
    const project = finding.projectId ? ` ${finding.projectId}` : "";
    const path = finding.path ? ` ${finding.path}` : "";
    return `[${finding.severity}] ${finding.code}${project}:${path} ${finding.message}`.trimEnd();
  }).join("\n")}\n`;
}
