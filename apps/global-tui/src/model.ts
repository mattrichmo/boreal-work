import { GlobalProtocolError, type GlobalServiceClient, type GlobalSnapshot, type GlobalActivityEvent, type Project, type Item, type Note, type Status, type Association, type Relationship } from "./client.js";

export type Route = "overview" | "projects" | "board" | "list" | "todos" | "notes" | "workflow" | "links" | "planning" | "archive" | "history" | "inbox";
export type Focus = "navigation" | "work" | "inspector";
export type InspectorTab = "details" | "relationships" | "history" | "linked";
export type TodoFilter = "today" | "overdue" | "waiting" | "all_open";
export type ActivityRow = GlobalActivityEvent & { id: string };
export type Row = Project | Item | Note | Status | Association | ActivityRow;
type EntityKey = string;

export class GlobalController {
  snapshot: GlobalSnapshot | undefined;
  route: Route = "overview";
  selected = 0;
  selectedId: string | undefined;
  projectId: string | undefined;
  searchQuery = "";
  focus: Focus = "work";
  inspectorTab: InspectorTab = "details";
  inspectorOffset = 0;
  todoFilter: TodoFilter = "today";
  historyEvents: ActivityRow[] = [];
  historyTotal = 0;
  historyHasMore = false;
  historyError: string | undefined;
  boardColumn = 0;
  boardCard = 0;
  notice = "";
  refreshing = false;
  sampledAt: number | undefined;
  lastRefreshError: string | undefined;
  private refreshingPromise: Promise<void> | undefined;
  private refreshQueued = false;
  unresolvedOperation: string | undefined;
  constructor(readonly client: GlobalServiceClient) {}

  async refresh(): Promise<void> {
    this.refreshQueued = true;
    if (this.refreshingPromise) return this.refreshingPromise;
    this.refreshing = true;
    this.refreshingPromise = (async () => {
      do {
        this.refreshQueued = false;
        try {
          const next = await this.client.snapshot(); validateSnapshot(next);
          this.snapshot = next;
          await this.loadHistory(); this.sampledAt = Date.now(); this.lastRefreshError = undefined;
          this.reconcileSelection();
        } catch (error) { this.lastRefreshError = error instanceof Error ? error.message : String(error); throw error; }
      } while (this.refreshQueued);
    })().finally(() => { this.refreshing = false; this.refreshingPromise = undefined; });
    return this.refreshingPromise;
  }

  async loadHistory(offset=0):Promise<void>{
    const historyClient=this.client as GlobalServiceClient & {history?: (options?:{projectId?:string;entityId?:string;limit?:number;offset?:number})=>Promise<{events:GlobalActivityEvent[];total:number;has_more:boolean;next_offset:number|null}>};
    if(!historyClient.history){this.historyEvents=this.fallbackHistory();this.historyTotal=this.historyEvents.length;return;}
    try{const page=await historyClient.history({projectId:this.projectId,limit:50,offset});const mapped=page.events.map(e=>({...e,id:e.operation_id}));this.historyEvents=offset?[...this.historyEvents,...mapped]:mapped;this.historyTotal=page.total;this.historyHasMore=page.has_more;this.historyError=undefined;}
    catch(error){this.historyError=error instanceof Error?error.message:String(error);}
  }

  async mutate(command: string, payload: Record<string, unknown>): Promise<void> {
    if (this.unresolvedOperation) throw new Error(`operation ${this.unresolvedOperation} has an unknown outcome; inspect current state before making another change`);
    const revision = this.snapshot?.revision;
    try { await this.client.execute(command, { ...payload, ...(revision === undefined ? {} : { expected_revision: revision }) }, true); }
    catch(error) { if(error instanceof GlobalProtocolError && (error.unknownOutcome || error.readbackRequired)) this.unresolvedOperation=error.operationId??"unknown"; throw error; }
    await this.refresh();
  }

  async resolveUnknownOperation(): Promise<string> {
    const id = this.unresolvedOperation; if (!id) return "No unresolved mutation.";
    try {
      const receipt = await this.client.execute<{operation_id:string;revision:number}>("operation show", {operation_id:id});
      this.unresolvedOperation = undefined; await this.refresh(); return `Operation ${safe(receipt.operation_id)} committed at revision ${receipt.revision}.`;
    } catch(error) {
      if(error instanceof GlobalProtocolError && ["not_found","notfound"].includes((error.errorCode??"").toLowerCase().replaceAll("-","_"))) { this.unresolvedOperation=undefined; await this.refresh(); return `Operation ${safe(id)} was not committed.`; }
      throw error;
    }
  }

  get projects(): Project[] { return (this.snapshot?.projects ?? []).filter(p => !p.archived); }
  get activeProject(): Project | undefined { return this.projects.find(p => p.id === this.projectId); }
  get statuses(): Status[] { return (this.snapshot?.statuses ?? []).filter(s => !this.activeProject || s.project_id === this.activeProject.id).sort((a,b) => a.position-b.position); }
  get items(): Item[] {
    const q=this.searchQuery.trim().toLocaleLowerCase();
    return (this.snapshot?.items ?? []).filter(i => !i.archived && (!this.projectId || i.project_id===this.projectId) && (!q || [i.title,i.description,...(i.labels??[]),i.status_id].some(v=>v.toLocaleLowerCase().includes(q))))
      .sort((a,b)=>a.position-b.position||a.created_at.localeCompare(b.created_at));
  }
  rows(): Row[] { return this.rowsForRoute(); }
  rowsForRoute(route=this.route): Row[] {
    const snap=this.snapshot; if(!snap)return [];
    const scoped=(id:string|null)=>!this.projectId||id===this.projectId;
    if(route==="projects")return this.projects;
    if(route==="board"||route==="list"||route==="planning")return this.items;
    if(route==="todos"||route==="inbox")return this.actionItems(route);
    if(route==="notes")return snap.notes.filter(n=>!n.archived&&scoped(n.project_id));
    if(route==="workflow")return this.statuses;
    if(route==="links")return snap.associations.filter(a=>scoped(a.project_id));
    if(route==="archive"){const archivedProjects=new Set(snap.projects.filter(p=>p.archived).map(p=>p.id));return [...snap.projects.filter(p=>p.archived&&scoped(p.id)),...snap.items.filter(i=>(i.archived||!!i.project_id&&archivedProjects.has(i.project_id))&&scoped(i.project_id)),...snap.notes.filter(n=>(n.archived||!!n.project_id&&archivedProjects.has(n.project_id))&&scoped(n.project_id))];}
    if(route==="history"){const events=this.historyEvents.length?this.historyEvents:this.fallbackHistory();return events.filter(e=>{if(!this.projectId)return true;const item=snap.items.find(x=>x.id===e.entity_id);const note=snap.notes.find(x=>x.id===e.entity_id);const project=snap.projects.find(x=>x.id===e.entity_id);return item?.project_id===this.projectId||note?.project_id===this.projectId||project?.id===this.projectId;});}
    if(route==="overview")return (snap.items??[]).filter(i=>!i.archived&&!isDone(snap.statuses.find(s=>s.project_id===i.project_id&&s.status_id===i.status_id))).sort((a,b)=>urgency(a,Date.now())-urgency(b,Date.now())||a.position-b.position);
    return [];
  }
  actionItems(route: "todos"|"inbox"): Item[] {
    const snap=this.snapshot; if(!snap)return [];
    const now=Date.now();
    return snap.items.filter(i=>!i.archived&&(route==="inbox"?(!this.projectId||i.project_id===this.projectId||i.project_id===null):(!this.projectId||i.project_id===this.projectId))&&!isDone(this.statusFor(i))&&(route==="inbox"?(i.project_id===null||isInbox(this.statusFor(i))):matchesTodoFilter(i,this.statusFor(i),this.todoFilter,now)))
      .sort((a,b)=>urgency(a,now)-urgency(b,now)||a.position-b.position);
  }
  statusFor(item:Item):Status|undefined{return this.snapshot?.statuses.find(s=>s.project_id===item.project_id&&s.status_id===item.status_id);}
  selectedRow(): Row | undefined { return this.route === "board" ? this.boardSelected : this.rows()[this.selected]; }
  get selectedItem(): Item | undefined { const row=this.selectedRow(); return row&&"title" in row&&"status_id" in row?row as Item:undefined; }
  get selectedProject(): Project | undefined { const row=this.selectedRow();return row&&"name" in row?row as Project:undefined; }
  get boardStatuses(): Status[] {
    const statuses=this.snapshot?.statuses??[];
    if(this.projectId)return statuses.filter(s=>s.project_id===this.projectId).sort((a,b)=>a.position-b.position);
    const keys=new Set(this.items.map(i=>`${i.project_id??"personal"}\0${i.status_id}`));
    return statuses.filter(s=>keys.has(`${s.project_id??"personal"}\0${s.status_id}`)).sort((a,b)=>String(a.project_id??"").localeCompare(String(b.project_id??""))||a.position-b.position);
  }
  boardCards(status=this.boardStatuses[this.boardColumn]):Item[]{return status?this.items.filter(i=>i.project_id===status.project_id&&i.status_id===status.status_id):[];}
  get boardSelected():Item|undefined{return this.boardCards()[this.boardCard];}
  selectProject(index:number):void{const p=this.projects[clamp(index,0,this.projects.length-1)];if(p){this.projectId=p.id;this.route="board";this.selectId(undefined);}}
  setRoute(route:Route):void{if(route==="overview")this.projectId=undefined;this.route=route;this.inspectorTab="details";this.inspectorOffset=0;this.selected=0;this.selectedId=undefined;this.boardColumn=0;this.boardCard=0;this.reconcileSelection();}
  setScope(projectId?:string):void{this.projectId=projectId;this.selected=0;this.selectedId=undefined;this.boardColumn=0;this.boardCard=0;this.reconcileSelection();}
  toggleScope():void{this.setScope(this.projectId?undefined:this.projects[0]?.id);}
  selectId(id:string|undefined):void{this.selectedId=id;this.reconcileSelection();}
  moveSelection(delta:number):void {
    if(this.route==="board") { this.moveBoard(delta); return; }
    this.selected=clamp(this.selected+delta,0,this.rows().length-1);this.selectedId=keyOf(this.rows()[this.selected]);
  }
  moveBoard(delta:number):void {
    const columns=this.boardStatuses;if(!columns.length){this.boardColumn=0;this.boardCard=0;return;}
    const cards=this.boardCards();const next=this.boardCard+delta;
    if(next>=0&&next<cards.length)this.boardCard=next;
    else if(delta>0&&this.boardColumn<columns.length-1){this.boardColumn++;this.boardCard=0;}
    else if(delta<0&&this.boardColumn>0){this.boardColumn--;this.boardCard=Math.max(0,this.boardCards().length-1);}
    this.selectedId=keyOf(this.boardSelected);
  }
  moveBoardColumn(delta:number):void{this.boardColumn=clamp(this.boardColumn+delta,0,this.boardStatuses.length-1);this.boardCard=clamp(this.boardCard,0,this.boardCards().length-1);this.selectedId=keyOf(this.boardSelected);}
  moveFocus(delta=1):void{const order:Focus[]=["navigation","work","inspector"];this.focus=order[((order.indexOf(this.focus)+delta)%order.length+order.length)%order.length];}
  moveInspectorTab(delta:number):void{const tabs:InspectorTab[]=["details","relationships","history","linked"];this.inspectorTab=tabs[clamp(tabs.indexOf(this.inspectorTab)+delta,0,tabs.length-1)];this.inspectorOffset=0;}
  moveInspectorScroll(delta:number):void{this.inspectorOffset=Math.max(0,this.inspectorOffset+delta);}
  clampSelection():void{this.reconcileSelection();}
  reconcileSelection():void {
    if(this.route==="board") {const cols=this.boardStatuses;this.boardColumn=clamp(this.boardColumn,0,cols.length-1);if(this.selectedId){const found=cols.findIndex(s=>this.items.some(i=>i.id===this.selectedId&&i.project_id===s.project_id&&i.status_id===s.status_id));if(found>=0)this.boardColumn=found;}const cards=this.boardCards();const ix=cards.findIndex(i=>i.id===this.selectedId);this.boardCard=ix>=0?ix:clamp(this.boardCard,0,cards.length-1);this.selectedId=keyOf(this.boardSelected);return;}
    const rows=this.rows();let index=this.selectedId?rows.findIndex(r=>keyOf(r)===this.selectedId):-1;if(index<0)index=clamp(this.selected,0,rows.length-1);this.selected=index;this.selectedId=keyOf(rows[index]);
  }
  private fallbackHistory():ActivityRow[]{return ((this.snapshot as (GlobalSnapshot&{status_history?:Array<{item_id:string;from_status_id:string|null;to_status_id:string;revision:number;changed_at:string}>})|undefined)?.status_history??[]).map(e=>({id:e.item_id,operation_id:`status-${e.item_id}-${e.revision}`,revision:e.revision,command:"status transition",entity_kind:"item",entity_id:e.item_id,title:this.snapshot?.items.find(i=>i.id===e.item_id)?.title??e.item_id,summary:`${e.from_status_id??"created"} → ${e.to_status_id}`,created_at:e.changed_at}));}
  statusHistoryFor(item:Item):Array<{item_id:string;from_status_id:string|null;to_status_id:string;revision:number;changed_at:string}>{return (this.snapshot as (GlobalSnapshot & {status_history?:Array<{item_id:string;from_status_id:string|null;to_status_id:string;revision:number;changed_at:string}>})|undefined)?.status_history?.filter(h=>h.item_id===item.id)??[];}
  relationshipsFor(row:Row|undefined):Relationship[]{if(!row||!("title" in row&&"status_id" in row))return [];const item=row as Item;return (this.snapshot?.relationships??[]).filter(r=>r.source_id===item.id||r.target_id===item.id);}
}

export function validateSnapshot(v:GlobalSnapshot):void{if(!v||v.schema_version!==2||!Number.isSafeInteger(v.revision)||v.revision<0)throw new Error("global snapshot schema or revision is invalid");for(const k of ["projects","items","notes","statuses","relationships","associations"] as const)if(!Array.isArray(v[k]))throw new Error(`global snapshot ${k} must be an array`);for(const p of v.projects)if(typeof p.id!=="string"||typeof p.name!=="string")throw new Error("global snapshot contains malformed project");for(const i of v.items)if(typeof i.id!=="string"||typeof i.title!=="string"||typeof i.status_id!=="string")throw new Error("global snapshot contains malformed item");}
export function isDone(status:Status|undefined):boolean{return status?.category==="completed"||status?.category==="cancelled";}
export function isOverdue(item:Item,now=Date.now()):boolean{return !!item.due_at&&Date.parse(item.due_at)<now;}
function urgency(i:Item,now:number):number{return i.due_at&&Date.parse(i.due_at)<now?0:i.due_at?1:2;}
function isInbox(s:Status|undefined):boolean{return s?.category==="inbox"||s?.status_id.toLowerCase()==="inbox";}
function isWaiting(s:Status|undefined):boolean{return s?.category==="waiting"||s?.status_id.toLowerCase()==="waiting";}
function matchesTodoFilter(i:Item,s:Status|undefined,f:TodoFilter,now:number):boolean{if(f==="all_open")return true;if(f==="waiting")return isWaiting(s);if(f==="overdue")return !!i.due_at&&Date.parse(i.due_at)<now&&!isWaiting(s);if(isWaiting(s))return false;if(!i.due_at)return true;const d=new Date(i.due_at),t=new Date(now);return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth()&&d.getDate()===t.getDate();}
function keyOf(r:Row|undefined):EntityKey|undefined{return r?("id" in r?r.id:"status_id" in r?r.status_id:"identity" in r?r.identity:undefined):undefined;}
function clamp(n:number,min:number,max:number):number{return Math.max(min,Math.min(max,n));}
function safe(s:string):string{return s.replace(/[\u0000-\u001f\u007f-\u009f\u001b]/g," ").slice(0,80);}
