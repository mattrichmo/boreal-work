import {
  BorealError,
  type EvidenceKind,
  type EvidenceOutcome,
  type VerificationVerdict,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import { breakStaleFileLock, inspectFileLock } from "@boreal/storage";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "./args.js";
import { asEvidenceId, asWorkId, runDoctor, type Diagnostic } from "./doctor.js";
import { assertInitialized, createCliContext, ensureWorkspaceDirs, type CliContext } from "./context.js";
import { formatRecord, table, type CliOutput } from "./output.js";

export interface CommandResult {
  readonly exitCode: number;
}

interface WorkListRow {
  readonly id: string;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly title: string;
  readonly labels: readonly string[];
}

export async function runCommand(args: ParsedArgs, output: CliOutput, cwd: string): Promise<CommandResult> {
  if (args.command.length === 0) {
    output.write(helpText());
    return { exitCode: 0 };
  }
  if (args.command[0] === "help") {
    output.write(helpText(args.command[1]));
    return { exitCode: 0 };
  }
  if (hasFlag(args, "help")) {
    output.write(helpText(args.command[0]));
    return { exitCode: 0 };
  }

  const context = await createCliContext(args, cwd);
  const json = hasFlag(args, "json");
  const [group, action, ...rest] = args.command;

  switch (group) {
    case "init":
      return initCommand(context, args, output, json);
    case "work":
      assertInitialized(context);
      return workCommand(action, rest, context, args, output, json);
    case "evidence":
      assertInitialized(context);
      return evidenceCommand(action, rest, context, args, output, json);
    case "doctor":
      return doctorCommand(context, args, output, json);
    case "lock":
      return lockCommand(action, context, args, output, json);
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown command: ${group ?? ""}`);
  }
}

async function initCommand(
  context: CliContext,
  _args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  await ensureWorkspaceDirs(context);
  const result = await context.runtime.ensureWorkspaceInitialized();
  output.write(
    formatRecord(
      { initialized: result.initialized, workspaceRoot: context.workspaceRoot, eventId: result.event.meta.id },
      json
    )
  );
  return { exitCode: 0 };
}

async function workCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const title = flagValue(args, "title") ?? rest.join(" ").trim();
      if (!title) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Work title is required");
      }
      const work = await context.runtime.createWork({
        title,
        description: flagValue(args, "description"),
        kind: parseWorkKind(flagValue(args, "kind")),
        priority: parsePriority(flagValue(args, "priority")),
        acceptanceCriteria: flagValues(args, "acceptance"),
        labels: flagValues(args, "label"),
        ready: hasFlag(args, "ready")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "ready": {
      const work = await context.runtime.markReady(asWorkId(requiredPositional(rest, 0, "work id")));
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = listStatus(args);
      const labels = flagValues(args, "label");
      const limit = parseLimit(flagValue(args, "limit"));
      const items = await context.store.read((reader) =>
        reader.listWorkItems({
          status,
          labels: labels.length > 0 ? labels : undefined
        })
      );
      const rows = items.slice(0, limit ?? items.length).map(workListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWorkListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const view = await context.runtime.getWorkView(asWorkId(requiredPositional(rest, 0, "work id")));
      output.write(formatRecord(view, json));
      return { exitCode: 0 };
    }
    case "block": {
      const blockedWorkId = asWorkId(requiredPositional(rest, 0, "blocked work id"));
      const blockingWorkId = asWorkId(requiredPositional(rest, 1, "blocking work id"));
      const work = await context.runtime.addBlockingDependency({ blockedWorkId, blockingWorkId });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "reserve": {
      const work = await context.runtime.reserveWork({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        agentId: flagValue(args, "agent") ?? context.actor.id,
        purpose: flagValue(args, "purpose")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    case "verify": {
      const evidenceIds = flagValues(args, "evidence").map(asEvidenceId);
      const verification = await context.runtime.verifyWork({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        verdict: parseVerdict(flagValue(args, "verdict")),
        evidenceIds,
        notes: flagValue(args, "notes")
      });
      output.write(formatRecord(verification, json));
      return { exitCode: 0 };
    }
    case "close": {
      const work = await context.runtime.closeWork({
        workId: asWorkId(requiredPositional(rest, 0, "work id")),
        reason: requiredFlag(args, "reason")
      });
      output.write(formatRecord(work, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown work command: ${action ?? ""}`);
  }
}

async function evidenceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action !== "add") {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown evidence command: ${action ?? ""}`);
  }

  const evidence = await context.runtime.recordEvidence({
    subjectId: asWorkId(requiredPositional(rest, 0, "work id")),
    subjectType: "work",
    kind: parseEvidenceKind(flagValue(args, "kind")),
    summary: requiredFlag(args, "summary"),
    outcome: parseOutcome(flagValue(args, "outcome")),
    command: flagValue(args, "command"),
    uri: flagValue(args, "uri")
  });
  output.write(formatRecord(evidence, json));
  return { exitCode: 0 };
}

async function doctorCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const result = await runDoctor(context, hasFlag(args, "fix"));
  if (json) {
    output.write(formatRecord(result, true));
  } else {
    output.write(result.diagnostics.map(formatDiagnostic).join("\n") + "\n");
  }
  return { exitCode: result.ok ? 0 : 1 };
}

async function lockCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "inspect": {
      const inspection = await inspectFileLock(context.paths.stateLockDir);
      output.write(formatRecord(inspection, json));
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

function requiredPositional(values: readonly string[], index: number, label: string): string {
  const value = values[index];
  if (!value) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Missing ${label}`);
  }
  return value;
}

function parseWorkKind(value: string | undefined): WorkKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "issue" || value === "task" || value === "sprint" || value === "milestone") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be issue, task, sprint, or milestone");
}

function parsePriority(value: string | undefined): WorkPriority | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "low" || value === "normal" || value === "high" || value === "critical") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--priority must be low, normal, high, or critical");
}

function listStatus(args: ParsedArgs): WorkStatus | undefined {
  const status = parseWorkStatus(flagValue(args, "status"));
  if (!hasFlag(args, "ready")) {
    return status;
  }
  if (status && status !== "ready") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--ready cannot be combined with a different --status value");
  }
  return "ready";
}

function parseWorkStatus(value: string | undefined): WorkStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "draft" ||
    value === "ready" ||
    value === "reserved" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "needs_verification" ||
    value === "verified" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new BorealError(
    "BOREAL_INVALID_INPUT",
    "--status must be draft, ready, reserved, in_progress, blocked, needs_verification, verified, closed, or cancelled"
  );
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--limit must be a positive integer");
  }
  return parsed;
}

function parseEvidenceKind(value: string | undefined): EvidenceKind {
  const kind = value ?? "command";
  if (kind === "command" || kind === "test" || kind === "diff" || kind === "review" || kind === "artifact" || kind === "note") {
    return kind;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be command, test, diff, review, artifact, or note");
}

function parseOutcome(value: string | undefined): EvidenceOutcome {
  const outcome = value ?? "observed";
  if (outcome === "passed" || outcome === "failed" || outcome === "observed" || outcome === "unknown") {
    return outcome;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--outcome must be passed, failed, observed, or unknown");
}

function parseVerdict(value: string | undefined): VerificationVerdict {
  const verdict = value ?? "passed";
  if (verdict === "passed" || verdict === "failed") {
    return verdict;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--verdict must be passed or failed");
}

function workListRow(work: {
  readonly meta: { readonly id: string };
  readonly title: string;
  readonly status: WorkStatus;
  readonly priority: string;
  readonly labels: readonly string[];
}): WorkListRow {
  return {
    id: work.meta.id,
    status: work.status,
    priority: work.priority,
    title: work.title,
    labels: [...work.labels]
  };
}

function textWorkListRow(row: WorkListRow): Record<string, string> {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    title: row.title,
    labels: row.labels.join(",")
  };
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`;
}

function helpText(topic?: string): string {
  switch (topic) {
    case undefined:
      return rootHelpText();
    case "init":
      return `bwrk init

Usage:
  bwrk init [--workspace <path>] [--json]

Initializes a Boreal workspace. The operation is idempotent and safe under concurrent init attempts.
`;
    case "work":
      return `bwrk work

Usage:
  bwrk work create <title> [--description <text>] [--kind issue|task|sprint|milestone] [--priority low|normal|high|critical] [--label <label>] [--acceptance <text>] [--ready] [--json]
  bwrk work ready <work-id> [--json]
  bwrk work list [--ready] [--status <status>] [--label <label>] [--limit <count>] [--json]
  bwrk work show <work-id> [--json]
  bwrk work block <blocked-work-id> <blocking-work-id> [--json]
  bwrk work reserve <work-id> [--agent <id>] [--purpose <text>] [--json]
  bwrk work verify <work-id> --evidence <evidence-id> [--verdict passed|failed] [--notes <text>] [--json]
  bwrk work close <work-id> --reason <text> [--json]
`;
    case "evidence":
      return `bwrk evidence

Usage:
  bwrk evidence add <work-id> --summary <text> [--kind command|test|diff|review|artifact|note] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--json]
`;
    case "doctor":
      return `bwrk doctor

Usage:
  bwrk doctor [--fix] [--json]

Validates workspace state, references, derived readiness, projections, and runtime locks. With --fix, only idempotent repairs run.
`;
    case "lock":
      return `bwrk lock

Usage:
  bwrk lock inspect [--json]
  bwrk lock break --stale-only [--json]

Active locks are never broken. Stale lock breaking coordinates through a recovery lock.
`;
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown help topic: ${topic}`);
  }
}

function rootHelpText(): string {
  return `bwrk - Boreal Work CLI

Usage:
  bwrk init [--workspace <path>] [--json]
  bwrk work create <title> [--description <text>] [--label <label>] [--acceptance <text>] [--ready] [--json]
  bwrk work ready <work-id> [--json]
  bwrk work list [--ready] [--status <status>] [--label <label>] [--limit <count>] [--json]
  bwrk work show <work-id> [--json]
  bwrk work block <blocked-work-id> <blocking-work-id> [--json]
  bwrk work reserve <work-id> [--agent <id>] [--purpose <text>] [--json]
  bwrk evidence add <work-id> --summary <text> [--kind command|test|diff|review|artifact|note] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--json]
  bwrk work verify <work-id> --evidence <evidence-id> [--verdict passed|failed] [--notes <text>] [--json]
  bwrk work close <work-id> --reason <text> [--json]
  bwrk doctor [--fix] [--json]
  bwrk lock inspect [--json]
  bwrk lock break --stale-only [--json]

Help:
  bwrk help [init|work|evidence|doctor|lock]
`;
}
