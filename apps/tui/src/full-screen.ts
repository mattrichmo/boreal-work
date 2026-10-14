import type { ActionResult, AttemptReceiptPage, AttemptReceiptRecord, BusinessScheduleDto, CreateWorkDraftInput, CycleChange, CycleCommandInput, DependencyChangeInput, Envelope, ExecutionMode, ExternalWaitAccountableDto, ExternalWaitCategoryDto, ExternalWaitOutcomeDto, ExternalWaitRoleDto, FinalResultBinding, IntakeDispositionReadbackDto, IntakeListReadbackDto, IntakeLifecycleDto, IntakePromoteReadbackDto, IntakePromotionTargetKindDto, LocalDateTimeInput, MemoryCommandInput, MountedView, RecoveryCommandInput, RevisionedStatusResponse, TuiAction, WorkspaceViewKind, WorkEditInput, WorkProjection } from "./client.js";
import type { LineShellController } from "./line-shell.js";
import { safeText } from "./ui/cells.js";
import { FrameWriter, type Theme } from "./ui/screen.js";
import { renderDashboard, dashboardLayout, detailLines, inspectorRect, modalDocument, currentNotice } from "./ui/dashboard.js";
import { initialState, reconcileSelection, visibleItems, FILTERS, ACTION_NAMES, actionForm, paletteCommands, type FormModal, type Modal, type DashboardState, type PlanningTaskPickerItem, type UiAction, type WorkspaceUiAction } from "./ui/model.js";
import { paneViewport, cycleDensity, type Density } from "./ui/layout.js";
import { editInput } from "./ui/input.js";
import { StreamingKeyDecoder } from "./ui/keys.js";
import { formatWorkspaceView } from "./ui/workspace-view.js";
import { businessDateFromInput, businessDateInput, businessDateLabel } from "./scheduling.js";
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
    readWorkspaceView?: (kind: WorkspaceViewKind) => Promise<Envelope<unknown>>;
    readCycle?: (view: "list" | "current" | "board" | "report", cycle_id?: string, limit?: number, offset?: number) => Promise<Envelope<unknown>>;
    readSources?: (limit?: number, offset?: number) => Promise<Envelope<{ project_id: string; items: SourceRow[]; total: number; offset: number; limit: number; has_more: boolean; catalog_root: string }>>;
    readIntake?: (limit?: number, offset?: number) => Promise<Envelope<IntakeListReadbackDto>>;
    updateIntakeDisposition?: (input: { intake_id: string; expected_content_revision: number; lifecycle: Exclude<IntakeLifecycleDto, "captured">; revisit_at_utc_ms: number | null }) => Promise<ActionResult<IntakeDispositionReadbackDto>>;
    promoteIntake?: (input: { intake_id: string; expected_content_revision: number; target_kind: IntakePromotionTargetKindDto; target_id: string }) => Promise<ActionResult<IntakePromoteReadbackDto>>;
    searchSources?: (query: string, limit?: number) => Promise<Envelope<unknown>>;
    readReview?: (review_id: string) => Promise<Envelope<unknown>>;
    readWork?: (work_id: string) => Promise<Envelope<WorkProjection>>;
    readWorkPage?: (limit?: number, offset?: number) => Promise<Envelope<RevisionedStatusResponse>>;
    editWork?: (input: Omit<WorkEditInput, "project_id" | "expected_revision">) => Promise<ActionResult<unknown>>;
    changeDependency?: (action: "dependency_add" | "dependency_remove", input: Omit<DependencyChangeInput, "project_id" | "expected_revision">) => Promise<ActionResult<unknown>>;
    changeCycle?: (input: CycleCommandInput) => Promise<ActionResult<unknown>>;
    runMemoryCommand?: (input: MemoryCommandInput) => Promise<ActionResult<unknown>>;
    runRecoveryCommand?: (input: RecoveryCommandInput) => Promise<ActionResult<unknown>>;
    endSession?: () => Promise<ActionResult<unknown>>;
    addSource?: (input: { input: string; origin: string; media_type?: string }) => Promise<ActionResult<unknown>>;
    bindFinalResult?: (work_id: string, input: { source_version_id: string; content_digest: string }) => Promise<ActionResult<FinalResultBinding>>;
    readWorkSchedule?: (work_id: string) => Promise<Envelope<import("./client.js").WorkScheduleReadbackDto>>;
    updateWorkSchedule?: (work_id: string, schedule_revision: number, schedule: BusinessScheduleDto) => Promise<ActionResult<import("./client.js").WorkScheduleMutationReadbackDto>>;
    readProjectCivilTime?: () => Promise<Envelope<import("./client.js").ProjectCivilTimeReadbackDto>>;
    readExternalWaits?: (wait_id?: string) => Promise<Envelope<import("./client.js").ExternalWaitReadbackDto>>;
    readExternalWaitPage?: (limit?: number, offset?: number, expected_project_revision?: number) => Promise<Envelope<import("./client.js").ExternalWaitListReadbackDto>>;
    createExternalWait?: (input: Omit<import("./client.js").ExternalWaitCreateDto, "schema_version" | "expected_project_revision" | "expected_wait_revision">) => Promise<ActionResult<import("./client.js").ExternalWaitMutationReadbackDto>>;
    resolveExternalWait?: (input: Omit<import("./client.js").ExternalWaitResolveDto, "schema_version" | "expected_project_revision">) => Promise<ActionResult<import("./client.js").ExternalWaitMutationReadbackDto>>;
    readReceiptsForAttempt?: (work_id: string, limit?: number, offset?: number) => Promise<Envelope<AttemptReceiptPage>>;
    selectReceiptForAttempt?: (work_id: string, receipt_id: string) => void;
};
interface SourceRow {
    project_id: string;
    source_version_id: string;
    origin: string;
    media_type: string;
    byte_count: number;
    content_digest: string;
    availability: string;
    parser_identity?: string | null;
}
const WORKSPACE_UI_ACTIONS = new Set<WorkspaceUiAction>([
    "edit_work", "dependency_add", "dependency_remove", "cycle_create", "cycle_board", "cycle_activate", "cycle_close", "cycle_cancel",
    "cycle_assign", "cycle_commit", "cycle_remove", "cycle_carry_over", "memory_search", "memory_show", "memory_draft", "memory_review",
    "memory_publish", "memory_reconcile", "recovery_resolve", "session_end", "source_capture", "source_search", "review_show", "bind_result",
    "schedule_edit", "wait_create", "wait_resolve", "wait_page", "intake_page", "intake_disposition", "intake_promote",
]);
function isWorkspaceUiAction(action: UiAction): action is WorkspaceUiAction {
    return WORKSPACE_UI_ACTIONS.has(action as WorkspaceUiAction);
}
function attemptIdentity(view: MountedView, id?: string): string | null {
    const a = view.monitoring?.items.find(i => i.work_id === id)?.attempt;
    return a ? `${a.attempt_id} · generation ${a.fence}` : null;
}
function resultMessage(action: TuiAction, result: ActionResult<unknown>): string {
    if (result.ok)
        return `${ACTION_NAMES[action]}: ${result.envelope.outcome} · revision ${result.envelope.revision ?? "unknown"}`;
    return `${ACTION_NAMES[action]}: ${result.error.message}${result.envelope.outcome === "unknown" ? ` · the result is unclear; press u to read operation ${result.envelope.operation_id} before retrying` : ""}`;
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
    const confirm = (action: UiAction, payload: unknown, summary: string, details: string[] = [], id?: string): void => {
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
        if (["create_work", "claim", "evidence", "finish", "release"].includes(action)) {
            state.modal = actionForm(action as "create_work" | "claim" | "evidence" | "finish" | "release", state.selectedId);
            return;
        }
        confirm(action, {}, action === "claim" ? "Claim this work for the current operator session." : "Accept this claim and begin work.", [], state.selectedId);
    };
    const stageWorkspace = (action: WorkspaceUiAction): void => {
        if (state.busy || mutationQueued) {
            message("Wait for the current request to finish before starting another action.", true);
            return;
        }
        syncSelection();
        const current = controller.view();
        const selected = visibleItems(current, state).find(item => item.work_id === state.selectedId);
        const needsWork = ["edit_work", "dependency_add", "dependency_remove", "bind_result", "schedule_edit", "wait_create"].includes(action);
        if (needsWork && !selected) {
            message(`${ACTION_NAMES[action]} requires selected work.`, true);
            return;
        }
        if (action === "session_end") {
            confirm(action, {}, "End the current service session.", [
                `Project: ${current.route.project_id ?? "unknown"}`,
                "Session: the mounted actor/harness/session context",
                "The service checks current authority and project revision before ending it.",
            ], undefined);
            return;
        }
        if (action === "edit_work") {
            if (!selected || !controller.readWork) {
                message("Work detail is unavailable; refresh or reconnect before opening an edit form.", true);
                return;
            }
            const selectedWork = selected;
            enqueue("Reading work detail", async () => {
                const result = await controller.readWork!(selectedWork.work_id);
                const detail = result.data;
                if (!detail || detail.project_id !== current.route.project_id || detail.work_id !== selectedWork.work_id)
                    throw new Error("Work detail did not match the selected project item.");
                const hydrated = { ...selectedWork, title: detail.title, description: detail.description,
                    parent_id: detail.parent_id, kind: detail.kind, dispatch_policy: detail.dispatch_policy,
                    priority: detail.priority, execution_mode: detail.execution_mode ?? null };
                state.modal = actionForm(action, selectedWork.work_id, hydrated);
                message(`Loaded ${selectedWork.work_id} detail for editing.`);
            });
            return;
        }
        if (action === "schedule_edit") {
            if (!selected || !controller.readWorkSchedule) {
                message("Work schedule editing is unavailable in this connection.", true);
                return;
            }
            const selectedWork = selected;
            enqueue("Reading work schedule", async () => {
                const [scheduleResult, civilResult] = await Promise.all([
                    controller.readWorkSchedule!(selectedWork.work_id),
                    controller.readProjectCivilTime?.(),
                ]);
                const currentRevision = controller.view().monitoring?.revision;
                if (!scheduleResult.data || scheduleResult.data.work_id !== selectedWork.work_id
                    || scheduleResult.data.project_revision !== currentRevision || scheduleResult.revision !== currentRevision
                    || (civilResult && (civilResult.data?.project_revision !== currentRevision || civilResult.revision !== currentRevision))) {
                    throw new Error("The schedule changed while it was being read. Refresh and open the schedule form again.");
                }
                const legacyDue = scheduleResult.data.legacy_due_at ? Date.parse(scheduleResult.data.legacy_due_at) : NaN;
                const snapshot: BusinessScheduleDto = scheduleResult.data.schedule ?? {
                    not_before: null,
                    due: Number.isFinite(legacyDue) ? { kind: "instant", at_ms: legacyDue } : null,
                    planned_start: null,
                    planned_end: null,
                };
                const form = actionForm(action, selectedWork.work_id, selectedWork);
                form.scheduleRevision = scheduleResult.data.schedule_revision;
                form.scheduleSnapshot = snapshot;
                form.civilTimezone = civilResult?.data?.setting?.timezone;
                for (const name of ["not_before", "due", "planned_start", "planned_end"] as const) {
                    const field = form.fields.find(candidate => candidate.name === name);
                    if (field) {
                        field.value = businessDateInput(snapshot[name]);
                        field.cursor = field.value.length;
                        field.hint = `YYYY-MM-DD${form.civilTimezone ? ` in ${form.civilTimezone}` : " in the project civil timezone"}; blank clears this optional date.`;
                    }
                }
                state.modal = form;
                const legacyNote = !scheduleResult.data.schedule && scheduleResult.data.legacy_due_at
                    ? " Existing legacy due time is preserved unless you change or clear it." : "";
                message(`Loaded schedule revision ${scheduleResult.data.schedule_revision}.${legacyNote}`);
            });
            return;
        }
        state.modal = actionForm(action, needsWork ? selected?.work_id : undefined, selected);
    };
    const showWorkspaceData = (title: string, kind: WorkspaceViewKind, result: Envelope<unknown>): void => {
        state.modal = { kind: "message", title: title.toUpperCase(), text: formatWorkspaceView(
            kind,
            controller.view().route.project_id ?? "unknown project",
            result.revision,
            result.as_of,
            result.data,
            controller.view().monitoring?.items ?? [],
            controller.view().monitoring?.revision,
        ), offset: 0 };
    };
    const openSourcePicker = (form: FormModal, fieldName: "source_version_id", offset = 0): void => {
        if (!controller.readSources) {
            form.error = "Registered source selection is unavailable in this service connection.";
            return;
        }
        enqueue("Loading registered sources", async () => {
            try {
                const result = await controller.readSources!(100, offset);
                const data = result.data;
                if (!data || data.project_id !== controller.view().route.project_id || !Array.isArray(data.items))
                    throw new Error("The source list did not belong to the mounted project.");
                const items = data.items.filter(item => item.project_id === data.project_id && typeof item.source_version_id === "string" && item.source_version_id.trim());
                if (items.length !== data.items.length)
                    throw new Error("The source list included malformed or cross-project rows; none were selected.");
                if (state.modal !== form && !(state.modal?.kind === "source_picker" && state.modal.form === form)) return;
                state.modal = {
                    kind: "source_picker", form, field_name: fieldName, items, index: 0,
                    total: data.total, offset: data.offset, limit: data.limit, has_more: data.has_more,
                    revision: result.revision, as_of: result.as_of,
                };
                message(items.length ? `${items.length} registered source versions loaded.` : "No registered source versions are available on this page.");
            }
            catch (error) {
                form.error = error instanceof Error ? error.message : String(error);
                if (state.modal === form) message("Source selection is unavailable.", true);
            }
        });
    };
    const openWorkPicker = (form: FormModal, offset = 0, limit = 50): void => {
        if (!controller.readWorkPage || !controller.readWork) {
            form.error = "Task assignment requires the typed work list and hierarchy read routes.";
            return;
        }
        enqueue("Checking Task hierarchy", async () => {
            const page = await controller.readWorkPage!(limit, offset);
            const data = page.data;
            if (!data || data.project_id !== controller.view().route.project_id || !Array.isArray(data.items))
                throw new Error("The work page did not belong to the mounted project.");
            const currentRevision = controller.view().monitoring?.revision;
            if (currentRevision !== undefined && currentRevision !== page.revision)
                throw new Error("The work list changed while the dashboard was open. Refresh, then reopen the Task picker.");
            const candidates = data.items.filter(item => item.kind === "task" && !item.diagnostic);
            const items: PlanningTaskPickerItem[] = candidates
                .filter(item => item.planning_integrity === "valid" && (item.execution_mode === "direct" || item.execution_mode === "container"))
                .map(item => ({ work_id: item.work_id, title: item.title ?? item.work_id,
                    execution_mode: item.execution_mode as "direct" | "container", planning_parent_id: item.planning_parent_id ?? null }));
            if (state.modal !== form && !(state.modal?.kind === "work_picker" && state.modal.form === form)) return;
            state.modal = {
                kind: "work_picker", form, field_name: "work_id", items, index: 0,
                total: data.total ?? data.items.length, hidden: candidates.length - items.length,
                offset: data.offset ?? offset, limit: data.limit ?? limit, has_more: data.has_more ?? false,
                revision: page.revision, as_of: page.as_of,
            };
            message(`Validated ${items.length} assignable Tasks; ${candidates.length - items.length} hidden because the planning hierarchy was not valid.`);
        });
    };
    const openReceiptPicker = (work_id: string, offset = 0, limit = 50): void => {
        if (!controller.readReceiptsForAttempt) {
            message("Attempt receipt history is unavailable in this service connection.", true);
            return;
        }
        const current = controller.view();
        const item = current.monitoring?.items.find(row => row.work_id === work_id);
        const attempt = item?.attempt;
        if (!item || !attempt) {
            message("Receipt history requires work with a current attempt.", true);
            return;
        }
        const identity = { work_id, attempt_id: attempt.attempt_id, fence: attempt.fence };
        enqueue("Loading attempt receipt history", async () => {
            const result = await controller.readReceiptsForAttempt!(work_id, limit, offset);
            const data = result.data;
            const latest = controller.view().monitoring?.items.find(row => row.work_id === work_id)?.attempt;
            if (!data || data.project_id !== current.route.project_id || data.work_id !== identity.work_id
                || data.attempt_id !== identity.attempt_id || data.fence !== identity.fence
                || !latest || latest.attempt_id !== identity.attempt_id || latest.fence !== identity.fence)
                throw new Error("The receipt page did not match the current work attempt and fence.");
            // Do not let a late page read replace a different view or a newly
            // selected work item after the operator has navigated elsewhere.
            const latestView = controller.view();
            if (state.modal !== null || latestView.route.project_id !== current.route.project_id
                || latestView.selected_work?.work_id !== work_id)
                return;
            state.modal = {
                kind: "receipt_picker", work_id, attempt_id: attempt.attempt_id, fence: attempt.fence,
                items: data.items, index: 0, offset: data.offset, limit: data.limit, has_more: data.has_more,
                revision: result.revision, as_of: result.as_of,
            };
            const selectable = data.items.filter(record => record.receipt_payload !== undefined && record.receipt_payload !== null).length;
            message(`Loaded ${data.items.length} receipt records for the exact fence; ${selectable} have a reconstructed payload available for explicit selection.`);
        });
    };
    const changeSourcePage = (direction: -1 | 1): void => {
        const picker = state.modal;
        if (picker?.kind !== "source_picker") return;
        const nextOffset = direction < 0 ? Math.max(0, picker.offset - picker.limit) : picker.offset + picker.limit;
        if (direction > 0 && !picker.has_more) {
            message("No later source page is available.");
            return;
        }
        openSourcePicker(picker.form, picker.field_name, nextOffset);
    };
    const changeWorkPage = (direction: -1 | 1): void => {
        const picker = state.modal;
        if (picker?.kind !== "work_picker") return;
        const nextOffset = direction < 0 ? Math.max(0, picker.offset - picker.limit) : picker.offset + picker.limit;
        if (direction > 0 && !picker.has_more) {
            message("No later work page is available.");
            return;
        }
        openWorkPicker(picker.form, nextOffset, picker.limit);
    };
    const changeReceiptPage = (direction: -1 | 1): void => {
        const picker = state.modal;
        if (picker?.kind !== "receipt_picker") return;
        const nextOffset = direction < 0 ? Math.max(0, picker.offset - picker.limit) : picker.offset + picker.limit;
        if (direction > 0 && !picker.has_more) {
            message("No later receipt page is available.");
            return;
        }
        openReceiptPicker(picker.work_id, nextOffset, picker.limit);
    };
    const readWorkspaceForm = (form: Extract<Modal, { kind: "form" }>, values: Record<string, string>): void => {
        state.modal = null;
        enqueue(`Loading ${ACTION_NAMES[form.action]}`, async () => {
            if (form.action === "cycle_board") {
                if (!controller.readCycle) throw new Error("Cycle board is unavailable in this connection.");
                showWorkspaceData("Cycle board", "cycles", await controller.readCycle("board", values.cycle_id));
            } else if (form.action === "memory_search" || form.action === "memory_show") {
                if (!controller.runMemoryCommand) throw new Error("Memory operations are unavailable in this connection.");
                const memory: MemoryCommandInput = form.action === "memory_show"
                    ? { expected_revision: null, confirmed: false, change: { kind: "show", draft_id: values.draft_id } }
                    : { expected_revision: null, confirmed: false, change: { kind: "search", text: values.query || null, entry_id: null, source_version_id: null, requested_git_revision: null, limit: 20 } };
                const result = await controller.runMemoryCommand(memory);
                if (!result.ok) throw result.error;
                showWorkspaceData(form.action === "memory_show" ? "Memory draft" : "Published memory", "memory", result.envelope);
            } else if (form.action === "source_search") {
                if (!controller.searchSources) throw new Error("Source search is unavailable in this connection.");
                showWorkspaceData("Source search", "sources", await controller.searchSources(values.query));
            } else if (form.action === "review_show") {
                if (!controller.readReview) throw new Error("Review detail is unavailable in this connection.");
                showWorkspaceData("Review detail", "reviews", await controller.readReview(values.review_id));
            } else if (form.action === "intake_page") {
                if (!controller.readIntake) throw new Error("Intake list is unavailable in this connection.");
                const limit = Number(values.limit), offset = Number(values.offset);
                if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
                    throw new Error("Intake page size must be 1..100 and offset must be a non-negative integer.");
                showWorkspaceData("Intake inbox", "intake", await controller.readIntake(limit, offset));
            } else if (form.action === "wait_page") {
                if (!controller.readExternalWaitPage) throw new Error("External wait pages are unavailable in this connection.");
                const limit = Number(values.limit), offset = Number(values.offset);
                if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
                    throw new Error("External wait page size must be 1..100 and offset must be a non-negative integer.");
                const expectedRevision = values.expected_project_revision ? Number(values.expected_project_revision) : undefined;
                if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))
                    throw new Error("Expected project revision must be a non-negative integer.");
                showWorkspaceData("External waits", "waits", await controller.readExternalWaitPage(limit, offset, expectedRevision));
            }
            message(`${ACTION_NAMES[form.action]} loaded from the project service.`);
        });
    };
    const parseLocalDateTime = (value: string): LocalDateTimeInput | null => {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
        if (!match) return null;
        const [, year, month, day, hour, minute, second] = match;
        const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second ?? 0) };
        const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
        return date.getUTCFullYear() === parts.year && date.getUTCMonth() === parts.month - 1 && date.getUTCDate() === parts.day
            && parts.hour <= 23 && parts.minute <= 59 && parts.second <= 59 ? parts : null;
    };
    const submitForm = (form: FormModal): void => {
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
                form.index = form.fields.findIndex(field => field.name === "priority");
                form.error = "Priority must be an integer from 0 to 255.";
                return;
            }
            if (!/^[^\s\u0000-\u001f\u007f]+$/u.test(values.work_id)) {
                form.index = 0;
                form.error = "Identifier cannot contain whitespace or control characters.";
                return;
            }
            const kind = values.kind as CreateWorkDraftInput["kind"];
            const execution_mode: ExecutionMode | undefined = kind === "milestone" ? "container"
                : kind === "task" ? values.execution_mode as ExecutionMode : undefined;
            if (kind === "milestone" && values.execution_mode !== "container") {
                form.index = form.fields.findIndex(field => field.name === "execution_mode");
                form.error = "Milestones must use container execution mode.";
                return;
            }
            if (kind === "task" && !["direct", "container"].includes(values.execution_mode)) {
                form.index = form.fields.findIndex(field => field.name === "execution_mode");
                form.error = "Choose direct or container execution mode for this Task.";
                return;
            }
            const input: CreateWorkDraftInput = { work_id: values.work_id, kind, title: values.title,
                parent_id: values.parent_id || null, priority, ...(execution_mode ? { execution_mode } : {}),
                ...(values.description ? { description: values.description } : {}) };
            confirm("create_work", input, `Create ${input.kind}: ${input.title}`, [
                `Identifier: ${input.work_id}`, `Parent: ${input.parent_id ?? "none"}`, `Priority: ${priority}`,
                `Execution mode: ${execution_mode ?? "legacy Sprint grouping"}`,
            ]);
        }
        else if (form.action === "bind_result") {
            if (!form.workId) { form.error = "Select work with a current attempt before binding a result."; return; }
            if (!/^sha256:[0-9a-f]{64}$/u.test(values.content_digest)) {
                form.index = form.fields.findIndex(field => field.name === "source_version_id");
                form.error = "Select a registered source with a valid content digest using P.";
                return;
            }
            const selected = controller.view().monitoring?.items.find(item => item.work_id === form.workId);
            const facts = selected?.action_context;
            if (!selected?.attempt || facts?.state !== "available" || facts.integrity !== "valid"
                || !Number.isSafeInteger(facts.entity_revision) || !facts.entity_revision
                || !Number.isSafeInteger(facts.proof_revision) || !facts.proof_revision) {
                form.error = "Authoritative attempt, entity revision, and proof revision are unavailable; refresh before binding.";
                return;
            }
            confirm("bind_result", { source_version_id: values.source_version_id, content_digest: values.content_digest },
                `Bind ${values.source_version_id} as the captured result for ${form.workId}.`, [
                    `Attempt ${selected.attempt.attempt_id} · fence ${selected.attempt.fence}`,
                    `SHA-256 ${values.content_digest}`,
                    `Entity revision ${facts.entity_revision} · proof revision ${facts.proof_revision}`,
                    "The service verifies the registered source, revisions, attempt fence, and acceptance profile.",
                ], form.workId);
        }
        else if (form.action === "claim") {
            const sourceVersionId = values.source_version_id;
            const configIdentity = values.config_identity;
            if (!sourceVersionId || /^unknown$/iu.test(sourceVersionId)) {
                form.index = 0;
                form.error = "Enter a real registered source version ID; no source has been selected.";
                return;
            }
            if (!configIdentity || /^(?:unknown|n\/a|none|null|undefined|todo|tbd)$/iu.test(configIdentity)) {
                form.index = 1;
                form.error = "Enter a meaningful execution configuration identity, not a placeholder.";
                return;
            }
            const payload = { source_version_id: sourceVersionId, config_identity: configIdentity };
            confirm("claim", payload, "Claim this work for the current operator session.", [
                `Registered source version: ${sourceVersionId}`,
                `Execution configuration: ${configIdentity}`,
                "The service verifies project/source binding and the start contract.",
            ], form.workId);
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
        else if (form.action === "release")
            confirm("release", values.reason, values.reason, ["Releases the current attempt."], form.workId);
        else if (form.action === "schedule_edit") {
            if (!form.workId || form.scheduleRevision === undefined || !form.scheduleSnapshot) {
                form.error = "The typed schedule readback is missing. Cancel, refresh, and reopen this form.";
                return;
            }
            try {
                const schedule: BusinessScheduleDto = {
                    not_before: businessDateFromInput(values.not_before, form.scheduleSnapshot.not_before),
                    due: businessDateFromInput(values.due, form.scheduleSnapshot.due),
                    planned_start: businessDateFromInput(values.planned_start, form.scheduleSnapshot.planned_start),
                    planned_end: businessDateFromInput(values.planned_end, form.scheduleSnapshot.planned_end),
                };
                const dates = [
                    ["Not before", schedule.not_before], ["Due", schedule.due],
                    ["Planned start", schedule.planned_start], ["Planned end", schedule.planned_end],
                ] as const;
                const payload = { schedule_revision: form.scheduleRevision, schedule };
                confirm("schedule_edit", payload, `Update business dates for ${form.workId}.`, [
                    `Schedule revision: ${form.scheduleRevision}`,
                    `Project revision: ${controller.view().monitoring?.revision ?? "unavailable"}`,
                    ...dates.map(([label, date]) => `${label}: ${businessDateLabel(date, "none")}`),
                    "Each blank date explicitly clears that optional field. The Rust service resolves dates using the project's civil-time rules.",
                ], form.workId);
            } catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                const field = /not_before|due|planned_start|planned_end/u.exec(messageText)?.[0];
                if (field) form.index = form.fields.findIndex(candidate => candidate.name === field);
                form.error = messageText;
            }
        }
        else if (form.action === "wait_create") {
            if (!form.workId) { form.error = "Select the work item that owns this external wait."; return; }
            if (!values.wait_id.trim()) {
                form.index = form.fields.findIndex(field => field.name === "wait_id");
                form.error = "Enter a stable external wait identifier.";
                return;
            }
            if (!values.reason.trim()) {
                form.index = form.fields.findIndex(field => field.name === "reason");
                form.error = "Describe the external decision, information, access, or service needed.";
                return;
            }
            const affected = [...new Set(values.affected_work_ids.split(",").map(value => value.trim()).filter(Boolean))];
            if (!affected.length) {
                form.index = form.fields.findIndex(field => field.name === "affected_work_ids");
                form.error = "Name at least one affected work item so the service can block only that dependent work.";
                return;
            }
            const buildAccountable = (kind: string, reference: string, displayName: string, role: string, prefix: string): ExternalWaitAccountableDto => {
                if (kind === "role") return { kind: "role", role: role as ExternalWaitRoleDto };
                if (kind !== "person" && kind !== "service") throw new Error("Choose person, role, or service as the accountable party.");
                if (!reference.trim() || !displayName.trim()) throw new Error(`Enter both the ${prefix} reference and display name.`);
                return { kind, reference: reference.trim(), display_name: displayName.trim() };
            };
            let followUp;
            try {
                followUp = businessDateFromInput(values.follow_up);
            } catch (error) {
                form.index = form.fields.findIndex(field => field.name === "follow_up");
                form.error = error instanceof Error ? error.message : String(error);
                return;
            }
            let accountable: ExternalWaitAccountableDto;
            try {
                accountable = buildAccountable(values.accountable_kind, values.accountable_reference, values.accountable_name, values.accountable_role, "accountable party");
            } catch (error) {
                form.index = form.fields.findIndex(field => field.name === (values.accountable_kind === "role" ? "accountable_role" : "accountable_reference"));
                form.error = error instanceof Error ? error.message : String(error);
                return;
            }
            const payload = {
                wait_id: values.wait_id.trim(),
                source_work_id: form.workId,
                affected_work_ids: affected,
                category: values.category as ExternalWaitCategoryDto,
                reason: values.reason.trim(),
                accountable,
                expected_decision: values.expected_decision.trim() || null,
                expected_output: values.expected_output.trim() || null,
                follow_up: followUp,
            };
            confirm("wait_create", payload, `Record external wait ${payload.wait_id}.`, [
                `Source work: ${payload.source_work_id}`,
                `Affected work: ${affected.join(", ")}`,
                `Category: ${payload.category} · accountable: ${accountable.kind === "role" ? accountable.role : `${accountable.display_name} (${accountable.reference})`}`,
                `Follow-up: ${businessDateLabel(followUp, "none")}`,
                "The wait remains open until an authorized, attributable resolution is recorded. Only the named affected work may be blocked.",
            ], form.workId);
        }
        else if (form.action === "wait_resolve") {
            if (!controller.readExternalWaits) { form.error = "External wait readback is unavailable in this service connection."; return; }
            const waitId = values.wait_id.trim();
            if (!waitId) {
                form.index = form.fields.findIndex(field => field.name === "wait_id");
                form.error = "Enter the exact wait ID shown in External waits.";
                return;
            }
            if (!values.detail.trim()) {
                form.index = form.fields.findIndex(field => field.name === "detail");
                form.error = "Describe the decision or information that was actually supplied.";
                return;
            }
            if (!(values.next_state === "resolved" || values.next_state === "cancelled")) {
                form.index = form.fields.findIndex(field => field.name === "next_state");
                form.error = "Choose resolved or cancelled.";
                return;
            }
            const outcomes: ExternalWaitOutcomeDto[] = ["approved", "rejected", "decision_provided", "output_provided", "declined", "unavailable", "cancelled"];
            if (!outcomes.includes(values.outcome as ExternalWaitOutcomeDto)) {
                form.index = form.fields.findIndex(field => field.name === "outcome");
                form.error = "Choose a supported outcome.";
                return;
            }
            const buildAccountable = (kind: string, reference: string, displayName: string, role: string): ExternalWaitAccountableDto => {
                if (kind === "role" && ["agent", "operator", "reviewer", "publisher"].includes(role))
                    return { kind: "role", role: role as ExternalWaitRoleDto };
                if (kind !== "person" && kind !== "service") throw new Error("Choose person, role, or service as the supplier type.");
                if (!reference.trim() || !displayName.trim()) throw new Error("Enter both the supplier reference and display name.");
                return { kind, reference: reference.trim(), display_name: displayName.trim() };
            };
            let suppliedBy: ExternalWaitAccountableDto;
            try { suppliedBy = buildAccountable(values.supplied_kind, values.supplied_reference, values.supplied_name, values.supplied_role); }
            catch (error) {
                form.index = form.fields.findIndex(field => field.name === (values.supplied_kind === "role" ? "supplied_role" : "supplied_reference"));
                form.error = error instanceof Error ? error.message : String(error);
                return;
            }
            state.modal = null;
            enqueue("Checking external wait revision", async () => {
                let response: Envelope<import("./client.js").ExternalWaitReadbackDto>;
                try { response = await controller.readExternalWaits!(waitId); }
                catch (error) { state.modal = form; form.error = error instanceof Error ? error.message : String(error); throw error; }
                const wait = response.data?.waits[0];
                const currentRevision = controller.view().monitoring?.revision;
                if (!wait || response.data?.project_revision !== currentRevision || response.revision !== currentRevision) {
                    state.modal = form;
                    form.error = "The wait readback is not from the current project revision. Refresh and inspect the wait again.";
                    throw new Error(form.error);
                }
                if (wait.state !== "open") {
                    state.modal = form;
                    form.error = `External wait ${waitId} is already ${wait.state} at revision ${wait.wait_revision}.`;
                    throw new Error(form.error);
                }
                const payload = {
                    wait_id: wait.wait_id,
                    expected_wait_revision: wait.wait_revision,
                    next_state: values.next_state,
                    outcome: values.outcome as ExternalWaitOutcomeDto,
                    detail: values.detail.trim(),
                    output_ref: values.output_ref.trim() || null,
                    supplied_by: suppliedBy,
                };
                confirm("wait_resolve", payload, `${payload.next_state === "resolved" ? "Resolve" : "Cancel"} external wait ${wait.wait_id}.`, [
                    `Wait revision: ${wait.wait_revision} · project revision: ${currentRevision}`,
                    `Source work: ${wait.source_work_id} · affected work: ${wait.affected_work_ids.join(", ") || "none named"}`,
                    `Outcome: ${payload.outcome} · supplied by: ${suppliedBy.kind === "role" ? suppliedBy.role : `${suppliedBy.display_name} (${suppliedBy.reference})`}`,
                    `Detail: ${payload.detail}`,
                    "Resolution records the external decision. It does not complete the source work or its dependents; the service recomputes their status.",
                ]);
            });
        }
        else if (["cycle_board", "memory_search", "memory_show", "source_search", "review_show", "intake_page", "wait_page"].includes(form.action))
            readWorkspaceForm(form, values);
        else if (form.action === "intake_disposition") {
            const contentRevision = Number(values.content_revision);
            if (!Number.isSafeInteger(contentRevision) || contentRevision < 1) {
                form.index = form.fields.findIndex(field => field.name === "content_revision");
                form.error = "Content revision must be a positive integer from the Intake list.";
                return;
            }
            const revisit = values.revisit_at_utc_ms ? Number(values.revisit_at_utc_ms) : null;
            if (revisit !== null && (!Number.isSafeInteger(revisit) || revisit < 0)) {
                form.index = form.fields.findIndex(field => field.name === "revisit_at_utc_ms");
                form.error = "Revisit time must be a non-negative millisecond timestamp.";
                return;
            }
            if (values.lifecycle === "deferred" && revisit === null) {
                form.index = form.fields.findIndex(field => field.name === "revisit_at_utc_ms");
                form.error = "Deferred intake items require a revisit timestamp.";
                return;
            }
            const lifecycle = values.lifecycle as Exclude<IntakeLifecycleDto, "captured">;
            confirm(form.action, { intake_id: values.intake_id, expected_content_revision: contentRevision,
                lifecycle, revisit_at_utc_ms: revisit }, `Set intake ${values.intake_id} to ${lifecycle}.`, [
                `Content revision: ${contentRevision}`,
                ...(revisit === null ? [] : [`Revisit at UTC milliseconds: ${revisit}`]),
                "The service rechecks the project and content revisions before saving.",
            ]);
        }
        else if (form.action === "intake_promote") {
            const contentRevision = Number(values.content_revision);
            if (!Number.isSafeInteger(contentRevision) || contentRevision < 1) {
                form.index = form.fields.findIndex(field => field.name === "content_revision");
                form.error = "Content revision must be a positive integer from the Intake list.";
                return;
            }
            const targetKind = values.target_kind as IntakePromotionTargetKindDto;
            confirm(form.action, { intake_id: values.intake_id, expected_content_revision: contentRevision,
                target_kind: targetKind, target_id: values.target_id }, `Link intake ${values.intake_id} to ${targetKind} ${values.target_id}.`, [
                `Content revision: ${contentRevision}`,
                "Promotion links an existing same-project target and preserves intake provenance.",
            ]);
        }
        else if (form.action === "edit_work") {
            const selected = form.workSnapshot ?? controller.view().monitoring?.items.find(item => item.work_id === form.workId);
            if (!form.workId || !selected) { form.error = "Selected work is no longer in the current service page."; return; }
            const input: Record<string, unknown> = { work_id: form.workId };
            if (values.title !== (selected.title ?? "")) input.title = values.title;
            if (values.description !== (selected.description ?? "")) input.description = values.description;
            if (values.priority) {
                const priority = Number(values.priority);
                if (!Number.isInteger(priority) || priority < 0 || priority > 255) { form.index = form.fields.findIndex(field => field.name === "priority"); form.error = "Priority must be an integer from 0 to 255."; return; }
                if (priority !== selected.priority) input.priority = priority;
            }
            if (values.dispatch_policy && values.dispatch_policy !== selected.dispatch_policy) input.dispatch_policy = values.dispatch_policy;
            if (values.execution_mode && values.execution_mode !== "unknown") {
                if (selected.kind === "milestone" && values.execution_mode !== "container") {
                    form.index = form.fields.findIndex(field => field.name === "execution_mode");
                    form.error = "Milestones must use container execution mode.";
                    return;
                }
                if (values.execution_mode !== selected.execution_mode) input.execution_mode = values.execution_mode as ExecutionMode;
            }
            if (values.parent_action === "set") {
                if (!values.parent_id) {
                    form.index = form.fields.findIndex(field => field.name === "parent_id");
                    form.error = "Enter the new parent identifier, or choose keep or clear.";
                    return;
                }
                if (values.parent_id !== selected.parent_id) input.parent_id = values.parent_id;
            } else if (values.parent_action === "clear" && selected.parent_id) input.clear_parent = true;
            if (Object.keys(input).length === 1) { form.error = "No work fields changed."; return; }
            confirm("edit_work", input, `Update ${selected.title ?? form.workId}.`, Object.entries(input).slice(1).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`), form.workId);
        }
        else if (form.action === "dependency_add" || form.action === "dependency_remove") {
            const payload = { prerequisite_id: values.prerequisite_id, dependent_id: values.dependent_id };
            confirm(form.action, payload, `${form.action === "dependency_add" ? "Add" : "Remove"} dependency.`, [
                `${payload.prerequisite_id} must close before ${payload.dependent_id}.`,
                "The server checks project scope, cycle constraints, and the current revision.",
            ], form.workId);
        }
        else if (form.action === "cycle_assign") {
            if (!controller.readWork) {
                form.error = "Task assignment requires the typed work hierarchy read route.";
                return;
            }
            const snapshotRevision = controller.view().monitoring?.revision;
            if (snapshotRevision === undefined) {
                form.error = "A current project revision is required before assigning a Task to a cycle.";
                return;
            }
            state.modal = null;
            enqueue("Verifying Task hierarchy", async () => {
                const detailEnvelope = await controller.readWork!(values.work_id);
                const detail = detailEnvelope.data;
                const currentRevision = controller.view().monitoring?.revision;
                if (!detail || detailEnvelope.revision !== snapshotRevision || currentRevision !== snapshotRevision
                    || detail.kind !== "task" || !["direct", "container"].includes(detail.execution_mode ?? "")
                    || detail.planning_integrity !== "valid") {
                    state.modal = form;
                    const diagnostic = detail?.planning_diagnostic?.trim();
                    form.error = `This Task is missing or has an invalid planning hierarchy. ${diagnostic ? safeText(diagnostic) : "Select a validated Task with P, refresh, and try again."}`;
                    return;
                }
                const reason = values.reason;
                const input: CycleCommandInput = { expected_revision: snapshotRevision ?? 0, reason, confirmed: true,
                    change: { kind: "assign", cycle_id: values.cycle_id, assignment_id: values.assignment_id, work_id: values.work_id } };
                confirm(form.action, input, `Assign valid Task ${detail.work_id} to cycle ${values.cycle_id}.`, [
                    `Assignment: ${values.assignment_id}`, `Planning parent: ${detail.planning_parent_id ?? "root"}`,
                    `Reason: ${reason}`, `Project revision: ${input.expected_revision}`,
                ], values.work_id);
            });
        }
        else if (form.action.startsWith("cycle_")) {
            const reason = values.reason ?? "";
            let change: CycleChange;
            if (form.action === "cycle_create") {
                const start = parseLocalDateTime(values.start), end = values.end ? parseLocalDateTime(values.end) : null;
                if (!start) { form.index = 4; form.error = "Start must use a valid YYYY-MM-DDTHH:mm[:ss] local date and time."; return; }
                if (values.end && !end) { form.index = 5; form.error = "End must use a valid YYYY-MM-DDTHH:mm[:ss] local date and time."; return; }
                change = { kind: "create", cycle_id: values.cycle_id, name: values.name, goal: values.goal, timezone: values.timezone, start, end };
            } else if (form.action === "cycle_activate") change = { kind: "activate", cycle_id: values.cycle_id };
            else if (form.action === "cycle_close") change = { kind: "close", cycle_id: values.cycle_id };
            else if (form.action === "cycle_cancel") change = { kind: "cancel", cycle_id: values.cycle_id };
            else if (form.action === "cycle_commit") change = { kind: "commit", cycle_id: values.cycle_id, assignment_id: values.assignment_id };
            else if (form.action === "cycle_remove") change = { kind: "remove", cycle_id: values.cycle_id, assignment_id: values.assignment_id };
            else if (form.action === "cycle_carry_over") change = { kind: "carry_over", cycle_id: values.cycle_id, assignment_id: values.assignment_id, successor_cycle_id: values.successor_cycle_id, successor_assignment_id: values.successor_assignment_id };
            else { form.error = "This cycle operation is not supported by the current service contract."; return; }
            const input: CycleCommandInput = { expected_revision: controller.view().monitoring?.revision ?? 0, reason, confirmed: true, change };
            confirm(form.action, input, `${ACTION_NAMES[form.action]}: ${values.cycle_id ?? "cycle"}.`, [
                `Reason: ${reason}`,
                `Project revision: ${input.expected_revision}`,
                "The Rust planning service owns calendar, assignment, and carry-over rules.",
            ], undefined);
        }
        else if (form.action === "memory_draft") {
            const input: MemoryCommandInput = { expected_revision: null, confirmed: true, change: {
                kind: "draft", draft_id: values.draft_id, entry_id: values.entry_id, title: values.title, body: values.body,
                citations: [{ source_version_id: values.source_version_id, location: values.location }],
            } };
            confirm(form.action, input, `Create cited memory draft ${values.draft_id}.`, [`Entry: ${values.entry_id}`, `Citation: ${values.source_version_id} · ${values.location}`], undefined);
        }
        else if (form.action === "memory_review") {
            const input: MemoryCommandInput = { expected_revision: null, confirmed: true, change: { kind: "review", draft_id: values.draft_id, decision: values.decision, reason: values.reason } };
            confirm(form.action, input, `${values.decision} memory draft ${values.draft_id}.`, [`Reason: ${values.reason}`], undefined);
        }
        else if (form.action === "memory_publish") {
            const input: MemoryCommandInput = { expected_revision: null, confirmed: true, change: { kind: "publish", review_id: values.review_id, expected_manifest_identity: values.expected_manifest_identity } };
            confirm(form.action, input, `Publish reviewed memory ${values.review_id}.`, [`Expected manifest: ${values.expected_manifest_identity}`, "Git publication is performed and reconciled by the service."], undefined);
        }
        else if (form.action === "memory_reconcile") {
            const input: MemoryCommandInput = { expected_revision: null, confirmed: true, change: { kind: "reconcile", operation_id: values.operation_id } };
            confirm(form.action, input, `Reconcile memory publication operation ${values.operation_id}.`, ["The service reads the exact durable operation outcome before updating publication state."], undefined);
        }
        else if (form.action === "recovery_resolve") {
            const input: RecoveryCommandInput = { action: "resolve", obligation_id: values.obligation_id, resolution_id: values.resolution_id, outcome: values.outcome, reason: values.reason, resource_state: values.resource_state, expected_revision: controller.view().monitoring?.revision ?? 0, confirmed: true };
            confirm(form.action, input, `Resolve recovery obligation ${values.obligation_id}.`, [`Outcome: ${values.outcome}`, `Resource state: ${values.resource_state}`, `Reason: ${values.reason}`], undefined);
        }
        else if (form.action === "source_capture") {
            confirm(form.action, { input: values.input, origin: values.origin, ...(values.media_type ? { media_type: values.media_type } : {}) }, `Capture source from ${values.input}.`, [`Origin: ${values.origin}`, "The Rust service confines source capture to the selected project workspace and checks source permissions."], undefined);
        }
    };
    const executeWorkspaceConfirm = async (pending: Confirm): Promise<void> => {
        let result: ActionResult<unknown>;
        switch (pending.action) {
            case "edit_work":
                if (!controller.editWork) throw new Error("Work editing is unavailable in this connection.");
                result = await controller.editWork(pending.payload as Omit<WorkEditInput, "project_id" | "expected_revision">);
                break;
            case "dependency_add":
            case "dependency_remove":
                if (!controller.changeDependency) throw new Error("Dependency changes are unavailable in this connection.");
                result = await controller.changeDependency(pending.action, pending.payload as Omit<DependencyChangeInput, "project_id" | "expected_revision">);
                break;
            case "cycle_create":
            case "cycle_activate":
            case "cycle_close":
            case "cycle_cancel":
            case "cycle_assign":
            case "cycle_commit":
            case "cycle_remove":
            case "cycle_carry_over":
                if (!controller.changeCycle) throw new Error("Cycle changes are unavailable in this connection.");
                result = await controller.changeCycle(pending.payload as CycleCommandInput);
                break;
            case "memory_draft":
            case "memory_review":
            case "memory_publish":
            case "memory_reconcile":
                if (!controller.runMemoryCommand) throw new Error("Memory changes are unavailable in this connection.");
                result = await controller.runMemoryCommand(pending.payload as MemoryCommandInput);
                break;
            case "recovery_resolve":
                if (!controller.runRecoveryCommand) throw new Error("Recovery resolution is unavailable in this connection.");
                result = await controller.runRecoveryCommand(pending.payload as RecoveryCommandInput);
                break;
            case "session_end":
                if (!controller.endSession) throw new Error("Session end is unavailable in this connection.");
                result = await controller.endSession();
                break;
            case "source_capture":
                if (!controller.addSource) throw new Error("Source capture is unavailable in this connection.");
                result = await controller.addSource(pending.payload as { input: string; origin: string; media_type?: string });
                break;
            case "bind_result":
                if (!controller.bindFinalResult) throw new Error("Final result binding is unavailable in this connection.");
                result = await controller.bindFinalResult(pending.workId!, pending.payload as { source_version_id: string; content_digest: string });
                break;
            case "schedule_edit": {
                if (!controller.updateWorkSchedule) throw new Error("Work schedule updates are unavailable in this connection.");
                const payload = pending.payload as { schedule_revision: number; schedule: BusinessScheduleDto };
                result = await controller.updateWorkSchedule(pending.workId!, payload.schedule_revision, payload.schedule);
                break;
            }
            case "wait_create":
                if (!controller.createExternalWait) throw new Error("External wait creation is unavailable in this connection.");
                result = await controller.createExternalWait(pending.payload as Parameters<NonNullable<ExtendedController["createExternalWait"]>>[0]);
                break;
            case "wait_resolve":
                if (!controller.resolveExternalWait) throw new Error("External wait resolution is unavailable in this connection.");
                result = await controller.resolveExternalWait(pending.payload as Parameters<NonNullable<ExtendedController["resolveExternalWait"]>>[0]);
                break;
            case "intake_disposition":
                if (!controller.updateIntakeDisposition) throw new Error("Intake disposition is unavailable in this connection.");
                result = await controller.updateIntakeDisposition(pending.payload as Parameters<NonNullable<ExtendedController["updateIntakeDisposition"]>>[0]);
                break;
            case "intake_promote":
                if (!controller.promoteIntake) throw new Error("Intake promotion is unavailable in this connection.");
                result = await controller.promoteIntake(pending.payload as Parameters<NonNullable<ExtendedController["promoteIntake"]>>[0]);
                break;
            default: throw new Error("This workspace action is read-only or unavailable.");
        }
        if (result.ok && pending.action === "bind_result") {
            const binding = result.data as FinalResultBinding;
            message(`Result bound as ${binding.binding_id} · proof revision ${binding.proof_revision}${binding.lineage_pending ? ` · source lineage pending: ${binding.lineage_pending}` : ""}`);
        } else if (result.ok && pending.action === "schedule_edit") {
            const readback = result.data as import("./client.js").WorkScheduleMutationReadbackDto;
            message(`Work dates saved · schedule revision ${readback.schedule_revision} · project revision ${readback.project_revision} · operation ${result.envelope.operation_id}${readback.replayed ? " · read back from the original operation" : ""}`);
        } else if (result.ok && (pending.action === "wait_create" || pending.action === "wait_resolve")) {
            const readback = result.data as import("./client.js").ExternalWaitMutationReadbackDto;
            message(`External wait ${readback.wait.wait_id} is ${readback.wait.state} · wait revision ${readback.wait.wait_revision} · project revision ${readback.project_revision} · operation ${result.envelope.operation_id}${readback.replayed ? " · read back from the original operation" : ""}`);
        } else if (result.ok && pending.action === "intake_disposition") {
            const readback = result.data as IntakeDispositionReadbackDto;
            message(`Intake ${readback.intake_id} is ${readback.lifecycle} · project revision ${result.envelope.revision ?? "unknown"}${readback.replayed ? " · replayed" : ""}`);
        } else if (result.ok && pending.action === "intake_promote") {
            const readback = result.data as IntakePromoteReadbackDto;
            message(`Intake ${readback.intake_id} linked to ${readback.target_kind} ${readback.target_id} · project revision ${result.envelope.revision ?? "unknown"}${readback.replayed ? " · replayed" : ""}`);
        } else {
            message(result.ok
                ? `${ACTION_NAMES[pending.action]}: ${result.envelope.outcome} · revision ${result.envelope.revision ?? "unknown"}`
                : `${ACTION_NAMES[pending.action]}: ${result.error.message}${result.error.stale ? " Refresh and reopen the form to review current values before retrying." : ""}`, !result.ok);
        }
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
        if (isWorkspaceUiAction(pending.action)) {
            await executeWorkspaceConfirm(pending);
            return;
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
                return;
            case "claim":
                result = await controller.claim(pending.workId!, pending.payload as { source_version_id: string; config_identity: string });
                return;
            case "accept_start":
                result = await controller.acceptStart(pending.workId!);
                return;
            case "evidence":
                result = await controller.addEvidence(pending.workId!, pending.payload);
                return;
            case "finish":
                result = await controller.finish(pending.workId!, pending.payload as string);
                return;
            case "release":
                result = await controller.release(pending.workId!, pending.payload as string);
                return;
            default: throw new Error("Unsupported interactive action");
        }
        message(resultMessage(pending.action as TuiAction, result), !result.ok);
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
        if (id.startsWith("workspace-action:")) {
            stageWorkspace(id.slice("workspace-action:".length) as WorkspaceUiAction);
            return;
        }
        if (id.startsWith("workspace:")) {
            const viewKind = id.slice("workspace:".length);
            const current = controller.view();
            if (viewKind === "schedule") {
                const workId = current.selected_work?.work_id;
                if (!workId || !controller.readWorkSchedule) {
                    message("Select work with typed schedule readback available.", true);
                    return;
                }
                enqueue("Reading work dates", async () => {
                    const [scheduleResult, civilResult] = await Promise.all([
                        controller.readWorkSchedule!(workId), controller.readProjectCivilTime?.(),
                    ]);
                    const currentRevision = controller.view().monitoring?.revision;
                    const data = scheduleResult.data;
                    if (!data || data.work_id !== workId || scheduleResult.revision !== currentRevision
                        || data.project_revision !== currentRevision
                        || (civilResult && (civilResult.revision !== currentRevision || civilResult.data?.project_revision !== currentRevision))) {
                        state.modal = { kind: "message", title: "WORK DATES STALE", text: "The schedule readback does not match the current status snapshot. Refresh and inspect it again; no values were combined across revisions.", offset: 0 };
                        message("Work dates changed during readback; refresh and retry.", true);
                        return;
                    }
                    const schedule = data.schedule;
                    const legacyDue = data.legacy_due_at ? Date.parse(data.legacy_due_at) : NaN;
                    const lines = [
                        `Work ${workId}`,
                        `Project revision ${data.project_revision} · schedule revision ${data.schedule_revision}`,
                        `Civil timezone ${civilResult?.data?.setting?.timezone ?? "not supplied by service"}`,
                        `Not before  ${businessDateLabel(schedule?.not_before)}`,
                        `Due         ${businessDateLabel(schedule?.due, Number.isFinite(legacyDue) ? `${data.legacy_due_at} (legacy instant)` : "Not scheduled")}`,
                        `Planned start  ${businessDateLabel(schedule?.planned_start)}`,
                        `Planned end    ${businessDateLabel(schedule?.planned_end)}`,
                        "",
                        "Dates are optional. Local date-only values use the project civil timezone; the service owns due and overdue classification.",
                    ];
                    state.modal = { kind: "message", title: "WORK DATES", text: lines.join("\n"), offset: 0 };
                    message(`Loaded typed dates at schedule revision ${data.schedule_revision}.`);
                });
                return;
            }
            if (viewKind === "receipts") {
                const work_id = current.selected_work?.work_id;
                if (work_id) openReceiptPicker(work_id);
                else message("Select work with a current attempt before reading its receipts.", true);
                return;
            }
            if (viewKind === "cycle-board") {
                stageWorkspace("cycle_board");
                return;
            }
            if (viewKind === "project") {
                const projectId = current.route.project_id ?? "unknown project";
                const monitoring = current.monitoring;
                state.modal = { kind: "message", title: "PROJECT OVERVIEW", text: [
                    `Project ${projectId}`,
                    `Service revision ${monitoring?.revision ?? "unavailable"}`,
                    `Work items ${monitoring?.total ?? "unavailable"} total · ${monitoring?.items.length ?? 0} loaded`,
                    `Page offset ${monitoring?.offset ?? "unavailable"}${monitoring?.has_more ? " · more rows available" : ""}`,
                    `Project name ${monitoring?.project_name ?? "not supplied"}`,
                    current.notice ? `Connection ${current.notice.kind}: ${current.notice.message}` : "Connection state is current.",
                ].join("\n"), offset: 0 };
                return;
            }
            if (viewKind === "pending") {
                const pending = current.pending_operations;
                state.modal = { kind: "message", title: "PENDING OPERATIONS", text: pending.length
                    ? pending.map(operation => `${operation.action}${operation.work_id ? ` · ${operation.work_id}` : ""}\n  Read operation ${operation.operation_id} before retrying.`).join("\n\n")
                    : "No operations are awaiting readback.", offset: 0 };
                return;
            }
            if (viewKind === "unavailable") {
                const capabilities = (current.capabilities ?? []).map(capability => ({ route: capability.route, label: capability.label, status: capability.status, reason: capability.reason }));
                const rows = capabilities.map(capability => `${capability.label} · ${capability.status}\n  ${capability.reason}`);
                state.modal = { kind: "message", title: "UNAVAILABLE ROUTES", text: [
                    ...(current.notice ? [`Connection notice: ${current.notice.message}`, ""] : []),
                    ...rows,
                ].join("\n\n") || "No unavailable routes are registered.", offset: 0 };
                return;
            }
            if (["cycles", "reviews", "memory", "recovery", "dependencies", "sources", "session", "waits", "intake"].includes(viewKind)) {
                if (!controller.readWorkspaceView) {
                    state.modal = { kind: "message", title: `${viewKind.toUpperCase()} UNAVAILABLE`, text: "This service connection does not provide this project view.", offset: 0 };
                    return;
                }
                const kind = viewKind as WorkspaceViewKind;
                enqueue(`Loading ${kind}`, async () => {
                    try {
                        const result = await controller.readWorkspaceView!(kind);
                        state.modal = { kind: "message", title: kind.toUpperCase(), text: formatWorkspaceView(
                            kind,
                            controller.view().route.project_id ?? "unknown project",
                            result.revision,
                            result.as_of,
                            result.data,
                            controller.view().monitoring?.items ?? [],
                            controller.view().monitoring?.revision,
                        ), offset: 0 };
                        message(`${kind} view loaded from the project service.`);
                    }
                    catch (error) {
                        state.modal = { kind: "message", title: `${kind.toUpperCase()} UNAVAILABLE`, text: error instanceof Error ? error.message : String(error), offset: 0 };
                        message(`${kind} view is unavailable.`, true);
                    }
                });
                return;
            }
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
        if (key === "escape" && (m.kind === "source_picker" || m.kind === "work_picker")) {
            state.modal = m.form;
            message("Returned to the form; no action was submitted.");
            return;
        }
        if (key === "escape" && m.kind === "receipt_picker" && m.show_details) {
            m.show_details = false;
            m.detail_offset = 0;
            message("Returned to the receipt list; no evidence was selected.");
            return;
        }
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
        if (m.kind === "source_picker") {
            if (["up", "k"].includes(key)) m.index = Math.max(0, m.index - 1);
            else if (["down", "j"].includes(key)) m.index = Math.min(Math.max(0, m.items.length - 1), m.index + 1);
            else if (key === "home") m.index = 0;
            else if (key === "end") m.index = Math.max(0, m.items.length - 1);
            else if (key === "[" || key === "page-up") changeSourcePage(-1);
            else if (key === "]" || key === "page-down") changeSourcePage(1);
            else if (key === "enter" && m.items[m.index]) {
                const field = m.form.fields.find(value => value.name === m.field_name);
                if (!field) { state.modal = m.form; m.form.error = "The source field is no longer available."; return; }
                field.value = m.items[m.index].source_version_id;
                field.cursor = field.value.length;
                if (m.form.action === "bind_result") {
                    const digest = m.form.fields.find(value => value.name === "content_digest");
                    if (digest) { digest.value = m.items[m.index].content_digest; digest.cursor = digest.value.length; }
                }
                m.form.index = m.form.fields.indexOf(field);
                m.form.error = undefined;
                state.modal = m.form;
                message(`Selected source ${field.value}.`);
            }
            return;
        }
        if (m.kind === "receipt_picker") {
            if (m.show_details) {
                if (key === "i") { m.show_details = false; m.detail_offset = 0; }
                else if (["up", "k"].includes(key)) m.detail_offset = Math.max(0, (m.detail_offset ?? 0) - 1);
                else if (["down", "j"].includes(key)) m.detail_offset = (m.detail_offset ?? 0) + 1;
                else if (key === "home") m.detail_offset = 0;
                else if (key === "end") m.detail_offset = Number.MAX_SAFE_INTEGER;
                else if (key === "page-up") m.detail_offset = Math.max(0, (m.detail_offset ?? 0) - 10);
                else if (key === "page-down") m.detail_offset = (m.detail_offset ?? 0) + 10;
                return;
            }
            if (["up", "k"].includes(key)) m.index = Math.max(0, m.index - 1);
            else if (["down", "j"].includes(key)) m.index = Math.min(Math.max(0, m.items.length - 1), m.index + 1);
            else if (key === "home") m.index = 0;
            else if (key === "end") m.index = Math.max(0, m.items.length - 1);
            else if (key === "[" || key === "page-up") changeReceiptPage(-1);
            else if (key === "]" || key === "page-down") changeReceiptPage(1);
            else if (key === "i" && m.items[m.index]) { m.show_details = true; m.detail_offset = 0; }
            else if (key === "enter" && m.items[m.index]) {
                const record = m.items[m.index];
                if (record.receipt_payload === undefined || record.receipt_payload === null) {
                    message(record.receipt_payload_diagnostic ?? `Receipt ${record.receipt_id} has no reconstructed payload. It remains visible and cannot be selected for finish.`, true);
                    return;
                }
                if (!controller.selectReceiptForAttempt) {
                    message("Receipt selection is unavailable in this service connection.", true);
                    return;
                }
                try {
                    controller.selectReceiptForAttempt(m.work_id, record.receipt_id);
                    state.modal = null;
                    message(`Selected receipt ${record.receipt_id} for attempt ${m.attempt_id} · fence ${m.fence}. Finish will use this exact payload.`);
                } catch (error) {
                    message(error instanceof Error ? error.message : String(error), true);
                }
            }
            return;
        }
        if (m.kind === "work_picker") {
            if (["up", "k"].includes(key)) m.index = Math.max(0, m.index - 1);
            else if (["down", "j"].includes(key)) m.index = Math.min(Math.max(0, m.items.length - 1), m.index + 1);
            else if (key === "home") m.index = 0;
            else if (key === "end") m.index = Math.max(0, m.items.length - 1);
            else if (key === "[" || key === "page-up") changeWorkPage(-1);
            else if (key === "]" || key === "page-down") changeWorkPage(1);
            else if (key === "enter" && m.items[m.index]) {
                const field = m.form.fields.find(value => value.name === m.field_name);
                if (!field) { state.modal = m.form; m.form.error = "The Task field is no longer available."; return; }
                field.value = m.items[m.index].work_id;
                field.cursor = field.value.length;
                m.form.index = m.form.fields.indexOf(field);
                m.form.error = undefined;
                state.modal = m.form;
                message(`Selected valid Task ${field.value}.`);
            }
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
            if ((key === "p" || key === "P") && field.name === "source_version_id") {
                openSourcePicker(m, "source_version_id");
                return;
            }
            if ((key === "p" || key === "P") && m.action === "cycle_assign" && field.name === "work_id") {
                openWorkPicker(m);
                return;
            }
            if (field.choices && ["left", "right", "up", "down", " "].includes(key)) {
                const delta = key === "left" || key === "up" ? -1 : 1;
                field.value = field.choices[(field.choices.indexOf(field.value) + delta + field.choices.length) % field.choices.length];
                if (m.action === "create_work" && field.name === "kind") {
                    const mode = m.fields.find(value => value.name === "execution_mode");
                    if (mode) {
                        if (field.value === "milestone") mode.value = "container";
                        else if (field.value === "sprint") mode.value = "not applicable";
                        else if (mode.value === "not applicable" || mode.value === "container") mode.value = "direct";
                    }
                }
                return;
            }
            if (field.choices)
                return;
            if (field.readOnly)
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
