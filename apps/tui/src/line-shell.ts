import { ActionResult, MountedView, Route } from "./client.js";
import { renderMountedView } from "./terminal.js";

export interface LineShellController {
  view(): MountedView;
  refresh(): Promise<MountedView>;
  navigate(route: Route): MountedView;
  claim(work_id: string, actor_id: string, options?: { harness_id?: string; session_id?: string }): Promise<ActionResult<unknown>>;
  acceptStart(work_id: string, options?: { session_id?: string }): Promise<ActionResult<unknown>>;
  addEvidence(work_id: string, evidence: unknown): Promise<ActionResult<unknown>>;
  finish(work_id: string, summary?: string): Promise<ActionResult<unknown>>;
  release(work_id: string, reason?: string): Promise<ActionResult<unknown>>;
}

export type MutationLineCommand =
  | { kind: "mutation"; action: "claim"; actor_id: string; harness_id?: string; session_id?: string }
  | { kind: "mutation"; action: "accept_start"; session_id?: string }
  | { kind: "mutation"; action: "evidence"; evidence: unknown }
  | { kind: "mutation"; action: "finish"; summary?: string }
  | { kind: "mutation"; action: "release"; reason?: string };

export type LineCommand =
  | { kind: "help" }
  | { kind: "refresh" }
  | { kind: "select"; work_id: string }
  | { kind: "quit" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | MutationLineCommand
  | { kind: "empty" }
  | { kind: "invalid"; input: string; message: string }
  | { kind: "unknown"; input: string };

function invalid(input: string, message: string): LineCommand {
  return { kind: "invalid", input, message };
}

function parseOptions(
  input: string,
  args: readonly string[],
  allowed: ReadonlySet<string>,
): { positional: string[]; values: Record<string, string> } | LineCommand {
  const positional: string[] = [];
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!allowed.has(arg)) return invalid(input, `unsupported option '${arg}'`);
    if (values[arg] !== undefined) return invalid(input, `option '${arg}' may only be provided once`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return invalid(input, `option '${arg}' requires a value`);
    values[arg] = value;
    index += 1;
  }
  return { positional, values };
}

export function parseLineCommand(input: string): LineCommand {
  const value = input.trim();
  if (!value) return { kind: "empty" };
  const [command, ...args] = value.split(/\s+/);
  if (command === "help") return { kind: "help" };
  if (command === "refresh") return { kind: "refresh" };
  if (command === "quit" || command === "exit") return { kind: "quit" };
  if (command === "select" && args.length === 1 && args[0]) return { kind: "select", work_id: args[0] };
  if (command === "confirm" && args.length === 0) return { kind: "confirm" };
  if (command === "cancel" && args.length === 0) return { kind: "cancel" };
  if (command === "claim") {
    const parsed = parseOptions(value, args, new Set(["--session", "--harness"]));
    if ("kind" in parsed) return parsed;
    if (parsed.positional.length !== 1 || !parsed.positional[0]) {
      return invalid(value, "usage: claim ACTOR_ID [--session SESSION_ID] [--harness HARNESS_ID]");
    }
    return {
      kind: "mutation",
      action: "claim",
      actor_id: parsed.positional[0],
      session_id: parsed.values["--session"],
      harness_id: parsed.values["--harness"],
    };
  }
  if (command === "accept-start" || command === "start") {
    const parsed = parseOptions(value, args, new Set(["--session"]));
    if ("kind" in parsed) return parsed;
    if (parsed.positional.length !== 0) return invalid(value, "usage: accept-start [--session SESSION_ID]");
    return { kind: "mutation", action: "accept_start", session_id: parsed.values["--session"] };
  }
  if (command === "evidence") {
    const encoded = value.slice(command.length).trim();
    if (!encoded) return invalid(value, "usage: evidence JSON");
    try {
      return { kind: "mutation", action: "evidence", evidence: JSON.parse(encoded) as unknown };
    } catch (error) {
      return invalid(value, `evidence must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (command === "finish" || command === "release") {
    const text = value.slice(command.length).trim();
    const mutation = command === "finish"
      ? { kind: "mutation" as const, action: "finish" as const, ...(text ? { summary: text } : {}) }
      : { kind: "mutation" as const, action: "release" as const, ...(text ? { reason: text } : {}) };
    return mutation;
  }
  return { kind: "unknown", input: value };
}

export function lineShellHelp(): string {
  return "commands: help | refresh | select WORK_ID | claim ACTOR_ID [--session ID] [--harness ID] | accept-start [--session ID] | evidence JSON | finish [SUMMARY] | release [REASON] | confirm | cancel | quit\n";
}

interface PendingMutation {
  readonly work_id: string;
  readonly command: MutationLineCommand;
}

function mutationEffect(command: MutationLineCommand): string {
  switch (command.action) {
    case "claim": return `claim attempt for actor=${command.actor_id}`;
    case "accept_start": return "accept the current claimed attempt";
    case "evidence": return "attach structured evidence to the current attempt";
    case "finish": return "finish and request proof-gated close";
    case "release": return "release the current attempt";
  }
}

function confirmationPrompt(view: MountedView, pending: PendingMutation): string {
  const revision = view.monitoring?.revision ?? null;
  const attempt = view.selected_work?.attempt;
  const fence = attempt ? `${attempt.attempt_id}@${attempt.fence}` : "none";
  return `tui: confirm ${pending.command.action} work=${pending.work_id} effect=${mutationEffect(pending.command)} expected_revision=${revision ?? "none"} attempt_fence=${fence}; enter confirm or cancel\n`;
}

function resultLine(pending: PendingMutation, result: ActionResult<unknown>): string {
  const envelope = result.envelope;
  const prefix = `tui: ${pending.command.action} work=${pending.work_id} operation=${envelope.operation_id} revision=${envelope.revision ?? "none"} outcome=${envelope.outcome}`;
  if (result.ok) return `${prefix}\n`;
  const retry = envelope.outcome === "unknown" ? "; operation readback is required before retrying" : "";
  return `${prefix} failed code=${result.error.code}: ${result.error.message}${retry}\n`;
}

async function executeMutation(controller: LineShellController, pending: PendingMutation): Promise<ActionResult<unknown>> {
  switch (pending.command.action) {
    case "claim":
      return controller.claim(pending.work_id, pending.command.actor_id, {
        session_id: pending.command.session_id,
        harness_id: pending.command.harness_id,
      });
    case "accept_start": return controller.acceptStart(pending.work_id, { session_id: pending.command.session_id });
    case "evidence": return controller.addEvidence(pending.work_id, pending.command.evidence);
    case "finish": return controller.finish(pending.work_id, pending.command.summary);
    case "release": return controller.release(pending.work_id, pending.command.reason);
  }
}

function errorLine(action: string, work_id: string, error: unknown): string {
  return `tui: ${action} work=${work_id} failed: ${error instanceof Error ? error.message : String(error)}\n`;
}

/** Small deterministic operator loop with a separate confirmation step for every mutation. */
export async function runLineShell(
  lines: AsyncIterable<string>,
  controller: LineShellController,
  write: (value: string) => void,
): Promise<void> {
  let pending: PendingMutation | null = null;
  for await (const line of lines) {
    const command = parseLineCommand(line);
    if (pending && command.kind !== "confirm" && command.kind !== "cancel") {
      if (command.kind === "quit") return;
      write("tui: confirmation pending; enter confirm or cancel\n");
      continue;
    }
    if (command.kind === "confirm") {
      if (!pending) {
        write("tui: no mutation is awaiting confirmation\n");
        continue;
      }
      const current = pending;
      pending = null;
      try {
        const result = await executeMutation(controller, current);
        write(resultLine(current, result));
        if (result.ok) write(renderMountedView(controller.view()));
      } catch (error) {
        write(errorLine(current.command.action, current.work_id, error));
      }
      continue;
    }
    if (command.kind === "cancel") {
      if (pending) {
        write(`tui: cancelled ${pending.command.action} for work=${pending.work_id}\n`);
        pending = null;
      } else {
        write("tui: no mutation is awaiting confirmation\n");
      }
      continue;
    }
    switch (command.kind) {
      case "empty": break;
      case "help": write(lineShellHelp()); break;
      case "refresh":
        try {
          write(renderMountedView(await controller.refresh()));
        } catch (error) {
          write(`tui: refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
        break;
      case "select": {
        const current = controller.view();
        if (!current.monitoring?.items.some((item) => item.work_id === command.work_id)) {
          write(`tui: work '${command.work_id}' is not present in the current snapshot\n`);
          break;
        }
        write(renderMountedView(controller.navigate({ kind: "work", project_id: current.route.project_id, work_id: command.work_id })));
        break;
      }
      case "mutation": {
        const current = controller.view();
        if (!current.selected_work || current.route.kind !== "work" || current.route.work_id !== current.selected_work.work_id) {
          write(`tui: ${command.action} requires a selected work item\n`);
          break;
        }
        pending = { work_id: current.selected_work.work_id, command };
        write(confirmationPrompt(current, pending));
        break;
      }
      case "quit": return;
      case "invalid": write(`tui: invalid command '${command.input}': ${command.message}\n`); break;
      case "unknown": write(`tui: unknown command '${command.input}'. ${lineShellHelp()}`); break;
    }
  }
}
