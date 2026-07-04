import { BorealError } from "@boreal/core";

import { flagValue, type ParsedArgs } from "../args.js";
import { box } from "../branding.js";
import {
  COMMAND_DEFINITIONS,
  commandBehavior,
  commandPath,
  serializeCommandDefinition
} from "../command-registry.js";
import { COMPLETION_SHELLS, generateShellCompletion, isCompletionShell } from "../completion.js";
import { formatRecord, type CliOutput } from "../output.js";
import { getVersionInfo } from "../version.js";
import type { CommandResult } from "./shared.js";

const CLI_RESULT_SCHEMA_VERSION = "boreal.cli.result.v1";

const CLI_JSON_OUTPUT_CONTRACT = {
  successEnvelope: {
    okPath: "ok",
    dataPath: "data"
  },
  mutationResult: {
    path: "data.result",
    schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    fields: ["id", "kind", "status", "subjectId"] as const
  }
};

export const HELP_SECTIONS: readonly { readonly title: string; readonly categories: readonly string[] }[] = [
  { title: "Start", categories: ["workspace", "install", "docs"] },
  { title: "Work", categories: ["work", "dependency", "evidence", "gate"] },
  { title: "Plan", categories: ["sprint", "workflow"] },
  { title: "Knowledge", categories: ["source", "claim", "decision", "context", "search", "raw", "wiki", "vault"] },
  { title: "Agents", categories: ["agent", "session", "reservation", "operation", "directive"] },
  { title: "Dashboards", categories: ["dashboard", "registry"] },
  { title: "Maintain", categories: ["doctor", "sync", "storage", "lock", "ledger", "snapshot", "duplicate", "merge", "compact", "daemon"] },
  { title: "Data", categories: ["export", "import"] },
  { title: "Meta", categories: ["meta", "schema"] }
];

export function commandsCommand(args: ParsedArgs, output: CliOutput, json: boolean): CommandResult {
  const format = commandsFormat(args);
  const registry = {
    jsonOutput: CLI_JSON_OUTPUT_CONTRACT,
    commands: COMMAND_DEFINITIONS.map(serializeCommandDefinition)
  };
  if (json) {
    output.write(formatRecord(registry, true));
  } else if (format === "markdown") {
    output.write(commandsMarkdown());
  } else {
    output.write(formatCommandsGrouped());
  }
  return { exitCode: 0 };
}

export function completionCommand(args: ParsedArgs, output: CliOutput, json: boolean): CommandResult {
  const shell = args.command[1] ?? "";
  if (!isCompletionShell(shell)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Completion shell must be one of: ${COMPLETION_SHELLS.join(", ")}`, {
      shell
    });
  }
  const name = flagValue(args, "name") ?? "bwrk";
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--name must contain only letters, numbers, dots, underscores, or dashes", {
      name
    });
  }
  const result = generateShellCompletion(shell, name);
  output.write(json ? formatRecord(result, true) : result.script);
  return { exitCode: 0 };
}

function formatCommandsGrouped(): string {
  const version = getVersionInfo().version;
  const lines: string[] = [box([`Boreal Work · command reference   v${version}`]), ""];
  const covered = new Set(HELP_SECTIONS.flatMap((section) => section.categories));
  const renderSection = (title: string, defs: readonly (typeof COMMAND_DEFINITIONS)[number][]): void => {
    if (defs.length === 0) return;
    const width = defs.reduce((max, definition) => Math.max(max, commandPath(definition).length), 0);
    lines.push(`▌ ${title.toUpperCase()}`);
    for (const definition of defs) {
      lines.push(`    ${commandPath(definition).padEnd(width)}   ${definition.summary}`);
    }
    lines.push("");
  };
  for (const section of HELP_SECTIONS) {
    renderSection(
      section.title,
      COMMAND_DEFINITIONS.filter((definition) => section.categories.includes(definition.category))
    );
  }
  renderSection(
    "More",
    COMMAND_DEFINITIONS.filter((definition) => !covered.has(definition.category))
  );
  lines.push(" bwrk help <command> for full usage · bwrk commands --format markdown for docs");
  return lines.join("\n");
}

function commandsFormat(args: ParsedArgs): "table" | "markdown" {
  const format = flagValue(args, "format") ?? "table";
  if (format === "table" || format === "markdown") {
    return format;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--format must be table or markdown");
}

function commandsMarkdown(): string {
  const lines = [
    "# Boreal Command Reference",
    "",
    "Generated from `COMMAND_DEFINITIONS`; use the hand-written CLI guide for workflow notes.",
    ""
  ];

  for (const definition of COMMAND_DEFINITIONS) {
    const behavior = commandBehavior(definition);
    lines.push(
      `## \`${commandPath(definition)}\``,
      "",
      "```bash",
      definition.usage,
      "```",
      "",
      definition.description ?? definition.summary,
      "",
      `- Category: \`${definition.category}\``,
      `- Requires workspace: \`${definition.requiresWorkspace ? "yes" : "no"}\``,
      `- Supports JSON: \`${definition.supportsJson ? "yes" : "no"}\``,
      `- Lock: \`${behavior.requiresLock}\``,
      `- Output schema: \`${behavior.jsonOutputSchema}\``
    );

    if (definition.flags.length > 0) {
      lines.push("", "Flags:");
      for (const flag of definition.flags) {
        const valueSuffix = flag.type === "value" ? " <value>" : "";
        const repeatable = flag.repeatable ? " Repeatable." : "";
        lines.push(`- \`--${flag.name}${valueSuffix}\`: ${flag.summary}${repeatable}`);
      }
    }

    lines.push("", "Examples:");
    for (const example of behavior.examples) {
      lines.push(`- \`${example}\``);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
