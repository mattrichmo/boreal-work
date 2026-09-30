import { GlobalProtocolError, type GlobalServiceClient, type GlobalSnapshot, type GlobalActivityEvent, type GlobalPage, type Project, type Item, type Note, type Status, type Association, type Relationship, type LinkedProject, type LinkedWorkItem } from "./client.js";

export type Route = "overview" | "projects" | "board" | "list" | "todos" | "notes" | "workflow" | "links" | "planning" | "archive" | "history" | "inbox";
export type Focus = "navigation" | "work" | "inspector";
export type InspectorTab = "details" | "relationships" | "history" | "linked";
export type TodoFilter = "today" | "overdue" | "unscheduled" | "waiting" | "all_open";
export type ActivityRow = GlobalActivityEvent & { id: string };
export type Row = Project | Item | Note | Status | Association | ActivityRow;
type EntityKey = string;

export class GlobalController {
  snapshot: GlobalSnapshot | undefined;
  route: Route = "overview";
  selected = 0;
  selectedId: string | undefined;
  readonly collapsedItemIds = new Set<string>();
  readonly bulkSelectedIds = new Set<string>();
  projectId: string | undefined;
  /** Last deliberately chosen project, retained while viewing the portfolio. */
  lastProjectId: string | undefined;
  searchQuery = "";
  focus: Focus = "work";
  inspectorTab: InspectorTab = "details";
  inspectorOffset = 0;
  todoFilter: TodoFilter = "today";
  historyEvents: ActivityRow[] = [];
  historyTotal = 0;
  historyHasMore = false;
  historyError: string | undefined;
  pageLoading = false;
  linkedPageLoading = false;
  linkedPageError: string | undefined;
  detailLoading = false;
  pageError: string | undefined;
  private pageOffsets = new Map<string,number>();
  pageTotals = new Map<string,number>();
  private linkedOffsets = new Map<string,number>();
  private lastGoodLinked = new Map<string,LinkedProject>();
  private archiveCollectionIndex = 0;
  private overviewCollectionIndex = 0;
  private searchMatchedIds = new Set<string>();
  boardColumn = 0;
  boardCard = 0;
  notice = "";
  refreshing = false;
  sampledAt: number | undefined;
  lastRefreshError: string | undefined;
  lastMutationReceipt: unknown;
  lastMutationRefreshFailed = false;
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
          const prior=this.selectedRow();
          const next = await this.client.snapshot(); validateSnapshot(next);
          this.reconcileLinkedSamples(next);
          this.snapshot = next;
          this.pageOffsets.clear();this.pageTotals.clear();this.linkedOffsets.clear();this.archiveCollectionIndex=0;this.overviewCollectionIndex=0;
          if(prior)await this.retainSelectedRow(prior);
          await this.loadHistory();if(prior&&"operation_id" in prior&&!this.historyEvents.some(e=>e.operation_id===prior.operation_id))this.historyEvents.push(prior); this.sampledAt = Date.now(); this.lastRefreshError = undefined;
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

  async loadMoreRows():Promise<boolean>{
    if(this.pageLoading||!this.snapshot)return false;
    if(this.route==="history"){
      if(!this.historyHasMore||this.historyEvents.length===0)return false;
      const offset=this.historyEvents.length;this.pageLoading=true;try{await this.loadHistory(offset);return !this.historyError;}finally{this.pageLoading=false;}
    }
    if(this.inspectorTab==="linked"&&this.selectedRow()&&"identity" in (this.selectedRow() as object))return this.loadMoreLinked();
    const routes:Record<string,string>={projects:"projects",board:"items",list:"items",planning:"items",todos:"items",inbox:"items",notes:"notes",workflow:"statuses",links:"associations"};const archiveCollections=["projects","items","notes"];const overviewCollections=["items","projects"];let collection=this.route==="archive"?archiveCollections[this.archiveCollectionIndex]:this.route==="overview"?overviewCollections[this.overviewCollectionIndex]:routes[this.route];if(!collection)return false;
    const client=this.client as GlobalServiceClient&{detailPage?<T=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;includeArchived?:boolean;kind?:string}):Promise<GlobalPage<T>>};if(!client.detailPage)return false;
    const key=`${collection}:${this.projectId??"*"}`;let offset=this.pageOffsets.get(key);if(offset===undefined){const data=this.snapshot[collection as "projects"|"items"|"notes"|"statuses"|"associations"] as unknown[];const scopedCount=this.projectId?data.filter(row=>!!row&&typeof row==="object"&&(row as Record<string,unknown>).project_id===this.projectId).length:0;offset=this.searchQuery?0:this.projectId?scopedCount:Math.min(this.snapshot.snapshot_limit??data.length,data.length);}
    const includeArchived=this.route==="archive";
    this.pageLoading=true;this.pageError=undefined;
    try{
      const page=await client.detailPage(collection,{...(this.projectId?{projectId:this.projectId}:{}),limit:100,offset,includeArchived,...(this.searchQuery?{query:this.searchQuery}:{})});
      if(this.searchQuery)for(const row of page.rows as unknown[]){const id=keyOf(row as Row);if(id)this.searchMatchedIds.add(id);}
      this.pageTotals.set(`${this.route}:${this.projectId??"*"}:${this.searchQuery}:${collection}`,page.total);
      this.appendPage(collection,page.rows as never[]);this.pageOffsets.set(key,page.next_offset??page.offset+page.rows.length);this.reconcileSelection();
      if(this.route==="archive"&&page.next_offset===null){if(this.archiveCollectionIndex+1<archiveCollections.length){this.archiveCollectionIndex++;this.pageLoading=false;return await this.loadMoreRows();}this.archiveCollectionIndex=0;return page.rows.length>0;}
      if(this.route==="overview"&&page.next_offset===null){if(this.overviewCollectionIndex+1<overviewCollections.length){this.overviewCollectionIndex++;this.pageLoading=false;return await this.loadMoreRows();}this.overviewCollectionIndex=0;return page.rows.length>0;}
      return page.rows.length>0;
    }catch(error){this.pageError=error instanceof Error?error.message:String(error);return false;}finally{this.pageLoading=false;}
  }

  async search(query:string):Promise<void>{this.searchQuery=query;this.selected=0;this.selectedId=undefined;this.searchMatchedIds.clear();this.pageOffsets.clear();this.pageTotals.clear();this.archiveCollectionIndex=0;this.overviewCollectionIndex=0;this.reconcileSelection();if(!query.trim())return;
    if(this.route==="overview"){
      const client=this.client as GlobalServiceClient&{detailPage?<T=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;query?:string}):Promise<GlobalPage<T>>};
      if(client.detailPage)try{const page=await client.detailPage("projects",{...(this.projectId?{projectId:this.projectId}:{}),query,limit:100,offset:0});for(const row of page.rows as unknown[]){const id=keyOf(row as Row);if(id)this.searchMatchedIds.add(id);}this.appendPage("projects",page.rows as never[]);this.pageOffsets.set(`projects:${this.projectId??"*"}`,page.next_offset??page.rows.length);}catch(error){this.pageError=error instanceof Error?error.message:String(error);}
    }
    await this.loadMoreRows();
  }

  async loadSelectedDetail():Promise<void>{
    const row=this.selectedRow();if(!row)return;this.detailLoading=true;
    try{
      if("title" in row&&!("status_id" in row)&&!("operation_id" in row)){const client=this.client as GlobalServiceClient&{noteShow?(noteId:string):Promise<Note>};const full=client.noteShow?await client.noteShow(row.id):await this.client.execute<Note>("note show",{note_id:row.id});this.replaceSnapshotRow("notes",row.id,full);}
      else if("title" in row&&"status_id" in row){const full=await this.client.execute<Item>(row.kind==="milestone"?"milestone show":row.kind==="task"?"task show":"todo show",{item_id:row.id});this.replaceSnapshotRow("items",row.id,full);}
    }finally{this.detailLoading=false;}
  }

  async loadMoreLinked():Promise<boolean>{
    const row=this.selectedRow();if(!row||!("identity" in row)||!this.snapshot)return false;const association=row as Association;const key=`${association.project_id}:${association.identity}`;const existing=this.snapshot.linked_projects?.find(x=>x.management_project_id===association.project_id&&x.project_id===association.identity);if(!existing)return false;
    type Page={items:LinkedWorkItem[];total?:number|null;items_total?:number|null;next_offset?:number|null;availability:string;revision:number|null;as_of:string|null;error:string|null;job_id?:string|null};
    const client=this.client as GlobalServiceClient&{linkedPage?(projectId:string,identity:string,options?:{limit?:number;offset?:number}):Promise<Page>;linkedJobShow?(jobId:string):Promise<{state:"refreshing"|"complete"|"failed";page?:Page;error?:string|null}>};if(!client.linkedPage)return false;
    const offset=this.linkedOffsets.get(key)??existing.items?.length??0;if(offset>=(existing.items_total??Infinity))return false;this.pageLoading=true;this.pageError=undefined;
    this.linkedPageLoading=true;this.linkedPageError=undefined;
    try{
      let page=await client.linkedPage(association.project_id,association.identity,{limit:50,offset});
      if(page.availability==="refreshing"&&page.job_id){
        if(!client.linkedJobShow)throw new Error("linked workspace refresh is running but job status is unavailable");
        const deadline=Date.now()+2500;let state:"refreshing"|"complete"|"failed"="refreshing";let result:Page|undefined;let error:string|undefined;
        while(Date.now()<deadline&&state==="refreshing"){
          const job=await client.linkedJobShow(page.job_id);state=job.state;result=job.page;error=job.error??undefined;
          if(state==="refreshing")await new Promise(resolve=>setTimeout(resolve,100));
        }
        if(state==="refreshing")throw new Error("linked workspace page is still refreshing; load more to check again");
        if(state==="failed"||!result)throw new Error(error??"linked workspace page failed");
        page=result;
      }
      if(page.availability==="unavailable"||page.availability==="failed")throw new Error(page.error??"linked workspace page is unavailable");
      const total=page.items_total??page.total??existing.items_total??0;const next=page.next_offset??null;
      const known=new Set((existing.items??[]).map(item=>item.work_id));existing.items=[...(existing.items??[]),...page.items.filter(item=>!known.has(item.work_id))];existing.items_total=total;existing.items_has_more=next!==null;existing.availability=page.availability;existing.revision=page.revision;existing.as_of=page.as_of;existing.error=page.error;this.linkedOffsets.set(key,next??offset+page.items.length);return page.items.length>0;
    }
    catch(error){const message=error instanceof Error?error.message:String(error);this.linkedPageError=message;this.pageError=message;return false;}finally{this.linkedPageLoading=false;this.pageLoading=false;}
  }

  private appendPage(collection:string,rows:never[]):void{const snap=this.snapshot as unknown as Record<string,unknown>;const current=snap[collection];if(!Array.isArray(current))return;const key=(x:unknown):string=>{if(!x||typeof x!=="object")return JSON.stringify(x);const r=x as Record<string,unknown>;return String(r.id??r.identity??r.status_id??r.operation_id??JSON.stringify(x));};const known=new Set(current.map(key));snap[collection]=[...current,...rows.filter(row=>!known.has(key(row)))];}
  private replaceSnapshotRow(collection:"items"|"notes",id:string,value:Item|Note):void{const rows=this.snapshot?.[collection] as Array<Item|Note>|undefined;if(!rows)return;const index=rows.findIndex(x=>x.id===id);if(index>=0)rows[index]={...rows[index],...value};}
  private reconcileLinkedSamples(next:GlobalSnapshot):void{
    const active=new Set(next.associations.filter(a=>a.kind==="workspace").map(a=>`${a.project_id}\0${a.identity}`));
    for(const key of [...this.lastGoodLinked.keys()])if(!active.has(key))this.lastGoodLinked.delete(key);
    const incoming=next.linked_projects??[];const byKey=new Map(incoming.map(s=>[`${s.management_project_id}\0${s.project_id}`,s]));
    for(const association of next.associations.filter(a=>a.kind==="workspace")){
      const key=`${association.project_id}\0${association.identity}`;const sample=byKey.get(key);
      if(sample&&sample.availability==="available"&&sample.revision!==null&&sample.as_of){this.lastGoodLinked.set(key,{...sample});continue;}
      const good=this.lastGoodLinked.get(key);if(!good)continue;
      const stale:LinkedProject={...good,management_project_id:association.project_id,project_id:association.identity,path:association.path??good.path,availability:"stale",error:sample?.error??"latest linked-workspace sample is unavailable"};
      if(sample)byKey.set(key,stale);else byKey.set(key,stale);
    }
    next.linked_projects=[...byKey.entries()].filter(([key])=>active.has(key)).map(([,sample])=>sample);
  }
  private async retainSelectedRow(row:Row):Promise<void>{
    if(!this.snapshot)return;
    try{
      if("title" in row&&"status_id" in row&&!this.snapshot.items.some(i=>i.id===row.id)){const value=await this.client.execute<Item>(row.kind==="milestone"?"milestone show":row.kind==="task"?"task show":"todo show",{item_id:row.id});this.snapshot.items.push(value);}
      else if("title" in row&&!("status_id" in row)&&!("operation_id" in row)&&!this.snapshot.notes.some(n=>n.id===row.id)){const client=this.client as GlobalServiceClient&{noteShow?(id:string):Promise<Note>};const value=client.noteShow?await client.noteShow(row.id):await this.client.execute<Note>("note show",{note_id:row.id});this.snapshot.notes.push(value);}
      else if("name" in row&&!this.snapshot.projects.some(p=>p.id===row.id)){const value=await this.client.execute<Project>("project show",{project_id:row.id});this.snapshot.projects.push(value);}
      else if("identity" in row&&!this.snapshot.associations.some(a=>a.identity===row.identity&&a.project_id===row.project_id)){const client=this.client as GlobalServiceClient&{detailPage?<T=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;query?:string}):Promise<GlobalPage<T>>};if(client.detailPage){const page=await client.detailPage("associations",{projectId:row.project_id,query:row.identity,limit:100,offset:0});this.snapshot.associations.push(...page.rows as Association[]);}}
    }catch{/* Keep the last selection if it can still be resolved from the retained snapshot. */}
  }

  async mutate(command: string, payload: Record<string, unknown>): Promise<void> {
    if (this.unresolvedOperation) throw new Error(`operation ${this.unresolvedOperation} has an unknown outcome; inspect current state before making another change`);
    const revision = this.snapshot?.revision;
    this.lastMutationReceipt=undefined;this.lastMutationRefreshFailed=false;
    try { this.lastMutationReceipt=await this.client.execute(command, { ...payload, ...(revision === undefined ? {} : { expected_revision: revision }) }, true); }
    catch(error) { if(error instanceof GlobalProtocolError && (error.unknownOutcome || error.readbackRequired)) this.unresolvedOperation=error.operationId??"unknown"; throw error; }
    try { await this.refresh(); this.notice="Saved · snapshot refreshed"; }
    catch { this.lastMutationRefreshFailed=true;this.notice="Saved; refresh failed · press r to refresh"; }
  }

  async resolveUnknownOperation(): Promise<string> {
    const id = this.unresolvedOperation; if (!id) return "No unresolved mutation.";
    try {
      const receipt = await this.client.execute<{operation_id:string;revision:number}>("operation show", {operation_id:id});
      this.unresolvedOperation = undefined;this.lastMutationReceipt=receipt;try{await this.refresh();this.lastMutationRefreshFailed=false;this.notice=`Saved · operation ${safe(receipt.operation_id)} committed at revision ${receipt.revision}`;return this.notice;}catch{this.lastMutationRefreshFailed=true;this.notice=`Saved; refresh failed · operation ${safe(receipt.operation_id)} committed at revision ${receipt.revision}`;return this.notice;}
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
    const archivedOwners=new Set((this.snapshot?.projects??[]).filter(p=>p.archived).map(p=>p.id));
    return (this.snapshot?.items ?? []).filter(i => !i.archived && !(i.project_id&&archivedOwners.has(i.project_id)) && (!this.projectId || i.project_id===this.projectId) && (!q || this.searchMatchedIds.has(i.id)||[i.title,i.description??"",...(i.labels??[]),i.status_id,this.statusFor(i)?.label??"",this.projectName(i.project_id)].some(v=>v.toLocaleLowerCase().includes(q))))
      .sort((a,b)=>a.position-b.position||a.created_at.localeCompare(b.created_at));
  }
  rows(): Row[] { return this.rowsForRoute(); }
  rowsForRoute(route=this.route): Row[] {
    const snap=this.snapshot; if(!snap)return [];
    const scoped=(id:string|null)=>!this.projectId||id===this.projectId;
    const q=this.searchQuery.trim().toLocaleLowerCase();
    const matches=(...values:string[])=>!q||values.some(v=>v.toLocaleLowerCase().includes(q));const matchesRow=(r:Row,...values:string[])=>!q||this.searchMatchedIds.has(keyOf(r)??"")||matches(...values);
    if(route==="projects")return this.projects.filter(p=>matchesRow(p,p.name,p.description,...(p.labels??[]),p.lifecycle??"",p.health??""));
    if(route==="board"||route==="list")return this.items;
    if(route==="planning")return this.planningRows();
    if(route==="todos"||route==="inbox")return this.actionItems(route);
    if(route==="notes")return snap.notes.filter(n=>!n.archived&&!(n.project_id&&snap.projects.some(p=>p.id===n.project_id&&p.archived))&&scoped(n.project_id)&&matchesRow(n,n.title,n.body??"",this.projectName(n.project_id)));
    if(route==="workflow")return this.statuses.filter(s=>matchesRow(s,s.label,s.status_id,s.category));
    if(route==="links")return snap.associations.filter(a=>scoped(a.project_id)&&matchesRow(a,a.identity,a.path??"",this.projectName(a.project_id),a.kind));
    if(route==="archive"){const archivedProjects=new Set(snap.projects.filter(p=>p.archived).map(p=>p.id));return [...snap.projects.filter(p=>p.archived&&scoped(p.id)&&matchesRow(p,p.name,p.description)),...snap.items.filter(i=>(i.archived||!!i.project_id&&archivedProjects.has(i.project_id))&&scoped(i.project_id)&&matchesRow(i,i.title,i.description??"",this.projectName(i.project_id))),...snap.notes.filter(n=>(n.archived||!!n.project_id&&archivedProjects.has(n.project_id))&&scoped(n.project_id)&&matchesRow(n,n.title,n.body??"",this.projectName(n.project_id)))];}
    if(route==="history"){const events=this.historyEvents.length?this.historyEvents:this.fallbackHistory();return events.filter(e=>{if(this.projectId){const item=snap.items.find(x=>x.id===e.entity_id);const note=snap.notes.find(x=>x.id===e.entity_id);const project=snap.projects.find(x=>x.id===e.entity_id);if(!(item?.project_id===this.projectId||note?.project_id===this.projectId||project?.id===this.projectId))return false;}return matches(e.title??"",e.summary,e.command);});}
    if(route==="overview")return this.overviewRows();
    return [];
  }
  actionItems(route: "todos"|"inbox"): Item[] {
    const snap=this.snapshot; if(!snap)return [];
    const now=Date.now();
    const archivedOwners=new Set(snap.projects.filter(p=>p.archived).map(p=>p.id));
    const q=this.searchQuery.trim().toLocaleLowerCase();
    return snap.items.filter(i=>!i.archived&&!(i.project_id&&archivedOwners.has(i.project_id))&&(route==="inbox"?(this.projectId?i.project_id===this.projectId:(i.project_id===null||isInbox(this.statusFor(i)))):(!this.projectId||i.project_id===this.projectId))&&!isDone(this.statusFor(i))&&(route==="inbox"?(i.project_id===null||isInbox(this.statusFor(i))):matchesTodoFilter(i,this.statusFor(i),this.todoFilter,now))&&(!q||this.searchMatchedIds.has(i.id)||[i.title,i.description??"",this.projectName(i.project_id),this.statusFor(i)?.label??""].some(v=>v.toLocaleLowerCase().includes(q))))
      .sort((a,b)=>route==="todos"&&isWaiting(this.statusFor(a))&&isWaiting(this.statusFor(b))?(Date.parse(a.follow_up_at??"")||Number.MAX_SAFE_INTEGER)-(Date.parse(b.follow_up_at??"")||Number.MAX_SAFE_INTEGER):urgency(a,now)-urgency(b,now)||a.position-b.position);
  }
  statusFor(item:Item):Status|undefined{return this.snapshot?.statuses.find(s=>s.project_id===item.project_id&&s.status_id===item.status_id);}
  selectedRow(): Row | undefined { return this.route === "board" ? this.boardSelected : this.rows()[this.selected]; }
  get selectedItem(): Item | undefined { const row=this.selectedRow(); return row&&"title" in row&&"status_id" in row?row as Item:undefined; }
  get selectedProject(): Project | undefined { const row=this.selectedRow();return row&&"name" in row?row as Project:undefined; }
  get boardStatuses(): Status[] {
    const statuses=this.snapshot?.statuses??[];
    if(this.projectId)return statuses.filter(s=>s.project_id===this.projectId).sort((a,b)=>a.position-b.position);
    const activeProjects=new Set(this.projects.map(p=>p.id));
    return statuses.filter(s=>!s.project_id||activeProjects.has(s.project_id)).sort((a,b)=>String(a.project_id??"").localeCompare(String(b.project_id??""))||a.position-b.position);
  }
  boardCards(status=this.boardStatuses[this.boardColumn]):Item[]{return status?this.items.filter(i=>i.project_id===status.project_id&&i.status_id===status.status_id):[];}
  get boardSelected():Item|undefined{return this.boardCards()[this.boardCard];}
  selectProject(index:number):void{const p=this.projects[clamp(index,0,this.projects.length-1)];if(p){this.setScope(p.id);this.setRoute("board");}}
  setRoute(route:Route):void{this.route=route;this.inspectorTab="details";this.inspectorOffset=0;this.selected=0;this.selectedId=undefined;this.boardColumn=0;this.boardCard=0;this.reconcileSelection();}
  setScope(projectId?:string):void{if(projectId)this.lastProjectId=projectId;else if(this.projectId)this.lastProjectId=this.projectId;this.projectId=projectId;this.selected=0;this.selectedId=undefined;this.boardColumn=0;this.boardCard=0;this.reconcileSelection();}
  toggleScope():void{this.setScope(this.projectId?undefined:(this.lastProjectId&&this.projects.some(p=>p.id===this.lastProjectId)?this.lastProjectId:this.projects[0]?.id));}
  setTodoFilter(filter:TodoFilter):void{this.todoFilter=filter;this.selected=0;this.selectedId=undefined;this.reconcileSelection();}
  selectId(id:string|undefined):void{this.selectedId=id;this.reconcileSelection();}
  toggleCollapsed(id:string):void{if(this.collapsedItemIds.has(id))this.collapsedItemIds.delete(id);else this.collapsedItemIds.add(id);this.reconcileSelection();}
  isCollapsed(id:string):boolean{return this.collapsedItemIds.has(id);}
  toggleBulkSelected(id:string):void{if(!this.rows().some(row=>keyOf(row)===id))return;if(this.bulkSelectedIds.has(id))this.bulkSelectedIds.delete(id);else this.bulkSelectedIds.add(id);}
  clearBulkSelection():void{this.bulkSelectedIds.clear();}
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
    if(this.snapshot){const items=new Map(this.snapshot.items.map(i=>[i.id,i]));const archivedOwners=new Set(this.snapshot.projects.filter(p=>p.archived).map(p=>p.id));for(const id of this.bulkSelectedIds){const item=items.get(id);if(item&&(item.archived||!!item.project_id&&archivedOwners.has(item.project_id)))this.bulkSelectedIds.delete(id);}for(const id of this.collapsedItemIds)if(!items.has(id))this.collapsedItemIds.delete(id);}
    if(this.route==="board") {const cols=this.boardStatuses;this.boardColumn=clamp(this.boardColumn,0,cols.length-1);if(this.selectedId){const found=cols.findIndex(s=>this.items.some(i=>i.id===this.selectedId&&i.project_id===s.project_id&&i.status_id===s.status_id));if(found>=0)this.boardColumn=found;}const cards=this.boardCards();const ix=cards.findIndex(i=>i.id===this.selectedId);this.boardCard=ix>=0?ix:clamp(this.boardCard,0,cards.length-1);this.selectedId=keyOf(this.boardSelected);return;}
    const rows=this.rows();let index=this.selectedId?rows.findIndex(r=>keyOf(r)===this.selectedId):-1;if(index<0)index=clamp(this.selected,0,rows.length-1);this.selected=index;this.selectedId=keyOf(rows[index]);
  }
  private fallbackHistory():ActivityRow[]{return ((this.snapshot as (GlobalSnapshot&{status_history?:Array<{item_id:string;from_status_id:string|null;to_status_id:string;revision:number;changed_at:string}>})|undefined)?.status_history??[]).map(e=>({id:e.item_id,operation_id:`status-${e.item_id}-${e.revision}`,revision:e.revision,command:"status transition",entity_kind:"item",entity_id:e.item_id,title:this.snapshot?.items.find(i=>i.id===e.item_id)?.title??e.item_id,summary:`${e.from_status_id??"created"} → ${e.to_status_id}`,created_at:e.changed_at}));}
  statusHistoryFor(item:Item):Array<{item_id:string;from_status_id:string|null;to_status_id:string;revision:number;changed_at:string}>{return (this.snapshot as (GlobalSnapshot & {status_history?:Array<{item_id:string;from_status_id:string|null;to_status_id:string;revision:number;changed_at:string}>})|undefined)?.status_history?.filter(h=>h.item_id===item.id)??[];}
  relationshipsFor(row:Row|undefined):Relationship[]{if(!row||!("title" in row&&"status_id" in row))return [];const item=row as Item;return (this.snapshot?.relationships??[]).filter(r=>r.source_id===item.id||r.target_id===item.id);}
  projectName(id:string|null):string{return this.snapshot?.projects.find(p=>p.id===id)?.name??(id?"Unknown project":"Personal inbox");}
  projectAttention(project:Project):{next_action?:{item_id:string;title:string;due_at:string|null;priority:number|null;status_id:string;status_label:string;kind:string}|null;next_milestone?:{item_id:string;title:string;due_at:string|null;completed_children:number;total_children:number}|null}{return (((this.snapshot?.attention as unknown as {projects?:Record<string,unknown>}|undefined)?.projects?.[project.id])??{}) as ReturnType<GlobalController["projectAttention"]>;}
  projectNextAction(project:Project):{id:string;title:string;due_at:string|null;priority:number|null;status_id:string;status_label:string;kind:string}|Item|undefined{const a=this.projectAttention(project).next_action;if(a)return{id:a.item_id,title:a.title,due_at:a.due_at,priority:a.priority,status_id:a.status_id,status_label:a.status_label,kind:a.kind};return (this.snapshot?.items??[]).filter(i=>i.project_id===project.id&&!i.archived&&!isDone(this.statusFor(i))).sort((x,y)=>urgency(x,Date.now())-urgency(y,Date.now())||(y.priority??-1)-(x.priority??-1)||x.position-y.position)[0];}
  projectNextMilestone(project:Project):{id:string;title:string;due_at:string|null;completed_children:number;total_children:number}|Item|undefined{const m=this.projectAttention(project).next_milestone;if(m)return{id:m.item_id,title:m.title,due_at:m.due_at,completed_children:m.completed_children,total_children:m.total_children};return (this.snapshot?.items??[]).filter(i=>i.project_id===project.id&&i.kind==="milestone"&&!i.archived&&!isDone(this.statusFor(i))).sort((x,y)=>urgency(x,Date.now())-urgency(y,Date.now())||x.position-y.position)[0];}
  itemBreadcrumb(item:Item):string[]{const byId=new Map((this.snapshot?.items??[]).map(i=>[i.id,i]));const parts:string[]=[];const seen=new Set<string>();let current:Item|undefined=item;while(current?.parent_id&&!seen.has(current.parent_id)){seen.add(current.parent_id);const parent=byId.get(current.parent_id);if(!parent)break;parts.unshift(parent.title);current=parent;}return parts;}
  milestoneProgress(item:Item):{completed:number;total:number;visibleOnly:boolean}{const p=item.project_id?this.snapshot?.projects.find(x=>x.id===item.project_id):undefined;const m=p?this.projectAttention(p).next_milestone:undefined;if(m?.item_id===item.id)return{completed:m.completed_children,total:m.total_children,visibleOnly:false};const children=(this.snapshot?.items??[]).filter(i=>i.parent_id===item.id&&!i.archived);return{completed:children.filter(i=>this.statusFor(i)?.category==="completed").length,total:children.length,visibleOnly:true};}
  projectLastActivity(project:Project):ActivityRow|undefined{const entities=new Set([project.id,...(this.snapshot?.items??[]).filter(i=>i.project_id===project.id).map(i=>i.id),...(this.snapshot?.notes??[]).filter(n=>n.project_id===project.id).map(n=>n.id)]);return this.historyEvents.filter(e=>e.entity_id&&entities.has(e.entity_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];}
  overviewRows():Row[]{
    const snap=this.snapshot;if(!snap)return[];const q=this.searchQuery.trim().toLocaleLowerCase();const match=(...v:string[])=>!q||v.some(x=>x.toLocaleLowerCase().includes(q));
    const open=this.items.filter(i=>!isDone(this.statusFor(i))).sort((a,b)=>urgency(a,Date.now())-urgency(b,Date.now())||(b.priority??-1)-(a.priority??-1)||a.position-b.position);
    const projects=this.projects.filter(p=>match(p.name,p.description,p.lifecycle??"",p.health??""));
    const scopedOpen=open.filter(i=>!this.projectId||i.project_id===this.projectId);
    const action=scopedOpen.filter(i=>!q||this.searchMatchedIds.has(i.id)||match(i.title,i.description??"",this.projectName(i.project_id),this.statusFor(i)?.label??""));
    const projectRows=projects.filter(p=>(!this.projectId||p.id===this.projectId)&&(!q||this.searchMatchedIds.has(p.id)||match(p.name,p.description)));
    // One canonical sequence feeds Home rendering, selection, and row totals.
    return [...action,...projectRows];
  }
  planningRows():Item[]{
    const snap=this.snapshot;if(!snap)return[];const archivedOwners=new Set(snap.projects.filter(p=>p.archived).map(p=>p.id));const all=snap.items.filter(i=>!i.archived&&!(i.project_id&&archivedOwners.has(i.project_id))&&(!this.projectId||i.project_id===this.projectId)).sort((a,b)=>a.position-b.position||a.created_at.localeCompare(b.created_at));const q=this.searchQuery.trim().toLocaleLowerCase();
    const byId=new Map(all.map(i=>[i.id,i]));const included=new Set(all.filter(i=>!q||this.searchMatchedIds.has(i.id)||[i.title,i.description??"",...(i.labels??[]),this.statusFor(i)?.label??""].some(v=>v.toLocaleLowerCase().includes(q))).map(i=>i.id));
    for(const id of [...included]){let item=byId.get(id);while(item?.parent_id&&byId.has(item.parent_id)){included.add(item.parent_id);item=byId.get(item.parent_id);}}
    const ordered:Item[]=[];const seen=new Set<string>();const visit=(item:Item)=>{if(seen.has(item.id)||!included.has(item.id))return;seen.add(item.id);ordered.push(item);if(this.collapsedItemIds.has(item.id)&&!q)return;for(const child of all.filter(x=>x.parent_id===item.id))visit(child);};
    for(const item of all)if(!item.parent_id||!byId.has(item.parent_id))visit(item);
    const hiddenByCollapsedAncestor=(item:Item):boolean=>{if(q)return false;let parent=item.parent_id;const chain=new Set<string>();while(parent&&!chain.has(parent)){if(this.collapsedItemIds.has(parent))return true;chain.add(parent);parent=byId.get(parent)?.parent_id??null;}return false;};
    for(const item of all)if(!seen.has(item.id)&&!hiddenByCollapsedAncestor(item))visit(item);return ordered;
  }
}

export function validateSnapshot(v:GlobalSnapshot):void{if(!v||v.schema_version!==2||!Number.isSafeInteger(v.revision)||v.revision<0)throw new Error("global snapshot schema or revision is invalid");for(const k of ["projects","items","notes","statuses","relationships","associations"] as const)if(!Array.isArray(v[k]))throw new Error(`global snapshot ${k} must be an array`);for(const p of v.projects)if(typeof p.id!=="string"||typeof p.name!=="string")throw new Error("global snapshot contains malformed project");for(const i of v.items)if(typeof i.id!=="string"||typeof i.title!=="string"||typeof i.status_id!=="string")throw new Error("global snapshot contains malformed item");}
export function isDone(status:Status|undefined):boolean{return status?.category==="completed"||status?.category==="cancelled";}
export function isOverdue(item:Item,now=Date.now()):boolean{if(!item.due_at)return false;if(dateOnly(item.due_at))return item.due_at<utcDay(now);const due=Date.parse(item.due_at);return Number.isFinite(due)&&utcDay(due)<utcDay(now);}
function urgency(i:Item,now:number):number{return isOverdue(i,now)?0:i.due_at?1:2;}
function dateOnly(value:string):boolean{return /^\d{4}-\d{2}-\d{2}$/u.test(value);}
function utcDay(time:number):string{return new Date(time).toISOString().slice(0,10);}
function isInbox(s:Status|undefined):boolean{return s?.category==="inbox"||s?.status_id.toLowerCase()==="inbox";}
function isWaiting(s:Status|undefined):boolean{return s?.category==="waiting"||s?.status_id.toLowerCase()==="waiting";}
function matchesTodoFilter(i:Item,s:Status|undefined,f:TodoFilter,now:number):boolean{if(f==="all_open")return true;if(f==="waiting")return isWaiting(s);if(f==="overdue")return isOverdue(i,now)&&!isWaiting(s);if(f==="unscheduled")return !i.due_at&&!isWaiting(s);if(isWaiting(s))return false;if(!i.due_at)return true;const due=Date.parse(i.due_at);return Number.isFinite(due)&&utcDay(due)===utcDay(now);}
function keyOf(r:Row|undefined):EntityKey|undefined{return r?("id" in r?r.id:"status_id" in r?r.status_id:"identity" in r?r.identity:undefined):undefined;}
function clamp(n:number,min:number,max:number):number{return Math.max(min,Math.min(max,n));}
function safe(s:string):string{return s.replace(/[\u0000-\u001f\u007f-\u009f\u001b]/g," ").slice(0,80);}
