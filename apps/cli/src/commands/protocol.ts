import { BorealError, type AgentDirectiveBundle } from "@boreal/core";

import type { ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

type ProtocolCommandGroup = "prime" | "status" | "next" | "session";
type ProtocolKind = "prime" | "session_start" | "session_end";
type ProtocolNextCommandResult = { readonly bundleMeta?: unknown; readonly directive?: unknown } & Record<string, unknown>;

interface ProtocolDirectiveSubject {
  readonly type: "workspace" | "session";
  readonly id: string;
  readonly title: string;
}

export interface ProtocolCommandDependencies {
  readonly agentIdFromArgs: (args: ParsedArgs, fallback: string) => string;
  readonly labelsFromArgs: (args: ParsedArgs) => readonly string[];
  readonly buildAgentProtocolBrief: (
    kind: ProtocolKind,
    context: CliContext,
    agentId: string,
    labels: readonly string[]
  ) => Promise<unknown>;
  readonly buildNextCommandResult: (
    context: CliContext,
    args: ParsedArgs,
    agentId: string,
    labels: readonly string[]
  ) => Promise<ProtocolNextCommandResult>;
  readonly nextResultBundle: (result: ProtocolNextCommandResult) => AgentDirectiveBundle;
  readonly formatNextCommandResult: (result: unknown) => string;
  readonly formatRecordWithAgentDirectives: (
    context: CliContext,
    args: ParsedArgs,
    value: unknown,
    json: boolean,
    options?: { readonly subject: ProtocolDirectiveSubject }
  ) => Promise<string>;
}

export async function protocolCommand(
  group: ProtocolCommandGroup,
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: ProtocolCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "prime":
    case "status":
      return primeCommand(context, args, output, json, dependencies);
    case "next":
      return nextCommand(context, args, output, json, dependencies);
    case "session":
      return sessionCommand(action, context, args, output, json, dependencies);
  }
}

async function primeCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: ProtocolCommandDependencies
): Promise<CommandResult> {
  const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
  const labels = dependencies.labelsFromArgs(args);
  const result = await dependencies.buildAgentProtocolBrief("prime", context, agentId, labels);
  output.write(await dependencies.formatRecordWithAgentDirectives(context, args, result, json, {
    subject: { type: "workspace", id: context.workspaceRoot, title: context.workspaceRoot }
  }));
  return { exitCode: 0 };
}

async function nextCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: ProtocolCommandDependencies
): Promise<CommandResult> {
  const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
  const labels = dependencies.labelsFromArgs(args);
  const result = await dependencies.buildNextCommandResult(context, args, agentId, labels);
  output.write(
    json
      ? formatRecord(result, true, { agentDirectives: result.bundleMeta && result.directive ? [dependencies.nextResultBundle(result)] : [] })
      : dependencies.formatNextCommandResult(result)
  );
  return { exitCode: 0 };
}

async function sessionCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: ProtocolCommandDependencies
): Promise<CommandResult> {
  const agentId = dependencies.agentIdFromArgs(args, context.actor.id);
  const labels = dependencies.labelsFromArgs(args);
  switch (action) {
    case "start":
      output.write(
        await dependencies.formatRecordWithAgentDirectives(context, args, await dependencies.buildAgentProtocolBrief("session_start", context, agentId, labels), json, {
          subject: { type: "session", id: context.sessionId, title: context.sessionId }
        })
      );
      return { exitCode: 0 };
    case "end":
      output.write(
        await dependencies.formatRecordWithAgentDirectives(context, args, await dependencies.buildAgentProtocolBrief("session_end", context, agentId, labels), json, {
          subject: { type: "session", id: context.sessionId, title: context.sessionId }
        })
      );
      return { exitCode: 0 };
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown session command: ${action ?? ""}`);
  }
}
