import { ActionResult, DashboardFilter, MountedView, TuiAction } from "./client.js";
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
  onData(listener: (value: string | Uint8Array) => void): () => void;
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

/** Chunk-safe terminal decoder. Incomplete escape/UTF-8 sequences stay buffered. */
export class StreamingKeyDecoder {
  private readonly utf8 = new TextDecoder("utf-8", { fatal: false });
  private pending = "";

  push(value: string | Uint8Array): string[] {
    this.pending += typeof value === "string" ? value : this.utf8.decode(value, { stream: true });
    return this.parse(false);
  }

  flush(): string[] {
    this.pending += this.utf8.decode();
    return this.parse(true);
  }

  private parse(flush: boolean): string[] {
    const keys: string[] = [];
    let index = 0;
    for (; index < this.pending.length;) {
      const remaining = this.pending.slice(index);
      if (remaining.startsWith("\u001b[A")) {
        keys.push("up"); index += 3; continue;
      }
      if (remaining.startsWith("\u001b[B")) {
        keys.push("down"); index += 3; continue;
      }
      if (remaining[0] === "\u001b" && !flush && "\u001b[A".startsWith(remaining)) break;
      const codePoint = remaining.codePointAt(0);
      if (codePoint === undefined) break;
      const key = String.fromCodePoint(codePoint);
      keys.push(codePoint === 13 || codePoint === 10 ? "enter"
        : codePoint === 27 ? "escape"
          : codePoint === 3 ? "ctrl-c"
            : codePoint === 127 || codePoint === 8 ? "backspace" : key);
      index += key.length;
    }
    this.pending = this.pending.slice(index);
    return keys;
  }
}

export function decodeKeys(value: string): string[] {
  const decoder = new StreamingKeyDecoder();
  return decoder.push(value).concat(decoder.flush());
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
  let paletteVisible = false;
  let filter: DashboardFilter = "all";
  let searchQuery = "";
  let searchEditing = false;
  let searchBuffer = "";
  let statusMessage: string | null = null;
  let pending: { action: PendingKeyboardAction; work_id: string; summary?: string } | null = null;
  let summaryEditing = false;
  let summaryBuffer = "";
  let selectedIndex = Math.max(0, controller.view().monitoring?.items.findIndex((item) => item.work_id === controller.view().route.work_id) ?? 0);
  let work = Promise.resolve();
  let activeWork: QueuedWork | null = null;
  const queuedMutations = new Set<string>();
  let refreshQueued = false;
  let refreshActive = false;
  let refreshDirty = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });

  const filteredItems = (): NonNullable<MountedView["monitoring"]>["items"] => {
    const items = controller.view().monitoring?.items ?? [];
    const query = searchQuery.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const status = item.display_status ?? item.status;
      const matchesFilter = filter === "all"
        || filter === "active" && ["claimed", "in_progress", "needs_verification", "awaiting_review", "complete"].includes(status)
        || filter === "expired" && status === "expired_review"
        || ["ready", "queued", "blocked", "closed"].includes(filter) && status === filter
        || ["milestones", "sprints", "tasks"].includes(filter) && item.kind === filter.slice(0, -1);
      if (!matchesFilter) return false;
      if (!query) return true;
      return [item.work_id, item.title, item.description, item.parent_id, item.kind]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  };

  const selectedWorkId = (): string | undefined => {
    const view = controller.view();
    const items = filteredItems();
    if (view.selected_work && items.some((item) => item.work_id === view.selected_work?.work_id)) return view.selected_work.work_id;
    return items[selectedIndex]?.work_id;
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
      filter,
      search_query: searchQuery,
      selected_index: selectedIndex,
      palette_visible: paletteVisible,
      search_editing: searchEditing,
      search_buffer: searchBuffer,
      summary_editing: summaryEditing,
      summary_buffer: summaryBuffer,
    }));
  };

  const navigate = (delta: number): void => {
    const view = controller.view();
    const items = filteredItems();
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

  const enqueueRefresh = (): void => {
    if (!acceptingInput) return;
    if (refreshActive || refreshQueued) {
      refreshDirty = true;
      return;
    }
    refreshQueued = true;
    enqueue(async () => {
      refreshQueued = false;
      refreshActive = true;
      try {
        await controller.refresh();
      } finally {
        refreshActive = false;
        if (refreshDirty && acceptingInput) {
          refreshDirty = false;
          enqueueRefresh();
        }
      }
    }, "refresh");
  };

  const executePending = async (): Promise<void> => {
    const current = pending;
    pending = null;
    if (!current) return;
    let result: ActionResult<unknown>;
    switch (current.action) {
      case "claim": result = await controller.claim(current.work_id); break;
      case "accept_start": result = await controller.acceptStart(current.work_id); break;
      case "finish": result = await controller.finish(current.work_id, current.summary); break;
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
    if (action === "finish") {
      summaryEditing = true;
      summaryBuffer = "";
      statusMessage = "type a closeout summary, then press Enter";
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
    if (key === "ctrl-c") { stop(); return; }
    if (summaryEditing) {
      if (key === "escape") {
        summaryEditing = false;
        summaryBuffer = "";
        statusMessage = "finish cancelled";
      } else if (key === "enter") {
        if (!summaryBuffer.trim()) statusMessage = "finish summary must not be empty";
        else {
          const work_id = selectedWorkId();
          if (work_id) pending = { action: "finish", work_id, summary: summaryBuffer.trim() };
          summaryEditing = false;
          summaryBuffer = "";
        }
      } else if (key === "backspace") {
        summaryBuffer = summaryBuffer.slice(0, -1);
      } else if (key.length > 0 && key >= " ") {
        summaryBuffer += key;
      }
      redraw();
      return;
    }
    if (searchEditing) {
      if (key === "escape") {
        searchEditing = false;
        searchBuffer = "";
      } else if (key === "enter") {
        searchQuery = searchBuffer.trim();
        searchEditing = false;
        searchBuffer = "";
        selectedIndex = 0;
        statusMessage = searchQuery ? `search: ${searchQuery}` : "search cleared";
      } else if (key === "backspace") {
        searchBuffer = searchBuffer.slice(0, -1);
      } else if (key.length > 0 && key >= " ") {
        searchBuffer += key;
      }
      redraw();
      return;
    }
    if (key === "q" || key === "Q") {
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
    if (paletteVisible) {
      const filters: Record<string, DashboardFilter> = {
        "1": "all", "2": "ready", "3": "active", "4": "blocked", "5": "expired",
        "6": "closed", "7": "milestones", "8": "sprints", "9": "tasks",
      };
      if (filters[key]) {
        filter = filters[key];
        selectedIndex = 0;
        paletteVisible = false;
        statusMessage = `filter: ${filter}`;
      } else if (key === "/") {
        paletteVisible = false;
        searchEditing = true;
        searchBuffer = searchQuery;
      } else if (key === "escape" || key === "p") {
        paletteVisible = false;
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
      case "r": case "R": enqueue(async () => { await controller.refresh(); statusMessage = "refreshed"; }, "manual refresh"); return;
      case "]":
        if (controller.nextPage) enqueue(async () => { await controller.nextPage?.(); statusMessage = "next page"; }, "next page");
        else statusMessage = "pagination is unavailable from this service adapter";
        break;
      case "?": helpVisible = !helpVisible; break;
      case "p": case "P": paletteVisible = true; break;
      case "/": searchEditing = true; searchBuffer = searchQuery; break;
      case "1": filter = "all"; selectedIndex = 0; break;
      case "2": filter = "ready"; selectedIndex = 0; break;
      case "3": filter = "active"; selectedIndex = 0; break;
      case "4": filter = "blocked"; selectedIndex = 0; break;
      case "5": filter = "expired"; selectedIndex = 0; break;
      case "6": filter = "closed"; selectedIndex = 0; break;
      case "7": filter = "milestones"; selectedIndex = 0; break;
      case "8": filter = "sprints"; selectedIndex = 0; break;
      case "9": filter = "tasks"; selectedIndex = 0; break;
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
  timer = setInterval(enqueueRefresh, refreshMs);

  try {
    terminal.write(ENTER_ALT_SCREEN);
    terminal.setRawMode?.(true);
    terminal.resume?.();
    const keyDecoder = new StreamingKeyDecoder();
    disposers.push(terminal.onData((value) => keyDecoder.push(value).forEach(handleKey)));
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
