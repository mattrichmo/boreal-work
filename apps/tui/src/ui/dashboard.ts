import type { MountedView, StatusItem } from "../client.js";
import { clip, fit, wrap, wrapWords, inputTail, cellWidth } from "./cells.js";
import { Screen, type Rect, type Tone, rightLabel } from "./screen.js";
import { ACTION_NAMES, FILTERS, itemStatus, paletteCommands, visibleItems, type DashboardState } from "./model.js";
const LABELS: Record<string, string> = { in_progress: "In progress", needs_verification: "Verification", awaiting_review: "Awaiting review", expired_review: "Review needed", retry_wait: "Retry wait" };
const label = (s: string) => LABELS[s] ?? s.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const tone = (s: string): Tone => s === "ready" || s === "closed" ? "good" : ["blocked", "expired_review", "cancelled"].includes(s) ? "danger" : ["queued", "needs_verification", "awaiting_review"].includes(s) ? "warn" : "accent";
export interface DashboardLayout {
    rail?: Rect;
    queue: Rect;
    inspector?: Rect;
    body: Rect;
    visibleRows: number;
}
export function dashboardLayout(width: number, height: number, detailOnly = false): DashboardLayout {
    const top = height >= 20 ? 7 : 5, bottom = 3;
    const body = { x: 1, y: top, width: Math.max(1, width - 2), height: Math.max(2, height - top - bottom) };
    const rail = width >= 124 && !detailOnly ? { ...body, width: 21 } : undefined;
    const x = rail ? rail.x + rail.width + 1 : body.x;
    const available = width - x - 1;
    const inspector = width >= 100 && !detailOnly ? { x: width - Math.min(44, Math.floor(width * .33)) - 1, y: body.y, width: Math.min(44, Math.floor(width * .33)), height: body.height } : undefined;
    const queue = { x, y: body.y, width: inspector ? inspector.x - x - 1 : available, height: body.height };
    return { rail, queue, inspector, body, visibleRows: Math.max(1, body.height - 4) };
}
function heading(screen: Screen, view: MountedView, state: DashboardState): void {
    const m = view.monitoring;
    screen.text(2, 1, "BOREAL", "accent");
    screen.text(9, 1, "/ WORK", "heading");
    const health = state.busy ? `BUSY · ${state.busy}` : view.notice?.kind === "error" || view.stale_revision ? "STALE · r retry" : state.error ? "ATTENTION" : state.frozen ? "PAUSED" : m ? "LIVE" : "CONNECTING";
    if (screen.width >= 72)
        rightLabel(screen, 1, health, state.error ? "danger" : state.frozen ? "warn" : "good");
    screen.text(2, 2, clip(`${m?.project_name ?? view.route.project_id ?? "Project"}  /  ${FILTERS.find(f => f.id === state.filter)?.label.toUpperCase() ?? "ALL WORK"}`, screen.width - 4), "muted");
    screen.rule(1, 3, screen.width - 2, state.ascii);
    if (screen.height >= 20) {
        const c = m?.counts;
        const metrics = [`READY ${c?.ready ?? "—"}`, `ACTIVE ${c?.in_progress ?? "—"}`, `BLOCKED ${c?.blocked ?? "—"}`, `REVIEW ${c?.expired_review ?? "—"}`, `CLOSED ${c?.closed ?? "—"}`];
        const step = Math.max(1, Math.floor((screen.width - 4) / metrics.length));
        metrics.forEach((v, i) => screen.text(2 + i * step, 4, clip(v, step - 1), i === 2 || i === 3 ? "warn" : i === 0 ? "good" : "text"));
        const scope = `${m?.total ?? 0} total · ${m?.items.length ?? 0} on this page${m?.has_more ? " · more available: ]" : ""}`;
        screen.text(2, 5, clip(scope, screen.width >= 100 ? screen.width - 51 : screen.width - 4), "muted");
        if (screen.width >= 100)
            rightLabel(screen, 5, `revision ${m?.revision ?? "—"} · ${m?.as_of?.slice(11, 19) ?? "not loaded"}`, "muted");
    }
}
function rail(screen: Screen, r: Rect, view: MountedView, state: DashboardState): void {
    screen.box(r, "WORKSPACE", state.focus === "navigation", state.ascii);
    FILTERS.forEach((f, index) => {
        const active = f.id === state.filter;
        const selected = state.focus === "navigation" && state.navIndex === index;
        const y = r.y + 2 + index;
        if (y >= r.y + r.height - 2)
            return;
        screen.text(r.x + 1, y, fit(`${active ? ">" : " "} ${f.key} ${f.label}`, r.width - 2), selected ? "selected" : active ? "accent" : "text");
    });
    if (r.height >= 17) {
        screen.text(r.x + 2, r.y + r.height - 5, "LOCAL VIEW", "muted");
        screen.text(r.x + 2, r.y + r.height - 4, `Sort: ${state.sort}`, "text", r.width - 4);
        screen.text(r.x + 2, r.y + r.height - 3, state.frozen ? "Refresh paused" : "Refresh every 5s", state.frozen ? "warn" : "muted", r.width - 4);
    }
}
function queue(screen: Screen, r: Rect, view: MountedView, state: DashboardState): void {
    const items = visibleItems(view, state), index = Math.max(0, items.findIndex(i => i.work_id === state.selectedId));
    const capacity = Math.max(1, r.height - 4), start = Math.min(Math.max(0, index - Math.floor(capacity / 2)), Math.max(0, items.length - capacity));
    screen.box(r, `WORK QUEUE (${items.length})`, state.focus === "queue", state.ascii);
    const inner = r.width - 4, stateWidth = inner >= 62 ? 15 : inner >= 38 ? 12 : 9;
    const idWidth = inner >= 84 ? 15 : inner >= 60 ? 12 : 0;
    const kindWidth = inner >= 100 ? 10 : 0;
    const titleWidth = Math.max(1, inner - stateWidth - idWidth - kindWidth - 2);
    screen.text(r.x + 2, r.y + 1, fit("", 2) + fit("WORK", titleWidth) + fit("STATE", stateWidth) + (idWidth ? fit("ID", idWidth) : "") + (kindWidth ? fit("KIND", kindWidth) : ""), "muted", inner);
    if (!items.length) {
        const empty = state.query ? "No work matches this search." : "No work in this view.";
        screen.text(r.x + 2, r.y + 3, clip(empty, inner), "heading");
        if (r.height > 6)
            screen.text(r.x + 2, r.y + 4, clip(view.monitoring?.has_more ? "Search is page-local. ] loads more work." : "Press n to create work, or 1 for all work.", inner), "muted");
    }
    items.slice(start, start + capacity).forEach((item, i) => {
        const selected = item.work_id === state.selectedId, y = r.y + 2 + i;
        const title = item.title ?? item.work_id;
        const marker = selected ? "> " : "  ";
        const rowTone: Tone = selected ? "selected" : "text";
        screen.text(r.x + 1, y, " ".repeat(r.width - 2), rowTone);
        screen.text(r.x + 2, y, marker + fit(title, titleWidth), rowTone, titleWidth + 2);
        screen.text(r.x + titleWidth + 4, y, fit(label(itemStatus(item)), stateWidth), selected ? "selected" : tone(itemStatus(item)), stateWidth);
        let x = r.x + titleWidth + 4 + stateWidth;
        if (idWidth) {
            screen.text(x, y, fit(item.work_id, idWidth), selected ? "selected" : "muted", idWidth);
            x += idWidth;
        }
        if (kindWidth)
            screen.text(x, y, fit(item.kind ?? "work", kindWidth), selected ? "selected" : "muted", kindWidth);
    });
    const info = ` ${items.length ? index + 1 : 0}/${items.length} · ${state.query ? `search: ${state.query}` : `${state.sort} order`}${view.monitoring?.has_more ? " · ] more" : ""} `;
    screen.text(r.x + 2, r.y + r.height - 1, clip(info, r.width - 4), "muted", r.width - 4);
}
interface DetailLine {
    text: string;
    tone?: Tone;
}
export function detailLines(item: StatusItem | undefined, view: MountedView, tab: number, width: number): DetailLine[] {
    if (!item)
        return [{ text: "Nothing selected", tone: "heading" }, { text: "Select work in the queue." }];
    const lines: DetailLine[] = [];
    const add = (text: string, t: Tone = "text") => wrapWords(text, width).forEach(text => lines.push({ text, tone: t }));
    if (tab === 1) {
        add("ACCEPTANCE GATES", "heading");
        if (!item.gates)
            add("Gate details were not supplied by the service.", "muted");
        else if (!item.gates.open.length && !item.gates.satisfied.length)
            add("No gates in this snapshot.", "muted");
        for (const g of item.gates?.open ?? []) {
            add(`${g.required ? "! REQUIRED" : "· OPTIONAL"}  ${g.gate_id}`, g.required ? "warn" : "muted");
            add(`${g.kind} · ${g.state}`);
            if (g.reason)
                add(g.reason, "muted");
            add("");
        }
        for (const g of item.gates?.satisfied ?? [])
            add(`✓ ${g.gate_id} · ${g.state}`, "good");
        add("");
        add("EVIDENCE", "heading");
        add(view.selected_receipt_available ? "Current receipt available for this attempt." : "No current receipt has been resolved.", view.selected_receipt_available ? "good" : "warn");
        if (item.receipt_id)
            add(item.receipt_id, "muted");
    }
    else if (tab === 2) {
        add("RECENT ACTIVITY", "heading");
        if (!item.activity?.length)
            add("Activity history is not included in this service snapshot.", "muted");
        for (const e of [...(item.activity ?? [])].reverse()) {
            add(`${e.occurred_at ?? "Time unavailable"} · ${label(e.kind)}`, "accent");
            if (e.summary)
                add(e.summary);
            if (e.actor_id)
                add(e.actor_id, "muted");
            add("");
        }
    }
    else {
        add(item.title ?? item.work_id, "heading");
        add(item.work_id, "muted");
        add("");
        add(`${label(itemStatus(item))} · ${item.kind ?? "work"}`, tone(itemStatus(item)));
        if (item.priority !== undefined)
            add(`Priority  ${item.priority}`);
        if (item.parent_id)
            add(`Parent    ${item.parent_id}`, "muted");
        if (item.due_at)
            add(`Due       ${item.due_at}`, "warn");
        add("");
        add("NEXT ACTION", "heading");
        add(item.next_action ? label(item.next_action) : "No next action supplied.", "accent");
        if (item.reason_codes.length)
            add(item.reason_codes.map(label).join(" · "), "warn");
        if (item.description) {
            add("");
            add("DESCRIPTION", "heading");
            add(item.description);
        }
        if (item.attempt) {
            add("");
            add("OWNERSHIP", "heading");
            add(item.attempt.actor_id ?? "Owner not supplied");
            add(`Phase  ${label(item.attempt.phase ?? "unknown")}`, "muted");
            if (item.attempt.lease_deadline)
                add(`Lease  ${item.attempt.lease_deadline}`, "muted");
        }
        add("");
        add("DEPENDENCIES", "heading");
        if (!item.dependencies)
            add("Not included in this snapshot.", "muted");
        else if (!item.dependencies.length)
            add("No dependencies in this snapshot.", "muted");
        else
            item.dependencies.forEach(d => add(`${d.satisfied ? "✓" : "·"} ${d.work_id} · ${label(d.status ?? "unknown")}`, d.satisfied ? "good" : "warn"));
        add("");
        add("AVAILABLE ACTIONS", "heading");
        for (const a of view.actions.filter(a => !["create_work", "create_project"].includes(a.action))) {
            add(`${a.enabled ? "→" : "·"} ${ACTION_NAMES[a.action]}`, a.enabled ? "accent" : "muted");
            if (!a.enabled && a.reason)
                add(`  ${a.reason}`, "muted");
        }
    }
    return lines;
}
function inspector(screen: Screen, r: Rect, view: MountedView, state: DashboardState): void {
    const item = visibleItems(view, state).find(i => i.work_id === state.selectedId);
    screen.box(r, "INSPECTOR", state.focus === "inspector", state.ascii);
    const tabs = ["Overview", "Gates", "Activity"], tabWidth = Math.floor((r.width - 4) / 3);
    tabs.forEach((t, i) => screen.text(r.x + 2 + i * tabWidth, r.y + 1, fit(t, tabWidth), state.inspectorTab === i ? "accent" : "muted", tabWidth));
    const lines = detailLines(item, view, state.inspectorTab, r.width - 4), capacity = Math.max(1, r.height - 4);
    const offset = Math.min(state.inspectorOffset, Math.max(0, lines.length - capacity));
    lines.slice(offset, offset + capacity).forEach((line, i) => screen.text(r.x + 2, r.y + 3 + i, line.text, line.tone ?? "text", r.width - 4));
    screen.text(r.x + 2, r.y + r.height - 1, clip(` ${offset + 1}–${Math.min(lines.length, offset + capacity)} / ${lines.length} · Tab focus · ← → tabs `, r.width - 4), "muted", r.width - 4);
}
export const HELP = [
    "NAVIGATION", "↑ ↓ / j k   Move in the focused pane", "Tab / Shift-Tab   Change pane focus", "Enter   Open inspector / activate choice", "Esc   Close dialog, leave detail, or clear search", "Home / End   First / last work item", "Page Up / Down   Move a page, or scroll inspector", "1–9   Switch work view", "]   Load next service page", "[   Return to first service page", "o   Cycle service / priority / title ordering", "", "FIND & INSPECT", "/   Search this loaded service page", "p / Ctrl-K / :   Search commands", "← → in inspector   Overview / Gates / Activity", "F   Pause / resume periodic refresh (resumes at page one)", "r   Refresh from the first service page", "T   Dark / light / monochrome", "", "ACTIONS (confirmation required)", "n   Create task, sprint, or milestone", "c   Claim selected work", "s   Start selected claim", "e   Attach a real receipt JSON object", "f   Finish with a closeout summary", "x   Release claim with a reason", "u   Read back the first unknown operation (no retry)", "", "INPUT & EXIT", "Tab   Next form field; arrows change a choice", "Ctrl-U   Clear the focused input", "Bracketed paste never activates keyboard commands", "q   Quit outside dialogs; Ctrl-C / Ctrl-D exits", "", "DATA BOUNDARIES", "Counts above are service totals; filters/search apply to the loaded page.", "Missing history, dependencies, or capabilities are labelled, never fabricated.", "No automatic replay of an operation whose outcome is unknown.", "Mouse tracking is intentionally off, preserving terminal text selection.",
];
function modal(screen: Screen, view: MountedView, state: DashboardState): void {
    const m = state.modal;
    if (!m)
        return;
    // De-emphasize the underlying workspace while the dialog owns keyboard focus.
    for (const row of screen.cells)
        for (const cell of row)
            cell.tone = "muted";
    const width = Math.min(88, screen.width - 4), height = Math.min(screen.height - 4, m.kind === "confirm" ? 17 : m.kind === "search" ? 9 : m.kind === "form" ? (m.action === "evidence" ? 24 : 18) : 26);
    const r = { x: Math.floor((screen.width - width) / 2), y: Math.floor((screen.height - height) / 2), width, height };
    screen.fill(r);
    const w = width - 6, x = r.x + 3, y = r.y + 2;
    const title = m.kind === "form" ? ACTION_NAMES[m.action] : m.kind === "confirm" ? "REVIEW ACTION" : m.kind === "palette" ? "COMMAND PALETTE" : m.kind === "help" ? "KEYBOARD REFERENCE" : "SEARCH WORK";
    screen.box(r, title, true, state.ascii);
    const foot = (s: string) => screen.text(x, r.y + height - 2, clip(s, w), "muted", w);
    if (m.kind === "search") {
        screen.text(x, y, "Search titles, identifiers, parents and owners.", "muted", w);
        screen.text(x, y + 2, `/ ${inputTail(m.value, w - 4)}▏`, "accent", w);
        screen.text(x, y + 3, "Search only covers the currently loaded page.", "muted", w);
        foot("Enter apply · Ctrl-U clear · Esc cancel");
    }
    else if (m.kind === "palette") {
        screen.text(x, y, `> ${inputTail(m.value, w - 4)}▏`, "accent", w);
        const commands = paletteCommands(view, state), capacity = height - 7, index = Math.min(m.index, Math.max(0, commands.length - 1));
        const start = Math.min(Math.max(0, index - Math.floor(capacity / 2)), Math.max(0, commands.length - capacity));
        commands.slice(start, start + capacity).forEach((c, i) => screen.text(x, y + 2 + i, fit(`${start + i === index ? ">" : " "} ${c.disabled ? "· " : ""}${c.label}`, w), start + i === index ? "selected" : c.disabled ? "muted" : "text", w));
        const chosen = commands[index];
        if (chosen)
            screen.text(x, r.y + height - 3, clip(chosen.hint, w), chosen.disabled ? "warn" : "muted", w);
        foot("↑ ↓ choose · Enter run · Esc close");
    }
    else if (m.kind === "help") {
        const all = HELP.flatMap(l => wrap(l, w)), capacity = height - 4, offset = Math.min(m.offset, Math.max(0, all.length - capacity));
        all.slice(offset, offset + capacity).forEach((line, i) => screen.text(x, y + i, line, /^[A-Z &()]+$/.test(line) ? "accent" : "text", w));
        foot(`↑ ↓ scroll · ${offset + 1}/${all.length} · Esc close`);
    }
    else if (m.kind === "form") {
        const field = m.fields[m.index];
        screen.text(x, y, `${m.index + 1} / ${m.fields.length}   ${field.label}${field.required ? " *" : ""}`, "heading", w);
        const compact = height < 18, inputY = compact ? y + 3 : y + 5;
        const hints = wrap(field.hint, w);
        hints.slice(0, compact ? 1 : 2).forEach((t, i) => screen.text(x, y + (compact ? 1 : 2) + i, t, "muted", w));
        if (field.choices) {
            field.choices.forEach((choice, i) => screen.text(x, inputY + i, `${field.value === choice ? ">" : " "} ${choice}`, field.value === choice ? "accent" : "muted", w));
        }
        else {
            const maxRows = Math.max(1, r.y + height - 3 - inputY), rows = wrap(field.value, w - 2);
            const rendered = rows.slice(-maxRows);
            rendered.forEach((s, i) => screen.text(x, inputY + i, (s || " ") + (i === rendered.length - 1 ? "▏" : ""), "accent", w));
        }
        if (m.error)
            screen.text(x, r.y + height - 4, clip(m.error, w), "danger", w);
        foot("Enter next / review · Tab field · Ctrl-U clear · Esc cancel");
    }
    else {
        const detail = [`CONFIRM: ${m.action} ${m.workId ?? "new work"}`, "", m.summary, ...m.details, `Snapshot revision: ${m.revision ?? "unknown"}`, m.attempt ? `Attempt: ${m.attempt}` : "", "This changes shared project state. Nothing is sent until confirmed."].filter(Boolean).flatMap(s => wrap(s, w));
        const capacity = height - 5, offset = Math.min(m.offset ?? 0, Math.max(0, detail.length - capacity));
        detail.slice(offset, offset + capacity).forEach((t, i) => screen.text(x, y + i, t, i === 0 && offset === 0 ? "accent" : "text", w));
        foot(detail.length > capacity ? "↑↓ scroll · Enter confirm · Esc cancel" : "Enter / y confirm · Esc / n cancel");
    }
}
/** Real screen grid, not a browser-style mockup. Every glyph is cell-bounded. */
export function renderDashboard(view: MountedView, state: DashboardState, width: number, height: number): Screen {
    width = Math.max(1, Math.min(500, Math.floor(width) || 80));
    height = Math.max(1, Math.min(200, Math.floor(height) || 24));
    const screen = new Screen(width, height);
    if (width < 44 || height < 14) {
        screen.text(1, 1, "BOREAL / WORK", "accent");
        screen.text(1, 3, `Terminal ${width}×${height}.`, "warn");
        screen.text(1, 4, "Resize to at least 44×14.", "muted");
        screen.text(1, Math.min(height - 1, 6), "q quit · Ctrl-C exit", "muted");
        return screen;
    }
    heading(screen, view, state);
    const layout = dashboardLayout(width, height, state.detailOnly);
    if (state.detailOnly)
        inspector(screen, layout.body, view, state);
    else {
        if (layout.rail)
            rail(screen, layout.rail, view, state);
        queue(screen, layout.queue, view, state);
        if (layout.inspector)
            inspector(screen, layout.inspector, view, state);
    }
    const notice = view.notice?.kind === "error" ? view.notice.message : state.status || view.notice?.message || "Ready";
    const pending = view.pending_operations.length ? `${view.pending_operations.length} UNKNOWN OPERATION(S) · u read back · ` : "";
    screen.text(2, height - 3, clip(pending + notice, width - 4), state.error ? "danger" : pending ? "warn" : "muted", width - 4);
    const keys = width >= 100 ? "↑↓ move  Tab pane  Enter inspect  / search  p commands  n new  r refresh  ? help  q quit" : "↑↓ move  Enter inspect  / search  p commands  ? help  q quit";
    screen.text(2, height - 2, clip(keys, width - 4), "text", width - 4);
    modal(screen, view, state);
    return screen;
}
