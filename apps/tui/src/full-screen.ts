import type { ActionResult, CreateWorkDraftInput, MountedView, TuiAction } from "./client.js";
import type { LineShellController } from "./line-shell.js";
import { eraseLast, safeText } from "./ui/cells.js";
import { FrameWriter, type Theme } from "./ui/screen.js";
import { renderDashboard, dashboardLayout, detailLines } from "./ui/dashboard.js";
import { initialState, reconcileSelection, visibleItems, FILTERS, ACTION_NAMES, actionForm, paletteCommands, type Modal, type DashboardState } from "./ui/model.js";
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
    const writer = new FrameWriter(value => terminal.write(value));
    const decoder = new StreamingKeyDecoder();
    let accepting = true, closed = false, shutdownTimedOut = false;
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
            const size = terminal.dimensions(), layout = dashboardLayout(size.width, size.height, state.detailOnly);
            const rect = state.detailOnly ? layout.body : layout.inspector;
            if (rect) {
                const selected = visibleItems(controller.view(), state).find(i => i.work_id === state.selectedId);
                const maximum = Math.max(0, detailLines(selected, controller.view(), state.inspectorTab, rect.width - 4).length - Math.max(1, rect.height - 4));
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
        if (m.kind === "confirm") {
            if (key === "enter" || key === "y" || key === "Y") {
                // Consume the exact draft now. Duplicate Enter cannot enqueue it again.
                if (mutationQueued)
                    return;
                state.modal = null;
                mutationQueued = true;
                enqueue(ACTION_NAMES[m.action], async () => { try {
                    await execute(m);
                }
                finally {
                    mutationQueued = false;
                } }, true);
            }
            else if (key === "n" || key === "N")
                state.modal = null;
            else if (["down", "j", "page-down"].includes(key))
                m.offset = Math.min(10000, (m.offset ?? 0) + (key === "page-down" ? 8 : 1));
            else if (["up", "k", "page-up"].includes(key))
                m.offset = Math.max(0, (m.offset ?? 0) - (key === "page-up" ? 8 : 1));
            else if (key === "home")
                m.offset = 0;
            return;
        }
        if (m.kind === "help") {
            if (["down", "j", "page-down"].includes(key))
                m.offset += key === "page-down" ? 10 : 1;
            if (["up", "k", "page-up"].includes(key))
                m.offset = Math.max(0, m.offset - (key === "page-up" ? 10 : 1));
            if (key === "home")
                m.offset = 0;
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
            if (key === "backspace")
                field.value = eraseLast(field.value);
            else if (key === "ctrl-u")
                field.value = "";
            else if (key.startsWith("paste:"))
                field.value = (field.value + key.slice(6).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")).slice(0, field.name === "receipt" ? 262144 : 8192);
            else if (Array.from(key).length === 1)
                field.value = (field.value + key).slice(0, field.name === "receipt" ? 262144 : 8192);
            m.error = undefined;
            return;
        }
        if (m.kind === "palette") {
            if (key === "down" || key === "up") {
                m.index = Math.max(0, Math.min(paletteCommands(controller.view(), state).length - 1, m.index + (key === "down" ? 1 : -1)));
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
        if (key === "backspace")
            m.value = eraseLast(m.value);
        else if (key === "ctrl-u")
            m.value = "";
        else if (key.startsWith("paste:"))
            m.value = (m.value + safeText(key.slice(6)).replaceAll("�", " ")).slice(0, 512);
        else if (Array.from(key).length === 1)
            m.value = (m.value + key).slice(0, 512);
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
        if (size.width < 44 || size.height < 14)
            return;
        if (key.startsWith("paste:")) {
            message("Paste ignored outside an input field.");
            redraw();
            return;
        }
        const page = dashboardLayout(size.width, size.height, state.detailOnly).visibleRows;
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
                else
                    state.selectedId = visibleItems(controller.view(), state)[0]?.work_id;
                break;
            case "end":
                state.selectedId = visibleItems(controller.view(), state).at(-1)?.work_id;
                break;
            case "tab":
            case "shift-tab": {
                const layout = dashboardLayout(size.width, size.height, state.detailOnly);
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
                else if (key === "left" && size.width >= 124)
                    state.focus = "navigation";
                else if (key === "right") {
                    state.focus = "inspector";
                    state.detailOnly = size.width < 100;
                }
                break;
            case "enter":
                if (state.focus === "navigation")
                    setFilter(FILTERS[state.navIndex].id);
                else if (state.selectedId) {
                    state.focus = "inspector";
                    state.detailOnly = size.width < 100;
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
            const { width } = terminal.dimensions();
            if (width < 124 && state.focus === "navigation")
                state.focus = "queue";
            if (width < 100 && state.focus === "inspector")
                state.detailOnly = true;
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
        try {
            terminal.setRawMode?.(terminal.was_raw ?? false);
        }
        finally {
            terminal.pause?.();
            terminal.write("\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l");
        }
        if (shutdownReport)
            terminal.write(safeText(shutdownReport) + "\n");
    }
}
