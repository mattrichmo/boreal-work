import { BorealError } from "@boreal/core";

import type { ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { resultSummary, section } from "../cli-ui.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import { getWorkflowAsset, listWorkflowAssets } from "../workflow-assets.js";
import type { CommandResult } from "./shared.js";

export interface WorkflowsCommandDependencies {
  readonly dashboardView: (args: ParsedArgs) => boolean;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
}

export async function workflowsCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: WorkflowsCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const workflows = await listWorkflowAssets({ workspaceRoot: context.workspaceRoot });
      const rows = workflows.map((workflow) => ({
        id: workflow.id,
        title: workflow.title,
        group: workflow.group,
        path: workflow.path,
        commands: workflow.allowedCommands.length,
        templates: workflow.templates.filter((template) => template !== "none").length
      }));
      output.write(json ? formatRecord(rows, true) : dependencies.dashboardView(args) ? formatWorkflowDashboard(rows) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const workflow = await getWorkflowAsset(dependencies.requiredPositional(rest, 0, "workflow reference"), {
        workspaceRoot: context.workspaceRoot
      });
      output.write(json ? formatRecord(workflow, true) : workflow.text);
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown workflows command: ${action ?? ""}`);
  }
}

function formatWorkflowDashboard(
  rows: readonly {
    readonly id: string;
    readonly title: string;
    readonly group: string;
    readonly path: string;
    readonly commands: number;
    readonly templates: number;
  }[]
): string {
  const groups = [...new Set(rows.map((row) => row.group))].sort();
  return [
    resultSummary({ status: "info", title: "Workflow picker", detail: `${rows.length} workflows available` }),
    ...groups.map((group) =>
      section(
        group,
        rows
          .filter((row) => row.group === group)
          .sort((left, right) => left.path.localeCompare(right.path))
          .map((row) => `${row.path} - ${row.title} (${row.commands} commands, ${row.templates} templates)`)
      )
    )
  ].join("\n\n") + "\n";
}
