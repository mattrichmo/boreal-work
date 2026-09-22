# R-TUI-CONTROLLER — apps/tui/src/full-screen.ts

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/src/full-screen.ts:L1–L300`  
**File SHA-256:** `f953a0b9a8f9efe02bb05c86e55ecb362b668a4497b656069599e4e3e2a7ebf0`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Mounted controller, input state, stale revisions, confirmations and request cancellation.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,300p' 'apps/tui/src/full-screen.ts'
```

## Exact baseline excerpt

````text
    1 | import type { ActionResult, CreateWorkDraftInput, MountedView, TuiAction } from "./client.js";
    2 | import type { LineShellController } from "./line-shell.js";
    3 | import { safeText } from "./ui/cells.js";
    4 | import { FrameWriter, type Theme } from "./ui/screen.js";
    5 | import { renderDashboard, dashboardLayout, detailLines, inspectorRect, modalDocument, currentNotice } from "./ui/dashboard.js";
    6 | import { initialState, reconcileSelection, visibleItems, FILTERS, ACTION_NAMES, actionForm, paletteCommands, type Modal, type DashboardState } from "./ui/model.js";
    7 | import { paneViewport, cycleDensity, type Density } from "./ui/layout.js";
    8 | import { editInput } from "./ui/input.js";
    9 | import { StreamingKeyDecoder } from "./ui/keys.js";
   10 | export { StreamingKeyDecoder, decodeKeys } from "./ui/keys.js";
   11 | export type TerminalSignal = "SIGINT" | "SIGTERM" | "SIGHUP";
   12 | export interface FullScreenTerminal {
   13 |     readonly is_tty: boolean;
   14 |     dimensions(): {
   15 |         width: number;
   16 |         height: number;
   17 |     };
   18 |     write(value: string): void;
   19 |     setRawMode?(enabled: boolean): void;
   20 |     /** Previous raw state, when this terminal is embedded by another caller. */
   21 |     readonly was_raw?: boolean;
   22 |     resume?(): void;
   23 |     pause?(): void;
   24 |     onData(listener: (value: string | Uint8Array) => void): () => void;
   25 |     onResize(listener: () => void): () => void;
   26 |     onSignal(signal: TerminalSignal, listener: () => void): () => void;
   27 |     onEnd?(listener: () => void): () => void;
   28 | }
   29 | export interface FullScreenOptions {
   30 |     readonly auto_refresh_ms?: number;
   31 |     readonly shutdown_drain_ms?: number;
   32 |     readonly theme?: Theme;
   33 |     readonly ascii?: boolean;
   34 |     readonly density?: Density;
   35 | }
   36 | type Confirm = Extract<Modal, {
   37 |     kind: "confirm";
   38 | }>;
   39 | type ExtendedController = LineShellController & {
   40 |     readback?: (operation_id: string) => Promise<unknown>;
   41 | };
   42 | function attemptIdentity(view: MountedView, id?: string): string | null {
   43 |     const a = view.monitoring?.items.find(i => i.work_id === id)?.attempt;
   44 |     return a ? `${a.attempt_id}@${a.fence}` : null;
   45 | }
   46 | function resultMessage(action: TuiAction, result: ActionResult<unknown>): string {
   47 |     if (result.ok)
   48 |         return `${ACTION_NAMES[action]}: ${result.envelope.outcome} · revision ${result.envelope.revision ?? "unknown"}`;
   49 |     return `${ACTION_NAMES[action]}: ${result.error.message} · ${result.error.code}${result.envelope.outcome === "unknown" ? ` · outcome unknown; u reads operation ${result.envelope.operation_id} before any retry` : ""}`;
   50 | }
   51 | /** Human interaction only. All durable writes stay behind MountedWorkflowController. */
   52 | export async function runFullScreen(controller: ExtendedController, terminal: FullScreenTerminal, options: FullScreenOptions = {}): Promise<void> {
   53 |     if (!terminal.is_tty)
   54 |         throw new Error("full-screen mode requires an interactive TTY");
   55 |     const state = initialState(controller.view(), options.theme ?? "dark", options.ascii ?? false);
   56 |     state.density = options.density ?? "auto";
   57 |     const writer = new FrameWriter(value => terminal.write(value));
   58 |     const decoder = new StreamingKeyDecoder();
   59 |     let accepting = true, closed = false, shutdownTimedOut = false;
   60 |     let work = Promise.resolve(), active: {
   61 |         label: string;
   62 |         mutation: boolean;
   63 |     } | null = null;
   64 |     let refreshQueued = false, refreshDirty = false, mutationQueued = false;
   65 |     // The existing service coordinator refreshes page zero. Keep later pages stable.
   66 |     let browsingLaterPage = (controller.view().monitoring?.offset ?? 0) > 0;
   67 |     if (browsingLaterPage) {
   68 |         state.frozen = true;
   69 |         state.status = "Selected work is on a later page; polling paused. r / F returns to page one.";
   70 |     }
   71 |     let escapeTimer: ReturnType<typeof setTimeout> | undefined;
   72 |     let refreshTimer: ReturnType<typeof setInterval> | undefined;
   73 |     let finish!: () => void;
   74 |     const finished = new Promise<void>(resolve => { finish = resolve; });
   75 |     let shutdown: Promise<void> | null = null, shutdownReport: string | null = null;
   76 |     const disposers: Array<() => void> = [];
   77 |     const syncSelection = (): void => {
   78 |         const selected = reconcileSelection(controller.view(), state);
   79 |         const current = controller.view().route;
   80 |         if (current.work_id !== selected?.work_id)
   81 |             controller.navigate({ kind: selected ? "work" : "monitoring", project_id: current.project_id, work_id: selected?.work_id });
   82 |     };
   83 |     const redraw = (): void => {
   84 |         if (closed || !accepting)
   85 |             return;
   86 |         syncSelection();
   87 |         const { width, height } = terminal.dimensions();
   88 |         const l = dashboardLayout(width, height, state.detailOnly, state.density, state.zen);
   89 |         if (!l.rail && state.focus === "navigation") state.focus = "queue";
   90 |         writer.paint(renderDashboard(controller.view(), state, width, height), state.theme);
   91 |     };
   92 |     const message = (text: string, error = false): void => { state.status = safeText(text); state.error = error; };
   93 |     const enqueue = (label: string, run: () => Promise<void>, mutation = false): void => {
   94 |         if (!accepting)
   95 |             return;
   96 |         work = work.then(async () => {
   97 |             // Never dispatch a queued mutation after the operator has exited.
   98 |             if (shutdownTimedOut || (!accepting && !active))
   99 |                 return;
  100 |             active = { label, mutation };
  101 |             state.busy = label;
  102 |             redraw();
  103 |             try {
  104 |                 await run();
  105 |             }
  106 |             catch (error) {
  107 |                 message(error instanceof Error ? error.message : String(error), true);
  108 |             }
  109 |             finally {
  110 |                 active = null;
  111 |                 state.busy = null;
  112 |             }
  113 |         }).then(redraw);
  114 |     };
  115 |     const refresh = (manual = false): void => {
  116 |         if (!accepting || (!manual && (state.frozen || state.modal !== null || browsingLaterPage)))
  117 |             return;
  118 |         if (manual)
  119 |             browsingLaterPage = false;
  120 |         if (refreshQueued) {
  121 |             refreshDirty = true;
  122 |             return;
  123 |         }
  124 |         refreshQueued = true;
  125 |         enqueue("Refreshing", async () => {
  126 |             try {
  127 |                 await controller.refresh();
  128 |                 const notice = controller.view().notice;
  129 |                 message(notice?.message ?? "First-page snapshot refreshed.", notice?.kind === "error");
  130 |             }
  131 |             finally {
  132 |                 refreshQueued = false;
  133 |                 if (refreshDirty && accepting) {
  134 |                     refreshDirty = false;
  135 |                     refresh();
  136 |                 }
  137 |             }
  138 |         });
  139 |     };
  140 |     const move = (delta: number): void => {
  141 |         if (state.focus === "navigation")
  142 |             state.navIndex = Math.max(0, Math.min(FILTERS.length - 1, state.navIndex + delta));
  143 |         else if (state.focus === "inspector" || state.detailOnly) {
  144 |             const size = terminal.dimensions(), layout = dashboardLayout(size.width, size.height, state.detailOnly, state.density, state.zen);
  145 |             const rect = inspectorRect(layout, state);
  146 |             if (rect) {
  147 |                 const selected = visibleItems(controller.view(), state).find(i => i.work_id === state.selectedId);
  148 |                 const pane = paneViewport(rect, layout.chrome);
  149 |                 const maximum = Math.max(0, detailLines(selected, controller.view(), state.inspectorTab, pane.width, layout.chrome === "compact" || layout.chrome === "micro").length - pane.height);
  150 |                 state.inspectorOffset = Math.max(0, Math.min(maximum, state.inspectorOffset + delta));
  151 |             }
  152 |         }
  153 |         else {
  154 |             const rows = visibleItems(controller.view(), state), current = Math.max(0, rows.findIndex(i => i.work_id === state.selectedId));
  155 |             state.selectedId = rows[Math.max(0, Math.min(rows.length - 1, current + delta))]?.work_id;
  156 |             state.inspectorOffset = 0;
  157 |         }
  158 |     };
  159 |     const setFilter = (id: DashboardState["filter"]): void => {
  160 |         state.filter = id;
  161 |         state.navIndex = FILTERS.findIndex(f => f.id === id);
  162 |         state.inspectorOffset = 0;
  163 |         state.detailOnly = false;
  164 |         state.focus = "queue";
  165 |         message(`View: ${id.toUpperCase()}`);
  166 |         syncSelection();
  167 |     };
  168 |     const confirm = (action: TuiAction, payload: unknown, summary: string, details: string[] = [], id = state.selectedId): void => {
  169 |         const view = controller.view();
  170 |         state.modal = { kind: "confirm", action, workId: action === "create_work" ? undefined : id, payload, summary, details,
  171 |             revision: view.monitoring?.revision ?? null, attempt: attemptIdentity(view, id), offset: 0 };
  172 |     };
  173 |     const stage = (action: TuiAction): void => {
  174 |         if (state.busy || mutationQueued) {
  175 |             message("Wait for the current request to finish before starting another action.", true);
  176 |             return;
  177 |         }
  178 |         syncSelection();
  179 |         const view = controller.view(), rule = view.actions.find(a => a.action === action);
  180 |         if (!rule?.enabled) {
  181 |             message(`${ACTION_NAMES[action]} unavailable: ${rule?.reason ?? "select work first"}`, true);
  182 |             return;
  183 |         }
  184 |         if (action === "create_project") {
  185 |             message("Use bwrk init for project initialization.");
  186 |             return;
  187 |         }
  188 |         if (["create_work", "evidence", "finish", "release"].includes(action)) {
  189 |             state.modal = actionForm(action as "create_work" | "evidence" | "finish" | "release", state.selectedId);
  190 |             return;
  191 |         }
  192 |         confirm(action, {}, action === "claim" ? "Claim this work for the current operator session." : "Accept this claim and begin work.");
  193 |     };
  194 |     const submitForm = (form: Extract<Modal, {
  195 |         kind: "form";
  196 |     }>): void => {
  197 |         const values = Object.fromEntries(form.fields.map(f => [f.name, f.value.trim()]));
  198 |         const missing = form.fields.findIndex(f => f.required && !f.value.trim());
  199 |         if (missing >= 0) {
  200 |             form.index = missing;
  201 |             form.error = `${form.fields[missing].label} is required.`;
  202 |             return;
  203 |         }
  204 |         if (form.action === "create_work") {
  205 |             const priority = Number(values.priority || "0");
  206 |             if (!Number.isInteger(priority) || priority < 0 || priority > 255) {
  207 |                 form.index = 4;
  208 |                 form.error = "Priority must be an integer from 0 to 255.";
  209 |                 return;
  210 |             }
  211 |             if (!/^[^\s\u0000-\u001f\u007f]+$/u.test(values.work_id)) {
  212 |                 form.index = 0;
  213 |                 form.error = "Identifier cannot contain whitespace or control characters.";
  214 |                 return;
  215 |             }
  216 |             const input: CreateWorkDraftInput = { work_id: values.work_id, kind: values.kind as CreateWorkDraftInput["kind"], title: values.title,
  217 |                 parent_id: values.parent_id || null, priority, ...(values.description ? { description: values.description } : {}) };
  218 |             confirm("create_work", input, `Create ${input.kind}: ${input.title}`, [`Identifier: ${input.work_id}`, `Parent: ${input.parent_id ?? "none"}`, `Priority: ${priority}`]);
  219 |         }
  220 |         else if (form.action === "evidence") {
  221 |             try {
  222 |                 const receipt: unknown = JSON.parse(values.receipt);
  223 |                 if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt))
  224 |                     throw new Error("Receipt must be a JSON object.");
  225 |                 confirm("evidence", receipt, "Attach this receipt to the current attempt.", ["The service validates receipt contents and provenance."], form.workId);
  226 |             }
  227 |             catch (error) {
  228 |                 form.error = error instanceof Error ? error.message : "Invalid receipt JSON.";
  229 |             }
  230 |         }
  231 |         else if (form.action === "finish")
  232 |             confirm("finish", values.summary, values.summary, ["Requests proof-gated finish and close."], form.workId);
  233 |         else
  234 |             confirm("release", values.reason, values.reason, ["Releases the current attempt."], form.workId);
  235 |     };
  236 |     const execute = async (pending: Confirm): Promise<void> => {
  237 |         const view = controller.view();
  238 |         if ((view.monitoring?.revision ?? null) !== pending.revision || (pending.workId && attemptIdentity(view, pending.workId) !== pending.attempt)) {
  239 |             message("The snapshot or attempt changed. Review the latest work and confirm again.", true);
  240 |             return;
  241 |         }
  242 |         if (pending.workId) {
  243 |             controller.navigate({ kind: "work", project_id: view.route.project_id, work_id: pending.workId });
  244 |             state.selectedId = pending.workId;
  245 |         }
  246 |         const rule = controller.view().actions.find(a => a.action === pending.action);
  247 |         if (!rule?.enabled) {
  248 |             message(rule?.reason ?? "The action is no longer available.", true);
  249 |             return;
  250 |         }
  251 |         let result: ActionResult<unknown>;
  252 |         switch (pending.action) {
  253 |             case "create_work":
  254 |                 result = await controller.createWork(pending.payload as CreateWorkDraftInput);
  255 |                 break;
  256 |             case "claim":
  257 |                 result = await controller.claim(pending.workId!);
  258 |                 break;
  259 |             case "accept_start":
  260 |                 result = await controller.acceptStart(pending.workId!);
  261 |                 break;
  262 |             case "evidence":
  263 |                 result = await controller.addEvidence(pending.workId!, pending.payload);
  264 |                 break;
  265 |             case "finish":
  266 |                 result = await controller.finish(pending.workId!, pending.payload as string);
  267 |                 break;
  268 |             case "release":
  269 |                 result = await controller.release(pending.workId!, pending.payload as string);
  270 |                 break;
  271 |             default: throw new Error("Unsupported interactive action");
  272 |         }
  273 |         message(resultMessage(pending.action, result), !result.ok);
  274 |     };
  275 |     const readback = (): void => {
  276 |         const operation = controller.view().pending_operations[0];
  277 |         if (!operation) {
  278 |             message("There are no unresolved operations.");
  279 |             return;
  280 |         }
  281 |         if (!controller.readback) {
  282 |             message("Operation readback is not available from this controller.", true);
  283 |             return;
  284 |         }
  285 |         enqueue("Reading operation", async () => {
  286 |             await controller.readback!(operation.operation_id);
  287 |             const remains = controller.view().pending_operations.some(p => p.operation_id === operation.operation_id);
  288 |             message(remains ? `Operation ${operation.operation_id} remains unresolved. No retry was sent.` : `Operation ${operation.operation_id} resolved. No retry was sent.`, remains);
  289 |             if (!remains)
  290 |                 await controller.refresh();
  291 |         });
  292 |     };
  293 |     const stop = (): void => {
  294 |         if (shutdown)
  295 |             return;
  296 |         accepting = false;
  297 |         state.modal = null;
  298 |         if (refreshTimer)
  299 |             clearInterval(refreshTimer);
  300 |         if (escapeTimer)
````
