import type { AttemptReceiptRecord, BusinessScheduleDto, DashboardFilter, MountedView, StatusItem, TuiAction } from "../client.js";
import type { Density } from "./layout.js";
import type { Theme } from "./screen.js";
export const FILTERS: readonly {
    id: DashboardFilter;
    label: string;
    key: string;
}[] = [
    { id: "all", label: "All work", key: "1" }, { id: "ready", label: "Ready", key: "2" },
    { id: "active", label: "In progress", key: "3" }, { id: "blocked", label: "Blocked", key: "4" },
    { id: "expired", label: "Expired work", key: "5" }, { id: "closed", label: "Closed", key: "6" },
    { id: "milestones", label: "Milestones", key: "7" }, { id: "sprints", label: "Sprints", key: "8" },
    { id: "tasks", label: "Tasks", key: "9" },
    { id: "review", label: "Awaiting review", key: "" },
    { id: "rejected", label: "Rejected review", key: "" },
    { id: "failed", label: "Failed execution", key: "" },
    { id: "held", label: "Operator holds", key: "" },
    { id: "corrupt", label: "Damaged records", key: "" },
];
export type WorkspaceUiAction =
    | "edit_work" | "dependency_add" | "dependency_remove"
    | "cycle_create" | "cycle_board" | "cycle_activate" | "cycle_close" | "cycle_cancel"
    | "cycle_assign" | "cycle_commit" | "cycle_remove" | "cycle_carry_over"
    | "memory_search" | "memory_show" | "memory_draft" | "memory_review" | "memory_publish" | "memory_reconcile"
    | "recovery_resolve" | "session_end" | "source_capture" | "source_search" | "review_show" | "bind_result"
    | "schedule_edit" | "wait_create" | "wait_resolve" | "wait_page"
    | "intake_page" | "intake_disposition" | "intake_promote";
export type UiAction = TuiAction | WorkspaceUiAction;
export const ACTION_NAMES: Record<UiAction, string> = {
    create_project: "Initialize project", create_work: "Create work", claim: "Claim work", accept_start: "Start work", evidence: "Attach evidence", finish: "Finish & close", release: "Release claim",
    edit_work: "Edit selected work", dependency_add: "Add dependency", dependency_remove: "Remove dependency",
    cycle_create: "Create cycle", cycle_board: "Open cycle board", cycle_activate: "Activate cycle", cycle_close: "Close cycle", cycle_cancel: "Cancel cycle",
    cycle_assign: "Assign work to cycle", cycle_commit: "Commit cycle assignment", cycle_remove: "Remove cycle assignment", cycle_carry_over: "Carry assignment over",
    memory_search: "Search published memory", memory_show: "Show memory draft", memory_draft: "Draft memory", memory_review: "Review memory draft", memory_publish: "Publish memory",
    memory_reconcile: "Reconcile memory publication",
    recovery_resolve: "Resolve recovery obligation", session_end: "End current session", source_capture: "Capture source", source_search: "Search sources", review_show: "Show review",
    bind_result: "Bind captured result",
    schedule_edit: "Edit work dates",
    wait_create: "Record external wait",
    wait_resolve: "Resolve external wait",
    wait_page: "Open external wait page",
    intake_page: "Open intake page", intake_disposition: "Set intake disposition", intake_promote: "Promote intake item",
};
export type Focus = "navigation" | "queue" | "inspector";
export type Sort = "service" | "priority" | "title";
export interface FormField {
    name: string;
    label: string;
    value: string;
    cursor?: number;
    hint: string;
    choices?: readonly string[];
    required?: boolean;
    readOnly?: boolean;
}
export type FormModal = {
    kind: "form";
    action: Exclude<UiAction, "create_project">;
    workId?: string;
    fields: FormField[];
    index: number;
    error?: string;
    workSnapshot?: StatusItem;
    scheduleRevision?: number;
    scheduleSnapshot?: BusinessScheduleDto;
    civilTimezone?: string;
};
export type Modal = {
    kind: "search";
    value: string;
    cursor?: number;
} | {
    kind: "palette";
    value: string;
    cursor?: number;
    scope?: "views";
    index: number;
} | {
    kind: "work_picker";
    form: FormModal;
    field_name: "work_id";
    items: PlanningTaskPickerItem[];
    index: number;
    total: number;
    hidden: number;
    offset: number;
    limit: number;
    has_more: boolean;
    revision: number | null;
    as_of: string;
} | {
    kind: "source_picker";
    form: FormModal;
    field_name: "source_version_id";
    items: SourcePickerItem[];
    index: number;
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
    revision: number | null;
    as_of: string;
} | {
    kind: "receipt_picker";
    work_id: string;
    attempt_id: string;
    fence: number;
    items: AttemptReceiptRecord[];
    index: number;
    offset: number;
    limit: number;
    has_more: boolean;
    revision: number | null;
    as_of: string;
    show_details?: boolean;
    detail_offset?: number;
} | {
    kind: "help";
    offset: number;
} | {
    kind: "message";
    title: string;
    text: string;
    offset: number;
} | FormModal | {
    kind: "confirm";
    action: UiAction;
    workId?: string;
    payload: unknown;
    revision: number | null;
    attempt: string | null;
    summary: string;
    details: string[];
    offset?: number;
    reviewError?: string;
};
export interface PlanningTaskPickerItem {
    work_id: string;
    title: string;
    execution_mode: "direct" | "container";
    planning_parent_id: string | null;
}
export interface SourcePickerItem {
    project_id: string;
    source_version_id: string;
    origin: string;
    media_type: string;
    byte_count: number;
    content_digest: string;
    availability: string;
    parser_identity?: string | null;
}
export interface DashboardState {
    filter: DashboardFilter;
    query: string;
    selectedId?: string;
    focus: Focus;
    navIndex: number;
    inspectorTab: number;
    inspectorOffset: number;
    detailOnly: boolean;
    sort: Sort;
    frozen: boolean;
    status: string;
    error: boolean;
    busy: string | null;
    density: Density;
    zen: boolean;
    theme: Theme;
    ascii: boolean;
    modal: Modal | null;
}
export function initialState(view: MountedView, theme: Theme = "dark", ascii = false): DashboardState {
    return { filter: "all", query: "", selectedId: view.route.work_id ?? view.monitoring?.items[0]?.work_id,
        focus: "queue", navIndex: 0, inspectorTab: 0, inspectorOffset: 0, detailOnly: false, sort: "service", frozen: false,
        status: "Ready. Select work to inspect its next available action.", error: false, busy: null, density: "auto", zen: false, theme, ascii, modal: null };
}
export function itemStatus(item: StatusItem): string { return item.diagnostic ? "corrupt" : item.display_status ?? item.status; }
export function matches(item: StatusItem, filter: DashboardFilter): boolean {
    const s = itemStatus(item);
    if (filter === "all")
        return true;
    if (filter === "review") return s === "awaiting_review";
    if (filter === "failed") return item.reason_codes.some(reason => reason.includes("failed") || reason.includes("rejected") || reason.includes("returned"));
    if (filter === "held") return item.reason_codes.some(reason => reason.includes("hold"));
    if (filter === "corrupt") return !!item.diagnostic || s === "corrupt";
    if (filter === "active")
        return ["claimed", "in_progress", "needs_verification", "awaiting_review", "complete"].includes(s);
    if (filter === "expired")
        return s === "expired_review";
    if (["milestones", "sprints", "tasks"].includes(filter))
        return item.kind === filter.slice(0, -1);
    return s === filter;
}
export function selectedAttentionQueue(view: MountedView, filter: DashboardFilter) {
    const queues = view.monitoring?.attention_queues;
    return filter === "review" ? queues?.review
        : filter === "rejected" ? queues?.rejected_review
        : filter === "expired" ? queues?.expiry
        : filter === "failed" ? queues?.failed_execution
        : filter === "held" ? queues?.operator_holds
        : filter === "corrupt" ? queues?.damaged_planning
        : undefined;
}
export function visibleItems(view: MountedView, state: Pick<DashboardState, "filter" | "query" | "sort">): StatusItem[] {
    const q = state.query.trim().toLocaleLowerCase();
    const queueItems = selectedAttentionQueue(view, state.filter)?.items;
    const source = queueItems ?? view.monitoring?.items ?? [];
    const rows = source.filter(i => (queueItems || matches(i, state.filter)) && (!q || [i.work_id, i.title, i.description, i.parent_id, i.kind, i.attempt?.actor_id].some(v => v?.toLocaleLowerCase().includes(q))));
    if (state.sort === "priority")
        rows.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.work_id.localeCompare(b.work_id));
    if (state.sort === "title")
        rows.sort((a, b) => (a.title ?? a.work_id).localeCompare(b.title ?? b.work_id));
    return rows;
}
export function reconcileSelection(view: MountedView, state: DashboardState): StatusItem | undefined {
    const items = visibleItems(view, state);
    if (!items.some(i => i.work_id === state.selectedId))
        state.selectedId = items[0]?.work_id;
    return items.find(i => i.work_id === state.selectedId);
}
export interface PaletteCommand {
    id: string;
    label: string;
    hint: string;
    disabled?: boolean;
}
export function paletteCommands(view: MountedView, state: DashboardState): PaletteCommand[] {
    const selectedFacts = view.selected_work?.action_context;
    const bindResultReady = !!view.workspace_actions_available?.includes("bind_result")
        && !!view.selected_work?.attempt && selectedFacts?.state === "available" && selectedFacts.integrity === "valid"
        && Number.isSafeInteger(selectedFacts.entity_revision) && (selectedFacts.entity_revision ?? 0) > 0
        && Number.isSafeInteger(selectedFacts.proof_revision) && (selectedFacts.proof_revision ?? 0) > 0;
    const commands: PaletteCommand[] = [
        ...FILTERS.map(f => ({ id: `filter:${f.id}`, label: f.label, hint: `View · ${f.key}` })),
        { id: "views", label: "Switch work view", hint: "v / 1–9" },
        { id: "density", label: `Display density: ${state.density}`, hint: "d · auto / compact / comfortable" },
        { id: "zen", label: state.zen ? "Restore responsive panes" : "Focus on one pane", hint: "z" },
        { id: "status", label: "Read full status / error", hint: "!" },
        { id: "redraw", label: "Redraw terminal", hint: "Ctrl-L" },
        { id: "search", label: "Search loaded work", hint: "/" }, { id: "refresh", label: "Refresh snapshot", hint: "r" },
        { id: "page", label: "Load next service page", hint: "]", disabled: !view.monitoring?.has_more },
        { id: "freeze", label: state.frozen ? "Resume live refresh" : "Pause live refresh", hint: "F" },
        { id: "readback", label: "Resolve pending operation", hint: "u · read only", disabled: !view.pending_operations.length },
        { id: "workspace:project", label: "Project overview", hint: "Workspace · read only" },
        { id: "workspace:cycles", label: "Cycles", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("cycles") },
        { id: "workspace:intake", label: "Intake inbox", hint: "Project intake · paged and read only", disabled: !view.workspace_views_available?.includes("intake") },
        { id: "workspace:cycle-board", label: "Open a cycle board", hint: "Read · choose a cycle ID", disabled: !view.workspace_actions_available?.includes("cycle_board") },
        { id: "workspace:dependencies", label: "Dependency graph", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("dependencies") },
        { id: "workspace:reviews", label: "Reviews", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("reviews") },
        { id: "workspace:sources", label: "Registered sources", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("sources") },
        { id: "workspace:session", label: "Active session", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("session") },
        { id: "workspace:waits", label: "External waits", hint: "Read project wait records", disabled: !view.workspace_views_available?.includes("waits") },
        { id: "workspace:schedule", label: "Work dates", hint: "Inspect typed dates for selected work", disabled: !view.workspace_actions_available?.includes("schedule_edit") || !state.selectedId },
        { id: "workspace:receipts", label: "Attempt receipt history / select finish evidence", hint: "Exact active attempt and fence · read only", disabled: !view.receipt_readback_available || !view.selected_work?.attempt },
        { id: "workspace:memory", label: "Published memory search", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("memory") },
        { id: "workspace:recovery", label: "Recovery obligations", hint: "Workspace · read only", disabled: !view.workspace_views_available?.includes("recovery") },
        { id: "workspace:pending", label: "Pending operations", hint: "Workspace · read only", disabled: !view.pending_operations.length },
        { id: "workspace:unavailable", label: "Unavailable routes", hint: "Workspace · read only" },
        ...([
            "edit_work", "dependency_add", "dependency_remove", "cycle_create", "cycle_activate", "cycle_close", "cycle_cancel", "cycle_assign", "cycle_commit", "cycle_remove", "cycle_carry_over",
            "memory_search", "memory_show", "memory_draft", "memory_review", "memory_publish", "memory_reconcile", "recovery_resolve", "session_end", "source_capture", "source_search", "review_show", "bind_result",
            "schedule_edit", "wait_create", "wait_resolve", "wait_page",
            "intake_page", "intake_disposition", "intake_promote",
        ] as const).map(action => ({
            id: `workspace-action:${action}`,
            label: ACTION_NAMES[action],
            hint: view.workspace_actions_available?.includes(action)
                ? action === "bind_result" && !bindResultReady
                    ? "Requires a current attempt and valid entity/proof revision context"
                    : `Project action · confirmation required`
                : "Unavailable in this service connection",
            disabled: !view.workspace_actions_available?.includes(action)
                || (["edit_work", "dependency_add", "dependency_remove", "bind_result", "schedule_edit", "wait_create"].includes(action) && !state.selectedId)
                || (action === "bind_result" && !bindResultReady),
        })),
        ...(["create_work", "claim", "accept_start", "evidence", "finish", "release"] as const).map(a => {
            const rule = view.actions.find(r => r.action === a);
            return { id: `action:${a}`, label: ACTION_NAMES[a], hint: rule?.enabled ? "Action · confirmation required" : rule?.reason ?? "Select work first", disabled: !rule?.enabled };
        }),
        { id: "theme", label: "Switch colour theme", hint: "T · dark / light / mono" },
        { id: "help", label: "Keyboard reference", hint: "?" }, { id: "quit", label: "Quit dashboard", hint: "q" },
    ];
    const query = state.modal?.kind === "palette" ? state.modal.value.trim().toLocaleLowerCase() : "";
    return commands.filter(c => (state.modal?.kind !== "palette" || state.modal.scope !== "views" || c.id.startsWith("filter:")) && (!query || `${c.label} ${c.hint}`.toLocaleLowerCase().includes(query)));
}
export function actionForm(action: Exclude<UiAction, "create_project">, workId?: string, selected?: StatusItem): FormModal {
    const field = (name: string, label: string, hint: string, required = true, value = ""): FormField => ({ name, label, hint, required, value });
    const fields: FormField[] = action === "create_work" ? [
        field("work_id", "Work identifier", "A unique, stable identifier. For example: task-104."),
        { ...field("kind", "Kind", "Left / Right cycles the work kind.", true, "task"), choices: ["task", "sprint", "milestone"] },
        { ...field("execution_mode", "Execution mode", "Milestones use container mode. Tasks default to direct; choose container only when this Task should own child Tasks.", true, "direct"), choices: ["direct", "container", "not applicable"] },
        field("title", "Title", "Describe the outcome, not just the activity."),
        field("parent_id", "Parent identifier", "Optional existing sprint or milestone identifier.", false),
        field("priority", "Priority", "0–255. Higher values are scheduled first.", false, "0"),
        field("description", "Description", "Optional context for the person or agent doing the work.", false),
    ] : action === "claim" ? [
        field("source_version_id", "Registered source version", "Press P to select from this project's registered source catalog."),
        field("config_identity", "Execution configuration identity", "Describe the real setup (for example repository revision + toolchain + relevant config version). Never include credentials or use ‘unknown’."),
    ] : action === "evidence" ? [field("receipt", "Receipt JSON", "Paste a real receipt object. No evidence is generated or fabricated here.")]
        : action === "finish" ? [field("summary", "Closeout summary", "Explain what changed and how it was verified.")]
            : action === "release" ? [field("reason", "Release reason", "Explain why this claim is being released.", true, "Released by operator")]
                : action === "edit_work" ? [
                    field("title", "Title", "A title is required. Replace the current title here.", true, selected?.title ?? ""),
                    field("description", "Description", "Replace the description here; clear it to remove the current description.", false, selected?.description ?? ""),
                    field("priority", "Priority", "0–255. Leave empty to keep the current priority.", false, selected?.priority === undefined ? "" : String(selected.priority)),
                    { ...field("dispatch_policy", "Dispatch policy", "Leave empty to keep the current policy.", false, selected?.dispatch_policy ?? ""), choices: ["automatic", "operator_only", "paused", ""] },
                    ...(selected?.kind === "sprint" ? [] : [{
                        ...field("execution_mode", "Execution mode", selected?.execution_mode ? `Current mode: ${selected.execution_mode}.` : "Current mode is unknown for this legacy item. Choose only if changing it.", false,
                            selected?.execution_mode ?? (selected?.kind === "milestone" ? "container" : "unknown")),
                        choices: selected?.kind === "milestone" ? ["unknown", "container"] : ["unknown", "direct", "container"],
                    }]),
                    { ...field("parent_action", "Parent change", "Keep, set, or clear the canonical parent.", true, "keep"), choices: ["keep", "set", "clear"] },
                    field("parent_id", "New parent", "Used when Parent change is set. For nested Tasks, enter the canonical Sprint parent.", false, selected?.parent_id ?? ""),
                ]
                        : action === "bind_result" ? [
                            { ...field("source_version_id", "Registered result source", "Press P and select a source from this project's registered catalog.", true), readOnly: true },
                            { ...field("content_digest", "Source content digest", "Copied from the selected source catalog row; this field cannot be edited.", true), readOnly: true },
                        ]
                        : action === "schedule_edit" ? [
                            field("not_before", "Not before · optional date", "YYYY-MM-DD in the project civil timezone; blank clears this date.", false),
                            field("due", "Due · optional date", "YYYY-MM-DD in the project civil timezone; blank clears this date.", false),
                            field("planned_start", "Planned start · optional date", "YYYY-MM-DD in the project civil timezone; blank clears this date.", false),
                            field("planned_end", "Planned end · optional date", "YYYY-MM-DD in the project civil timezone; blank clears this date.", false),
                        ]
                        : action === "wait_create" ? [
                            field("wait_id", "Wait identifier", "A unique stable identifier for this external dependency.", true, `wait-${Date.now().toString(36)}`),
                            { ...field("category", "Category", "External decision, approval, information, access, or service dependency.", true, "decision"), choices: ["decision", "approval", "information", "access", "service", "other"] },
                            field("reason", "What is needed", "Describe the external condition that is holding the dependent work."),
                            field("affected_work_ids", "Affected work IDs", "Comma-separated dependent work IDs. Only these records are affected.", true),
                            { ...field("accountable_kind", "Accountable party type", "Choose who or what is expected to respond.", true, "person"), choices: ["person", "role", "service"] },
                            field("accountable_reference", "Accountable reference", "A stable person/service reference or leave blank for a named role.", false),
                            field("accountable_name", "Accountable name", "Display name for a person or service.", false),
                            { ...field("accountable_role", "Accountable role", "Used when party type is role.", true, "operator"), choices: ["agent", "operator", "reviewer", "publisher"] },
                            field("expected_decision", "Expected decision", "Optional; do not treat time passing as a decision.", false),
                            field("expected_output", "Expected output", "Optional description of the information or artifact needed.", false),
                            field("follow_up", "Follow-up · optional date", "YYYY-MM-DD in the project civil timezone; blank means no follow-up date.", false),
                        ]
                        : action === "wait_resolve" ? [
                            field("wait_id", "External wait ID", "Read External waits first to find the exact open wait ID."),
                            { ...field("next_state", "Resolution state", "Resolve the wait or cancel the request.", true, "resolved"), choices: ["resolved", "cancelled"] },
                            { ...field("outcome", "Outcome", "Record what the external party actually supplied.", true, "decision_provided"), choices: ["approved", "rejected", "decision_provided", "output_provided", "declined", "unavailable", "cancelled"] },
                            field("detail", "Resolution detail", "Describe the attributable decision or information received."),
                            field("output_ref", "Output reference", "Optional reference to the supplied output.", false),
                            { ...field("supplied_kind", "Supplied by type", "Who or what provided the response.", true, "person"), choices: ["person", "role", "service"] },
                            field("supplied_reference", "Supplier reference", "Stable person/service reference or leave blank for a named role.", false),
                            field("supplied_name", "Supplier name", "Display name for a person or service.", false),
                            { ...field("supplied_role", "Supplier role", "Used when provider type is role.", true, "operator"), choices: ["agent", "operator", "reviewer", "publisher"] },
                        ]
                        : action === "dependency_add" || action === "dependency_remove" ? [
                        field("prerequisite_id", "Prerequisite work ID", "This item must close before the dependent work.", true),
                        field("dependent_id", "Dependent work ID", "The work item waiting for the prerequisite.", true, selected?.work_id ?? ""),
                    ]
                        : action === "cycle_create" ? [
                            field("cycle_id", "Cycle identifier", "A unique stable identifier."), field("name", "Name", "Cycle name."),
                            field("goal", "Goal", "Optional cycle goal.", false), field("timezone", "IANA timezone", "For example America/Regina."),
                            field("start", "Local start", "YYYY-MM-DDTHH:mm[:ss] in the selected timezone."), field("end", "Local end", "Optional; leave empty for no end.", false),
                            field("reason", "Reason", "Explain why this cycle is being created."),
                        ]
                            : action === "cycle_board" || action === "cycle_activate" || action === "cycle_close" || action === "cycle_cancel" ? [
                                field("cycle_id", "Cycle identifier", "Use the ID shown in Cycles."),
                                ...(action === "cycle_activate" || action === "cycle_close" || action === "cycle_cancel" ? [field("reason", "Reason", "Explain this cycle change.")] : []),
                            ]
                                : action === "cycle_assign" ? [
                                    field("cycle_id", "Cycle identifier", "Use the ID shown in Cycles."), field("assignment_id", "Assignment identifier", "A unique stable assignment ID."),
                                    field("work_id", "Task to assign", "Press P to choose a Task whose canonical planning hierarchy is valid.", true), field("reason", "Reason", "Explain the assignment.")
                                ]
                                    : action === "cycle_commit" || action === "cycle_remove" ? [
                                        field("cycle_id", "Cycle identifier", "Use the ID shown in Cycles."), field("assignment_id", "Assignment identifier", "Use the assignment ID shown on the board."),
                                        field("reason", "Reason", "Explain this assignment change.")
                                    ]
                                        : action === "cycle_carry_over" ? [
                                            field("cycle_id", "Current cycle", "Source cycle identifier."), field("assignment_id", "Assignment identifier", "Assignment to carry over."),
                                            field("successor_cycle_id", "Next cycle", "Destination cycle identifier."), field("successor_assignment_id", "New assignment identifier", "Unique destination assignment ID."),
                                            field("reason", "Reason", "Explain the carry-over.")
                                        ]
                                            : action === "memory_search" || action === "source_search" ? [field("query", "Search text", "Search published, cited project records.")]
                                                : action === "memory_show" ? [field("draft_id", "Draft identifier", "Use a known durable draft ID.")]
                                                    : action === "memory_draft" ? [
                                                        field("draft_id", "Draft identifier", "A unique stable draft ID."), field("entry_id", "Memory entry ID", "A stable published memory ID."),
                                                        field("title", "Title", "Short, searchable memory title."), field("body", "Body", "The cited memory content."),
                                                        field("source_version_id", "Source version", "Press P to select from this project's registered source catalog."), field("location", "Citation location", "For example README.md:12."),
                                                    ]
                                                        : action === "memory_review" ? [field("draft_id", "Draft identifier", "Use a known durable draft ID."), { ...field("decision", "Decision", "Left / Right changes the decision.", true, "approved"), choices: ["approved", "rejected"] }, field("reason", "Reason", "Explain the review decision.")]
                                                                : action === "memory_publish" ? [field("review_id", "Approved review ID", "Publication uses the approved review record."), field("expected_manifest_identity", "Expected manifest identity", "Confirm the exact current memory manifest identity.")]
                                                                    : action === "memory_reconcile" ? [field("operation_id", "Publish operation ID", "Reconcile the durable publication operation using its exact operation ID.")]
                                                                : action === "recovery_resolve" ? [
                                                                    field("obligation_id", "Obligation ID", "Use the ID shown in Recovery."), field("resolution_id", "Resolution ID", "A unique durable resolution ID."),
                                                                    field("outcome", "Outcome", "Record what the adapter confirmed."), field("reason", "Reason", "Explain the reviewed recovery decision."),
                                                                    field("resource_state", "Resource state", "Record whether the resource is still active or safely stopped."),
                                                                ]
                                                                    : action === "source_capture" ? [field("input", "Project-relative file or directory", "The service confines capture to this project's workspace."), field("origin", "Origin", "Explain the source provenance."), field("media_type", "Media type", "Optional; defaults to application/octet-stream.", false)]
                                                                            : action === "wait_page" ? [
                                                                                field("limit", "Page size", "Number of waits to request, from 1 to 100.", true, "50"),
                                                                                field("offset", "Starting offset", "Use the next offset shown in External waits to continue paging.", true, "50"),
                                                                                field("expected_project_revision", "Expected project revision · optional", "Set this to the revision shown on the previous page to keep paging one consistent snapshot.", false),
                                                                            ]
                                                                            : action === "intake_page" ? [
                                                                            field("limit", "Page size", "Number of items to request, from 1 to 100.", true, "50"),
                                                                            field("offset", "Starting offset", "Use the next offset shown in Intake to continue paging.", true, "0"),
                                                                        ]
                                                                            : action === "intake_disposition" ? [
                                                                                field("intake_id", "Intake identifier", "Use an ID shown in Intake."),
                                                                                field("content_revision", "Content revision", "Use the content revision shown in Intake."),
                                                                                { ...field("lifecycle", "Disposition", "Left / Right changes the state.", true, "triaged"), choices: ["triaged", "deferred", "resolved", "archived"] },
                                                                                field("revisit_at_utc_ms", "Revisit time · milliseconds", "Required for deferred; otherwise leave empty.", false),
                                                                            ]
                                                                                : action === "intake_promote" ? [
                                                                                    field("intake_id", "Intake identifier", "Use an ID shown in Intake."),
                                                                                    field("content_revision", "Content revision", "Use the content revision shown in Intake."),
                                                                                    { ...field("target_kind", "Existing target type", "Promotion links an existing target in this project.", true, "draft_work"), choices: ["draft_work", "source_version", "memory_draft"] },
                                                                                    field("target_id", "Existing target identifier", "The target must already exist in this project."),
                                                                                ]
                                                                                    : action === "review_show" ? [field("review_id", "Review identifier", "Use the ID shown in Reviews.")]
                                                                            : [];
    return { kind: "form", action, workId, fields, index: 0, ...(selected ? { workSnapshot: selected } : {}) };
}
