import type { DashboardFilter, MountedView, StatusItem, TuiAction } from "../client.js";
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
export const ACTION_NAMES: Record<TuiAction, string> = { create_project: "Initialize project", create_work: "Create work", claim: "Claim work", accept_start: "Start work", evidence: "Attach evidence", finish: "Finish & close", release: "Release claim" };
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
}
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
    kind: "help";
    offset: number;
} | {
    kind: "message";
    title: string;
    text: string;
    offset: number;
} | {
    kind: "form";
    action: "create_work" | "claim" | "evidence" | "finish" | "release";
    workId?: string;
    fields: FormField[];
    index: number;
    error?: string;
} | {
    kind: "confirm";
    action: TuiAction;
    workId?: string;
    payload: unknown;
    revision: number | null;
    attempt: string | null;
    summary: string;
    details: string[];
    offset?: number;
    reviewError?: string;
};
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
        { id: "workspace:cycles", label: "Cycles", hint: "Workspace · read only" },
        { id: "workspace:reviews", label: "Reviews", hint: "Workspace · read only" },
        { id: "workspace:memory", label: "Published memory search", hint: "Workspace · read only" },
        { id: "workspace:recovery", label: "Recovery obligations", hint: "Workspace · read only" },
        { id: "workspace:pending", label: "Pending operations", hint: "Workspace · read only", disabled: !view.pending_operations.length },
        { id: "workspace:unavailable", label: "Unavailable routes", hint: "Workspace · read only" },
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
export function actionForm(action: "create_work" | "claim" | "evidence" | "finish" | "release", workId?: string): Extract<Modal, {
    kind: "form";
}> {
    const field = (name: string, label: string, hint: string, required = true, value = ""): FormField => ({ name, label, hint, required, value });
    const fields: FormField[] = action === "create_work" ? [
        field("work_id", "Work identifier", "A unique, stable identifier. For example: task-104."),
        { ...field("kind", "Kind", "Left / Right cycles the work kind.", true, "task"), choices: ["task", "sprint", "milestone"] },
        field("title", "Title", "Describe the outcome, not just the activity."),
        field("parent_id", "Parent identifier", "Optional existing sprint or milestone identifier.", false),
        field("priority", "Priority", "0–255. Higher values are scheduled first.", false, "0"),
        field("description", "Description", "Optional context for the person or agent doing the work.", false),
    ] : action === "claim" ? [
        field("source_version_id", "Registered source version", "Use the exact ID from `bwrk source list PROJECT`. If none exists, capture the relevant file with `bwrk source add PROJECT --input PATH --origin ORIGIN`, then list sources again."),
        field("config_identity", "Execution configuration identity", "Describe the real setup (for example repository revision + toolchain + relevant config version). Never include credentials or use ‘unknown’."),
    ] : action === "evidence" ? [field("receipt", "Receipt JSON", "Paste a real receipt object. No evidence is generated or fabricated here.")]
        : action === "finish" ? [field("summary", "Closeout summary", "Explain what changed and how it was verified.")]
            : [field("reason", "Release reason", "Explain why this claim is being released.", true, "Released by operator")];
    return { kind: "form", action, workId, fields, index: 0 };
}
