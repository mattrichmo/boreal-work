import { BorealError, type AgentDirectiveSubjectType } from "@boreal/core";
import { breakStaleFileLock } from "@boreal/storage";

import { hasFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { runDoctor, type DoctorResult } from "../doctor.js";
import { inspectRuntimeLocks, type RuntimeLockInspectionResult } from "../locks.js";
import { formatRecord, type CliOutput } from "../output.js";
import { inspectWorkflowAssets, type InstalledSkillRootValidationInput } from "../workflow-assets.js";
import {
  clearCircuitBreakers,
  type CommandResult
} from "./shared.js";

type HealthCommandGroup = "doctor" | "schema" | "docs" | "gate" | "lock";
type WorkflowAssetInspectionResult = Awaited<ReturnType<typeof inspectWorkflowAssets>>;

interface HealthDirectiveSubject {
  readonly type: AgentDirectiveSubjectType;
  readonly id: string;
  readonly title: string;
}

export interface HealthCommandDependencies {
  readonly installedSkillChecks: (context: CliContext, args: ParsedArgs) => Promise<readonly InstalledSkillRootValidationInput[]>;
  readonly formatSkillDoctor: (result: WorkflowAssetInspectionResult) => string;
  readonly doctorResultCanAttachDirectives: (result: DoctorResult) => boolean;
  readonly formatRecordWithAgentDirectives: (
    context: CliContext,
    args: ParsedArgs,
    value: unknown,
    json: boolean,
    options?: {
      readonly doctorResult?: DoctorResult;
      readonly subject?: HealthDirectiveSubject;
    }
  ) => Promise<string>;
  readonly dashboardView: (args: ParsedArgs) => boolean;
  readonly formatDoctorDashboard: (result: DoctorResult) => string;
  readonly formatDiagnostic: (diagnostic: DoctorResult["diagnostics"][number]) => string;
  readonly schemaValidateResult: (context: CliContext) => Promise<{ readonly ok: boolean } & Record<string, unknown>>;
  readonly docsCheckResult: (context: CliContext) => Promise<{ readonly ok: boolean } & Record<string, unknown>>;
  readonly gateCloseoutResult: (context: CliContext, args: ParsedArgs) => Promise<{ readonly ok: boolean } & Record<string, unknown>>;
  readonly formatLockDashboard: (result: RuntimeLockInspectionResult) => string;
}

export async function healthCommand(
  group: HealthCommandGroup,
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: HealthCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "doctor":
      return doctorCommand(action, context, args, output, json, dependencies);
    case "schema":
      return schemaCommand(action, context, output, json, dependencies);
    case "docs":
      return docsCommand(action, context, output, json, dependencies);
    case "gate":
      return gateCommand(action, context, args, output, json, dependencies);
    case "lock":
      return lockCommand(action, context, args, output, json, dependencies);
  }
}

async function doctorCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: HealthCommandDependencies
): Promise<CommandResult> {
  if (action === "skills") {
    const result = await inspectWorkflowAssets({
      workspaceRoot: context.workspaceRoot,
      installChecks: await dependencies.installedSkillChecks(context, args)
    });
    output.write(json ? formatRecord(result, true) : dependencies.formatSkillDoctor(result));
    return { exitCode: result.ok ? 0 : 1 };
  }
  if (action !== undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown doctor command: ${action}`);
  }
  const result = await runDoctor(context, hasFlag(args, "fix"), hasFlag(args, "strict"));
  if (hasFlag(args, "fix") && result.ok) {
    await clearCircuitBreakers(context);
  }
  if (json) {
    output.write(
      dependencies.doctorResultCanAttachDirectives(result)
        ? await dependencies.formatRecordWithAgentDirectives(context, args, result, true, {
            doctorResult: result,
            subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
          })
        : formatRecord(result, true)
    );
  } else if (dependencies.dashboardView(args)) {
    output.write(dependencies.formatDoctorDashboard(result));
  } else {
    output.write(result.diagnostics.map(dependencies.formatDiagnostic).join("\n") + "\n");
  }
  return { exitCode: result.ok ? 0 : 1 };
}

async function schemaCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean,
  dependencies: HealthCommandDependencies
): Promise<CommandResult> {
  if (action !== "validate") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown schema command: ${action ?? ""}`);
  }
  const result = await dependencies.schemaValidateResult(context);
  output.write(formatRecord(result, json));
  return { exitCode: result.ok ? 0 : 1 };
}

async function docsCommand(
  action: string | undefined,
  context: CliContext,
  output: CliOutput,
  json: boolean,
  dependencies: HealthCommandDependencies
): Promise<CommandResult> {
  if (action !== "check") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown docs command: ${action ?? ""}`);
  }
  const result = await dependencies.docsCheckResult(context);
  output.write(formatRecord(result, json));
  return { exitCode: result.ok ? 0 : 1 };
}

async function gateCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: HealthCommandDependencies
): Promise<CommandResult> {
  if (action !== undefined && action !== "closeout") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown gate command: ${action}`);
  }
  const result = await dependencies.gateCloseoutResult(context, args);
  output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, {
    subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
  }));
  return { exitCode: result.ok ? 0 : 1 };
}

async function lockCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: HealthCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "inspect": {
      const inspection = await inspectRuntimeLocks(context);
      output.write(json ? formatRecord(inspection, true) : dependencies.dashboardView(args) ? dependencies.formatLockDashboard(inspection) : formatRecord(inspection, false));
      return { exitCode: 0 };
    }
    case "break": {
      if (!hasFlag(args, "stale-only")) {
        throw new BorealError("BOREAL_INVALID_INPUT", "`bwrk lock break` requires --stale-only");
      }
      const result = await breakStaleFileLock(context.paths.stateLockDir);
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown lock command: ${action ?? ""}`);
  }
}
