import type { ActionResult, CreateWorkDraftInput, MountedView, TuiAction } from "./client.js";
import type { LineShellController } from "./line-shell.js";
import { safeText } from "./ui/cells.js";
import { FrameWriter, type Theme } from "./ui/screen.js";
import { renderDashboard, dashboardLayout, detailLines, inspectorRect, modalDocument, currentNotice } from "./ui/dashboard.js";
import { initialState, reconcileSelection, visibleItems, FILTERS, ACTION_NAMES, actionForm, paletteCommands, type Modal, type DashboardState } from "./ui/model.js";
import { paneViewport, cycleDensity, type Density } from "./ui/layout.js";
import { editInput } from "./ui/input.js";
import { StreamingKeyDecoder } from "./ui/keys.js";
export { StreamingKeyDecoder, decodeKeys } from "./ui/keys.js";
export type TerminalSignal = "SIGINT" | "SIGTERM" | "SIGHUP";
export interface FullScreenTerminal {
    readonly is_tty: boolean;
    dimensions(): {
        width: number;
        height: number;
    };
    write(value: string): void;
    setRawMode?(enabled: boolean): void;
    /** Previous raw state, when this terminal is embedded by another caller. */
    readonly was_raw?: boolean;
    resume?(): void;
    pause?(): void;
    onData(listener: (value: string | Uint8Array) => void): () => void;
    onResize(listener: () => void): () => void;
    onSignal(signal: TerminalSignal, listener: () => void): () => void;
    onEnd?(listener: () => void): () => void;
}
export interface FullScreenOptions {
    readonly auto_refresh_ms?: number;
    readonly shutdown_drain_ms?: number;
    readonly theme?: Theme;
    readonly ascii?: boolean;
    readonly density?: Density;
}
type Confirm = Extract<Modal, {
    kind: "confirm";
}>;
type ExtendedController = LineShellController & {
    readback?: (operation_id: string) => Promise<unknown>;
};
function attemptIdentity(view: MountedView, id?: string): string | null {
    const a = view.monitoring?.items.find(i => i.work_id === id)?.attempt;
    return a ? `${a.attempt_id}@${a.fence}` : null;
}
function resultMessage(action: TuiAction, result: ActionResult<unknown>): string {
    if (result.ok)
        return `${ACTION_NAMES[action]}: ${result.envelope.outcome} · revision ${result.envelope.revision ?? "unknown"}`;
    return `${ACTION_NAMES[action]}: ${result.error.message} · ${result.error.code}${result.envelope.outcome === "unknown" ? ` · outcome unknown; u reads operation ${result.envelope.operation_id} before any retry` : ""}`;
}
/** Human interaction only. All durable writes stay behind MountedWorkflowController. */
export async function runFullScreen(controller: ExtendedController, terminal: FullScreenTerminal, options: FullScreenOptions = {}): Promise<void> {
    if (!terminal.is_tty)
        throw new Error("full-screen mode requires an interactive TTY");
    const state = initialState(controller.view(), options.theme ?? "dark", options.ascii ?? false);
    state.density = options.density ?? "auto";
    const writer = new FrameWriter(value => terminal.write(value));
    const decoder = new StreamingKeyDecoder();
    let accepting = true, closed = false, shutdownTimedOut = false, terminalRestored = false;
    let work = Promise.resolve(), active: {
        label: string;
        mutation: boolean;
    } | null = null;
    let refreshQueued = false, refreshDirty = false, mutationQueued = false;
    // The existing service coordinator refreshes page zero. Keep later pages stable.
    let browsingLaterPage = (controller.view().monitoring?.offset ?? 0) > 0;
    if (browsingLaterPage) {
        state.frozen = true;
        state.status = "Selected work is on a later page; polling paused. r / F returns to page one.";
    }
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    let shutdown: Promise<void> | null = null, shutdownReport: string | null = null;
    const disposers: Array<() => void> = [];
    const restoreTerminal = (): void => {
        if (terminalRestored)
            return;
        terminalRestored = true;
        try {
            terminal.setRawMode?.(terminal.was_raw ?? false);
        }
        finally {
            terminal.pause?.();
            terminal.write("\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l");
        }
    };
    const syncSelection = (): void => {
        const selected = reconcileSelection(controller.view(), state);
        const current = controller.view().route;
        if (current.work_id !== selected?.work_id)
            controller.navigate({ kind: selected ? "work" : "monitoring", project_id: current.project_id, work_id: selected?.work_id });
    };
    const redraw = (): void => {
        if (closed || !accepting)
            return;
        syncSelection();
        const { width, height } = terminal.dimensions();
        const l = dashboardLayout(width, height, state.detailOnly, state.density, state.zen);
        if (!l.rail && state.focus === "navigation") state.focus = "queue";
        writer.paint(renderDashboard(controller.view(), state, width, height), state.theme);
    };
    const message = (text: string, error = false): void => { state.status = safeText(text); state.error = error; };
    const enqueue = (label: string, run: () => Promise<void>, mutation = false): void => {
        if (!accepting)
            return;
        work = work.then(async () => {
            // Never dispatch a queued mutation after the operator has exited.
            if (shutdownTimedOut || (!accepting && !active))
                return;
            active = { label, mutation };
            state.busy = label;
            redraw();
            try {
                await run();
            }
            catch (error) {
                message(error instanceof Error ? error.message : String(error), true);
            }
            finally {
                active = null;
                state.busy = null;
            }
        }).then(redraw);
    };
    const refresh = (manual = false): void => {
        if (!accepting || (!manual && (state.frozen || state.modal !== null || browsingLaterPage)))
            return;
        if (manual)
            browsingLaterPage = false;
        if (refreshQueued) {
            refreshDirty = true;
            return;
        }
        refreshQueued = true;
        enqueue("Refreshing", async () => {
            try {
                await controller.refresh();
                const notice = controller.view().notice;
                message(notice?.message ?? "First-page snapshot refreshed.", notice?.kind === "error");
            }
            finally {
                refreshQueued = false;
                if (refreshDirty && accepting) {
                    refreshDirty = false;
                    refresh();
                }
            }
        });
    };
    const move = (delta: number): void => {
        if (state.focus === "navigation")
            state.navIndex = Math.max(0, Math.min(FILTERS.length - 1, state.navIndex + delta));
        else if (state.focus === "inspector" || state.detailOnly) {
            const size = terminal.dimensions(), layout = dashboardLayout(size.width, size.height, state.detailOnly, state.density, state.zen);
            const rect = inspectorRect(layout, state);
            if (rect) {
                const selected = visibleItems(controller.view(), state).find(i => i.work_id === state.selectedId);
                const pane = paneViewport(rect, layout.chrome);
                const maximum = Math.max(0, detailLines(selected, controller.view(), state.inspectorTab, pane.width, layout.chrome === "compact" || layout.chrome === "micro").length - pane.height);
                state.inspectorOffset = Math.max(0, Math.min(maximum, state.inspectorOffset + delta));
            }
        }
        else {
            const rows = visibleItems(controller.view(), state), current = Math.max(0, rows.findIndex(i => i.work_id === state.selectedId));
            state.selectedId = rows[Math.max(0, Math.min(rows.length - 1, current + delta))]?.work_id;
            state.inspectorOffset = 0;
        }
    };
    const setFilter = (id: DashboardState["filter"]): void => {
        state.filter = id;
        state.navIndex = FILTERS.findIndex(f => f.id === id);
        state.inspectorOffset = 0;
        state.detailOnly = false;
        state.focus = "queue";
        message(`View: ${id.toUpperCase()}`);
        syncSelection();
    };
    const confirm = (action: TuiAction, payload: unknown, summary: string, details: string[] = [], id = state.selectedId): void => {
        const view = controller.view();
        state.modal = { kind: "confirm", action, workId: action === "create_work" ? undefined : id, payload, summary, details,
            revision: view.monitoring?.revision ?? null, attempt: attemptIdentity(view, id), offset: 0 };
    };
    const stage = (action: TuiAction): void => {
        if (state.busy || mutationQueued) {
            message("Wait for the current request to finish before starting another action.", true);
            return;
        }
        syncSelection();
        const view = controller.view(), rule = view.actions.find(a => a.action === action);
        if (!rule?.enabled) {
            message(`${ACTION_NAMES[action]} unavailable: ${rule?.reason ?? "select work first"}`, true);
            return;
        }
        if (action === "create_project") {
            message("Use bwrk init for project initialization.");
            return;
        }
        if (["create_work", "evidence", "finish", "release"].includes(action)) {
            state.modal = actionForm(action as "create_work" | "evidence" | "finish" | "release", state.selectedId);
            return;
        }
        confirm(action, {}, action === "claim" ? "Claim this work for the current operator session." : "Accept this claim and begin work.");
    };
    const submitForm = (form: Extract<Modal, {
        kind: "form";
    }>): void => {
        const values = Object.fromEntries(form.fields.map(f => [f.name, f.value.trim()]));
        const missing = form.fields.findIndex(f => f.required && !f.value.trim());
        if (missing >= 0) {
            form.index = missing;
            form.error = `${form.fields[missing].label} is required.`;
            return;
        }
        if (form.action === "create_work") {
            const priority = Number(values.priority || "0");
            if (!Number.isInteger(priority) || priority < 0 || priority > 255) {
                form.index = 4;
                form.error = "Priority must be an integer from 0 to 255.";
                return;
            }
            if (!/^[^\s\u0000-\u001f\u007f]+$/u.test(values.work_id)) {
                form.index = 0;
                form.error = "Identifier cannot contain whitespace or control characters.";
                return;
            }
            const input: CreateWorkDraftInput = { work_id: values.work_id, kind: values.kind as CreateWorkDraftInput["kind"], title: values.title,
                parent_id: values.parent_id || null, priority, ...(values.description ? { description: values.description } : {}) };
            confirm("create_work", input, `Create ${input.kind}: ${input.title}`, [`Identifier: ${input.work_id}`, `Parent: ${input.parent_id ?? "none"}`, `Priority: ${priority}`]);
        }
        else if (form.action === "evidence") {
            try {
                const receipt: unknown = JSON.parse(values.receipt);
                if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt))
                    throw new Error("Receipt must be a JSON object.");
                confirm("evidence", receipt, "Attach this receipt to the current attempt.", ["The service validates receipt contents and provenance."], form.workId);
            }
            catch (error) {
                form.error = error instanceof Error ? error.message : "Invalid receipt JSON.";
            }
        }
        else if (form.action === "finish")
            confirm("finish", values.summary, values.summary, ["Requests proof-gated finish and close."], form.workId);
        else
            confirm("release", values.reason, values.reason, ["Releases the current attempt."], form.workId);
    };
    const execute = async (pending: Confirm): Promise<void> => {
        const view = controller.view();
        if ((view.monitoring?.revision ?? null) !== pending.revision || (pending.workId && attemptIdentity(view, pending.workId) !== pending.attempt)) {
            message("The snapshot or attempt changed. Review the latest work and confirm again.", true);
            return;
        }
        if (pending.workId) {
            controller.navigate({ kind: "work", project_id: view.route.project_id, work_id: pending.workId });
            state.selectedId = pending.workId;
        }
        const rule = controller.view().actions.find(a => a.action === pending.action);
        if (!rule?.enabled) {
            message(rule?.reason ?? "The action is no longer available.", true);
            return;
        }
        let result: ActionResult<unknown>;
        switch (pending.action) {
            case "create_work":
                result = await controller.createWork(pending.payload as CreateWorkDraftInput);
                break;
            case "claim":
                result = await controller.claim(pending.workId!);
                break;
            case "accept_start":
                result = await controller.acceptStart(pending.workId!);
                break;
            case "evidence":
                result = await controller.addEvidence(pending.workId!, pending.payload);
                break;
            case "finish":
                result = await controller.finish(pending.workId!, pending.payload as string);
                break;
            case "release":
                result = await controller.release(pending.workId!, pending.payload as string);
                break;
            default: throw new Error("Unsupported interactive action");
        }
        message(resultMessage(pending.action, result), !result.ok);
    };
    const readback = (): void => {
        const operation = controller.view().pending_operations[0];
        if (!operation) {
            message("There are no unresolved operations.");
            return;
        }
        if (!controller.readback) {
            message("Operation readback is not available from this controller.", true);
            return;
        }
        enqueue("Reading operation", async () => {
            await controller.readback!(operation.operation_id);
            const remains = controller.view().pending_operations.some(p => p.operation_id === operation.operation_id);
            message(remains ? `Operation ${operation.operation_id} remains unresolved. No retry was sent.` : `Operation ${operation.operation_id} resolved. No retry was sent.`, remains);
            if (!remains)
                await controller.refresh();
        });
    };
    const stop = (): void => {
        if (shutdown)
            return;
        accepting = false;
        state.modal = null;
        if (refreshTimer)
            clearInterval(refreshTimer);
        if (escapeTimer)
            clearTimeout(escapeTimer);
        // Restore terminal ownership before waiting for in-flight service work.
        // The launcher may need to supervise this process during the bounded
        // drain, and the operator must never be left in raw/alternate-screen
        // mode while that happens.
        restoreTerminal();
        shutdown = (async () => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const drained = await Promise.race([work.then(() => true, () => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), options.shutdown_drain_ms ?? 10000); })]);
            if (timer)
                clearTimeout(timer);
            const operations = controller.view().pending_operations.map(p => p.operation_id);
            if (!drained) {
                shutdownTimedOut = true;
                if (active?.mutation || operations.length)
                    shutdownReport = `dashboard shutdown: ${active?.label ?? "mutation"} outcome unknown; ${operations.length ? `read operation ${operations.join(", ")} before retrying` : "no operation ID was returned; do not retry automatically"}`;
                else
                    shutdownReport = "dashboard shutdown: read request timed out; no mutation was queued.";
            }
            else if (operations.length)
                shutdownReport = `dashboard shutdown: operation ${operations.join(", ")} retained with unknown outcome; read back before retrying`;
        })();
        void shutdown.then(finish, finish);
    };
    const runCommand = (id: string): void => {
        state.modal = null;
        if (id.startsWith("filter:")) {
            setFilter(id.slice(7) as DashboardState["filter"]);
            return;
        }
        if (id.startsWith("action:")) {
            stage(id.slice(7) as TuiAction);
            return;
        }
        switch (id) {
            case "views":
                state.modal = { kind: "palette", value: "", index: state.navIndex, scope: "views" };
                break;
            case "density":
                state.density = cycleDensity(state.density);
                message(`Density: ${state.density}. Geometry still takes priority in short terminals.`);
                break;
            case "zen":
                state.zen = !state.zen;
                if (state.focus === "navigation") state.focus = "queue";
                message(state.zen ? "Focus view. z restores responsive panes." : "Responsive panes restored.");
                break;
            case "status":
                state.modal = { kind: "message", title: "STATUS / RECOVERY", text: currentNotice(controller.view(), state), offset: 0 };
                break;
            case "redraw":
                writer.invalidate();
                break;
            case "search":
                state.modal = { kind: "search", value: state.query };
                break;
            case "refresh":
                refresh(true);
                break;
            case "page":
                loadNextPage();
                break;
            case "readback":
                readback();
                break;
            case "freeze":
                state.frozen = !state.frozen;
                if (!state.frozen && browsingLaterPage) {
                    browsingLaterPage = false;
                    refresh(true);
                }
                message(state.frozen ? "Live refresh paused. r returns to the first page." : "Live refresh resumed on the first service page.");
                break;
            case "theme":
                state.theme = state.theme === "dark" ? "light" : state.theme === "light" ? "mono" : "dark";
                writer.invalidate();
                break;
            case "help":
                state.modal = { kind: "help", offset: 0 };
                break;
            case "quit":
                stop();
                break;
        }
    };
    const loadNextPage = (): void => {
        if (!controller.view().monitoring?.has_more) {
            message("This is the last service page.");
            return;
        }
        if (!controller.nextPage) {
            message("Pagination is unavailable.", true);
            return;
        }
        enqueue("Loading page", async () => { await controller.nextPage!(); browsingLaterPage = true; state.frozen = true; state.selectedId = undefined; syncSelection(); message("Next page loaded; polling paused. r / [ returns to page one; F resumes live refresh."); });
    };
    const editModal = (key: string): void => {
        const m = state.modal;
        if (!m)
            return;
        if (key === "escape") {
            state.modal = null;
            message("Cancelled. No action was submitted.");
            return;
        }
        if (m.kind === "confirm" || m.kind === "help" || m.kind === "message") {
            const size = terminal.dimensions(), doc = modalDocument(controller.view(), state, size.width, size.height);
            m.offset = Math.max(0, Math.min(m.offset ?? 0, doc.maximum));
            if (m.kind === "confirm" && ["enter", "y", "Y"].includes(key)) {
                if (size.width < 12 || size.height < 4) {
                    m.reviewError = "More space is needed to review this action safely.";
                    return;
                }
                m.reviewError = undefined;
                if (m.offset < doc.maximum) {
                    m.offset = Math.min(doc.maximum, m.offset + doc.capacity);
                    return; // Enter pages first; it never confirms hidden content.
                }
                if (mutationQueued) return;
                state.modal = null;
                mutationQueued = true;
                enqueue(ACTION_NAMES[m.action], async () => { try { await execute(m); }
                    finally { mutationQueued = false; } }, true);
            } else if (m.kind === "confirm" && ["n", "N"].includes(key)) state.modal = null;
            else if (["down", "j", "page-down"].includes(key)) m.offset = Math.min(doc.maximum, m.offset + (key === "page-down" ? doc.capacity : 1));
            else if (["up", "k", "page-up"].includes(key)) m.offset = Math.max(0, m.offset - (key === "page-up" ? doc.capacity : 1));
            else if (key === "home") m.offset = 0;
            else if (key === "end") m.offset = doc.maximum;
            return;
        }
        if (m.kind === "form") {
            const field = m.fields[m.index];
            if (key === "tab" || key === "shift-tab") {
                m.index = (m.index + (key === "tab" ? 1 : -1) + m.fields.length) % m.fields.length;
                return;
            }
            if (key === "enter") {
                if (m.index < m.fields.length - 1)
                    m.index++;
                else
                    submitForm(m);
                return;
            }
            if (field.choices && ["left", "right", "up", "down", " "].includes(key)) {
                const delta = key === "left" || key === "up" ? -1 : 1;
                field.value = field.choices[(field.choices.indexOf(field.value) + delta + field.choices.length) % field.choices.length];
                return;
            }
            if (field.choices)
                return;
            const edited = editInput(field.value, field.cursor, key, field.name === "receipt" ? 262144 : 8192, true);
            field.value = edited.value;
            field.cursor = edited.cursor;
            m.error = undefined;
            return;
        }
        if (m.kind === "palette") {
            if (["down", "up", "tab", "shift-tab", "page-up", "page-down"].includes(key) || (!m.value && ["home", "end"].includes(key))) {
                const count = paletteCommands(controller.view(), state).length;
                const size = terminal.dimensions(), page = Math.max(1, size.height - 5);
                if (key === "home") m.index = 0;
                else if (key === "end") m.index = Math.max(0, count - 1);
                else m.index = Math.max(0, Math.min(count - 1, m.index + (["up", "shift-tab", "page-up"].includes(key) ? -1 : 1) * (key.startsWith("page-") ? page : 1)));
                return;
            }
            if (key === "/" && !m.value) {
                state.modal = { kind: "search", value: state.query };
                return;
            }
            if (key === "enter") {
                const command = paletteCommands(controller.view(), state)[m.index];
                if (command && !command.disabled)
                    runCommand(command.id);
                else if (command)
                    message(command.hint, true);
                return;
            }
        }
        else if (key === "enter") {
            state.query = m.value.trim();
            state.modal = null;
            syncSelection();
            message(state.query ? `search: ${state.query}` : "Search cleared.");
            return;
        }
        const edited = editInput(m.value, m.cursor, key, 512);
        m.value = edited.value; m.cursor = edited.cursor;
        if (m.kind === "palette")
            m.index = 0;
    };
    const handleKey = (key: string): void => {
        if (closed || !accepting)
            return;
        if (key === "ctrl-c" || key === "ctrl-d") {
            stop();
            return;
        }
        if (key === "ctrl-l") { writer.invalidate(); redraw(); return; }
        if (state.modal) {
            editModal(key);
            redraw();
            return;
        }
        if (key === "q" || key === "Q") {
            stop();
            return;
        }
        const size = terminal.dimensions();
        if (key.startsWith("paste:")) {
            message("Paste ignored outside an input field.");
            redraw();
            return;
        }
        const currentLayout = dashboardLayout(size.width, size.height, state.detailOnly, state.density, state.zen);
        const currentInspector = inspectorRect(currentLayout, state);
        const page = state.focus === "inspector" && currentInspector ? paneViewport(currentInspector, currentLayout.chrome).height : currentLayout.visibleRows;
        if (FILTERS.some(f => f.key === key)) {
            setFilter(FILTERS.find(f => f.key === key)!.id);
            redraw();
            return;
        }
        switch (key) {
            case "down":
            case "j":
                move(1);
                break;
            case "up":
            case "k":
                move(-1);
                break;
            case "page-down":
                move(page);
                break;
            case "page-up":
                move(-page);
                break;
            case "home":
                if (state.focus === "inspector")
                    state.inspectorOffset = 0;
                else if (state.focus === "navigation") state.navIndex = 0;
                else
                    state.selectedId = visibleItems(controller.view(), state)[0]?.work_id;
                break;
            case "end":
                if (state.focus === "inspector") move(Number.MAX_SAFE_INTEGER);
                else if (state.focus === "navigation") state.navIndex = FILTERS.length - 1;
                else state.selectedId = visibleItems(controller.view(), state).at(-1)?.work_id;
                break;
            case "tab":
            case "shift-tab": {
                const layout = dashboardLayout(size.width, size.height, state.detailOnly, state.density, state.zen);
                const focus: DashboardState["focus"][] = state.detailOnly ? ["inspector"] : [...(layout.rail ? ["navigation" as const] : []), "queue", ...(layout.inspector ? ["inspector" as const] : [])];
                state.focus = focus[(Math.max(0, focus.indexOf(state.focus)) + (key === "tab" ? 1 : -1) + focus.length) % focus.length];
                break;
            }
            case "left":
            case "right":
                if (state.focus === "inspector" || state.detailOnly) {
                    state.inspectorTab = (state.inspectorTab + (key === "right" ? 1 : 2)) % 3;
                    state.inspectorOffset = 0;
                }
                else if (key === "left" && currentLayout.rail)
                    state.focus = "navigation";
                else if (key === "right") {
                    state.focus = "inspector";
                    state.detailOnly = false;
                }
                break;
            case "enter":
                if (state.focus === "navigation")
                    setFilter(FILTERS[state.navIndex].id);
                else if (state.selectedId) {
                    state.focus = "inspector";
                    state.detailOnly = false;
                    syncSelection();
                }
                break;
            case "escape":
                if (state.detailOnly || state.focus !== "queue") {
                    state.detailOnly = false;
                    state.focus = "queue";
                }
                else {
                    state.query = "";
                    message("Search cleared.");
                }
                break;
            case "/":
                state.modal = { kind: "search", value: state.query };
                break;
            case "p":
            case "P":
            case ":":
            case "ctrl-k":
                state.modal = { kind: "palette", value: "", index: 0 };
                break;
            case "v":
                runCommand("views");
                break;
            case "d":
                runCommand("density");
                break;
            case "z":
                runCommand("zen");
                break;
            case "!":
                runCommand("status");
                break;
            case "i":
                state.detailOnly = !state.detailOnly;
                state.focus = state.detailOnly ? "inspector" : "queue";
                break;
            case "f1":
            case "?":
                state.modal = { kind: "help", offset: 0 };
                break;
            case "r":
            case "R":
                refresh(true);
                break;
            case "F":
                runCommand("freeze");
                break;
            case "T":
                runCommand("theme");
                break;
            case "o":
                state.sort = state.sort === "service" ? "priority" : state.sort === "priority" ? "title" : "service";
                break;
            case "]":
                loadNextPage();
                break;
            case "[":
                refresh(true);
                break;
            case "u":
                readback();
                break;
            case "n":
                stage("create_work");
                break;
            case "c":
            case "C":
                stage("claim");
                break;
            case "s":
            case "S":
                stage("accept_start");
                break;
            case "e":
                stage("evidence");
                break;
            case "f":
                stage("finish");
                break;
            case "x":
            case "X":
                stage("release");
                break;
        }
        redraw();
    };
    try {
        // Disable autowrap to avoid writing the bottom-right cell scrolling the screen.
        terminal.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h");
        terminal.setRawMode?.(true);
        terminal.resume?.();
        disposers.push(terminal.onData(value => {
            if (escapeTimer)
                clearTimeout(escapeTimer);
            decoder.push(value).forEach(handleKey);
            if (decoder.awaitingEscape)
                escapeTimer = setTimeout(() => decoder.flushEscape().forEach(handleKey), 35);
        }));
        disposers.push(terminal.onResize(() => {
            const size = terminal.dimensions();
            const l = dashboardLayout(size.width, size.height, state.detailOnly, state.density, state.zen);
            if (!l.rail && state.focus === "navigation") state.focus = "queue";
            // Inspector focus is retained. The renderer temporarily promotes it to a
            // full view, and returns it to its split pane when space becomes available.
            writer.invalidate();
            redraw();
        }));
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
            disposers.push(terminal.onSignal(signal, stop));
        if (terminal.onEnd)
            disposers.push(terminal.onEnd(stop));
        const refreshMs = options.auto_refresh_ms ?? 5000;
        if (refreshMs > 0)
            refreshTimer = setInterval(() => refresh(), Math.max(500, refreshMs));
        redraw();
        await finished;
    }
    finally {
        closed = true;
        accepting = false;
        if (refreshTimer)
            clearInterval(refreshTimer);
        if (escapeTimer)
            clearTimeout(escapeTimer);
        for (const dispose of disposers.reverse())
            try {
                dispose();
            }
            catch { /* Continue restoring the other terminal resources. */ }
        restoreTerminal();
        if (shutdownReport)
            terminal.write(safeText(shutdownReport) + "\n");
    }
}
