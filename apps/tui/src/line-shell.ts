import {
  ActionResult,
  CreateProjectDraftInput,
  CreateWorkDraftInput,
  Envelope,
  MountedView,
  Route,
  WorkKind,
  WorkspaceViewKind,
} from "./client.js";
import { renderMountedView } from "./terminal.js";

export interface LineShellController {
  view(): MountedView;
  refresh(): Promise<MountedView>;
  navigate(route: Route): MountedView;
  createProject(input: CreateProjectDraftInput): Promise<ActionResult<unknown>>;
  createWork(input: CreateWorkDraftInput): Promise<ActionResult<unknown>>;
  claim(work_id: string, execution: { source_version_id: string; config_identity: string }): Promise<ActionResult<unknown>>;
  acceptStart(work_id: string): Promise<ActionResult<unknown>>;
  addEvidence(work_id: string, evidence: unknown): Promise<ActionResult<unknown>>;
  finish(work_id: string, summary?: string): Promise<ActionResult<unknown>>;
  release(work_id: string, reason?: string): Promise<ActionResult<unknown>>;
  nextPage?(): Promise<MountedView>;
  readWorkspaceView?(kind: WorkspaceViewKind): Promise<Envelope<unknown>>;
}

type LineWorkspaceViewKind = WorkspaceViewKind | "project" | "pending" | "unavailable";

export type MutationLineCommand =
  | { kind: "mutation"; action: "create_project"; input: CreateProjectDraftInput }
  | { kind: "mutation"; action: "create_work"; input: CreateWorkDraftInput }
  | { kind: "mutation"; action: "claim"; source_version_id: string; config_identity: string }
  | { kind: "mutation"; action: "accept_start" }
  | { kind: "mutation"; action: "evidence"; evidence: unknown }
  | { kind: "mutation"; action: "finish"; summary?: string }
  | { kind: "mutation"; action: "release"; reason?: string };

export type LineCommand =
  | { kind: "help" }
  | { kind: "refresh" }
  | { kind: "workspace_view"; view: LineWorkspaceViewKind }
  | { kind: "select"; work_id: string }
  | { kind: "quit" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | MutationLineCommand
  | { kind: "empty" }
  | { kind: "invalid"; input: string; message: string }
  | { kind: "unknown"; input: string };

export interface LineShellOptions {
  /** Periodic revision-bound refresh for an interactive dashboard session. */
  readonly auto_refresh_ms?: number;
}

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
  if (command === "workspace") {
    if (args.length !== 1 || !["project", "cycles", "reviews", "memory", "recovery", "pending", "unavailable"].includes(args[0])) return invalid(value, "usage: workspace project|cycles|reviews|memory|recovery|pending|unavailable");
    return { kind: "workspace_view", view: args[0] as LineWorkspaceViewKind };
  }
  if (command === "quit" || command === "exit") return { kind: "quit" };
  if ((command === "select" || command === "show") && args.length === 1 && args[0]) return { kind: "select", work_id: args[0] };
  if (command === "confirm" && args.length === 0) return { kind: "confirm" };
  if (command === "cancel" && args.length === 0) return { kind: "cancel" };
  if (command === "create-project") {
    const parsed = parseOptions(value, args, new Set(["--role", "--credential", "--display-name"]));
    if ("kind" in parsed) return parsed;
    if (parsed.positional.length !== 1 || !parsed.positional[0]) {
      return invalid(value, "usage: create-project PROJECT_ID [--role ROLE] [--credential REF] [--display-name NAME]");
    }
    return {
      kind: "mutation",
      action: "create_project",
      input: {
        project_id: parsed.positional[0],
        actor_role: parsed.values["--role"],
        credential_ref: parsed.values["--credential"],
        display_name: parsed.values["--display-name"],
      },
    };
  }
  if (command === "create-work") {
    const parsed = parseOptions(value, args, new Set(["--parent", "--priority"]));
    if ("kind" in parsed) return parsed;
    const [work_id, rawKind, ...titleParts] = parsed.positional;
    if (!work_id || !rawKind || titleParts.length === 0 || !["milestone", "sprint", "task"].includes(rawKind)) {
      return invalid(value, "usage: create-work WORK_ID milestone|sprint|task TITLE [--parent WORK_ID] [--priority 0..255]");
    }
    const priorityValue = parsed.values["--priority"];
    const priority = priorityValue === undefined ? undefined : Number(priorityValue);
    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 255)) {
      return invalid(value, "--priority must be an integer between 0 and 255");
    }
    return {
      kind: "mutation",
      action: "create_work",
      input: {
        work_id,
        kind: rawKind as WorkKind,
        title: titleParts.join(" "),
        parent_id: parsed.values["--parent"] ?? null,
        priority,
      },
    };
  }
  if (command === "claim") {
    const parsed = parseOptions(value, args, new Set(["--source-version", "--config-identity"]));
    if ("kind" in parsed) return parsed;
    if (parsed.positional.length || !parsed.values["--source-version"] || !parsed.values["--config-identity"])
      return invalid(value, "usage: claim --source-version SOURCE_VERSION_ID --config-identity CONFIG_IDENTITY (get a real ID with `bwrk source list PROJECT`; capture one with `bwrk source add PROJECT --input PATH --origin ORIGIN`)");
    if (/^unknown$/iu.test(parsed.values["--source-version"])) return invalid(value, "claim needs a real registered source version ID, not 'unknown'");
    if (/^(?:unknown|n\/a|none|null|undefined|todo|tbd)$/iu.test(parsed.values["--config-identity"])) return invalid(value, "claim needs a meaningful config identity, not a placeholder");
    return { kind: "mutation", action: "claim", source_version_id: parsed.values["--source-version"], config_identity: parsed.values["--config-identity"] };
  }
  if (command === "accept-start" || command === "start") {
    if (args.length !== 0) return invalid(value, "usage: accept-start");
    return { kind: "mutation", action: "accept_start" };
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
  return "commands: help | refresh | workspace project|cycles|reviews|memory|recovery|pending|unavailable | select WORK_ID | create-project PROJECT_ID | create-work WORK_ID KIND TITLE [--parent ID] | claim --source-version SOURCE_VERSION_ID --config-identity CONFIG_IDENTITY | accept-start | evidence RECEIPT_JSON | finish | release [REASON] | confirm | cancel | quit\nClaim requires a real registered source version (`bwrk source list PROJECT`; add one with `bwrk source add PROJECT --input PATH --origin ORIGIN`) and a meaningful, non-secret execution configuration identity.\n";
}

interface PendingMutation {
  readonly target: string;
  readonly work_id?: string;
  readonly command: MutationLineCommand;
}

function mutationEffect(command: MutationLineCommand): string {
  switch (command.action) {
    case "create_project": return "initialize the mounted project and operator identity";
    case "create_work": return `create ${command.input.kind} '${command.input.work_id}'`;
    case "claim": return "claim attempt for the mounted actor, harness, and session";
    case "accept_start": return "accept the current claimed attempt";
    case "evidence": return "attach structured evidence to the current attempt";
    case "finish": return "finish and request proof-gated close";
    case "release": return "release the current attempt";
  }
}

function confirmationPrompt(view: MountedView, pending: PendingMutation): string {
  const revision = view.monitoring?.revision ?? null;
  const attempt = view.selected_work?.attempt;
  const attemptSummary = attempt ? `${attempt.attempt_id}, generation ${attempt.fence}` : "none";
  const binding = pending.command.action === "claim"
    ? ` source_version_id=${pending.command.source_version_id} config_identity=${pending.command.config_identity}`
    : "";
  return `tui: confirm ${pending.command.action} target=${pending.target} effect=${mutationEffect(pending.command)}${binding} expected_revision=${revision ?? "none"} attempt ${attemptSummary}; enter confirm or cancel\n`;
}

function resultLine(pending: PendingMutation, result: ActionResult<unknown>): string {
  const envelope = result.envelope;
  const prefix = `tui: ${pending.command.action} target=${pending.target} operation=${envelope.operation_id} revision=${envelope.revision ?? "none"} outcome=${envelope.outcome}`;
  if (result.ok) return `${prefix}\n`;
  const retry = envelope.outcome === "unknown" ? "; operation readback is required before retrying" : "";
  return `${prefix} failed: ${result.error.message}${retry}\n`;
}

async function executeMutation(controller: LineShellController, pending: PendingMutation): Promise<ActionResult<unknown>> {
  switch (pending.command.action) {
    case "create_project": return controller.createProject(pending.command.input);
    case "create_work": return controller.createWork(pending.command.input);
    case "claim": return controller.claim(pending.work_id!, { source_version_id: pending.command.source_version_id, config_identity: pending.command.config_identity });
    case "accept_start": return controller.acceptStart(pending.work_id!);
    case "evidence": return controller.addEvidence(pending.work_id!, pending.command.evidence);
    case "finish": return controller.finish(pending.work_id!, pending.command.summary);
    case "release": return controller.release(pending.work_id!, pending.command.reason);
  }
}

function errorLine(action: string, target: string, error: unknown): string {
  return `tui: ${action} target=${target} failed: ${error instanceof Error ? error.message : String(error)}\n`;
}

/** Small deterministic operator loop with a separate confirmation step for every mutation. */
export async function runLineShell(
  lines: AsyncIterable<string>,
  controller: LineShellController,
  write: (value: string) => void,
  options: LineShellOptions = {},
): Promise<void> {
  let pending: PendingMutation | null = null;
  const refreshMs = options.auto_refresh_ms === undefined ? 0 : Math.max(500, Math.floor(options.auto_refresh_ms));
  const timer = refreshMs > 0 ? setInterval(() => {
    if (pending) return;
    void controller.refresh()
      .then((view) => write(`\n[tui] revision update\n${renderMountedView(view)}`))
      .catch((error) => write(`tui: automatic refresh failed: ${error instanceof Error ? error.message : String(error)}\n`));
  }, refreshMs) : undefined;
  try {
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
          write(errorLine(current.command.action, current.target, error));
        }
        continue;
      }
      if (command.kind === "cancel") {
        if (pending) {
          write(`tui: cancelled ${pending.command.action} for target=${pending.target}\n`);
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
        case "workspace_view":
          if (command.view === "project") {
            const view = controller.view();
            write(`PROJECT\n${JSON.stringify({ project_id: view.route.project_id, revision: view.monitoring?.revision ?? null, total_work_items: view.monitoring?.total ?? 0, displayed_work_items: view.monitoring?.items.length ?? 0, page_offset: view.monitoring?.offset ?? 0, has_more: view.monitoring?.has_more ?? false, notice: view.notice?.message ?? null }, null, 2)}\n`);
            break;
          }
          if (command.view === "pending") {
            const operations = controller.view().pending_operations;
            write(`PENDING OPERATIONS\n${operations.length ? JSON.stringify(operations, null, 2) : "No operations are awaiting readback."}\n`);
            break;
          }
          if (command.view === "unavailable") {
            const view = controller.view();
            write(`UNAVAILABLE ROUTES\n${view.notice ? `Connection notice: ${view.notice.message}\n\n` : ""}${JSON.stringify((view.capabilities ?? []).filter(capability => capability.status === "unavailable"), null, 2)}\n`);
            break;
          }
          if (!controller.readWorkspaceView) {
            write(`tui: ${command.view} view is unavailable from this service connection\n`);
            break;
          }
          try {
            const result = await controller.readWorkspaceView(command.view);
            write(`${command.view.toUpperCase()}\n${JSON.stringify({ project_id: controller.view().route.project_id, revision: result.revision, as_of: result.as_of, data: result.data }, null, 2)}\n`);
          } catch (error) {
            write(`tui: ${command.view} view failed: ${error instanceof Error ? error.message : String(error)}\n`);
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
          if (command.action === "create_project") {
            pending = { target: command.input.project_id, command };
            write(confirmationPrompt(current, pending));
            break;
          }
          if (command.action === "create_work") {
            pending = { target: command.input.work_id, command };
            write(confirmationPrompt(current, pending));
            break;
          }
          if (!current.selected_work || current.route.kind !== "work" || current.route.work_id !== current.selected_work.work_id) {
            write(`tui: ${command.action} requires a selected work item\n`);
            break;
          }
          pending = { target: current.selected_work.work_id, work_id: current.selected_work.work_id, command };
          write(confirmationPrompt(current, pending));
          break;
        }
        case "quit": return;
        case "invalid": write(`tui: invalid command '${command.input}': ${command.message}\n`); break;
        case "unknown": write(`tui: unknown command '${command.input}'. ${lineShellHelp()}`); break;
      }
    }
  } finally {
    if (timer !== undefined) clearInterval(timer);
  }
}
