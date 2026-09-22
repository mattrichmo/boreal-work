# R-TUI-DASHBOARD — apps/tui/src/ui/dashboard.ts

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/src/ui/dashboard.ts:L1–L240`  
**File SHA-256:** `c907e2e5c57ec2cc4a5b3e4842775230a5e2095bad54384a61d6a65cccd2b3fe`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Responsive dashboard rendering and identity/navigation density.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,240p' 'apps/tui/src/ui/dashboard.ts'
```

## Exact baseline excerpt

````text
    1 | import type { MountedView, StatusItem } from "../client.js";
    2 | import { clip, fit, wrap, wrapWords, cellWidth } from "./cells.js";
    3 | import { Screen, type Rect, type Tone } from "./screen.js";
    4 | import { inputDisplay } from "./input.js";
    5 | import { resolveViewport, chromeFor, paneViewport, dialogViewport, adaptiveHint, windowStart, type Density, type Chrome } from "./layout.js";
    6 | import { ACTION_NAMES, FILTERS, itemStatus, paletteCommands, visibleItems, type DashboardState, type Modal } from "./model.js";
    7 | const LABELS: Record<string, string> = { in_progress: "In progress", needs_verification: "Verification", awaiting_review: "Awaiting review", expired_review: "Review needed", retry_wait: "Retry wait", corrupt: "Unreadable" };
    8 | const label = (s: string) => LABELS[s] ?? s.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
    9 | const tone = (s: string): Tone => s === "ready" || s === "closed" ? "good" : ["blocked", "expired_review", "cancelled", "corrupt"].includes(s) ? "danger" : ["queued", "needs_verification", "awaiting_review"].includes(s) ? "warn" : "accent";
   10 | export interface DashboardLayout {
   11 |     rail?: Rect; queue: Rect; inspector?: Rect; body: Rect; visibleRows: number;
   12 |     chrome: Chrome; mode: "three-pane" | "split" | "stacked" | "single"; footerRows: number;
   13 | }
   14 | export function dashboardLayout(width: number, height: number, detailOnly = false, density: Density = "auto", zen = false): DashboardLayout {
   15 |     ({ width, height } = resolveViewport({ width, height }));
   16 |     const chrome = chromeFor(width, height, density);
   17 |     const footerRows = height >= 8 ? 2 : height >= 3 ? 1 : 0;
   18 |     const top = chrome === "comfortable" ? 6 : chrome === "standard" ? 4 : height >= 10 ? 2 : height >= 4 ? 1 : 0;
   19 |     const margin = chrome === "comfortable" || chrome === "standard" ? 1 : 0;
   20 |     const body = { x: margin, y: top, width: Math.max(1, width - margin * 2), height: Math.max(1, height - top - footerRows) };
   21 |     const rail = width >= 136 && height >= 26 && chrome !== "compact" && !detailOnly && !zen ? { ...body, width: 21 } : undefined;
   22 |     const x = rail ? rail.x + rail.width + 1 : body.x;
   23 |     let queue: Rect = { ...body, x, width: body.x + body.width - x }, inspector: Rect | undefined;
   24 |     let mode: DashboardLayout["mode"] = "single";
   25 |     if (!detailOnly && !zen && width >= 104 && height >= 10) {
   26 |         const iw = Math.min(58, Math.max(34, Math.floor(queue.width * .38)));
   27 |         inspector = { x: body.x + body.width - iw, y: body.y, width: iw, height: body.height };
   28 |         queue = { ...queue, width: inspector.x - x - 1 };
   29 |         mode = rail ? "three-pane" : "split";
   30 |     } else if (!detailOnly && !zen && width >= 76 && height >= 32 && density !== "compact") {
   31 |         const qh = Math.floor(body.height * .55);
   32 |         queue = { ...queue, height: qh };
   33 |         inspector = { ...body, y: body.y + qh + 1, height: body.height - qh - 1 };
   34 |         mode = "stacked";
   35 |     }
   36 |     return { rail, queue, inspector, body, chrome, mode, footerRows, visibleRows: paneViewport(queue, chrome).height };
   37 | }
   38 | /** When a pane no longer fits, preserve its focus as a full view, not a hidden pane. */
   39 | export function inspectorRect(layout: DashboardLayout, state: DashboardState): Rect | undefined {
   40 |     return state.detailOnly || (state.focus === "inspector" && !layout.inspector) ? layout.body : layout.inspector;
   41 | }
   42 | function leftRight(screen: Screen, y: number, left: string, right: string, leftTone: Tone = "text", rightTone: Tone = "muted", x = 1, width = screen.width - 2): void {
   43 |     const rw = cellWidth(right);
   44 |     if (rw + 8 < width) {
   45 |         screen.text(x, y, clip(left, width - rw - 2), leftTone, width - rw - 2);
   46 |         screen.text(x + width - rw, y, right, rightTone, rw);
   47 |     } else screen.text(x, y, clip(left, width), leftTone, width);
   48 | }
   49 | function health(view: MountedView, state: DashboardState): string {
   50 |     return state.busy ? `BUSY ${state.busy}` : view.notice?.kind === "error" || view.stale_revision ? "STALE / r retry" : state.error ? "ATTENTION" : state.frozen ? "PAUSED" : view.monitoring ? "LIVE" : "CONNECTING";
   51 | }
   52 | function heading(screen: Screen, view: MountedView, state: DashboardState, l: DashboardLayout): void {
   53 |     if (!l.body.y) return;
   54 |     const m = view.monitoring, c = m?.counts;
   55 |     const filter = FILTERS.find(f => f.id === state.filter)?.label ?? "All work";
   56 |     const project = m?.project_name ?? view.route.project_id ?? "Project";
   57 |     const hp = health(view, state), ht: Tone = hp.startsWith("STALE") || state.error ? "danger" : state.frozen ? "warn" : "good";
   58 |     const brand = screen.width < 36 ? `BW / ${filter}` : `BOREAL / WORK  ${l.chrome === "comfortable" ? "" : `/ ${project}`}`;
   59 |     leftRight(screen, 0, brand, hp, "accent", ht);
   60 |     if (l.body.y < 2) return;
   61 |     const scope = `${m?.items.length ?? 0}/${m?.total ?? 0} loaded${m?.has_more ? "  ] more" : ""}`;
   62 |     if (l.chrome === "compact" || l.chrome === "micro") {
   63 |         const summary = screen.width >= 92 ? `${filter}  ·  READY ${c?.ready ?? "-"}  ACTIVE ${c?.in_progress ?? "-"}  BLOCKED ${c?.blocked ?? "-"}` : `${filter} · v views`;
   64 |         leftRight(screen, 1, summary, scope, "muted");
   65 |     } else {
   66 |         leftRight(screen, 1, `${project}  /  ${filter.toUpperCase()}`, `${l.mode} · ${state.density}`, "muted");
   67 |         if (l.chrome === "comfortable") {
   68 |             screen.rule(1, 2, screen.width - 2, state.ascii);
   69 |             const metrics = [`READY ${c?.ready ?? "—"}`, `ACTIVE ${c?.in_progress ?? "—"}`, `BLOCKED ${c?.blocked ?? "—"}`, `REVIEW ${c?.expired_review ?? "—"}`, `CLOSED ${c?.closed ?? "—"}`];
   70 |             const step = Math.floor((screen.width - 4) / metrics.length);
   71 |             metrics.forEach((v, i) => screen.text(2 + i * step, 3, clip(v, step - 1), i === 2 || i === 3 ? "warn" : i === 0 ? "good" : "text", step - 1));
   72 |             leftRight(screen, 4, scope, `revision ${m?.revision ?? "—"} · ${m?.as_of?.slice(11, 19) ?? "not loaded"}`, "muted");
   73 |         } else { leftRight(screen, 2, scope, `revision ${m?.revision ?? "—"}`, "muted"); screen.rule(1, 3, screen.width - 2, state.ascii); }
   74 |     }
   75 | }
   76 | function rail(screen: Screen, r: Rect, state: DashboardState): void {
   77 |     screen.box(r, "WORKSPACE", state.focus === "navigation", state.ascii);
   78 |     const capacity = Math.max(1, r.height - 4), start = windowStart(state.navIndex, FILTERS.length, capacity);
   79 |     FILTERS.slice(start, start + capacity).forEach((f, i) => {
   80 |         const active = f.id === state.filter, focused = state.focus === "navigation" && state.navIndex === start + i;
   81 |         screen.text(r.x + 1, r.y + 2 + i, fit(`${active ? ">" : " "} ${f.key} ${f.label}`, r.width - 2), focused ? "selected" : active ? "accent" : "text", r.width - 2);
   82 |     });
   83 |     if (r.height >= 17) {
   84 |         screen.text(r.x + 2, r.y + r.height - 5, "DISPLAY", "muted", r.width - 4);
   85 |         screen.text(r.x + 2, r.y + r.height - 4, `d ${state.density} density`, "text", r.width - 4);
   86 |         screen.text(r.x + 2, r.y + r.height - 3, "z focus · v views", "muted", r.width - 4);
   87 |     }
   88 | }
   89 | function queue(screen: Screen, r: Rect, view: MountedView, state: DashboardState, chrome: Chrome): void {
   90 |     const items = visibleItems(view, state), index = Math.max(0, items.findIndex(i => i.work_id === state.selectedId));
   91 |     const p = paneViewport(r, chrome), start = windowStart(index, items.length, p.height);
   92 |     const position = `${items.length ? index + 1 : 0}/${items.length}${view.monitoring?.has_more ? " ]" : ""}`;
   93 |     if (p.boxed) {
   94 |         screen.box(r, `WORK QUEUE (${items.length})`, state.focus === "queue", state.ascii);
   95 |         screen.text(r.x + 2, r.y + r.height - 1, clip(` ${position} · ${state.query ? `search: ${state.query}` : `${state.sort} order`} `, r.width - 4), "muted", r.width - 4);
   96 |     } else if (r.height > 1) leftRight(screen, r.y, `WORK QUEUE${state.query ? ` / ${state.query}` : ""}`, position, state.focus === "queue" ? "accent" : "heading", "muted", r.x, r.width);
   97 |     const sw = p.width >= 58 ? 15 : p.width >= 34 ? 11 : p.width >= 22 ? 7 : 0;
   98 |     const iw = p.width >= 78 ? 14 : 0, kw = p.width >= 110 ? 10 : 0;
   99 |     const pw = p.width >= 94 ? 5 : 0, ow = p.width >= 125 ? 14 : 0, gap = sw ? 1 : 0;
  100 |     const tw = Math.max(1, p.width - 2 - sw - iw - kw - pw - ow - gap);
  101 |     if (!p.boxed && r.height > 1 && p.width >= 58) screen.text(p.x, r.y, fit(`WORK QUEUE (${position})`, 2 + tw + gap) + fit("STATE", sw) + fit("ID", iw) + fit("PRI", pw) + fit("KIND", kw) + fit("OWNER", ow), state.focus === "queue" ? "accent" : "heading", p.width);
  102 |     if (p.boxed) screen.text(p.x, r.y + 1, "  " + fit("WORK", tw + gap) + fit("STATE", sw) + fit("ID", iw) + fit("PRI", pw) + fit("KIND", kw) + fit("OWNER", ow), "muted", p.width);
  103 |     if (!items.length) {
  104 |         screen.text(p.x, p.y, clip(state.query ? "No search matches" : "No work in this view", p.width), "heading", p.width);
  105 |         if (p.height > 1) screen.text(p.x, p.y + 1, clip(view.monitoring?.has_more ? "] next page · v views" : "n new work · v views", p.width), "muted", p.width);
  106 |     }
  107 |     items.slice(start, start + p.height).forEach((item, i) => {
  108 |         const selected = item.work_id === state.selectedId, rt: Tone = selected ? "selected" : "text", y = p.y + i;
  109 |         screen.text(p.x, y, fit(`${selected ? "> " : "  "}${clip(item.title ?? item.work_id, tw)}`, p.width), rt, p.width);
  110 |         const stateLabel = sw < 10 ? ({ in_progress: "Active", needs_verification: "Verify", expired_review: "Review", awaiting_review: "Review" }[itemStatus(item)] ?? label(itemStatus(item))) : label(itemStatus(item));
  111 |         let x = p.x + 2 + tw + gap;
  112 |         screen.text(x, y, fit(stateLabel, sw), selected ? "selected" : tone(itemStatus(item)), sw); x += sw;
  113 |         screen.text(x, y, fit(item.work_id, iw), selected ? "selected" : "muted", iw); x += iw;
  114 |         screen.text(x, y, fit(item.priority ?? "—", pw), selected ? "selected" : "muted", pw); x += pw;
  115 |         screen.text(x, y, fit(item.kind ?? "work", kw), selected ? "selected" : "muted", kw); x += kw;
  116 |         screen.text(x, y, fit(item.attempt?.actor_id ?? "—", ow), selected ? "selected" : "muted", ow);
  117 |     });
  118 | }
  119 | interface DetailLine {
  120 |     text: string;
  121 |     tone?: Tone;
  122 | }
  123 | export function detailLines(item: StatusItem | undefined, view: MountedView, tab: number, width: number, compact = false): DetailLine[] {
  124 |     if (!item)
  125 |         return [{ text: "Nothing selected", tone: "heading" }, { text: "Select work in the queue." }];
  126 |     const lines: DetailLine[] = [];
  127 |     const add = (text: string, t: Tone = "text") => { if (!compact || text) wrapWords(text, width).forEach(text => lines.push({ text, tone: t })); };
  128 |     if (tab === 1) {
  129 |         add("ACCEPTANCE GATES", "heading");
  130 |         if (!item.gates)
  131 |             add("Gate details were not supplied by the service.", "muted");
  132 |         else if (!item.gates.open.length && !item.gates.satisfied.length)
  133 |             add("No gates in this snapshot.", "muted");
  134 |         for (const g of item.gates?.open ?? []) {
  135 |             add(`${g.required ? "! REQUIRED" : "· OPTIONAL"}  ${g.gate_id}`, g.required ? "warn" : "muted");
  136 |             add(`${g.kind} · ${g.state}`);
  137 |             if (g.reason)
  138 |                 add(g.reason, "muted");
  139 |             add("");
  140 |         }
  141 |         for (const g of item.gates?.satisfied ?? [])
  142 |             add(`✓ ${g.gate_id} · ${g.state}`, "good");
  143 |         add("");
  144 |         add("EVIDENCE", "heading");
  145 |         add(view.selected_receipt_available ? "Current receipt available for this attempt." : "No current receipt has been resolved.", view.selected_receipt_available ? "good" : "warn");
  146 |         if (item.receipt_id)
  147 |             add(item.receipt_id, "muted");
  148 |     }
  149 |     else if (tab === 2) {
  150 |         add("RECENT ACTIVITY", "heading");
  151 |         if (!item.activity?.length)
  152 |             add("Activity history is not included in this service snapshot.", "muted");
  153 |         for (const e of [...(item.activity ?? [])].reverse()) {
  154 |             add(`${e.occurred_at ?? "Time unavailable"} · ${label(e.kind)}`, "accent");
  155 |             if (e.summary)
  156 |                 add(e.summary);
  157 |             if (e.actor_id)
  158 |                 add(e.actor_id, "muted");
  159 |             add("");
  160 |         }
  161 |     }
  162 |     else {
  163 |         add(item.title ?? item.work_id, "heading");
  164 |         add(item.work_id, "muted");
  165 |         add("");
  166 |         add(`${label(itemStatus(item))} · ${item.kind ?? "work"}`, tone(itemStatus(item)));
  167 |         if (compact) add(`Next: ${item.next_action ? label(item.next_action) : "No next action supplied."}`, "accent");
  168 |         if (item.priority !== undefined)
  169 |             add(`Priority  ${item.priority}`);
  170 |         if (item.parent_id)
  171 |             add(`Parent    ${item.parent_id}`, "muted");
  172 |         if (item.due_at)
  173 |             add(`Due       ${item.due_at}`, "warn");
  174 |         add("");
  175 |         if (!compact) { add("NEXT ACTION", "heading");
  176 |             add(item.next_action ? label(item.next_action) : "No next action supplied.", "accent"); }
  177 |         if (item.primary_reason)
  178 |             add(`Primary: ${label(item.primary_reason)}`, "warn");
  179 |         const secondaryReasons = item.primary_reason ? item.reason_codes.slice(1) : item.reason_codes;
  180 |         if (secondaryReasons.length)
  181 |             add(secondaryReasons.map(label).join(" · "), "warn");
  182 |         if (item.diagnostic) {
  183 |             add("");
  184 |             add("RECORD INTEGRITY", "heading");
  185 |             add("Unreadable record · no actions are available.", "danger");
  186 |             add(item.diagnostic.code, "danger");
  187 |             add(item.diagnostic.detail, "muted");
  188 |         }
  189 |         if (item.description) {
  190 |             add("");
  191 |             add("DESCRIPTION", "heading");
  192 |             add(item.description);
  193 |         }
  194 |         if (item.attempt) {
  195 |             add("");
  196 |             add("OWNERSHIP", "heading");
  197 |             add(item.attempt.actor_id ?? "Owner not supplied");
  198 |             add(`Phase  ${label(item.attempt.phase ?? "unknown")}`, "muted");
  199 |             if (item.attempt.lease_deadline)
  200 |                 add(`Lease  ${item.attempt.lease_deadline}`, "muted");
  201 |         }
  202 |         add("");
  203 |         add("DEPENDENCIES", "heading");
  204 |         if (!item.dependencies)
  205 |             add("Not included in this snapshot.", "muted");
  206 |         else if (!item.dependencies.length)
  207 |             add("No dependencies in this snapshot.", "muted");
  208 |         else
  209 |             item.dependencies.forEach(d => add(`${d.satisfied ? "✓" : "·"} ${d.work_id} · ${label(d.status ?? "unknown")}`, d.satisfied ? "good" : "warn"));
  210 |         add("");
  211 |         add("AVAILABLE ACTIONS", "heading");
  212 |         for (const a of view.actions.filter(a => !["create_work", "create_project"].includes(a.action))) {
  213 |             add(`${a.enabled ? "→" : "·"} ${ACTION_NAMES[a.action]}`, a.enabled ? "accent" : "muted");
  214 |             if (!a.enabled && a.reason)
  215 |                 add(`  ${a.reason}`, "muted");
  216 |         }
  217 |     }
  218 |     return lines;
  219 | }
  220 | function inspector(screen: Screen, r: Rect, view: MountedView, state: DashboardState, chrome: Chrome): void {
  221 |     const p = paneViewport(r, chrome), item = visibleItems(view, state).find(i => i.work_id === state.selectedId);
  222 |     const tabs = ["Overview", "Gates", "Activity"], current = tabs[state.inspectorTab];
  223 |     const lines = detailLines(item, view, state.inspectorTab, p.width, chrome === "compact" || chrome === "micro");
  224 |     const offset = Math.min(state.inspectorOffset, Math.max(0, lines.length - p.height));
  225 |     if (p.boxed) {
  226 |         screen.box(r, "INSPECTOR", state.focus === "inspector", state.ascii);
  227 |         screen.text(p.x, r.y + 1, clip(tabs.map((t, i) => i === state.inspectorTab ? `[${t}]` : t).join(" "), p.width), "accent", p.width);
  228 |         screen.text(p.x, r.y + r.height - 1, clip(` ${offset + 1}-${Math.min(lines.length, offset + p.height)}/${lines.length} · ←→ tabs · Esc back `, p.width), "muted", p.width);
  229 |     } else if (r.height > 1) leftRight(screen, r.y, `INSPECTOR / ${current}`, `${offset + 1}/${lines.length}`, state.focus === "inspector" ? "accent" : "heading", "muted", r.x, r.width);
  230 |     lines.slice(offset, offset + p.height).forEach((line, i) => screen.text(p.x, p.y + i, line.text, line.tone ?? "text", p.width));
  231 | }
  232 | export const HELP = [
  233 |     "NAVIGATION", "↑ ↓ / j k   Move in the focused pane", "Tab / Shift-Tab   Change pane focus", "Enter   Open inspector / activate choice", "Esc   Close dialog, leave detail, or clear search", "Home / End   First / last work item", "Page Up / Down   Move a page, or scroll inspector", "1–9   Switch work view", "]   Load next service page", "[   Return to first service page", "o   Cycle service / priority / title ordering", "", "FIND & INSPECT", "/   Search this loaded service page", "p / Ctrl-K / :   Search commands", "← → in inspector   Overview / Gates / Activity", "F   Pause / resume periodic refresh (resumes at page one)", "r   Refresh from the first service page", "T   Dark / light / monochrome", "", "ACTIONS (confirmation required)", "n   Create task, sprint, or milestone", "c   Claim selected work", "s   Start selected claim", "e   Attach a real receipt JSON object", "f   Finish with a closeout summary", "x   Release claim with a reason", "u   Read back the first unknown operation (no retry)", "", "INPUT & EXIT", "Tab   Next form field; arrows change a choice", "Ctrl-U   Clear the focused input", "Bracketed paste never activates keyboard commands", "q   Quit outside dialogs; Ctrl-C / Ctrl-D exits", "", "DATA BOUNDARIES", "Counts above are service totals; filters/search apply to the loaded page.", "Missing history, dependencies, or capabilities are labelled, never fabricated.", "No automatic replay of an operation whose outcome is unknown.", "Mouse tracking is intentionally off, preserving terminal text selection.",
  234 | ];
  235 | export function currentNotice(view: MountedView, state: DashboardState): string {
  236 |     const pending = view.pending_operations.length ? `${view.pending_operations.length} UNKNOWN OPERATION(S) · u read back. ` : "";
  237 |     return pending + (view.notice?.kind === "error" ? view.notice.message : state.status || view.notice?.message || "Ready");
  238 | }
  239 | export function confirmationLines(m: Extract<Modal, {kind: "confirm"}>, width: number): string[] {
  240 |     return [`CONFIRM: ${m.action} ${m.workId ?? "new work"}`, m.summary, ...m.details, `Snapshot revision: ${m.revision ?? "unknown"}`, m.attempt ? `Attempt: ${m.attempt}` : "", "This changes shared project state. Nothing is sent until confirmed."].filter(Boolean).flatMap(s => wrapWords(s, width));
````
