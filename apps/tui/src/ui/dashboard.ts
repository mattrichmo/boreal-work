import type { MountedView, StatusItem } from "../client.js";
import { clip, fit, wrap, wrapWords, cellWidth } from "./cells.js";
import { Screen, type Rect, type Tone } from "./screen.js";
import { inputDisplay } from "./input.js";
import { resolveViewport, chromeFor, paneViewport, dialogViewport, adaptiveHint, windowStart, type Density, type Chrome } from "./layout.js";
import { ACTION_NAMES, FILTERS, itemStatus, paletteCommands, visibleItems, type DashboardState, type Modal } from "./model.js";
const LABELS: Record<string, string> = { in_progress: "In progress", needs_verification: "Verification", awaiting_review: "Awaiting review", expired_review: "Review needed", retry_wait: "Retry wait", corrupt: "Unreadable" };
const label = (s: string) => LABELS[s] ?? s.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const tone = (s: string): Tone => s === "ready" || s === "closed" ? "good" : ["blocked", "expired_review", "cancelled", "corrupt"].includes(s) ? "danger" : ["queued", "needs_verification", "awaiting_review"].includes(s) ? "warn" : "accent";
export interface DashboardLayout {
    rail?: Rect; queue: Rect; inspector?: Rect; body: Rect; visibleRows: number;
    chrome: Chrome; mode: "three-pane" | "split" | "stacked" | "single"; footerRows: number;
}
export function dashboardLayout(width: number, height: number, detailOnly = false, density: Density = "auto", zen = false): DashboardLayout {
    ({ width, height } = resolveViewport({ width, height }));
    const chrome = chromeFor(width, height, density);
    const footerRows = height >= 8 ? 2 : height >= 3 ? 1 : 0;
    const top = chrome === "comfortable" ? 6 : chrome === "standard" ? 4 : height >= 10 ? 2 : height >= 4 ? 1 : 0;
    const margin = chrome === "comfortable" || chrome === "standard" ? 1 : 0;
    const body = { x: margin, y: top, width: Math.max(1, width - margin * 2), height: Math.max(1, height - top - footerRows) };
    const rail = width >= 136 && height >= 26 && chrome !== "compact" && !detailOnly && !zen ? { ...body, width: 21 } : undefined;
    const x = rail ? rail.x + rail.width + 1 : body.x;
    let queue: Rect = { ...body, x, width: body.x + body.width - x }, inspector: Rect | undefined;
    let mode: DashboardLayout["mode"] = "single";
    if (!detailOnly && !zen && width >= 104 && height >= 10) {
        const iw = Math.min(58, Math.max(34, Math.floor(queue.width * .38)));
        inspector = { x: body.x + body.width - iw, y: body.y, width: iw, height: body.height };
        queue = { ...queue, width: inspector.x - x - 1 };
        mode = rail ? "three-pane" : "split";
    } else if (!detailOnly && !zen && width >= 76 && height >= 32 && density !== "compact") {
        const qh = Math.floor(body.height * .55);
        queue = { ...queue, height: qh };
        inspector = { ...body, y: body.y + qh + 1, height: body.height - qh - 1 };
        mode = "stacked";
    }
    return { rail, queue, inspector, body, chrome, mode, footerRows, visibleRows: paneViewport(queue, chrome).height };
}
/** When a pane no longer fits, preserve its focus as a full view, not a hidden pane. */
export function inspectorRect(layout: DashboardLayout, state: DashboardState): Rect | undefined {
    return state.detailOnly || (state.focus === "inspector" && !layout.inspector) ? layout.body : layout.inspector;
}
function leftRight(screen: Screen, y: number, left: string, right: string, leftTone: Tone = "text", rightTone: Tone = "muted", x = 1, width = screen.width - 2): void {
    const rw = cellWidth(right);
    if (rw + 8 < width) {
        screen.text(x, y, clip(left, width - rw - 2), leftTone, width - rw - 2);
        screen.text(x + width - rw, y, right, rightTone, rw);
    } else screen.text(x, y, clip(left, width), leftTone, width);
}
function health(view: MountedView, state: DashboardState): string {
    return state.busy ? `BUSY ${state.busy}` : view.notice?.kind === "error" || view.stale_revision ? "STALE / r retry" : state.error ? "ATTENTION" : state.frozen ? "PAUSED" : view.monitoring ? "LIVE" : "CONNECTING";
}
function heading(screen: Screen, view: MountedView, state: DashboardState, l: DashboardLayout): void {
    if (!l.body.y) return;
    const m = view.monitoring, c = m?.counts;
    const filter = FILTERS.find(f => f.id === state.filter)?.label ?? "All work";
    const project = m?.project_name ?? view.route.project_id ?? "Project";
    const hp = health(view, state), ht: Tone = hp.startsWith("STALE") || state.error ? "danger" : state.frozen ? "warn" : "good";
    const brand = screen.width < 36 ? `BW / ${filter}` : `BOREAL / WORK  ${l.chrome === "comfortable" ? "" : `/ ${project}`}`;
    leftRight(screen, 0, brand, hp, "accent", ht);
    if (l.body.y < 2) return;
    const scope = `${m?.items.length ?? 0}/${m?.total ?? 0} loaded${m?.has_more ? "  ] more" : ""}`;
    if (l.chrome === "compact" || l.chrome === "micro") {
        const summary = screen.width >= 92 ? `${filter}  ·  READY ${c?.ready ?? "-"}  ACTIVE ${c?.in_progress ?? "-"}  BLOCKED ${c?.blocked ?? "-"}` : `${filter} · v views`;
        leftRight(screen, 1, summary, scope, "muted");
    } else {
        leftRight(screen, 1, `${project}  /  ${filter.toUpperCase()}`, `${l.mode} · ${state.density}`, "muted");
        if (l.chrome === "comfortable") {
            screen.rule(1, 2, screen.width - 2, state.ascii);
            const metrics = [`READY ${c?.ready ?? "—"}`, `ACTIVE ${c?.in_progress ?? "—"}`, `BLOCKED ${c?.blocked ?? "—"}`, `REVIEW ${c?.expired_review ?? "—"}`, `CLOSED ${c?.closed ?? "—"}`];
            const step = Math.floor((screen.width - 4) / metrics.length);
            metrics.forEach((v, i) => screen.text(2 + i * step, 3, clip(v, step - 1), i === 2 || i === 3 ? "warn" : i === 0 ? "good" : "text", step - 1));
            leftRight(screen, 4, scope, `revision ${m?.revision ?? "—"} · ${m?.as_of?.slice(11, 19) ?? "not loaded"}`, "muted");
        } else { leftRight(screen, 2, scope, `revision ${m?.revision ?? "—"}`, "muted"); screen.rule(1, 3, screen.width - 2, state.ascii); }
    }
}
function rail(screen: Screen, r: Rect, state: DashboardState): void {
    screen.box(r, "WORKSPACE", state.focus === "navigation", state.ascii);
    const capacity = Math.max(1, r.height - 4), start = windowStart(state.navIndex, FILTERS.length, capacity);
    FILTERS.slice(start, start + capacity).forEach((f, i) => {
        const active = f.id === state.filter, focused = state.focus === "navigation" && state.navIndex === start + i;
        screen.text(r.x + 1, r.y + 2 + i, fit(`${active ? ">" : " "} ${f.key} ${f.label}`, r.width - 2), focused ? "selected" : active ? "accent" : "text", r.width - 2);
    });
    if (r.height >= 17) {
        screen.text(r.x + 2, r.y + r.height - 5, "DISPLAY", "muted", r.width - 4);
        screen.text(r.x + 2, r.y + r.height - 4, `d ${state.density} density`, "text", r.width - 4);
        screen.text(r.x + 2, r.y + r.height - 3, "z focus · v views", "muted", r.width - 4);
    }
}
function queue(screen: Screen, r: Rect, view: MountedView, state: DashboardState, chrome: Chrome): void {
    const items = visibleItems(view, state), index = Math.max(0, items.findIndex(i => i.work_id === state.selectedId));
    const p = paneViewport(r, chrome), start = windowStart(index, items.length, p.height);
    const position = `${items.length ? index + 1 : 0}/${items.length}${view.monitoring?.has_more ? " ]" : ""}`;
    if (p.boxed) {
        screen.box(r, `WORK QUEUE (${items.length})`, state.focus === "queue", state.ascii);
        screen.text(r.x + 2, r.y + r.height - 1, clip(` ${position} · ${state.query ? `search: ${state.query}` : `${state.sort} order`} `, r.width - 4), "muted", r.width - 4);
    } else if (r.height > 1) leftRight(screen, r.y, `WORK QUEUE${state.query ? ` / ${state.query}` : ""}`, position, state.focus === "queue" ? "accent" : "heading", "muted", r.x, r.width);
    const sw = p.width >= 58 ? 15 : p.width >= 34 ? 11 : p.width >= 22 ? 7 : 0;
    const iw = p.width >= 78 ? 14 : 0, kw = p.width >= 110 ? 10 : 0;
    const pw = p.width >= 94 ? 5 : 0, ow = p.width >= 125 ? 14 : 0, gap = sw ? 1 : 0;
    const tw = Math.max(1, p.width - 2 - sw - iw - kw - pw - ow - gap);
    if (!p.boxed && r.height > 1 && p.width >= 58) screen.text(p.x, r.y, fit(`WORK QUEUE (${position})`, 2 + tw + gap) + fit("STATE", sw) + fit("ID", iw) + fit("PRI", pw) + fit("KIND", kw) + fit("OWNER", ow), state.focus === "queue" ? "accent" : "heading", p.width);
    if (p.boxed) screen.text(p.x, r.y + 1, "  " + fit("WORK", tw + gap) + fit("STATE", sw) + fit("ID", iw) + fit("PRI", pw) + fit("KIND", kw) + fit("OWNER", ow), "muted", p.width);
    if (!items.length) {
        screen.text(p.x, p.y, clip(state.query ? "No search matches" : "No work in this view", p.width), "heading", p.width);
        if (p.height > 1) screen.text(p.x, p.y + 1, clip(view.monitoring?.has_more ? "] next page · v views" : "n new work · v views", p.width), "muted", p.width);
    }
    items.slice(start, start + p.height).forEach((item, i) => {
        const selected = item.work_id === state.selectedId, rt: Tone = selected ? "selected" : "text", y = p.y + i;
        screen.text(p.x, y, fit(`${selected ? "> " : "  "}${clip(item.title ?? item.work_id, tw)}`, p.width), rt, p.width);
        const stateLabel = sw < 10 ? ({ in_progress: "Active", needs_verification: "Verify", expired_review: "Review", awaiting_review: "Review" }[itemStatus(item)] ?? label(itemStatus(item))) : label(itemStatus(item));
        let x = p.x + 2 + tw + gap;
        screen.text(x, y, fit(stateLabel, sw), selected ? "selected" : tone(itemStatus(item)), sw); x += sw;
        screen.text(x, y, fit(item.work_id, iw), selected ? "selected" : "muted", iw); x += iw;
        screen.text(x, y, fit(item.priority ?? "—", pw), selected ? "selected" : "muted", pw); x += pw;
        screen.text(x, y, fit(item.kind ?? "work", kw), selected ? "selected" : "muted", kw); x += kw;
        screen.text(x, y, fit(item.attempt?.actor_id ?? "—", ow), selected ? "selected" : "muted", ow);
    });
}
interface DetailLine {
    text: string;
    tone?: Tone;
}
export function detailLines(item: StatusItem | undefined, view: MountedView, tab: number, width: number, compact = false): DetailLine[] {
    if (!item)
        return [{ text: "Nothing selected", tone: "heading" }, { text: "Select work in the queue." }];
    const lines: DetailLine[] = [];
    const add = (text: string, t: Tone = "text") => { if (!compact || text) wrapWords(text, width).forEach(text => lines.push({ text, tone: t })); };
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
        if (compact) add(`Next: ${item.next_action ? label(item.next_action) : "No next action supplied."}`, "accent");
        if (item.priority !== undefined)
            add(`Priority  ${item.priority}`);
        if (item.parent_id)
            add(`Parent    ${item.parent_id}`, "muted");
        if (item.due_at)
            add(`Due       ${item.due_at}`, "warn");
        add("");
        if (!compact) { add("NEXT ACTION", "heading");
            add(item.next_action ? label(item.next_action) : "No next action supplied.", "accent"); }
        if (item.primary_reason)
            add(`Primary: ${label(item.primary_reason)}`, "warn");
        const secondaryReasons = item.primary_reason ? item.reason_codes.slice(1) : item.reason_codes;
        if (secondaryReasons.length)
            add(secondaryReasons.map(label).join(" · "), "warn");
        if (item.diagnostic) {
            add("");
            add("RECORD INTEGRITY", "heading");
            add("Unreadable record · no actions are available.", "danger");
            add(item.diagnostic.code, "danger");
            add(item.diagnostic.detail, "muted");
        }
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
function inspector(screen: Screen, r: Rect, view: MountedView, state: DashboardState, chrome: Chrome): void {
    const p = paneViewport(r, chrome), item = visibleItems(view, state).find(i => i.work_id === state.selectedId);
    const tabs = ["Overview", "Gates", "Activity"], current = tabs[state.inspectorTab];
    const lines = detailLines(item, view, state.inspectorTab, p.width, chrome === "compact" || chrome === "micro");
    const offset = Math.min(state.inspectorOffset, Math.max(0, lines.length - p.height));
    if (p.boxed) {
        screen.box(r, "INSPECTOR", state.focus === "inspector", state.ascii);
        screen.text(p.x, r.y + 1, clip(tabs.map((t, i) => i === state.inspectorTab ? `[${t}]` : t).join(" "), p.width), "accent", p.width);
        screen.text(p.x, r.y + r.height - 1, clip(` ${offset + 1}-${Math.min(lines.length, offset + p.height)}/${lines.length} · ←→ tabs · Esc back `, p.width), "muted", p.width);
    } else if (r.height > 1) leftRight(screen, r.y, `INSPECTOR / ${current}`, `${offset + 1}/${lines.length}`, state.focus === "inspector" ? "accent" : "heading", "muted", r.x, r.width);
    lines.slice(offset, offset + p.height).forEach((line, i) => screen.text(p.x, p.y + i, line.text, line.tone ?? "text", p.width));
}
export const HELP = [
    "NAVIGATION", "↑ ↓ / j k   Move in the focused pane", "Tab / Shift-Tab   Change pane focus", "Enter   Open inspector / activate choice", "Esc   Close dialog, leave detail, or clear search", "Home / End   First / last work item", "Page Up / Down   Move a page, or scroll inspector", "1–9   Switch work view", "]   Load next service page", "[   Return to first service page", "o   Cycle service / priority / title ordering", "", "FIND & INSPECT", "/   Search this loaded service page", "p / Ctrl-K / :   Search commands", "← → in inspector   Overview / Gates / Activity", "F   Pause / resume periodic refresh (resumes at page one)", "r   Refresh from the first service page", "T   Dark / light / monochrome", "", "ACTIONS (confirmation required)", "n   Create task, sprint, or milestone", "c   Claim selected work", "s   Start selected claim", "e   Attach a real receipt JSON object", "f   Finish with a closeout summary", "x   Release claim with a reason", "u   Read back the first unknown operation (no retry)", "", "INPUT & EXIT", "Tab   Next form field; arrows change a choice", "Ctrl-U   Clear the focused input", "Bracketed paste never activates keyboard commands", "q   Quit outside dialogs; Ctrl-C / Ctrl-D exits", "", "DATA BOUNDARIES", "Counts above are service totals; filters/search apply to the loaded page.", "Missing history, dependencies, or capabilities are labelled, never fabricated.", "No automatic replay of an operation whose outcome is unknown.", "Mouse tracking is intentionally off, preserving terminal text selection.",
];
export function currentNotice(view: MountedView, state: DashboardState): string {
    const pending = view.pending_operations.length ? `${view.pending_operations.length} UNKNOWN OPERATION(S) · u read back. ` : "";
    return pending + (view.notice?.kind === "error" ? view.notice.message : state.status || view.notice?.message || "Ready");
}
export function confirmationLines(m: Extract<Modal, {kind: "confirm"}>, width: number): string[] {
    return [`CONFIRM: ${m.action} ${m.workId ?? "new work"}`, m.summary, ...m.details, `Snapshot revision: ${m.revision ?? "unknown"}`, m.attempt ? `Attempt: ${m.attempt}` : "", "This changes shared project state. Nothing is sent until confirmed."].filter(Boolean).flatMap(s => wrapWords(s, width));
}
export function modalDocument(view: MountedView, state: DashboardState, width: number, height: number): { lines: string[]; capacity: number; maximum: number } {
    const m = state.modal, p = dialogViewport(width, height, m?.kind === "confirm" ? 22 : 26).body;
    let lines: string[] = [];
    if (m?.kind === "confirm") lines = confirmationLines(m, p.width);
    if (m?.kind === "help") {
        const l = dashboardLayout(width, height, state.detailOnly, state.density, state.zen);
        lines = [`TERMINAL ${width}×${height} / ${l.mode} / ${l.chrome}`, `Density ${state.density} · Theme ${state.theme} · ${state.zen ? "Focus view" : "Adaptive panes"}`, "", "DISPLAY & RECOVERY", "v  Switch work view (all nine views)", "d  Cycle auto / compact / comfortable density", "z  Toggle a focused, single-pane workspace", "i  Toggle full-view inspector", "!  Read the full status or error", "Ctrl-L  Repaint the terminal", "F1 / ?  Help at every size", "", ...HELP].flatMap(t => wrapWords(t, p.width));
    }
    if (m?.kind === "message") lines = wrapWords(m.text, p.width);
    return { lines, capacity: p.height, maximum: Math.max(0, lines.length - p.height) };
}
function modal(screen: Screen, view: MountedView, state: DashboardState): void {
    const m = state.modal; if (!m) return;
    for (const row of screen.cells) for (const c of row) c.tone = "muted";
    const desired = m.kind === "confirm" ? 22 : m.kind === "search" ? 9 : m.kind === "form" ? 18 : 26;
    const d = dialogViewport(screen.width, screen.height, desired), p = d.body;
    screen.fill(d.rect);
    const title = m.kind === "form" ? ACTION_NAMES[m.action] : m.kind === "confirm" ? "REVIEW ACTION" : m.kind === "palette" ? m.scope === "views" ? "SWITCH VIEW" : "COMMAND PALETTE" : m.kind === "help" ? "KEYBOARD REFERENCE" : m.kind === "message" ? m.title : "SEARCH WORK";
    if (d.boxed) screen.box(d.rect, title, true, state.ascii);
    else if (d.rect.height >= 3) screen.text(p.x, d.titleY, clip(title, p.width), "accent", p.width);
    const foot = (text: string, tone: Tone = "muted") => { if (d.rect.height >= 2) screen.text(p.x, d.footerY, fit(text, p.width), tone, p.width); };
    if (m.kind === "search") {
        screen.text(p.x, p.y, inputDisplay(m.value, m.cursor, p.width, state.ascii), "accent", p.width);
        if (p.height > 2) screen.text(p.x, p.y + 2, clip("Search titles, IDs, parents and owners on this loaded page.", p.width), "muted", p.width);
        foot(adaptiveHint(p.width, "Enter apply · ←→ edit · Ctrl-U clear · Esc cancel", "Enter apply · Esc back", "Enter / Esc"));
    } else if (m.kind === "palette") {
        const commands = paletteCommands(view, state), index = Math.min(m.index, Math.max(0, commands.length - 1));
        const hasInput = p.height >= 2, hasHint = p.height >= 5;
        const capacity = Math.max(1, p.height - (hasInput ? 1 : 0) - (hasHint ? 1 : 0)), start = windowStart(index, commands.length, capacity);
        if (hasInput) screen.text(p.x, p.y, `> ${inputDisplay(m.value, m.cursor, p.width - 2, state.ascii)}`, "accent", p.width);
        commands.slice(start, start + capacity).forEach((c, i) => screen.text(p.x, p.y + (hasInput ? 1 : 0) + i, fit(`${start + i === index ? ">" : " "} ${c.disabled ? "[x] " : ""}${c.label}`, p.width), start + i === index ? "selected" : c.disabled ? "muted" : "text", p.width));
        if (!commands.length) screen.text(p.x, p.y + (hasInput ? 1 : 0), "No matching commands", "muted", p.width);
        if (hasHint && commands[index]) screen.text(p.x, p.y + p.height - 1, clip(commands[index].hint, p.width), commands[index].disabled ? "warn" : "muted", p.width);
        foot(adaptiveHint(p.width, `↑↓ choose · Enter run · Esc close · ${index + 1}/${commands.length}`, "↑↓ Enter · Esc back", "↑↓ Enter Esc"));
    } else if (m.kind === "form") {
        const f = m.fields[m.index], hasLabel = p.height >= 2;
        if (hasLabel) screen.text(p.x, p.y, clip(`${m.index + 1}/${m.fields.length} ${f.label}${f.required ? " *" : ""}`, p.width), "heading", p.width);
        const inputY = p.y + (hasLabel ? 1 : 0), room = Math.max(1, p.height - (hasLabel ? 1 : 0));
        const errorRows = m.error && room >= 2 ? 1 : 0;
        const hints = room >= 4 ? wrapWords(f.hint, p.width).slice(0, 2) : [];
        const inputRows = Math.max(1, room - hints.length - errorRows);
        if (f.choices) {
            const chosen = Math.max(0, f.choices.indexOf(f.value)), start = windowStart(chosen, f.choices.length, inputRows);
            f.choices.slice(start, start + inputRows).forEach((choice, i) => screen.text(p.x, inputY + i, fit(`${start + i === chosen ? ">" : " "} ${choice}`, p.width), start + i === chosen ? "selected" : "text", p.width));
        } else {
            // Keep the caret visible regardless of field length or dialog height.
            screen.text(p.x, inputY, inputDisplay(f.value, f.cursor, p.width, state.ascii), "accent", p.width);
            if (inputRows > 2 && (cellWidth(f.value) > p.width || f.value.includes("\n"))) wrapWords(f.value, p.width).slice(-inputRows + 1).forEach((t, i) => screen.text(p.x, inputY + 1 + i, t, "muted", p.width));
        }
        hints.forEach((t, i) => screen.text(p.x, p.y + p.height - errorRows - hints.length + i, t, "muted", p.width));
        if (m.error && errorRows) screen.text(p.x, p.y + p.height - 1, clip(m.error, p.width), "danger", p.width);
        foot(m.error && !errorRows ? clip(m.error, p.width) : adaptiveHint(p.width, "Enter next / review · Tab field · ←→ edit · Ctrl-U clear · Esc cancel", "Enter next · Tab field · Esc cancel", "Enter Tab Esc"), m.error ? "danger" : "muted");
    } else {
        const doc = modalDocument(view, state, screen.width, screen.height);
        const offset = Math.min(m.offset ?? 0, doc.maximum);
        doc.lines.slice(offset, offset + doc.capacity).forEach((t, i) => screen.text(p.x, p.y + i, t, m.kind === "confirm" && offset + i === 0 ? "accent" : "text", p.width));
        if (m.kind === "confirm") {
            const action = offset < doc.maximum ? "Enter next page" : "Enter confirm";
            foot(m.reviewError ? clip(m.reviewError, p.width) : adaptiveHint(p.width, `${action} · ↑↓ / End scroll · Esc cancel · ${offset + 1}/${doc.lines.length}`, `${action} · Esc cancel`, offset < doc.maximum ? "Enter more / Esc" : "Enter yes / Esc"), offset < doc.maximum ? "warn" : "accent");
        } else foot(adaptiveHint(p.width, `↑↓ / PgUp PgDn scroll · ${offset + 1}-${Math.min(doc.lines.length, offset + doc.capacity)}/${doc.lines.length} · Esc close`, "↑↓ scroll · Esc back", "↑↓ Esc"));
    }
}
/** All viewport sizes render real content. Destructive confirmations need >=4 rows. */
export function renderDashboard(view: MountedView, state: DashboardState, width: number, height: number): Screen {
    ({ width, height } = resolveViewport({ width, height }));
    const screen = new Screen(width, height), l = dashboardLayout(width, height, state.detailOnly, state.density, state.zen);
    heading(screen, view, state, l);
    const detail = inspectorRect(l, state), onlyDetail = state.detailOnly || (state.focus === "inspector" && !l.inspector);
    if (onlyDetail && detail) inspector(screen, detail, view, state, l.chrome);
    else { if (l.rail) rail(screen, l.rail, state); queue(screen, l.queue, view, state, l.chrome); if (detail) inspector(screen, detail, view, state, l.chrome); }
    if (l.footerRows >= 2) {
        const nt: Tone = state.error || view.notice?.kind === "error" ? "danger" : view.pending_operations.length ? "warn" : "muted";
        leftRight(screen, height - 2, currentNotice(view, state), "! full status", nt, "muted", 0, width);
    }
    if (l.footerRows) {
        const keys = state.focus === "inspector" || onlyDetail
            ? adaptiveHint(width, "↑↓ scroll  ←→ tabs  Tab pane  Esc queue  i expand  p commands  ? help  q quit", "↑↓ scroll  ←→ tabs  Esc back  ? help  q quit", "↑↓ ←→ Esc  ?  q")
            : adaptiveHint(width, "↑↓ move  Tab pane  Enter inspect  v views  / search  p commands  d density  z focus  ? help  q quit", "↑↓ move  Enter inspect  v views  / search  p commands  ? help  q quit", "↑↓ Enter  v views  / find  ? help  q quit", "↑↓ Enter v / ? q");
        screen.text(0, height - 1, fit(keys, width), "text", width);
    }
    modal(screen, view, state);
    return screen;
}
