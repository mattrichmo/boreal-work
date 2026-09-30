import type { GlobalController, Route } from "./model.js";
import { render, ROUTE_MENU } from "./view.js";
import { StreamingKeyDecoder } from "./terminal/keys.js";
import { form, moveField, editField, cycleChoice, validateForm, renderForm, parseLabels, type FormField, type FormState } from "./forms.js";
import type { Association, GlobalActivityEvent, Item, LinkedProject, Note, Project, Status } from "./client.js";
import { wrapWords } from "./terminal/cells.js";
import { FrameWriter, Screen, type Theme } from "./terminal/screen.js";

export interface KeyTerminal {
  isTty: boolean;
  dimensions?(): { width: number; height: number };
  write(value: string): void;
  onData(listener: (data: string | Uint8Array) => void): () => void;
  onResize?(listener: () => void): () => void;
  setRawMode(enabled: boolean): void;
  onSignal?(signal: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void): () => void;
  openLinkedWorkspace?(path: string): Promise<void>;
  theme?: Theme;
}
type Modal = { kind: "help"; offset: number } | { kind: "palette"; query: string; index: number } | { kind: "form"; state: FormState; save: (values: Record<string, string | number | null>) => Promise<void> } | { kind: "reader"; title: string; body: string; offset: number; linkedAssociation?: Association } | { kind: "history"; events: GlobalActivityEvent[]; offset: number; total: number; hasMore: boolean; nextOffset: number | null; pageSize: number; scroll: number; loading: boolean; error?: string } | { kind: "picker"; title: string; options: Array<{ label: string; value: string }>; query: string; index: number; choose: (value: string) => void; cancel?: () => void };
const ROUTES: Route[] = ROUTE_MENU.map(([route]) => route);
const NAV_ROUTES: Route[] = ROUTES;
const ROUTE_KEYS: Record<string, Route> = { "1": "overview", "2": "projects", "3": "board", "4": "list", "5": "todos", "6": "notes", "7": "workflow", "8": "links" };
const routeNames = ROUTE_MENU.map(([, label]) => label);
function rowId(row: unknown): string | undefined { const r = row as { id?: string; status_id?: string }; return r?.id ?? r?.status_id; }
function selectedItem(c: GlobalController): Item | undefined { return c.route === "board" ? c.boardSelected : c.selectedItem; }
function selectedProject(c: GlobalController): Project | undefined { return c.route === "projects" ? c.selectedProject : undefined; }
function selectedNote(c: GlobalController): Note | undefined { return c.route === "notes" ? c.selectedRow() as Note : undefined; }
function selectedStatus(c: GlobalController): Status | undefined { return c.route === "workflow" ? c.selectedRow() as Status : undefined; }
function selectedAssociation(c: GlobalController): Association | undefined { return c.route === "links" ? c.selectedRow() as Association : undefined; }
function linkedSample(c: GlobalController, a: Association): LinkedProject | undefined { return c.snapshot?.linked_projects?.find(x => x.management_project_id === a.project_id && x.project_id === a.identity); }
function linkedReaderBody(sample: LinkedProject): string {
  const items = sample.items ?? [], total = sample.items_total ?? items.length;
  return [`${sample.availability} · ${sample.path ?? "path unavailable"} · source revision ${sample.revision ?? "—"} · ${humanDate(sample.as_of)}`, `Counts: ${JSON.stringify(sample.counts ?? {})}`, `Showing ${items.length} of ${total} linked work items${sample.items_has_more ? " · PgDn/Enter loads next page" : " · all available items shown"}`, ...items.map(i => `${i.display_status} · ${i.kind} · ${i.title}${i.reason_codes.length ? ` · ${i.reason_codes.join(", ")}` : ""}`), ...(sample.error ? [`Unavailable: ${sample.error}`] : [])].join("\n");
}

export async function runInteractive(controller: GlobalController, terminal: KeyTerminal): Promise<void> {
  let initialError="";
  try { await controller.refresh(); } catch(error) { initialError=`Global manager unavailable · ${String(error)} · retry with r`; }
  if (!terminal.isTty) { terminal.write(render(controller)); return; }
  const decoder = new StreamingKeyDecoder();
  const previous = "\u001b[?25h\u001b[?2004l\u001b[?1049l";
  let alive = true, busy = false, suspended = false, modal: Modal | undefined, notice = initialError;
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  let alternateScreen = false;
  const frameWriter = new FrameWriter(value => terminal.write(value));
  const size = () => terminal.dimensions?.() ?? { width: 100, height: 40 };
  const draw = (): void => {
    if (!alive || suspended) return;
    const { width, height } = size();
    let body = render(controller, width, Math.max(8, height - 2)).split("\n");
    if (modal) {
      if (modal.kind === "help") { const lines = ["Global manager help", ...helpLines(controller).flatMap(line => wrapWords(line, Math.max(1, width - 2))), "", "↑↓/PgUp/PgDn scroll · Esc or ? closes help"]; body = lines.slice(modal.offset, modal.offset + Math.max(1, height - 2)); }
      else if (modal.kind === "form") body = renderForm(modal.state, width, Math.max(1, height - 3));
      else if (modal.kind === "reader") { const sample = modal.linkedAssociation && linkedSample(controller, modal.linkedAssociation); const text = sample ? linkedReaderBody(sample) : modal.body; const wrapped = text.split("\n").flatMap(line => wrapWords(line, Math.max(1, width - 2))); const more = !!sample?.items_has_more; body = [modal.title, sample ? `↑↓ scroll · ${more ? "PgDn/Enter next page" : "all pages loaded"} · Esc close` : "↑↓/PgUp/PgDn scroll · Esc close", "─".repeat(Math.max(1, width)), ...wrapped.slice(modal.offset, modal.offset + Math.max(1, height - 5))]; }
      else if (modal.kind === "history") {
        const first = modal.events.length ? modal.offset + 1 : 0, last = modal.offset + modal.events.length;
        const content = modal.loading ? ["Loading history…"] : modal.events.flatMap(e => wrapWords(`r${e.revision} · ${humanDate(e.created_at)} · ${e.title ?? e.entity_kind ?? "Activity"} · ${e.summary}`, Math.max(1, width - 2)));
        const pageHeight = Math.max(1, height - 7), status = modal.error ?? `Page ${Math.floor(modal.offset / modal.pageSize) + 1} · ${modal.hasMore ? "more older events" : "latest page"}`;
        body = [`Activity history · ${first}–${last} of ${modal.total}`, "↑↓ scroll · ←/PgUp newer · →/PgDn older · Esc close", "─".repeat(Math.max(1, width)), ...content.slice(modal.scroll, modal.scroll + pageHeight), status];
      }
      else if (modal.kind === "picker" || modal.kind === "palette") {
        const options = modal.kind === "palette" ? paletteEntries().map(x => ({ label: x.label, value: x.label })) : modal.options;
        const query = modal.query.toLocaleLowerCase();
        const matches = options.filter(x => x.label.toLocaleLowerCase().includes(query));
        if (modal.kind === "palette" || modal.kind === "picker") modal.index = Math.max(0, Math.min(modal.index, matches.length - 1));
        const index = modal.index;
        const page = Math.max(1, height - 6), start = Math.max(0, Math.min(matches.length - page, index - Math.floor(page / 2)));
        body = [modal.kind === "palette" ? "Command palette" : modal.title, "Type to search · ↑↓ select · Enter open · Esc close", `> ${modal.query}`, "─".repeat(Math.max(1, width)), ...(matches.length ? matches.slice(start, start + page).map((x, i) => `${start + i === index ? "›" : " "} ${x.label}`) : [options.length ? "No matches. Clear the query or press Esc." : "No choices available. Return and choose another destination or create a status."])];
      }
    }
    const status = controller.refreshing ? "Refreshing…" : controller.lastRefreshError ? `Stale · ${controller.lastRefreshError}` : controller.sampledAt ? `Updated ${new Date(controller.sampledAt).toLocaleTimeString()} · rev ${controller.snapshot?.revision ?? "?"}` : `rev ${controller.snapshot?.revision ?? "?"}`;
    const footer = controller.unresolvedOperation ? `Unknown write ${controller.unresolvedOperation} · r reads receipt before more writes` : busy ? (controller.detailLoading ? "Loading record detail…" : controller.pageLoading ? "Loading linked page…" : "Saving…") : notice || contextualHint(controller);
    const screen = new Screen(width, height);
    const lines = [...body.slice(0, Math.max(1, height - 2)), status, footer];
    lines.slice(0, height).forEach((line, row) => {
      const tone = row === 0 ? "heading" : row === 1 || row === 2 ? "muted" : line.includes("WRITE FROZEN") || line.startsWith("Unknown write") || line.startsWith("Error:") ? "danger" : row >= height - 2 ? "accent" : line.includes("›") || line.includes("▸") ? "selected" : "text";
      screen.text(0, row, line, tone, width);
    });
    if (!alternateScreen) {
      terminal.write("\u001b[?1049h\u001b[?2004h\u001b[?25l\u001b[2J");
      alternateScreen = true; frameWriter.invalidate();
    }
    frameWriter.paint(screen, terminal.theme ?? "dark");
  };
  const cleanup = (): void => {
    if (!alive) return;
    alive = false;
    if (escapeTimer) clearTimeout(escapeTimer);
    unsub(); resizeOff(); signals.forEach(off => off());
    if (poll) clearInterval(poll);
    terminal.setRawMode(false); terminal.write(previous); alternateScreen = false;
    finish?.();
  };
  let finish: (() => void) | undefined;
  let unsub = (): void => {}, resizeOff = (): void => {};
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"].map(sig => terminal.onSignal?.(sig as "SIGINT" | "SIGTERM" | "SIGHUP", cleanup)).filter((x): x is () => void => !!x);
  const poll = setInterval(() => { if (!alive || modal || busy) return; void controller.refresh().then(draw).catch(e => { notice = `Refresh failed: ${String(e)}`; draw(); }); }, 5000);
  (poll as unknown as { unref?: () => void }).unref?.();
  const writeMutation = async (command: string, payload: Record<string, unknown>): Promise<void> => {
    if (controller.unresolvedOperation) throw new Error("Resolve the uncertain write with r before making another change");
    if(!controller.snapshot)throw new Error("The global manager has no current snapshot; press r to connect before writing.");
    busy = true; draw();
    try {
      await controller.mutate(command, payload);
      notice = controller.lastMutationRefreshFailed ? "Saved; refresh failed · press r to retry read" : "Saved";
    }
    finally { busy = false; draw(); }
  };
  const launchWrite = (command: string, payload: Record<string, unknown>): void => { void writeMutation(command, payload).catch(error => { notice = `Action failed: ${String(error)}`; draw(); }); };
  const formModal = (state: FormState, save: (values: Record<string, string | number | null>) => Promise<void>): void => { modal = { kind: "form", state, save }; draw(); };
  const inputForm = (title: string, fields: Parameters<typeof form>[1], save: (v: Record<string, string | number | null>) => Promise<void>): void => formModal(form(title, fields), save);
  const picker = (title: string, options: Array<{ label: string; value: string }>, choose: (value: string) => void, cancel?: () => void): void => { modal = { kind: "picker", title, options, query: "", index: 0, choose, cancel }; draw(); };
  const cacheLinkedSample = (association: Association, response: LinkedProject): void => {
    if (!controller.snapshot) return;
    const samples = controller.snapshot.linked_projects ?? (controller.snapshot.linked_projects = []);
    const sample = { ...response, management_project_id: association.project_id, project_id: association.identity };
    const index = samples.findIndex(x => x.management_project_id === association.project_id && x.project_id === association.identity);
    if (index < 0) samples.push(sample); else samples[index] = { ...samples[index], ...sample };
  };
  const openLinkedReader = (association: Association): void => {
    void controller.client.linkedShow(association.project_id, association.identity).then(response => {
      cacheLinkedSample(association, response);
      const sample = linkedSample(controller, association);
      modal = { kind: "reader", title: association.identity, body: sample ? linkedReaderBody(sample) : "Linked detail unavailable.", offset: 0, linkedAssociation: association };
      draw();
    }).catch(e => { notice = `Linked progress unavailable: ${String(e)}`; draw(); });
  };
  const chooseProject = (callback: (id: string) => void): void => picker("Choose project", [{ label: "All projects", value: "" }, ...controller.projects.map(p => ({ label: p.name, value: p.id }))], callback);
  const chooseStatus = (item: Item, callback: (id: string) => void): void => picker("Choose status", controller.snapshot!.statuses.filter(s => s.project_id === item.project_id).map(s => ({ label: `${s.label} · ${s.category}`, value: s.status_id })), callback);
  const chooseItem = (title: string, filter: (item: Item) => boolean, callback: (id: string) => void, exclude?: string): void => picker(title, controller.snapshot!.items.filter(i => !i.archived && filter(i) && i.id !== exclude).map(i => ({ label: `${i.title} · ${controller.projects.find(p => p.id === i.project_id)?.name ?? "Personal"}`, value: i.id })), callback);
  const openPalette = (): void => { modal = { kind: "palette", query: "", index: 0 }; draw(); };
  const performPalette = (label: string): void => {
    const found = paletteEntries().find(x => x.label === label); modal = undefined; if (found) void Promise.resolve(found.run()).catch(error => { notice = `Action failed: ${String(error)}`; }).finally(draw); draw();
  };
  const loadHistoryPage = async (offset: number, current?: Extract<Modal, { kind: "history" }>): Promise<void> => {
    const state = current ?? { kind: "history" as const, events: [], offset, total: 0, hasMore: false, nextOffset: null, pageSize: 50, scroll: 0, loading: false };
    modal = state; state.loading = true; state.error = undefined; draw();
    try {
      const page = await controller.client.history({ projectId: controller.projectId, limit: state.pageSize, offset });
      if (modal !== state) return;
      state.events = page.events; state.offset = offset; state.total = page.total; state.hasMore = page.has_more; state.nextOffset = page.next_offset;
    } catch (error) { if (modal === state) state.error = String(error); }
    finally { if (modal === state) { state.loading = false; draw(); } }
  };
  const createItem = (kind: "task" | "milestone" | "subtask" = "task", parent?: Item, detail = false): void => {
    const begin = (projectId: string | null): void => {
      const projectStatuses = (controller.snapshot?.statuses ?? []).filter(s => s.project_id === projectId).sort((a,b) => a.position-b.position);
      const fields: FormField[] = [{ key: "title", label: "Title", value: "", required: true }];
      if (detail) fields.push(
        { key: "destination", label: "Destination", value: projectId ?? "", kind: "picker", choices: ["", ...controller.projects.map(p => p.id)], choiceLabels: Object.fromEntries([["", "Personal inbox"], ...controller.projects.map(p => [p.id, p.name] as [string,string])]), hint: "Choose a management project or Personal inbox" },
        { key: "description", label: "Description", value: "", kind: "multiline" as const },
        { key: "parent_id", label: "Parent", value: parent?.id ?? "", kind: "picker", requireChoiceOnOwnerChange:!!parent, choices: ["", ...(controller.snapshot?.items??[]).filter(i => i.project_id === projectId).map(i => i.id)], choiceLabels: Object.fromEntries([["", "No parent"], ...(controller.snapshot?.items??[]).filter(i => i.project_id === projectId).map(i => [i.id, i.title] as [string,string])]) },
        { key: "status_id", label: "Workflow status", value: projectStatuses[0]?.status_id ?? "", kind: "picker" as const, required: true, touched: !!projectStatuses.length, choices: projectStatuses.map(s => s.status_id), choiceLabels: Object.fromEntries(projectStatuses.map(s => [s.status_id, s.label])), hint: "Choose a status for the selected destination" },
        { key: "priority", label: "Priority", value: "", kind: "number" as const, required: false, hint: "Optional; blank uses the service default (0), allowed 0–255" },
        { key: "due_at", label: "Due date", value: "", kind: "date" as const },
        { key: "follow_up_at", label: "Waiting follow-up date", value: "", kind: "date" as const, hint: "Separate from due date; no reminder is sent" },
        { key: "labels", label: "Labels", value: "", hint: "Separate labels with commas" }
      );
      inputForm(detail ? `New ${kind} · details` : `Quick capture · ${projectId ? controller.projects.find(p=>p.id===projectId)?.name ?? "selected project" : "Personal inbox"}`, fields, async v => {
        const command = kind === "task" ? "todo add" : `${kind} add`;
        const destination = detail ? String(v.destination ?? projectId ?? "") || null : projectId;
        await writeMutation(command, { project_id: destination, parent_id: detail ? (v.parent_id || null) : (parent?.id ?? null), title: v.title, ...(detail ? { description: v.description, status_id: v.status_id || undefined, ...(v.priority === null || v.priority === "" ? {} : { priority: v.priority }), due_at: v.due_at || null, follow_up_at: v.follow_up_at || null, labels: parseLabels(String(v.labels)) } : {}) }); modal = undefined;
      });
    };
    const projectId = parent?.project_id ?? controller.projectId ?? null;
    begin(projectId);
  };
  const editItem = (item: Item): void => {
    const choicesFor = (projectId: string | null) => (controller.snapshot?.items??[]).filter(i => i.project_id === projectId && i.id !== item.id);
    const statusesFor = (projectId: string | null) => (controller.snapshot?.statuses ?? []).filter(s => s.project_id === projectId).sort((a,b)=>a.position-b.position);
    const fields: FormField[] = [
      { key: "title", label: "Title", value: item.title, required: true },
      { key: "description", label: "Description", value: item.description ?? "", kind: "multiline" },
      { key: "project_id", label: "Destination", value: item.project_id ?? "", kind: "picker", choices: ["", ...controller.projects.map(p=>p.id)], choiceLabels: Object.fromEntries([["", "Personal inbox"],...controller.projects.map(p=>[p.id,p.name] as [string,string])]), hint: "Move to a project or Personal inbox" },
      { key: "parent_id", label: "Parent", value: item.parent_id ?? "", kind: "picker", excludeId:item.id, requireChoiceOnOwnerChange:!!item.parent_id, choices: ["",...choicesFor(item.project_id).map(i=>i.id)], choiceLabels: Object.fromEntries([["","No parent"],...choicesFor(item.project_id).map(i=>[i.id,i.title] as [string,string])]) },
      { key: "status_id", label: "Workflow status", value: item.status_id, kind: "picker", required:true, touched:true, choices: statusesFor(item.project_id).map(s=>s.status_id), choiceLabels: Object.fromEntries(statusesFor(item.project_id).map(s=>[s.status_id,s.label])), hint:"Choose a target workflow status after changing destination" },
      { key: "priority", label: "Priority", value: item.priority === null ? "" : String(item.priority), kind: "number", hint: "Blank keeps the current value; allowed 0–255" },
    { key: "due_at", label: "Due date", value: item.due_at ?? "", kind: "date" },
    { key: "follow_up_at", label: "Waiting follow-up date", value: item.follow_up_at ?? "", kind: "date", hint: "Separate from due date; no reminder is sent" },
      { key: "labels", label: "Labels", value: item.labels?.join(", ") ?? "" },
      { key: "position", label: "Card order", value: String(item.position), kind: "number" }
    ];
    inputForm("Edit item", fields, async v => {
      const payload:Record<string,unknown>={item_id:item.id,title:v.title,description:v.description,status_id:v.status_id,due_at:v.due_at||null,follow_up_at:v.follow_up_at||null,labels:parseLabels(String(v.labels)),position:v.position};
      if(v.priority!==null&&v.priority!=="")payload.priority=v.priority;
      if(String(v.project_id??"")!==(item.project_id??""))payload.project_id=String(v.project_id??"")||null;
      if(String(v.parent_id??"")!==(item.parent_id??""))payload.parent_id=v.parent_id||null;
      await writeMutation("todo edit",payload); modal=undefined;
    });
  };
  const editProject = (project: Project): void => inputForm("Edit project", [
    { key: "name", label: "Name", value: project.name, required: true },
    { key: "description", label: "Description", value: project.description, kind: "multiline" },
    { key: "priority", label: "Priority", value: String(project.priority ?? ""), kind: "number" },
    { key: "lifecycle", label: "Lifecycle", value: project.lifecycle ?? "" },
    { key: "health", label: "Health", value: project.health ?? "" },
    { key: "labels", label: "Labels", value: project.labels?.join(", ") ?? "" }
  ], async v => { await writeMutation("project edit", { project_id: project.id, name:v.name, description:v.description, ...(v.priority === null || v.priority === "" ? {} : {priority:v.priority}), lifecycle:v.lifecycle, health:v.health, labels: parseLabels(String(v.labels)) }); modal = undefined; });
  const createNote = (note?: Note): void => {
    const go = (projectId: string | null): void => inputForm(note ? "Edit note" : "New note", [
      { key: "title", label: "Title", value: note?.title ?? "", required: true },
      { key: "body", label: "Body", value: note?.body ?? "", kind: "multiline" }
    ], async v => { await writeMutation(note ? "note edit" : "note add", note ? { note_id: note.id, ...v } : { project_id: projectId, ...v }); modal = undefined; });
    if (note) go(note.project_id); else if (controller.projectId) go(controller.projectId); else chooseProject(id => go(id || null));
  };
  const addStatus = (): void => {
    const project = selectedProject(controller) ?? controller.activeProject;
    if (!project) { notice = "Choose a project to edit its workflow"; draw(); return; }
    inputForm("Add workflow status", [
      { key: "status_id", label: "Short key", value: "", required: true },
      { key: "label", label: "Label", value: "", required: true },
      { key: "category", label: "Meaning", value: "open", kind: "choice", choices: ["open", "active", "waiting", "blocked", "completed", "cancelled"] },
      { key: "position", label: "Position", value: String(controller.statuses.length), kind: "number" }
    ], async v => { await writeMutation("workflow status add", { project_id: project.id, ...v }); modal = undefined; });
  };
  const addLink = (): void => {
    const project = selectedProject(controller) ?? controller.activeProject;
    if (!project) { notice = "Choose a project first"; draw(); return; }
    inputForm("Link execution workspace", [
      { key: "path", label: "Workspace path", value: "", required: true }
    ], async v => { await writeMutation("project link", { project_id: project.id, path: v.path }); modal = undefined; });
  };
  const editStatus = (status: Status): void => inputForm("Edit workflow status", [
    { key: "label", label: "Label", value: status.label, required: true },
    { key: "category", label: "Meaning", value: status.category, kind: "choice", choices: ["open", "active", "waiting", "blocked", "completed", "cancelled"] },
    { key: "position", label: "Position", value: String(status.position), kind: "number" }
  ], async v => { await writeMutation("workflow status edit", { project_id: status.project_id, status_id: status.status_id, ...v }); modal = undefined; });
  const paletteEntries = (): Array<{ label: string; run: () => void | Promise<void> }> => {
    const item = selectedItem(controller), project = selectedProject(controller), note = selectedNote(controller), status = selectedStatus(controller), association = selectedAssociation(controller);
    const archived = controller.route === "archive" ? controller.selectedRow() as unknown as { id?: string; status_id?: string; name?: string } : undefined;
    const entries = [
      ...ROUTE_MENU.map(([route, label]) => ({ label: `View · ${label}`, run: () => controller.setRoute(route) })),
      { label: "Scope · All projects", run: () => controller.setScope(undefined) },
      ...controller.projects.map(p => ({ label: `Scope · ${p.name}`, run: () => controller.setScope(p.id) })),
      { label: "Action · Quick capture", run: () => createItem() },
      { label: "Action · Detailed item", run: () => createItem("task", undefined, true) },
      { label: "Action · New project", run: () => inputForm("New project", [{ key: "name", label: "Name", value: "", required: true }, { key: "description", label: "Description", value: "", kind: "multiline" }], async v => { await writeMutation("project add", v); modal = undefined; }) },
      { label: "Action · New note", run: () => createNote() },
      { label: "Action · Add milestone", run: () => createItem("milestone", undefined, true) },
      { label: "Action · Add workflow status", run: () => addStatus() },
      { label: "Action · Link execution workspace", run: () => addLink() },
      { label: "Action · Attach folder", run: () => controller.activeProject ? inputForm("Attach folder", [{ key: "path", label: "Folder path", value: "", required: true }], async v => { await writeMutation("project attach-folder", { project_id: controller.activeProject!.id, path: v.path }); modal = undefined; }) : undefined },
      { label: "Action · Refresh snapshot", run: () => controller.unresolvedOperation ? controller.resolveUnknownOperation().then(x => { notice = x; }) : controller.refresh() },
      ...(["today", "overdue", "unscheduled", "waiting", "all_open"] as const).map(filter => ({ label: `Filter · ${filter.replace("_", " ")}`, run: () => { controller.todoFilter = filter; controller.setRoute("todos"); } }))
    ];
    if (item) entries.push(
      { label: `Action · Edit ${item.title}`, run: () => editItem(item) },
      { label: "Action · Choose status", run: () => chooseStatus(item, id => launchWrite("todo move", { item_id: item.id, status_id: id })) },
      { label: "Action · Complete item", run: () => launchWrite("todo complete", { item_id: item.id }) },
      { label: "Action · Reopen item", run: () => launchWrite("todo reopen", { item_id: item.id }) },
      { label: "Action · Add child", run: () => createItem(item.kind === "milestone" ? "task" : "subtask", item, true) },
      { label: "Action · Add dependency", run: () => chooseItem("Choose dependency", x => x.project_id === item.project_id, id => launchWrite("relationship add", { project_id: item.project_id, source_id: item.id, target_id: id, kind: "depends_on" }), item.id) },
      { label: "Action · Remove dependency", run: () => { const deps = controller.snapshot?.relationships.filter(r => r.source_id === item.id || r.target_id === item.id) ?? []; picker("Remove dependency", deps.map(r => ({ label: `${r.kind}: ${titleFor(controller, r.source_id)} → ${titleFor(controller, r.target_id)}`, value: `${r.source_id}\u0000${r.target_id}\u0000${r.kind}` })), value => { const [source_id, target_id, kind] = value.split("\u0000"); launchWrite("relationship remove", { source_id, target_id, kind }); }); } },
      { label: "Action · Move card earlier", run: () => launchWrite("todo reorder", { item_id: item.id, direction: "up" }) },
      { label: "Action · Move card later", run: () => launchWrite("todo reorder", { item_id: item.id, direction: "down" }) },
      { label: "Action · Archive item", run: () => launchWrite("todo archive", { item_id: item.id }) }
    );
    if (project) entries.push({ label: `Action · Edit ${project.name}`, run: () => editProject(project) }, { label: "Action · Archive project", run: () => launchWrite("project archive", { project_id: project.id }) });
    if (note) entries.push({ label: `Action · Edit ${note.title}`, run: () => createNote(note) }, { label: "Action · Archive note", run: () => launchWrite("note archive", { note_id: note.id }) });
    if (status) entries.push({ label: `Action · Edit status ${status.label}`, run: () => editStatus(status) });
    if (association) entries.push({ label: `Action · Inspect linked workspace ${association.identity}`, run: () => openLinkedReader(association) });
    const targetProject = project ?? controller.activeProject;
    if (targetProject) entries.push({ label: "Action · Remove linked workspace", run: () => { const links = controller.snapshot?.associations.filter(a => a.project_id === targetProject.id) ?? []; picker("Remove linked workspace", links.map(x => ({ label: `${x.kind} · ${x.identity} · ${x.path ?? "no path"}`, value: `${x.kind}\u0000${x.identity}` })), value => { const [kind, identity] = value.split("\u0000"); launchWrite("project unlink", { project_id: targetProject.id, kind, identity }); }); } });
    if (archived?.id) entries.push({ label: "Action · Restore selected archived record", run: () => launchWrite(archived.status_id ? "todo unarchive" : archived.name ? "project unarchive" : "note unarchive", archived.status_id ? { item_id: archived.id } : archived.name ? { project_id: archived.id } : { note_id: archived.id }) });
    return entries;
  };

  const inspectItem = (item:Item):void => {
    const reader={kind:"reader" as const,title:item.title,body:"Loading full record…",offset:0};modal=reader;draw();
    void controller.loadSelectedDetail().then(()=>{
      if(modal!==reader)return;
      const full=controller.snapshot?.items.find(i=>i.id===item.id)??item;
      reader.body=[full.description??"",`Project: ${controller.projects.find(p=>p.id===full.project_id)?.name??"Personal inbox"}`,`Status: ${controller.snapshot?.statuses.find(s=>s.project_id===full.project_id&&s.status_id===full.status_id)?.label??full.status_id}`,`Priority: ${full.priority??"—"}`,`Due: ${humanDate(full.due_at)}`,`Follow-up: ${humanDate(full.follow_up_at)}`,`Parent: ${controller.snapshot?.items.find(i=>i.id===full.parent_id)?.title??"None"}`,"",...relationshipLines(controller,full),"",...(controller.statusHistoryFor?.(full)??[]).map(h=>`rev ${h.revision}: ${h.from_status_id??"new"} → ${h.to_status_id} · ${humanDate(h.changed_at)}`)].join("\n");
    }).catch(error=>{if(modal===reader)reader.body=`Full detail unavailable: ${String(error)}`;}).finally(()=>draw());
  };
  const inspectNote = (note:Note):void => {
    const reader={kind:"reader" as const,title:note.title,body:"Loading full note…",offset:0};modal=reader;draw();
    void controller.loadSelectedDetail().then(()=>{if(modal===reader)reader.body=controller.snapshot?.notes.find(n=>n.id===note.id)?.body??"";}).catch(error=>{if(modal===reader)reader.body=`Full note unavailable: ${String(error)}`;}).finally(()=>draw());
  };

  const action = (key: string): void => {
    if (key === "q" || key === "ctrl-c") { cleanup(); return; }
    if (key === "?" ) { modal = { kind: "help", offset: 0 }; draw(); return; }
    if (key === ":") { openPalette(); return; }
    if (ROUTE_KEYS[key]) { controller.setRoute(ROUTE_KEYS[key]); draw(); return; }
    if (key === " ") { controller.toggleScope(); draw(); return; }
    if (key === "tab" || key === "shift-tab") { controller.moveFocus(key === "tab" ? 1 : -1); draw(); return; }
    if (key === "right" || key === "left") { if (controller.focus === "work" && controller.route === "board") controller.moveBoardColumn(key === "right" ? 1 : -1); else if (controller.focus === "inspector") controller.moveInspectorTab(key === "right" ? 1 : -1); else if (key === "right") controller.moveFocus(1); draw(); return; }
    if (key === "up" || key === "k") { if (controller.focus === "navigation") controller.setRoute(NAV_ROUTES[Math.max(0, NAV_ROUTES.indexOf(controller.route) - 1)]); else if (controller.focus === "inspector") controller.moveInspectorScroll(-1); else controller.moveSelection(-1); draw(); return; }
    if (key === "down" || key === "j") { if (controller.focus === "navigation") controller.setRoute(NAV_ROUTES[Math.min(NAV_ROUTES.length - 1, NAV_ROUTES.indexOf(controller.route) + 1)]); else if (controller.focus === "inspector") controller.moveInspectorScroll(1); else controller.moveSelection(1); draw(); return; }
    if (key === "page-up" || key === "page-down") {
      if (controller.focus === "inspector") controller.moveInspectorScroll(key === "page-up" ? -8 : 8);
      else {
        controller.moveSelection(key === "page-up" ? -8 : 8);
        if(key==="page-down"&&controller.selected>=Math.max(0,controller.rows().length-8))void controller.loadMoreRows().then(draw);
      }
      draw(); return;
    }
    if (key === "s" && controller.route !== "workflow") { chooseProject(id => controller.setScope(id || undefined)); return; }
    if (key === "" || key.startsWith("paste:")) { if (modal && modal.kind !== "help" && modal.kind !== "reader" && modal.kind !== "history") { if (modal.kind === "form") editField(modal.state, key); else modal.query += key.slice(6); draw(); } return; }
    const item = selectedItem(controller), project = selectedProject(controller), note = selectedNote(controller), status = selectedStatus(controller), association = selectedAssociation(controller);
    if (key === "escape") { if (modal) modal = undefined; else if (controller.route !== "overview") controller.setRoute("overview"); draw(); return; }
    if (key === "enter") {
      if (project) { controller.selectProject(controller.projects.indexOf(project)); return; }
      if (item) { inspectItem(item); return; }
      if (controller.route === "history") { void loadHistoryPage(0); return; }
      if (note) { inspectNote(note); return; }
      if (association) { openLinkedReader(association); return; }
    }
    if (key === "H" && association?.kind === "workspace" && association.path && terminal.openLinkedWorkspace) {
      if (escapeTimer) clearTimeout(escapeTimer);
      terminal.write("\u001b[?25h\u001b[?2004l\u001b[?1049l"); terminal.setRawMode(false);
      alternateScreen = false; frameWriter.invalidate(); busy = true; suspended = true;
      void terminal.openLinkedWorkspace(association.path).then(() => { notice = "Returned from linked workspace"; }).catch(error => { notice = `Handoff failed: ${String(error)}`; }).finally(() => { if (alive) { terminal.setRawMode(true); suspended = false; busy = false; draw(); } });
      return;
    }
    if (key === "n") { if (controller.route === "projects") inputForm("New project", [{ key: "name", label: "Name", value: "", required: true }, { key: "description", label: "Description", value: "", kind: "multiline" }], async v => { await writeMutation("project add", v); modal = undefined; }); else if (controller.route === "notes") createNote(); else if (controller.route === "links") addLink(); else createItem(); return; }
    if (key === "N") { createItem("task", undefined, true); return; }
    if (key === "e") {
      if(item||note){busy=true;void controller.loadSelectedDetail().then(()=>{const full=item?controller.snapshot?.items.find(i=>i.id===item.id):controller.snapshot?.notes.find(n=>n.id===note!.id);if(item&&full&&"status_id" in full)editItem(full);else if(note&&full&&"body" in full)createNote(full);else notice="Full record detail is unavailable.";}).catch(e=>{notice=`Could not load full record detail: ${String(e)}`;}).finally(()=>{busy=false;draw();});}
      else if(project)editProject(project);else if(status)editStatus(status);else{notice="Choose a project, item, note, or workflow status to edit.";draw();}return;
    }
    if (key === "s" && controller.route === "workflow") { addStatus(); return; }
    if (key === "[" && item) { launchWrite("todo reorder", { item_id: item.id, direction: "up" }); return; }
    if (key === "]" && item) { launchWrite("todo reorder", { item_id: item.id, direction: "down" }); return; }
    if (key === "l" && controller.activeProject) { addLink(); return; }
    if (key === "f" && controller.activeProject) { inputForm("Attach folder", [{ key: "path", label: "Folder path", value: "", required: true }], async v => { await writeMutation("project attach-folder", { project_id: controller.activeProject!.id, path: v.path }); modal = undefined; }); return; }
    if (key === "U" && controller.activeProject) { const links = controller.snapshot?.associations.filter(a => a.project_id === controller.activeProject!.id) ?? []; picker("Remove linked workspace", links.map(x => ({ label: `${x.kind} · ${x.identity} · ${x.path ?? "no path"}`, value: `${x.kind}\u0000${x.identity}` })), value => { const [kind, identity] = value.split("\u0000"); launchWrite("project unlink", { project_id: controller.activeProject!.id, kind, identity }); }); return; }
    if (key === "m" && item) { chooseStatus(item, id => launchWrite("todo move", { item_id: item.id, status_id: id })); return; }
    if (key === "c" && item) { launchWrite("todo complete", { item_id: item.id }); return; }
    if (key === "o" && item) { launchWrite("todo reopen", { item_id: item.id }); return; }
    if (key === "a" && (item || project || note)) { const target = item ? ["todo archive", { item_id: item.id }] : project ? ["project archive", { project_id: project.id }] : ["note archive", { note_id: note!.id }]; launchWrite(target[0] as string, target[1] as Record<string, unknown>); return; }
    if (key === "u" && controller.route === "archive") { const row = controller.selectedRow() as unknown as { id?: string; status_id?: string; name?: string; body?: string }; if (row?.id) launchWrite(row.status_id ? "todo unarchive" : row.name ? "project unarchive" : "note unarchive", row.status_id ? { item_id: row.id } : row.name ? { project_id: row.id } : { note_id: row.id }); return; }
    if (key === "g") { createItem("milestone", undefined, true); return; }
    if (key === "h" && item) { createItem(item.kind === "milestone" ? "task" : "subtask", item, true); return; }
    if (key === "b" && item) { chooseItem("Choose dependency", x => x.project_id === item.project_id, id => launchWrite("relationship add", { project_id: item.project_id, source_id: item.id, target_id: id, kind: "depends_on" }), item.id); return; }
    if (key === "D" && item) { const deps = controller.snapshot?.relationships.filter(r => r.source_id === item.id || r.target_id === item.id) ?? []; picker("Remove dependency", deps.map(r => ({ label: `${r.kind}: ${titleFor(controller, r.source_id)} → ${titleFor(controller, r.target_id)}`, value: `${r.source_id}\u0000${r.target_id}\u0000${r.kind}` })), value => { const [source_id, target_id, kind] = value.split("\u0000"); launchWrite("relationship remove", { source_id, target_id, kind }); }); return; }
    if (key === "p" && item && controller.route === "planning") { launchWrite("todo reorder", { item_id: item.id, direction: "up" }); return; }
    if (key === "v" && item) { modal = { kind: "reader", title: item.title, body: item.description ?? "", offset: 0 }; draw(); return; }
    if (key === "r") { void (controller.unresolvedOperation ? controller.resolveUnknownOperation().then(x => { notice = x; draw(); }) : controller.refresh()).catch(e => { notice = `Refresh/readback failed: ${String(e)}`; }).finally(draw); return; }
    if (key === "/" && ["overview","board", "list", "todos", "projects", "notes","workflow","archive","links","inbox"].includes(controller.route)) { inputForm("Search this view", [{ key: "query", label: "Search text", value: controller.searchQuery, hint: "Searches the full collection through the service" }], async v => { await controller.search(String(v.query)); modal = undefined; draw(); }); return; }
    if (key === "x") { void controller.search("").then(draw).catch(e=>{notice=`Search failed: ${String(e)}`;draw();}); return; }
    const needsWork=["m","c","o","h","b","D","[","]"].includes(key)&&!item;
    const needsArchive=key==="a"&&!(item||project||note);
    const needsEdit=key==="e"&&!(item||project||note||status);
    if(needsWork||needsArchive||needsEdit){notice="Choose a visible record in this view first; no action was sent.";draw();}
  };
  const saveForm = async (): Promise<void> => {
    if (!modal || modal.kind !== "form") return;
    const values = validateForm(modal.state);
    if (!values) { draw(); return; }
    const current = modal; busy = true; draw();
    try { await current.save(values); }
    catch (e) {
      const conflict=!!(e&&typeof e==="object"&&"errorCode" in e&&/conflict|revision/i.test(String((e as {errorCode?:unknown}).errorCode)));
      if(conflict){try{await controller.refresh();current.state.error="Revision conflict: latest state loaded. Review this form, then press Ctrl-S to deliberately reapply.";}catch(readError){current.state.error=`Revision conflict; refresh failed: ${String(readError)}. Form retained; retry the read with r after closing.`;}}
      else current.state.error = String(e);
    }
    finally { busy = false; draw(); }
  };
  const handle = (key: string): void => {
    if (!alive) return;
    if (key === "ctrl-c") { cleanup(); return; }
    if (suspended || busy) return;
    if(controller.unresolvedOperation&&key==="r"){
      busy=true;void controller.resolveUnknownOperation().then(result=>{notice=result;if(/committed/i.test(result))modal=undefined;else if(modal?.kind==="form")modal.state.error=`${result} Draft retained; press Ctrl-S only if you still want to submit it.`;}).catch(error=>{notice=`Receipt read failed: ${String(error)}`;}).finally(()=>{busy=false;draw();});return;
    }
    if (!controller.snapshot && !["r", "q", "?"].includes(key)) { notice = "No snapshot loaded · press r to retry or q to quit"; draw(); return; }
    if (modal?.kind === "help") { if (key === "escape" || key === "?") modal = undefined; else if(key==="down"||key==="page-down")modal.offset++;else if(key==="up"||key==="page-up")modal.offset=Math.max(0,modal.offset-1);draw();return; }
    if (modal?.kind === "reader") {
      const current=modal, sample=current.linkedAssociation&&linkedSample(controller,current.linkedAssociation);
      if(current.linkedAssociation&&(key==="page-down"||(key==="enter"&&sample?.items_has_more))&&sample?.items_has_more){busy=true;notice="Loading linked work items…";draw();void controller.loadMoreLinked().then(loaded=>{if(!loaded&&controller.pageError)notice=`Linked page failed: ${controller.pageError}`;else notice="";}).catch(error=>{notice=`Linked page failed: ${String(error)}`;}).finally(()=>{busy=false;draw();});return;}
      if (key === "escape" || key === "enter") modal = undefined; else if (key === "down" || key === "page-down") modal.offset += key === "down" ? 1 : 8; else if (key === "up" || key === "page-up") modal.offset = Math.max(0, modal.offset - (key === "up" ? 1 : 8)); draw(); return;
    }
    if (modal?.kind === "history") {
      if (key === "escape" || key === "enter") modal = undefined;
      else if ((key === "down" || key === "up") && !modal.loading) modal.scroll = Math.max(0, modal.scroll + (key === "down" ? 1 : -1));
      else if ((key === "right" || key === "page-down") && modal.hasMore && !modal.loading) void loadHistoryPage(modal.nextOffset ?? modal.offset + modal.pageSize, modal);
      else if ((key === "left" || key === "page-up") && modal.offset > 0 && !modal.loading) void loadHistoryPage(Math.max(0, modal.offset - modal.pageSize), modal);
      draw(); return;
    }
    if (modal?.kind === "form") {
      if (key === "escape") { modal = undefined; draw(); return; }
      if (key === "tab" || key === "down") moveField(modal.state, 1);
      else if (key === "shift-tab" || key === "up") moveField(modal.state, -1);
      else if (key === "left" || key === "right") { if (modal.state.fields[modal.state.active]?.kind === "choice") cycleChoice(modal.state, key === "right" ? 1 : -1); else editField(modal.state, key); }
      else if (key === "ctrl-s") void saveForm();
      else if (key === "enter") {
        const current=modal, active=current.state.fields[current.state.active];
        if(active?.kind==="multiline")editField(current.state,"\n");
        else if(active?.kind==="picker") {
          const options=(active.choices??[]).map(value=>({value,label:active.choiceLabels?.[value]??value}));
          picker(`Choose ${active.label.toLocaleLowerCase()}`,options,value=>{
            const previousOwner=active.value||null;active.value=value;active.touched=true;const owner=value||null;
            if(active.key==="project_id"||active.key==="destination"){
              const parent=current.state.fields.find(f=>f.key==="parent_id"),status=current.state.fields.find(f=>f.key==="status_id");
              if(parent){const eligible=(controller.snapshot?.items??[]).filter(i=>i.project_id===owner&&i.id!==parent.excludeId);parent.choices=["",...eligible.map(i=>i.id)];parent.choiceLabels=Object.fromEntries([["","No parent"],...eligible.map(i=>[i.id,i.title] as [string,string])]);if(owner!==previousOwner){parent.value="";parent.required=!!parent.requireChoiceOnOwnerChange;parent.touched=!parent.required;}else if(!parent.choices.includes(parent.value))parent.value="";}
              if(status){const list=(controller.snapshot?.statuses??[]).filter(s=>s.project_id===owner).sort((a,b)=>a.position-b.position);status.choices=list.map(s=>s.status_id);status.choiceLabels=Object.fromEntries(list.map(s=>[s.status_id,s.label]));if(owner!==previousOwner){status.value="";status.touched=false;}else if(!status.choices.includes(status.value))status.value="";}
            }
            modal={kind:"form",state:current.state,save:current.save};draw();
          },()=>{modal={kind:"form",state:current.state,save:current.save};draw();});return;
        }
        else if(current.state.fields.length===1||current.state.active===current.state.fields.length-1)void saveForm();else moveField(current.state,1);
      }
      else editField(modal.state, key);
      draw(); return;
    }
    if (modal?.kind === "palette" || modal?.kind === "picker") {
      if (key === "escape") { const current=modal; if(current.kind==="picker"&&current.cancel)current.cancel();else modal = undefined; draw(); return; }
      if (key === "up") modal.index--;
      else if (key === "down") modal.index++;
      else if (key === "enter") {
        const current = modal;
        const list = current.kind === "palette" ? paletteEntries().map(x => ({ label: x.label, value: x.label })) : current.options;
        const matches = list.filter(x => x.label.toLocaleLowerCase().includes(current.query.toLocaleLowerCase()));
        const picked = matches[Math.max(0, Math.min(current.index, matches.length - 1))];
        if (picked) { if (current.kind === "palette") performPalette(picked.value); else { modal = undefined; current.choose(picked.value); } }
      } else if (key === "backspace") modal.query = Array.from(modal.query).slice(0, -1).join("");
      else if (key.startsWith("paste:")) modal.query += key.slice(6);
      else if (Array.from(key).length === 1 && key >= " ") modal.query += key;
      draw(); return;
    }
    action(key);
  };
  let unsubKey = (): void => {};
  unsub = (): void => { unsubKey(); };
  resizeOff = terminal.onResize?.(() => draw()) ?? (() => {});
  terminal.setRawMode(true);
  const promise = new Promise<void>(resolve => { finish = resolve; });
  unsubKey = terminal.onData(chunk => {
    for (const key of decoder.push(chunk)) handle(key);
    if (decoder.awaitingEscape) { if (escapeTimer) clearTimeout(escapeTimer); escapeTimer = setTimeout(() => { for (const key of decoder.flushEscape()) handle(key); }, 35); }
    else if (escapeTimer) { clearTimeout(escapeTimer); escapeTimer = undefined; }
    draw();
  });
  draw();
  await promise;
}

function helpLines(c: GlobalController): string[] {
  const routeActions:Record<Route,string>={
    overview:"↑↓ choose attention item · Enter inspect · : commands",
    projects:"n create project · e edit · a archive · Enter open project",
    board:"←→ columns · ↑↓ cards · n capture · N details · e edit · c complete · m status",
    list:"↑↓ choose · Enter inspect · n capture · N details · e edit · c complete · m status",
    todos:"↑↓ choose · Enter inspect · n capture · e edit · c complete · m status",
    notes:"n new note · Enter read · e edit · a archive",
    workflow:"s add status · e edit selected status",
    links:"Enter inspect linked progress · l link · U unlink · H open execution dashboard",
    planning:"Enter inspect · n new item · g milestone · h child · [ ] reorder",
    archive:"u restore selected record · Enter inspect",
    history:"Enter open activity · PgUp/PgDn page · ↑↓ scroll",
    inbox:"n quick capture to selected project or Personal inbox · Enter inspect · e triage"
  };
  const selected=selectedItem(c)?"Selected work: e edit · h add child · m status · c complete · o reopen · b dependency · D remove dependency · a archive":"";
  return [`${c.route} · ${c.activeProject?.name ?? "All projects"}`, routeActions[c.route], selected, "Tab focus · Space toggle all/last project · s choose scope · : search all views and actions", "? help · r refresh/read receipt · Esc back · q quit. Palette : contains every view and action."].filter(Boolean);
}
function contextualHint(c:GlobalController):string{const selected=selectedItem(c)?" · e edit m status c complete b dependency":"";return `Tab focus · Space scope · : commands · ? help · ${c.route}: ${c.route==="board"?"←→ columns ↑↓ cards n capture Enter inspect":c.route==="projects"?"n create Enter open e edit":c.route==="notes"?"n new Enter read e edit":c.route==="workflow"?"s add e edit":c.route==="links"?"Enter inspect l link H handoff":c.route==="archive"?"u restore Enter inspect":c.route==="history"?"Enter activity ↑↓ scroll":c.route==="overview"?"↑↓ attention Enter inspect":"n capture Enter inspect e edit"}${selected}`;}
function paletteOptions(c: GlobalController): Array<{ label: string; run: () => void | Promise<void> }> {
  return [...ROUTES.map((r, i) => ({ label: `View · ${routeNames[i]}`, run: () => c.setRoute(r) })), { label: "Scope · All projects", run: () => c.setScope(undefined) }, ...c.projects.map(p => ({ label: `Scope · ${p.name}`, run: () => c.setScope(p.id) })), { label: "Refresh snapshot", run: () => c.refresh() }, { label: "Create item", run: () => c.route === "projects" ? c.setRoute("board") : undefined }];
}
function titleFor(c: GlobalController, id: string): string { return c.snapshot?.items.find(i => i.id === id)?.title ?? id; }
function relationshipLines(c: GlobalController, item: Item): string[] { return (c.snapshot?.relationships ?? []).filter(r => r.source_id === item.id || r.target_id === item.id).map(r => `${r.kind}: ${titleFor(c, r.source_id)} → ${titleFor(c, r.target_id)}`); }
function humanDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "time unavailable";
  const raw = String(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const numeric = /^\d{10,}$/.test(raw) ? Number(raw) : undefined;
  const time = numeric ?? Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : raw;
}
function tokenizeLine(line:string):string[] {
  const tokens:string[]=[];let token="",quote:"'"|'"'|undefined,started=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==="\\"){
      const next=line[i+1];
      if(next===undefined){token+="\\";started=true;continue;}
      if(next==="\\"||next==="'"||next==='"'||(!quote&&/\s/u.test(next))||next===quote){token+=next;i++;started=true;continue;}
      token+="\\";started=true;continue;
    }
    if(quote){if(ch===quote)quote=undefined;else token+=ch;started=true;continue;}
    if(ch==="'"||ch==='"'){quote=ch as "'"|'"';started=true;continue;}
    if(/\s/u.test(ch)){if(started){tokens.push(token);token="";started=false;}continue;}
    token+=ch;started=true;
  }
  if(quote)throw new Error("unmatched quote in command line");
  if(started)tokens.push(token);
  return tokens;
}

export async function runLineInterface(controller: GlobalController, input: AsyncIterable<string>, write: (value: string) => void): Promise<void> {
  try { await controller.refresh(); } catch(error) { write(`Global manager unavailable · ${String(error)}. Type refresh to retry the read.\n`); }
  write(`${render(controller)}\nType help for commands.\n`);
  const mutate=async(command:string,payload:Record<string,unknown>):Promise<void>=>{if(!controller.snapshot)throw new Error("No current snapshot; use refresh before writing.");await controller.mutate(command,payload);if(controller.lastMutationRefreshFailed)write("Saved; refresh failed. Use refresh to retry the read.\n");};
  for await (const raw of input) {
    const line = raw.trim(); if (!line) continue;
    let tokens:string[];try{tokens=tokenizeLine(line);}catch(error){write(`Error: ${error instanceof Error?error.message:String(error)}\n`);continue;}
    const [cmd, ...parts] = tokens;if(!cmd)continue;const rest=parts.join(" ");
    if (!controller.snapshot && !["quit", "exit", "q", "help", "refresh"].includes(cmd)) { write("No snapshot loaded · use refresh to retry the read, or quit.\n"); continue; }
    const item = selectedItem(controller), project = selectedProject(controller), note = selectedNote(controller);
    try {
      if (["q", "quit", "exit"].includes(cmd)) return;
      if (cmd === "help") write("Commands: overview/projects/board/list/todos/notes/workflow/links/planning/archive/history/inbox; scope all|PROJECT_NUMBER; select N; search [TEXT]; refresh; add TITLE; edit TITLE (selected item/project/note); inspect; complete; archive; restore; status N (workflow row); dependency add N|remove N; note add TITLE; quit. Selection is by visible row number, project/status choices by label.\n");
      else if (ROUTES.includes(cmd as Route)) controller.setRoute(cmd as Route);
      else if (cmd === "scope") { if (parts[0] === "all") controller.setScope(undefined); else { const p = controller.projects[Number(parts[0]) - 1]; if (!p) throw new Error("choose a project number shown by projects"); controller.setScope(p.id); } }
      else if (cmd === "select") { const row = controller.rows()[Number(parts[0]) - 1]; if (!row) throw new Error("row number is outside the current list"); controller.selectId(rowId(row)); }
      else if (cmd === "search") await controller.search(rest);
      else if (cmd === "refresh") { if (controller.unresolvedOperation) write(`${await controller.resolveUnknownOperation()}\n`); else await controller.refresh(); }
      else if (cmd === "inspect" && item) write(`${item.title}\n${item.description??""}\n${relationshipLines(controller, item).join("\n")}\n`);
      else if (cmd === "add" && rest) await mutate("todo add", { project_id: controller.projectId ?? null, title: rest });
      else if (cmd === "edit" && item && rest) await mutate("todo edit",{item_id:item.id,title:rest});
      else if (cmd === "edit" && project && rest) await mutate("project edit",{project_id:project.id,name:rest});
      else if (cmd === "edit" && note && rest) await mutate("note edit",{note_id:note.id,title:rest});
      else if (cmd === "complete" && item) await mutate("todo complete", { item_id: item.id });
      else if (cmd === "archive" && (item || project || note)) await mutate(item ? "todo archive" : project ? "project archive" : "note archive", item ? { item_id: item.id } : project ? { project_id: project.id } : { note_id: note!.id });
      else if (cmd === "restore") { const row = controller.selectedRow() as unknown as { id?: string; status_id?: string; name?: string }; if (!row?.id) throw new Error("select an archived record first"); await mutate(row.status_id ? "todo unarchive" : row.name ? "project unarchive" : "note unarchive", row.status_id ? { item_id: row.id } : row.name ? { project_id: row.id } : { note_id: row.id }); }
      else if (cmd === "status" && item) { const status = controller.statuses[Number(parts[0]) - 1]; if (!status) throw new Error("choose a status number shown by workflow"); await mutate("todo move", { item_id: item.id, status_id: status.status_id }); }
      else if (cmd === "dependency" && item && parts[0] === "add") { const target = controller.items[Number(parts[1]) - 1]; if (!target) throw new Error("choose an item number from list"); await mutate("relationship add", { project_id: item.project_id, source_id: item.id, target_id: target.id, kind: "depends_on" }); }
      else if (cmd === "dependency" && item && parts[0] === "remove") { const relationship = controller.snapshot?.relationships.filter(r => r.source_id === item.id || r.target_id === item.id)[Number(parts[1]) - 1]; if (!relationship) throw new Error("choose a dependency number from inspect"); await mutate("relationship remove", { source_id: relationship.source_id, target_id: relationship.target_id, kind: relationship.kind }); }
      else if (cmd === "note" && parts[0] === "add") await mutate("note add", { project_id: controller.projectId ?? null, title: parts.slice(1).join(" "), body: "" });
      else if (cmd === "open" && project) controller.selectProject(controller.projects.indexOf(project));
      else throw new Error("command needs a suitable selected record, or is unknown");
      write(`${render(controller)}\n`);
    } catch (error) { write(`Error: ${error instanceof Error ? error.message : String(error)}\n`); }
  }
}
