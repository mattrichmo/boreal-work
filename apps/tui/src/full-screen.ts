import { ActionResult, MountedView, TuiAction } from "./client.js";
import { LineShellController } from "./line-shell.js";
import { renderMountedView } from "./terminal.js";

const ENTER_ALT_SCREEN = "\u001b[?1049h\u001b[?25l";
const LEAVE_ALT_SCREEN = "\u001b[?25h\u001b[?1049l";
const CLEAR_SCREEN = "\u001b[2J\u001b[H";

export type TerminalSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface FullScreenTerminal {
  readonly is_tty: boolean;
  dimensions(): { width: number; height: number };
  write(value: string): void;
  setRawMode?(enabled: boolean): void;
  resume?(): void;
  pause?(): void;
  onData(listener: (value: string) => void): () => void;
  onResize(listener: () => void): () => void;
  onSignal(signal: TerminalSignal, listener: () => void): () => void;
}

export interface FullScreenOptions {
  readonly auto_refresh_ms?: number;
  /** Maximum time to wait for queued/in-flight work after shutdown begins. */
  readonly shutdown_drain_ms?: number;
}

type PendingKeyboardAction = Exclude<TuiAction, "create_project" | "create_work" | "evidence">;
type QueuedWork = {
  readonly label: string;
  readonly mutation: boolean;
  readonly run: () => Promise<void>;
};

export function decodeKeys(value: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < value.length;) {
    const sequence = value.slice(index, index + 3);
    if (sequence === "\u001b[A") {
      keys.push("up");
      index += 3;
    } else if (sequence === "\u001b[B") {
      keys.push("down");
      index += 3;
    } else {
      const key = value[index];
      keys.push(key === "\r" || key === "\n" ? "enter" : key === "\u001b" ? "escape" : key === "\u0003" ? "ctrl-c" : key);
      index += 1;
    }
  }
  return keys;
}

function actionResultMessage(action: PendingKeyboardAction, result: ActionResult<unknown>): string {
  const envelope = result.envelope;
  if (result.ok) return `${action}: ${envelope.outcome} at revision ${envelope.revision ?? "unknown"}`;
  const suffix = envelope.outcome === "unknown" ? "; read back this operation before retrying" : "";
  return `${action}: ${result.error.code} (${envelope.operation_id})${suffix}`;
}

/**
 * Small full-screen dashboard loop. It owns terminal state only; all work
 * state and lifecycle transitions remain in the mounted service controller.
 */
export async function runFullScreen(
  controller: LineShellController,
  terminal: FullScreenTerminal,
  options: FullScreenOptions = {},
): Promise<void> {
  if (!terminal.is_tty) throw new Error("full-screen mode requires an interactive TTY");

  let closed = false;
  let acceptingInput = true;
  let shutdownTimedOut = false;
  let shutdownReport: string | null = null;
  let helpVisible = false;
  let statusMessage: string | null = null;
  let pending: { action: PendingKeyboardAction; work_id: string } | null = null;
  let selectedIndex = Math.max(0, controller.view().monitoring?.items.findIndex((item) => item.work_id === controller.view().route.work_id) ?? 0);
  let work = Promise.resolve();
  let activeWork: QueuedWork | null = null;
  const queuedMutations = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });

  const selectedWorkId = (): string | undefined => {
    const view = controller.view();
    if (view.selected_work) return view.selected_work.work_id;
    return view.monitoring?.items[selectedIndex]?.work_id;
  };

  const redraw = (): void => {
    if (closed || !acceptingInput) return;
    const dimensions = terminal.dimensions();
    terminal.write(CLEAR_SCREEN);
    terminal.write(renderMountedView(controller.view(), {
      width: dimensions.width,
      height: dimensions.height,
      interactive: true,
      help_visible: helpVisible,
      pending_confirmation: pending ? `${pending.action} ${pending.work_id}` : null,
      status_message: statusMessage,
    }));
  };

  const navigate = (delta: number): void => {
    const view = controller.view();
    const items = view.monitoring?.items ?? [];
    if (items.length === 0) return;
    selectedIndex = (selectedIndex + delta + items.length) % items.length;
    const selected = items[selectedIndex];
    controller.navigate({ kind: "work", project_id: view.route.project_id, work_id: selected.work_id });
    statusMessage = null;
  };

  const enqueue = (run: () => Promise<void>, label: string, mutation = false): void => {
    if (!acceptingInput) return;
    const queued: QueuedWork = { run, label, mutation };
    if (mutation) queuedMutations.add(label);
    work = work.then(async () => {
      if (shutdownTimedOut) {
        if (mutation) queuedMutations.delete(label);
        return;
      }
      if (mutation) queuedMutations.delete(label);
      activeWork = queued;
      try {
        await run();
      } finally {
        activeWork = null;
      }
    }).catch((error) => {
      statusMessage = error instanceof Error ? error.message : String(error);
    }).then(redraw);
  };

  const executePending = async (): Promise<void> => {
    const current = pending;
    pending = null;
    if (!current) return;
    let result: ActionResult<unknown>;
    switch (current.action) {
      case "claim": result = await controller.claim(current.work_id); break;
      case "accept_start": result = await controller.acceptStart(current.work_id); break;
      case "finish": throw new Error("finish requires a typed summary; use `finish <summary>` in the line interface");
      case "release": result = await controller.release(current.work_id, "dashboard_operator"); break;
    }
    statusMessage = actionResultMessage(current.action, result);
  };

  const stage = (action: PendingKeyboardAction): void => {
    const work_id = selectedWorkId();
    if (!work_id) {
      statusMessage = `${action} requires a selected work item`;
      return;
    }
    const availability = controller.view().actions.find((entry) => entry.action === action);
    if (!availability?.enabled) {
      statusMessage = `${action} unavailable: ${availability?.reason ?? "action is not available"}`;
      return;
    }
    pending = { action, work_id };
    statusMessage = null;
  };

  const reportShutdownTimeout = (): void => {
    const pendingOperations = controller.view().pending_operations.map((operation) => operation.operation_id);
    const labels = [
      ...(activeWork?.mutation ? [activeWork.label] : []),
      ...queuedMutations,
    ];
    const operationText = pendingOperations.length > 0
      ? `; read operation${pendingOperations.length === 1 ? "" : "s"} ${pendingOperations.join(", ")} before retrying`
      : "; no operation ID was returned before shutdown, so do not retry automatically";
    shutdownReport = `dashboard shutdown: ${labels.join(", ") || "mutation"} outcome unknown${operationText}`;
  };

  const reportPendingOperations = (): void => {
    const pendingOperations = controller.view().pending_operations.map((operation) => operation.operation_id);
    if (pendingOperations.length > 0) {
      shutdownReport = `dashboard shutdown: operation${pendingOperations.length === 1 ? "" : "s"} ${pendingOperations.join(", ")} retained with unknown outcome; read back before retrying`;
    }
  };

  const drain = async (): Promise<void> => {
    const drainMs = options.shutdown_drain_ms === undefined
      ? 10_000
      : Math.max(1, Math.floor(options.shutdown_drain_ms));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      work.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), drainMs);
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
    if (!drained) {
      shutdownTimedOut = true;
      reportShutdownTimeout();
    } else reportPendingOperations();
  };

  let shutdownPromise: Promise<void> | null = null;
  const stop = (): void => {
    if (shutdownPromise) return;
    acceptingInput = false;
    pending = null;
    if (timer !== undefined) clearInterval(timer);
    shutdownPromise = drain();
    void shutdownPromise.then(finish, finish);
  };

  const handleKey = (key: string): void => {
    if (closed || !acceptingInput) return;
    if (key === "q" || key === "Q" || key === "ctrl-c") {
      stop();
      return;
    }
    if (pending) {
      if (key === "y" || key === "Y" || key === "enter") {
        enqueue(executePending, `mutation ${pending.action} ${pending.work_id}`, true);
      }
      else if (key === "n" || key === "N" || key === "escape") {
        statusMessage = `cancelled ${pending.action}`;
        pending = null;
      }
      redraw();
      return;
    }
    switch (key) {
      case "j": case "down": navigate(1); break;
      case "k": case "up": navigate(-1); break;
      case "enter": {
        const work_id = selectedWorkId();
        if (work_id) controller.navigate({ kind: "work", project_id: controller.view().route.project_id, work_id });
        break;
      }
      case "escape": controller.navigate({ kind: "monitoring", project_id: controller.view().route.project_id }); break;
      case "r": case "R": enqueue(async () => { await controller.refresh(); statusMessage = "refreshed"; }, "refresh"); return;
      case "?": helpVisible = !helpVisible; break;
      case "c": case "C": stage("claim"); break;
      case "s": case "S": stage("accept_start"); break;
      case "f": case "F": stage("finish"); break;
      case "x": case "X": stage("release"); break;
      default: return;
    }
    redraw();
  };

  const disposers: Array<() => void> = [];
  const refreshMs = options.auto_refresh_ms === undefined ? 5_000 : Math.max(500, Math.floor(options.auto_refresh_ms));
  timer = setInterval(() => enqueue(async () => { await controller.refresh(); }, "refresh"), refreshMs);

  try {
    terminal.write(ENTER_ALT_SCREEN);
    terminal.setRawMode?.(true);
    terminal.resume?.();
    disposers.push(terminal.onData((value) => decodeKeys(value).forEach(handleKey)));
    disposers.push(terminal.onResize(redraw));
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      disposers.push(terminal.onSignal(signal, stop));
    }
    redraw();
    await finished;
  } finally {
    closed = true;
    if (timer !== undefined) clearInterval(timer);
    for (const dispose of disposers.reverse()) dispose();
    terminal.setRawMode?.(false);
    terminal.pause?.();
    terminal.write(LEAVE_ALT_SCREEN);
    if (shutdownReport) terminal.write(`${shutdownReport}\n`);
  }
}
