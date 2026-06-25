import { BorealError } from "@boreal/core";
import type { ParsedArgs } from "./args.js";

export type FlagType = "boolean" | "value";

export interface FlagDefinition {
  readonly name: string;
  readonly type: FlagType;
  readonly summary: string;
  readonly repeatable?: boolean;
}

export interface CommandDefinition {
  readonly path: readonly string[];
  readonly category:
    | "workspace"
    | "work"
    | "evidence"
    | "source"
    | "claim"
    | "decision"
    | "context"
    | "doctor"
    | "lock"
    | "meta";
  readonly summary: string;
  readonly usage: string;
  readonly description?: string;
  readonly flags: readonly FlagDefinition[];
  readonly positionals?: {
    readonly label: string;
    readonly min: number;
    readonly max?: number;
  };
  readonly requiresWorkspace: boolean;
  readonly supportsJson: boolean;
}

export const GLOBAL_FLAGS: readonly FlagDefinition[] = [
  {
    name: "workspace",
    type: "value",
    summary: "Workspace directory. Defaults to the current directory.",
  },
  {
    name: "json",
    type: "boolean",
    summary: "Emit a JSON envelope instead of human-readable text.",
  },
  {
    name: "actor",
    type: "value",
    summary: "Actor identifier to record in command events.",
  },
  {
    name: "actor-kind",
    type: "value",
    summary: "Actor kind to record in command events.",
  },
  {
    name: "help",
    type: "boolean",
    summary: "Show command help.",
  },
];

const flag = (
  name: string,
  type: FlagType,
  summary: string,
  repeatable = false,
): FlagDefinition => ({
  name,
  type,
  summary,
  repeatable,
});

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  {
    path: ["init"],
    category: "workspace",
    summary: "Initialize a Boreal workspace.",
    usage: "bwrk init [--workspace <dir>] [--json]",
    description: "Creates the workspace metadata directory and state store if they do not already exist.",
    flags: [],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: false,
    supportsJson: true,
  },
  {
    path: ["commands"],
    category: "meta",
    summary: "List the registered command surface.",
    usage: "bwrk commands [--json]",
    description: "Prints the command registry used by validation, help, and machine consumers.",
    flags: [],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: false,
    supportsJson: true,
  },
  {
    path: ["work", "create"],
    category: "work",
    summary: "Create a work item.",
    usage:
      "bwrk work create <title> [--description <text>] [--priority <n>] [--kind <kind>] [--label <label>...] [--acceptance <text>...] [--ready] [--json]",
    flags: [
      flag("description", "value", "Work description."),
      flag("priority", "value", "Numeric priority. Higher values sort first."),
      flag("kind", "value", "Work kind."),
      flag("label", "value", "Label to attach to the work item.", true),
      flag("acceptance", "value", "Acceptance criterion.", true),
      flag("ready", "boolean", "Create the item as ready when policy allows it."),
    ],
    positionals: { label: "title", min: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "ready"],
    category: "work",
    summary: "Mark work ready.",
    usage: "bwrk work ready <work-id> [--json]",
    flags: [],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "list"],
    category: "work",
    summary: "List work items.",
    usage: "bwrk work list [--ready] [--status <status>] [--label <label>...] [--limit <n>] [--json]",
    flags: [
      flag("ready", "boolean", "Only include ready work."),
      flag("status", "value", "Only include work with this status."),
      flag("label", "value", "Only include work with this label.", true),
      flag("limit", "value", "Maximum number of work items to print."),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "show"],
    category: "work",
    summary: "Show one work item.",
    usage: "bwrk work show <work-id> [--json]",
    flags: [],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "block"],
    category: "work",
    summary: "Make one work item depend on another.",
    usage: "bwrk work block <work-id> <blocked-by-work-id> [--json]",
    flags: [],
    positionals: { label: "work ids", min: 2, max: 2 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "reserve"],
    category: "work",
    summary: "Reserve ready work for an agent.",
    usage:
      "bwrk work reserve <work-id> --agent <agent-id> [--purpose <text>] [--force --reason <text>] [--json]",
    flags: [
      flag("agent", "value", "Agent identifier taking the reservation."),
      flag("purpose", "value", "Reservation purpose."),
      flag("force", "boolean", "Allow a documented reservation of non-ready work."),
      flag("reason", "value", "Required reason when --force is set."),
    ],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "verify"],
    category: "work",
    summary: "Verify work with evidence.",
    usage: "bwrk work verify <work-id> --evidence <evidence-id>... [--verdict passed|failed] [--notes <text>] [--json]",
    flags: [
      flag("evidence", "value", "Evidence record to attach to the verification.", true),
      flag("verdict", "value", "Verification verdict. Defaults to passed."),
      flag("notes", "value", "Verification notes."),
    ],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["work", "close"],
    category: "work",
    summary: "Close verified work.",
    usage: "bwrk work close <work-id> [--reason <text>] [--json]",
    flags: [flag("reason", "value", "Close reason.")],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["evidence", "add"],
    category: "evidence",
    summary: "Add an evidence record.",
    usage:
      "bwrk evidence add <work-id> --summary <text> [--kind <kind>] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--json]",
    flags: [
      flag("summary", "value", "Evidence summary."),
      flag("kind", "value", "Evidence kind."),
      flag("outcome", "value", "Evidence outcome. Defaults to observed."),
      flag("command", "value", "Command that produced the evidence."),
      flag("uri", "value", "URI for external evidence."),
    ],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["source", "add"],
    category: "source",
    summary: "Add a knowledge source.",
    usage:
      "bwrk source add --title <text> --uri <uri> [--kind raw|document|chat|code|artifact] [--summary <text>] [--json]",
    flags: [
      flag("title", "value", "Source title."),
      flag("uri", "value", "Source URI."),
      flag("kind", "value", "Source kind. Defaults to document."),
      flag("summary", "value", "Source summary."),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["source", "list"],
    category: "source",
    summary: "List knowledge sources.",
    usage: "bwrk source list [--kind raw|document|chat|code|artifact] [--limit <n>] [--json]",
    flags: [
      flag("kind", "value", "Only include sources with this kind."),
      flag("limit", "value", "Maximum number of sources to print."),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["source", "show"],
    category: "source",
    summary: "Show one knowledge source.",
    usage: "bwrk source show <source-id> [--json]",
    flags: [],
    positionals: { label: "source id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["claim", "create"],
    category: "claim",
    summary: "Create a knowledge claim.",
    usage:
      "bwrk claim create --statement <text> [--status proposed|accepted|rejected|stale] [--source <source-id>...] [--evidence <evidence-id>...] [--json]",
    flags: [
      flag("statement", "value", "Claim statement."),
      flag("status", "value", "Claim status. Defaults to proposed."),
      flag("source", "value", "Source supporting the claim.", true),
      flag("evidence", "value", "Evidence supporting the claim.", true),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["claim", "list"],
    category: "claim",
    summary: "List knowledge claims.",
    usage: "bwrk claim list [--status proposed|accepted|rejected|stale] [--source <source-id>] [--limit <n>] [--json]",
    flags: [
      flag("status", "value", "Only include claims with this status."),
      flag("source", "value", "Only include claims referencing this source."),
      flag("limit", "value", "Maximum number of claims to print."),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["claim", "show"],
    category: "claim",
    summary: "Show one knowledge claim.",
    usage: "bwrk claim show <claim-id> [--json]",
    flags: [],
    positionals: { label: "claim id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["decision", "create"],
    category: "decision",
    summary: "Create a decision record.",
    usage:
      "bwrk decision create --title <text> --decision <text> [--context <text>] [--status proposed|accepted|superseded|rejected] [--consequence <text>...] [--source <source-id>...] [--json]",
    flags: [
      flag("title", "value", "Decision title."),
      flag("decision", "value", "Decision text."),
      flag("context", "value", "Decision context."),
      flag("status", "value", "Decision status. Defaults to accepted."),
      flag("consequence", "value", "Decision consequence.", true),
      flag("source", "value", "Source informing the decision.", true),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["decision", "list"],
    category: "decision",
    summary: "List decisions.",
    usage: "bwrk decision list [--status proposed|accepted|superseded|rejected] [--source <source-id>] [--limit <n>] [--json]",
    flags: [
      flag("status", "value", "Only include decisions with this status."),
      flag("source", "value", "Only include decisions referencing this source."),
      flag("limit", "value", "Maximum number of decisions to print."),
    ],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["decision", "show"],
    category: "decision",
    summary: "Show one decision.",
    usage: "bwrk decision show <decision-id> [--json]",
    flags: [],
    positionals: { label: "decision id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["context", "rebuild"],
    category: "context",
    summary: "Rebuild context pack projections.",
    usage: "bwrk context rebuild [--json]",
    flags: [],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["context", "show"],
    category: "context",
    summary: "Show a work context pack.",
    usage: "bwrk context show <work-id> [--json]",
    flags: [],
    positionals: { label: "work id", min: 1, max: 1 },
    requiresWorkspace: true,
    supportsJson: true,
  },
  {
    path: ["doctor"],
    category: "doctor",
    summary: "Inspect workspace integrity.",
    usage: "bwrk doctor [--fix] [--json]",
    description: "Checks state shape, references, graph consistency, reservations, verification policy, and stale readiness.",
    flags: [flag("fix", "boolean", "Apply supported safe repairs.")],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: false,
    supportsJson: true,
  },
  {
    path: ["lock", "inspect"],
    category: "lock",
    summary: "Inspect the workspace lock.",
    usage: "bwrk lock inspect [--json]",
    flags: [],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: false,
    supportsJson: true,
  },
  {
    path: ["lock", "break"],
    category: "lock",
    summary: "Break a stale or orphaned workspace lock.",
    usage: "bwrk lock break [--stale-only] [--json]",
    flags: [flag("stale-only", "boolean", "Only break locks older than the stale threshold.")],
    positionals: { label: "arguments", min: 0, max: 0 },
    requiresWorkspace: false,
    supportsJson: true,
  },
];

const commandMatches = (command: readonly string[], definition: CommandDefinition): boolean => {
  if (command.length < definition.path.length) {
    return false;
  }
  return definition.path.every((segment, index) => command[index] === segment);
};

export const findCommandDefinition = (command: readonly string[]): CommandDefinition | undefined =>
  COMMAND_DEFINITIONS.filter((definition) => commandMatches(command, definition)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];

export const commandPath = (definition: CommandDefinition): string => definition.path.join(" ");

export const serializeCommandDefinition = (definition: CommandDefinition) => ({
  path: definition.path,
  category: definition.category,
  summary: definition.summary,
  usage: definition.usage,
  description: definition.description,
  requiresWorkspace: definition.requiresWorkspace,
  supportsJson: definition.supportsJson,
  positionals: definition.positionals,
  flags: [...GLOBAL_FLAGS, ...definition.flags].map((entry) => ({
    name: entry.name,
    type: entry.type,
    repeatable: Boolean(entry.repeatable),
    summary: entry.summary,
  })),
});

export const validateCommandFlags = (args: ParsedArgs, definition: CommandDefinition): void => {
  const allowedFlags = new Map<string, FlagDefinition>();
  for (const entry of [...GLOBAL_FLAGS, ...definition.flags]) {
    allowedFlags.set(entry.name, entry);
  }

  for (const [name, values] of args.flags.entries()) {
    const definitionForFlag = allowedFlags.get(name);
    if (!definitionForFlag) {
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        `Unknown flag --${name} for bwrk ${commandPath(definition)}`,
        {
          command: definition.path,
          flag: name,
        },
      );
    }
    if (!definitionForFlag.repeatable && values.length > 1) {
      throw new BorealError(
        "BOREAL_INVALID_INPUT",
        `Flag --${name} may only be provided once for bwrk ${commandPath(definition)}`,
        {
          command: definition.path,
          flag: name,
        },
      );
    }
    if (definitionForFlag.type === "boolean") {
      const invalidValue = values.find((value) => value !== "true" && value !== "false");
      if (invalidValue) {
        throw new BorealError(
          "BOREAL_INVALID_INPUT",
          `Flag --${name} expects a boolean value for bwrk ${commandPath(definition)}`,
          {
            command: definition.path,
            flag: name,
            value: invalidValue,
          },
        );
      }
    }
  }

  const positionals = args.command.slice(definition.path.length);
  const positionalRule = definition.positionals ?? { label: "arguments", min: 0, max: 0 };
  if (positionals.length < positionalRule.min) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      `Missing ${positionalRule.label} for bwrk ${commandPath(definition)}`,
      {
        command: definition.path,
        expected: positionalRule,
        actual: positionals.length,
      },
    );
  }
  if (positionalRule.max !== undefined && positionals.length > positionalRule.max) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      `Unexpected argument for bwrk ${commandPath(definition)}`,
      {
        command: definition.path,
        expected: positionalRule,
        actual: positionals,
      },
    );
  }
};
