import { BorealError } from "@boreal/core";

import { flagValues, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import {
  installCommand,
  installRootFromArgs,
  skillInstallScopeFromArgs,
  type SkillInstallScope
} from "./install.js";
import { readProjectSetupConfig } from "../project-setup.js";
import { inspectWorkflowAssets, type InstalledSkillRootValidationInput } from "../workflow-assets.js";
import type { CommandResult } from "./shared.js";

type IntegrationTarget = "codex" | "claude" | "skills";

export async function integrationsCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action === undefined) {
    const help = [
      "Boreal integrations",
      "",
      "  bwrk integrations add codex [--scope project|user]",
      "  bwrk integrations add claude [--scope project|user]",
      "  bwrk integrations add skills [--scope project|user]",
      "  bwrk integrations status [--scope project|user] [--target codex|claude|skills...]"
    ].join("\n") + "\n";
    output.write(json ? formatRecord({ schemaVersion: "boreal.cli.integrations.help.v1", commands: help.trim().split("\n").slice(2) }, true) : help);
    return { exitCode: 0 };
  }

  if (action === "add") {
    const target = asIntegrationTarget(rest[0]);
    return installCommand(target, context, args, output, json);
  }

  if (action === "status") {
    return integrationStatusCommand(context, args, output, json);
  }

  throw new BorealError("BOREAL_INVALID_INPUT", `Unknown integrations command: ${action}`);
}

async function integrationStatusCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const scope = skillInstallScopeFromArgs(args);
  const targets = await integrationTargets(context, args, scope);
  const installChecks: InstalledSkillRootValidationInput[] = await Promise.all(
    targets.map(async (target) => ({
      target,
      installRoot: await installRootFromArgs(context, args, target, scope)
    }))
  );
  const inspection = await inspectWorkflowAssets({
    workspaceRoot: context.workspaceRoot,
    installChecks
  });
  const result = {
    schemaVersion: "boreal.cli.integrations.status.v1",
    scope,
    workspaceRoot: context.workspaceRoot,
    targets,
    workflowCount: inspection.workflowCount,
    templateCount: inspection.templateCount,
    skillCount: inspection.skillCount,
    installedChecks: inspection.installedChecks,
    issues: inspection.issues
  };
  output.write(json ? formatRecord(result, true) : formatIntegrationStatus(result));
  return { exitCode: inspection.ok ? 0 : 1 };
}

async function integrationTargets(
  context: CliContext,
  args: ParsedArgs,
  scope: SkillInstallScope
): Promise<readonly IntegrationTarget[]> {
  const explicit = flagValues(args, "target")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .map(asIntegrationTarget);
  if (explicit.length > 0) {
    return uniqueTargets(explicit);
  }
  if (scope === "project") {
    const config = await readProjectSetupConfig(context.workspaceRoot);
    if (config?.skillTargets && config.skillTargets.length > 0) {
      return config.skillTargets;
    }
  }
  return ["codex"];
}

function asIntegrationTarget(value: string | undefined): IntegrationTarget {
  if (value === "codex" || value === "claude" || value === "skills") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Integration target must be codex, claude, or skills", { target: value });
}

function uniqueTargets(targets: readonly IntegrationTarget[]): readonly IntegrationTarget[] {
  return [...new Set(targets)];
}

function formatIntegrationStatus(result: {
  readonly scope: SkillInstallScope;
  readonly workspaceRoot: string;
  readonly targets: readonly IntegrationTarget[];
  readonly workflowCount: number;
  readonly templateCount: number;
  readonly skillCount: number;
  readonly installedChecks: readonly {
    readonly target: IntegrationTarget;
    readonly installRoot: string;
    readonly skillRoot: string;
    readonly expectedFileCount: number;
    readonly checkedFileCount: number;
  }[];
  readonly issues: readonly { readonly code: string; readonly path: string; readonly message: string }[];
}): string {
  const lines = [
    `Boreal integrations (${result.scope})`,
    `workspace: ${result.workspaceRoot}`,
    `assets: ${result.workflowCount} workflows, ${result.templateCount} templates, ${result.skillCount} skills`,
    ...result.installedChecks.map((check) =>
      `  ${check.target}: ${check.checkedFileCount}/${check.expectedFileCount} files at ${check.skillRoot}`
    ),
    ...(result.issues.length > 0
      ? ["issues:", ...result.issues.map((issue) => `  ${issue.code}: ${issue.path}: ${issue.message}`)]
      : ["status: ready"])
  ];
  return `${lines.join("\n")}\n`;
}
