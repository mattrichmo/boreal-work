import { GlobalProtocolError, type GlobalServiceClient, type GlobalSnapshot, type GlobalActivityEvent, type GlobalPage, type GlobalOperationResult, type CaptureOrigin, type CaptureWitness, type Project, type Item, type Note, type Status, type Association, type Relationship, type LinkedProject, type LinkedWorkItem } from "./client.js";

export type Route = "overview" | "projects" | "board" | "list" | "todos" | "notes" | "workflow" | "links" | "planning" | "archive" | "history" | "inbox";
export type Focus = "navigation" | "work" | "inspector";
export type InspectorTab = "details" | "relationships" | "history" | "linked";
export type TodoFilter = "today" | "overdue" | "unscheduled" | "waiting" | "all_open";
export type ActivityRow = GlobalActivityEvent & { id: string };
export type Row = Project | Item | Note | Status | Association | ActivityRow;
export type CaptureInspection =
  | { status: "not_loaded" }
  | { status: "loading" }
  | { status: "available"; witness: CaptureWitness }
  | { status: "missing"; message: string }
  | { status: "bounded"; message: string }
  | { status: "unavailable"; message: string };
export type ChoiceCollection = "projects" | "items" | "statuses";
export type DailyClassificationView = { group: string; deadline: string; waiting: boolean; filters?: Partial<Record<TodoFilter,boolean>> };
export type CivilTimeView = { observed_at_unix_ms: number; timezone: string; system_civil_date: string; tzdb_identity: string };
type AttentionBlocker = { item_id: string; title: string; status_id: string; reason_code: string; reason: string };
type BlockedAction = { item_id: string; title: string; prerequisites: AttentionBlocker[] };
type ProjectAttentionView = {
  open?: number; waiting?: number; overdue?: number; due_today?: number; unscheduled?: number; later?: number;
  next_action?: { item_id: string; title: string; due_at: string | null; priority: number | null; status_id: string; status_label: string; kind: string } | null;
  next_milestone?: { item_id: string; title: string; due_at: string | null; completed_children: number; total_children: number } | null;
  blocked_by?: BlockedAction[]; next_action_unavailable_reason?: string | null;
};
type AttentionSnapshot = { portfolio?: Record<string, number>; projects?: Record<string, ProjectAttentionView>; personal?: ProjectAttentionView };
type EntityKey = string;
type CachedCaptureInspection = { digest: string; inspection: CaptureInspection };
const CAPTURE_HISTORY_LIMIT = 200;
const CAPTURE_INSPECTION_CACHE_LIMIT = 8;

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
  private captureInspections = new Map<string,CachedCaptureInspection>();
  private captureInspectionLoads = new Map<string,Promise<void>>();
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
          const priorSearchMatchId=this.searchQuery.trim()&&this.route!=="history"&&prior?keyOf(prior):undefined;
          const preservePriorSearchMatch=!!priorSearchMatchId&&this.searchMatchedIds.has(priorSearchMatchId);
          const received = await this.client.snapshot(); validateSnapshot(received);
          // Capture text belongs to the selected detail flow. The Global
          // summary may include an internal witness ledger for backup/read
          // compatibility, so discard it before keeping routine UI state.
          const next = { ...received } as GlobalSnapshot & { capture_witnesses?: unknown };
          delete next.capture_witnesses;
          this.reconcileLinkedSamples(next);
          this.snapshot = next;
          this.pageOffsets.clear();this.pageTotals.clear();this.linkedOffsets.clear();this.archiveCollectionIndex=0;this.overviewCollectionIndex=0;this.searchMatchedIds.clear();this.pageError=undefined;
          if(prior){
            await this.retainSelectedRow(prior);
            // A server search can match fields omitted from local row filtering
            // (for example due dates). Preserve that stable selection across
            // the refresh after rehydrating the selected row.
            if(preservePriorSearchMatch&&priorSearchMatchId&&this.snapshotContainsRow(prior))this.searchMatchedIds.add(priorSearchMatchId);
          }
          await this.loadHistory();if(prior&&"operation_id" in prior&&!this.historyEvents.some(e=>e.operation_id===prior.operation_id))this.historyEvents.push(prior); this.sampledAt = Date.now(); this.lastRefreshError = undefined;
          if(this.searchQuery.trim()&&this.route!=="history")await this.loadMoreRows();
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

  /**
   * Return complete picker choices. Snapshot rows remain the fast path when
   * the summary is known complete; a capped summary is filled from bounded,
   * revision-pinned service pages before it is offered to a form.
   */
  async completeChoices<T extends Project|Item|Status>(collection:ChoiceCollection,projectId?:string|null):Promise<T[]>{
    const snapshot=this.snapshot;if(!snapshot)throw new Error("a current Global snapshot is required to load choices");
    this.pageError=undefined;
    const visible=snapshot[collection] as T[];
    const knownTotal=snapshot.totals?.[collection];
    const incomplete=typeof knownTotal==="number"?knownTotal>visible.length:snapshot.snapshot_limit!==undefined&&visible.length>=snapshot.snapshot_limit;
    const belongs=(row:T):boolean=>collection==="projects"?true:projectId===undefined||((row as Item|Status).project_id===projectId);
    if(!incomplete){return visible.filter(row=>belongs(row)&&!(collection==="projects"&&(row as Project).archived)&&!(collection==="items"&&(row as Item).archived));}

    const client=this.client as GlobalServiceClient&{detailPage?<U=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;expectedRevision?:number}):Promise<GlobalPage<U>>};
    if(!client.detailPage)throw new Error(`the ${collection} summary is incomplete and complete choices are unavailable`);
    const revision=snapshot.revision;let expectedRevision=revision,offset=0,total:number|undefined;const rows:T[]=[];
    this.pageLoading=true;this.pageError=undefined;
    try{
      for(;;){
        const page=await client.detailPage<T>(collection,{...(typeof projectId==="string"?{projectId}:{}),limit:100,offset,expectedRevision});
        if(page.resnapshot_required||page.revision!==expectedRevision){
          if(!this.refreshing){this.pageLoading=false;await this.refresh();}
          throw new Error(`the Global revision changed while loading ${collection} choices; the snapshot was refreshed, reopen the picker`);
        }
        if(page.offset!==offset||!Number.isSafeInteger(page.total)||page.total<0||page.rows.length>page.limit||page.limit<1){
          throw new Error(`the service returned an invalid ${collection} page`);
        }
        if(total!==undefined&&page.total!==total)throw new Error(`the ${collection} total changed within a revision`);
        total=page.total;rows.push(...page.rows);
        const next=page.next_offset;
        if(next===null){if(rows.length!==total)throw new Error(`the ${collection} choices were incomplete (${rows.length} of ${total} rows loaded)`);break;}
        if(!Number.isSafeInteger(next)||next<=offset||next!==offset+page.rows.length||!page.has_more)throw new Error(`the service returned an invalid ${collection} page cursor`);
        offset=next;expectedRevision=page.revision;
      }
      return rows.filter(row=>belongs(row)&&!(collection==="projects"&&(row as Project).archived)&&!(collection==="items"&&(row as Item).archived));
    }catch(error){this.pageError=error instanceof Error?error.message:String(error);throw error;}
    finally{this.pageLoading=false;}
  }

  async loadMoreRows():Promise<boolean>{
    if(this.pageLoading||!this.snapshot)return false;
    if(this.route==="history"){
      if(!this.historyHasMore||this.historyEvents.length===0)return false;
      const offset=this.historyEvents.length;this.pageLoading=true;try{await this.loadHistory(offset);return !this.historyError;}finally{this.pageLoading=false;}
    }
    if(this.inspectorTab==="linked"&&this.selectedRow()&&"identity" in (this.selectedRow() as object))return this.loadMoreLinked();
    const routes:Record<string,string>={projects:"projects",board:"items",list:"items",planning:"items",todos:"items",inbox:"items",notes:"notes",workflow:"statuses",links:"associations"};const archiveCollections=["projects","items","notes"];const overviewCollections=["items","projects"];let collection=this.route==="archive"?archiveCollections[this.archiveCollectionIndex]:this.route==="overview"?overviewCollections[this.overviewCollectionIndex]:routes[this.route];if(!collection)return false;
    const client=this.client as GlobalServiceClient&{detailPage?<T=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;includeArchived?:boolean;kind?:string;query?:string;expectedRevision?:number}):Promise<GlobalPage<T>>};if(!client.detailPage){this.pageError="complete paging is unavailable from this Global service client";return false;}
    const includeArchived=this.route==="archive";
    const activeSnapshot=this.snapshot,activeRoute=this.route,activeScope=this.projectId,activeQuery=this.searchQuery;
    const key=`${collection}:${activeScope??"*"}:${activeRoute}:${activeQuery}:${includeArchived}`;let offset=this.pageOffsets.get(key);if(offset===undefined){const data=activeSnapshot[collection as "projects"|"items"|"notes"|"statuses"|"associations"] as unknown[];offset=activeQuery.trim()?0:summaryVisibleCount(activeSnapshot,collection,data,activeScope,includeArchived);}
    this.pageLoading=true;this.pageError=undefined;
    try{
      const page=await client.detailPage(collection,{...(activeScope?{projectId:activeScope}:{}),limit:100,offset,includeArchived,...(activeQuery.trim()?{query:activeQuery.trim()}:{}),expectedRevision:activeSnapshot.revision});
      if(this.snapshot!==activeSnapshot||this.route!==activeRoute||this.projectId!==activeScope||this.searchQuery!==activeQuery)return false;
      if(page.resnapshot_required||page.revision!==activeSnapshot.revision){
        this.pageLoading=false;
        if(!this.refreshing)await this.refresh();
        this.pageError=`The Global revision changed while loading this page; refreshed. Search again or load the next page to continue.`;return false;
      }
      if(page.offset!==offset||!Number.isSafeInteger(page.total)||page.total<0||page.rows.length>page.limit||page.limit<1||(page.next_offset!==null&&page.next_offset!==page.offset+page.rows.length)||(page.has_more!==undefined&&(page.next_offset!==null)!==page.has_more))throw new Error("the service returned an invalid page or cursor");
      if(activeQuery.trim())for(const row of page.rows as unknown[]){const id=keyOf(row as Row);if(id)this.searchMatchedIds.add(id);}
      this.pageTotals.set(`${activeRoute}:${activeScope??"*"}:${activeQuery}:${collection}`,page.total);
      this.appendPage(collection,page.rows as never[]);this.pageOffsets.set(key,page.next_offset??page.offset+page.rows.length);this.reconcileSelection();
      if(this.route==="archive"&&page.next_offset===null){if(this.archiveCollectionIndex+1<archiveCollections.length){this.archiveCollectionIndex++;this.pageLoading=false;return await this.loadMoreRows();}this.archiveCollectionIndex=0;return page.rows.length>0;}
      if(this.route==="overview"&&page.next_offset===null){if(this.overviewCollectionIndex+1<overviewCollections.length){this.overviewCollectionIndex++;this.pageLoading=false;return await this.loadMoreRows();}this.overviewCollectionIndex=0;return page.rows.length>0;}
      return page.rows.length>0;
    }catch(error){this.pageError=error instanceof Error?error.message:String(error);return false;}finally{this.pageLoading=false;}
  }

  async search(query:string):Promise<void>{this.searchQuery=query.trim();this.selected=0;this.selectedId=undefined;this.searchMatchedIds.clear();this.pageOffsets.clear();this.pageTotals.clear();this.archiveCollectionIndex=0;this.overviewCollectionIndex=0;this.pageError=undefined;this.reconcileSelection();if(!this.searchQuery)return;
    await this.loadMoreRows();
  }

  async loadSelectedDetail():Promise<void>{
    const row=this.selectedRow();if(!row)return;this.detailLoading=true;
    try{
      if("title" in row&&!("status_id" in row)&&!("operation_id" in row)){const client=this.client as GlobalServiceClient&{noteShow?(noteId:string):Promise<Note>};const full=client.noteShow?await client.noteShow(row.id):await this.client.execute<Note>("note show",{note_id:row.id});this.replaceSnapshotRow("notes",row.id,full);}
      else if("title" in row&&"status_id" in row){const full=await this.client.execute<Item>(row.kind==="milestone"?"milestone show":row.kind==="task"?"task show":"todo show",{item_id:row.id});this.replaceSnapshotRow("items",row.id,full);const selected=this.snapshot?.items.find(item=>item.id===row.id);if(selected)await this.loadCaptureInspection(selected);}
    }finally{this.detailLoading=false;}
  }

  captureInspectionFor(item:Item):CaptureInspection|undefined{
    const raw=(item as Item&{capture_origin?:unknown}).capture_origin;
    if(raw===undefined||raw===null)return undefined;
    const origin=captureOriginFor(item);
    if(!origin)return{status:"unavailable",message:"Capture provenance metadata is malformed."};
    const cached=this.captureInspections.get(item.id);
    return cached?.digest===origin.digest?cached.inspection:{status:"not_loaded"};
  }

  private async loadCaptureInspection(item:Item):Promise<void>{
    const raw=(item as Item&{capture_origin?:unknown}).capture_origin;
    if(raw===undefined||raw===null)return;
    const origin=captureOriginFor(item);
    if(!origin){this.rememberCaptureInspection(item.id,"",{status:"unavailable",message:"Capture provenance metadata is malformed."});return;}
    const cached=this.captureInspections.get(item.id);
    if(cached?.digest===origin.digest&&["available","missing","bounded"].includes(cached.inspection.status))return;
    const key=`${item.id}\0${origin.digest}`;
    const existing=this.captureInspectionLoads.get(key);if(existing)return existing;
    const pending=(async()=>{
      this.rememberCaptureInspection(item.id,origin.digest,{status:"loading"});
      try{
        const historyClient=this.client as GlobalServiceClient&{history?: (options?:{entityId?:string;limit?:number;offset?:number})=>Promise<{events:GlobalActivityEvent[];current_revision:number;total:number;limit:number;offset:number;has_more:boolean;next_offset:number|null}>};
        if(!historyClient.history){this.rememberCaptureInspection(item.id,origin.digest,{status:"unavailable",message:"This Global client cannot read capture activity history."});return;}
        const page=await historyClient.history({entityId:item.id,limit:CAPTURE_HISTORY_LIMIT,offset:0});
        if(!validCaptureHistoryPage(page)){
          this.rememberCaptureInspection(item.id,origin.digest,{status:"unavailable",message:"Global returned an invalid capture history page; the origin digest remains available."});return;
        }
        const event=page.events.find(candidate=>candidate.entity_id===item.id&&candidate.command==="todo add");
        if(!event){
          const message=page.has_more
            ? `The original capture is outside the newest ${CAPTURE_HISTORY_LIMIT} retained item history events; the origin digest remains available.`
            : "No retained capture operation was found in item history; the origin digest remains available.";
          this.rememberCaptureInspection(item.id,origin.digest,{status:page.has_more?"bounded":"missing",message});return;
        }
        const operationClient=this.client as GlobalServiceClient&{operationShow?: (operationId:string)=>Promise<GlobalOperationResult>};
        const operation=operationClient.operationShow
          ? await operationClient.operationShow(event.operation_id)
          : await this.client.execute<GlobalOperationResult>("operation show",{operation_id:event.operation_id});
        const witness=await captureWitnessFromOperation(operation,event,item,origin);
        if(!witness){this.rememberCaptureInspection(item.id,origin.digest,{status:"unavailable",message:"The retained capture operation has no witness matching this item and origin digest; the digest remains available."});return;}
        this.rememberCaptureInspection(item.id,origin.digest,{status:"available",witness});
      }catch(error){
        this.rememberCaptureInspection(item.id,origin.digest,{status:"unavailable",message:`Capture history could not be read: ${error instanceof Error?error.message:String(error)}. The origin digest remains available.`});
      }
    })().finally(()=>this.captureInspectionLoads.delete(key));
    this.captureInspectionLoads.set(key,pending);return pending;
  }

  private rememberCaptureInspection(itemId:string,digest:string,inspection:CaptureInspection):void{
    this.captureInspections.delete(itemId);this.captureInspections.set(itemId,{digest,inspection});
    while(this.captureInspections.size>CAPTURE_INSPECTION_CACHE_LIMIT){const oldest=this.captureInspections.keys().next().value as string|undefined;if(oldest===undefined)break;this.captureInspections.delete(oldest);}
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

  private appendPage(collection:string,rows:never[]):void{const snap=this.snapshot as unknown as Record<string,unknown>;const current=snap[collection];if(!Array.isArray(current))return;const key=(x:unknown):string=>keyOf(x as Row)??JSON.stringify(x);const known=new Set(current.map(key));snap[collection]=[...current,...rows.filter(row=>!known.has(key(row)))];}
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
      else if("label" in row&&"status_id" in row&&!this.snapshot.statuses.some(s=>s.status_id===row.status_id&&s.project_id===row.project_id)){const client=this.client as GlobalServiceClient&{detailPage?<T=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;query?:string}):Promise<GlobalPage<T>>};if(client.detailPage){const page=await client.detailPage("statuses",{...(row.project_id?{projectId:row.project_id}:{}),query:row.status_id,limit:100,offset:0});if(page.revision===this.snapshot.revision)this.appendPage("statuses",page.rows as never[]);}}
      else if("identity" in row&&!this.snapshot.associations.some(a=>a.identity===row.identity&&a.project_id===row.project_id&&a.kind===row.kind)){const client=this.client as GlobalServiceClient&{detailPage?<T=unknown>(collection:string,options?:{projectId?:string;limit?:number;offset?:number;query?:string}):Promise<GlobalPage<T>>};if(client.detailPage){const page=await client.detailPage("associations",{projectId:row.project_id,query:row.identity,limit:100,offset:0});if(page.revision===this.snapshot.revision)this.appendPage("associations",page.rows as never[]);}}
    }catch{/* Keep the last selection if it can still be resolved from the retained snapshot. */}
  }

  private snapshotContainsRow(row:Row):boolean{
    const snapshot=this.snapshot;if(!snapshot)return false;
    if("id" in row){
      if("status_id" in row)return snapshot.items.some(candidate=>candidate.id===row.id);
      if("name" in row)return snapshot.projects.some(candidate=>candidate.id===row.id);
      return snapshot.notes.some(candidate=>candidate.id===row.id);
    }
    if("status_id" in row)return snapshot.statuses.some(candidate=>candidate.project_id===row.project_id&&candidate.status_id===row.status_id);
    if("identity" in row)return snapshot.associations.some(candidate=>candidate.project_id===row.project_id&&candidate.kind===row.kind&&candidate.identity===row.identity);
    return false;
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
    const archivedOwners=new Set(snap.projects.filter(p=>p.archived).map(p=>p.id));
    const q=this.searchQuery.trim().toLocaleLowerCase();
    return snap.items.filter(i=>!i.archived&&!(i.project_id&&archivedOwners.has(i.project_id))&&(route==="inbox"?(this.projectId?i.project_id===this.projectId:true):(!this.projectId||i.project_id===this.projectId))&&!isDone(this.statusFor(i))&&(route==="inbox"?isInbox(this.statusFor(i)):matchesTodoFilter(i,this.todoFilter))&&(!q||this.searchMatchedIds.has(i.id)||[i.title,i.description??"",this.projectName(i.project_id),this.statusFor(i)?.label??""].some(v=>v.toLocaleLowerCase().includes(q))))
      .sort((a,b)=>route==="todos"?compareDailyItems(a,b,this.todoFilter):urgency(a)-urgency(b)||a.position-b.position||a.id.localeCompare(b.id));
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
  selectId(id:string|undefined):void{if(id){const row=this.rows().find(candidate=>publicRowId(candidate)===id||keyOf(candidate)===id);this.selectedId=row?keyOf(row):id;}else this.selectedId=undefined;this.reconcileSelection();}
  selectRow(row:Row):void{this.selectedId=keyOf(row);this.reconcileSelection();}
  rowKey(row:Row|undefined):string|undefined{return keyOf(row);}
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
  projectAttention(project:Project):ProjectAttentionView{return this.attentionSnapshot()?.projects?.[project.id]??{};}
  personalAttention():ProjectAttentionView{return this.attentionSnapshot()?.personal??{};}
  portfolioAttention():Record<string,number>|undefined{return this.attentionSnapshot()?.portfolio;}
  civilTime():CivilTimeView|undefined{return (this.snapshot as (GlobalSnapshot&{civil_time?:CivilTimeView})|undefined)?.civil_time;}
  attentionSnapshot():AttentionSnapshot|undefined{return (this.snapshot as (GlobalSnapshot&{attention?:AttentionSnapshot})|undefined)?.attention;}
  projectNextAction(project:Project):ProjectAttentionView["next_action"]{return this.projectAttention(project).next_action??undefined;}
  projectNextMilestone(project:Project):ProjectAttentionView["next_milestone"]{return this.projectAttention(project).next_milestone??undefined;}
  itemBreadcrumb(item:Item):string[]{const byId=new Map((this.snapshot?.items??[]).map(i=>[i.id,i]));const parts:string[]=[];const seen=new Set<string>();let current:Item|undefined=item;while(current?.parent_id&&!seen.has(current.parent_id)){seen.add(current.parent_id);const parent=byId.get(current.parent_id);if(!parent)break;parts.unshift(parent.title);current=parent;}return parts;}
  milestoneProgress(item:Item):{completed:number;total:number;visibleOnly:boolean}{const p=item.project_id?this.snapshot?.projects.find(x=>x.id===item.project_id):undefined;const m=p?this.projectAttention(p).next_milestone:undefined;if(m?.item_id===item.id)return{completed:m.completed_children,total:m.total_children,visibleOnly:false};const children=(this.snapshot?.items??[]).filter(i=>i.parent_id===item.id&&!i.archived);return{completed:children.filter(i=>this.statusFor(i)?.category==="completed").length,total:children.length,visibleOnly:true};}
  projectLastActivity(project:Project):ActivityRow|undefined{const entities=new Set([project.id,...(this.snapshot?.items??[]).filter(i=>i.project_id===project.id).map(i=>i.id),...(this.snapshot?.notes??[]).filter(n=>n.project_id===project.id).map(n=>n.id)]);return this.historyEvents.filter(e=>e.entity_id&&entities.has(e.entity_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];}
  overviewRows():Row[]{
    const snap=this.snapshot;if(!snap)return[];const q=this.searchQuery.trim().toLocaleLowerCase();const match=(...v:string[])=>!q||v.some(x=>x.toLocaleLowerCase().includes(q));
    const open=this.items.filter(i=>!isDone(this.statusFor(i))).sort((a,b)=>urgency(a)-urgency(b)||(b.priority??-1)-(a.priority??-1)||a.position-b.position);
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

export function validateSnapshot(v:GlobalSnapshot):void{if(!v||![2,3].includes(v.schema_version)||!Number.isSafeInteger(v.revision)||v.revision<0)throw new Error("global snapshot schema or revision is invalid");for(const k of ["projects","items","notes","statuses","relationships","associations"] as const)if(!Array.isArray(v[k]))throw new Error(`global snapshot ${k} must be an array`);for(const p of v.projects)if(typeof p.id!=="string"||typeof p.name!=="string")throw new Error("global snapshot contains malformed project");for(const i of v.items)if(typeof i.id!=="string"||typeof i.title!=="string"||typeof i.status_id!=="string")throw new Error("global snapshot contains malformed item");}
export function captureOriginFor(item:Item):CaptureOrigin|undefined{
  const value=(item as unknown as {capture_origin?:unknown}).capture_origin;
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const origin=value as Record<string,unknown>;
  if(typeof origin.digest!=="string"||!/^sha256:[0-9a-f]{64}$/u.test(origin.digest))return undefined;
  if(origin.source_ref!==undefined&&origin.source_ref!==null&&typeof origin.source_ref!=="string")return undefined;
  if(typeof origin.source_ref==="string"&&(origin.source_ref.trim().length===0||new TextEncoder().encode(origin.source_ref).length>4096||/\p{Cc}/u.test(origin.source_ref)))return undefined;
  return{digest:origin.digest,...(origin.source_ref===undefined?{}:{source_ref:origin.source_ref as string|null})};
}
function validCaptureHistoryPage(page:{events:GlobalActivityEvent[];current_revision:number;total:number;limit:number;offset:number;has_more:boolean;next_offset:number|null}):boolean{
  if(!page||!Array.isArray(page.events)||!Number.isSafeInteger(page.current_revision)||page.current_revision<0||!Number.isSafeInteger(page.total)||page.total<0||page.limit!==CAPTURE_HISTORY_LIMIT||page.offset!==0||page.events.length>page.limit||page.events.length>CAPTURE_HISTORY_LIMIT||page.total<page.events.length||typeof page.has_more!=="boolean")return false;
  const next=page.events.length;
  const hasMore=next<page.total;
  if(page.has_more!==hasMore||page.next_offset!==(hasMore?next:null))return false;
  if(hasMore&&page.events.length===0)return false;
  return page.events.every(event=>!!event&&typeof event.operation_id==="string"&&event.operation_id.length>0&&Number.isSafeInteger(event.revision)&&event.revision>0&&event.revision<=page.current_revision&&typeof event.command==="string"&&(event.entity_id===null||typeof event.entity_id==="string"));
}
async function captureWitnessFromOperation(operation:GlobalOperationResult,event:GlobalActivityEvent,item:Item,origin:CaptureOrigin):Promise<CaptureWitness|undefined>{
  if(!operation||operation.operation_id!==event.operation_id||operation.revision!==event.revision||!Number.isSafeInteger(operation.revision)||!operation.result||typeof operation.result!=="object"||Array.isArray(operation.result)||operation.result.id!==item.id)return undefined;
  const raw=operation.result.capture_witness;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return undefined;
  const witness=raw as Record<string,unknown>;
  if(witness.item_id!==item.id||witness.revision!==event.revision||typeof witness.captured_at!=="string"||typeof witness.text!=="string"||witness.digest!==origin.digest)return undefined;
  const sourceRef=witness.source_ref;
  if(sourceRef!==undefined&&sourceRef!==null&&typeof sourceRef!=="string")return undefined;
  if((sourceRef??null)!==(origin.source_ref??null))return undefined;
  const digestBytes=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(witness.text));
  const digest=`sha256:${Array.from(new Uint8Array(digestBytes),byte=>byte.toString(16).padStart(2,"0")).join("")}`;
  if(digest!==origin.digest)return undefined;
  return{item_id:item.id,revision:event.revision,captured_at:witness.captured_at,text:witness.text,digest:origin.digest,...(sourceRef===undefined?{}:{source_ref:sourceRef as string|null})};
}
export function isDone(status:Status|undefined):boolean{return status?.category==="completed"||status?.category==="cancelled";}
export function dailyClassification(item:Item):DailyClassificationView|undefined{return (item as Item&{daily_classification?:DailyClassificationView}).daily_classification;}
export function isOverdue(item:Item):boolean{return dailyClassification(item)?.deadline==="overdue";}
function urgency(item:Item):number{const group=dailyClassification(item)?.group;return group==="overdue"?0:group==="due_today"?1:group==="waiting"?2:group==="unscheduled"?3:group==="later"?4:5;}
function isWaiting(item:Item):boolean{return dailyClassification(item)?.waiting===true;}
function followUpTime(item:Item):number{const value=item.follow_up_at;if(typeof value!=="string")return Number.MAX_SAFE_INTEGER;const time=Date.parse(value);return Number.isFinite(time)?time:Number.MAX_SAFE_INTEGER;}
function compareDailyItems(left:Item,right:Item,filter:TodoFilter):number{
  if(filter==="waiting")return followUpTime(left)-followUpTime(right)||(right.priority??-1)-(left.priority??-1)||left.position-right.position||left.id.localeCompare(right.id);
  const leftWaiting=isWaiting(left),rightWaiting=isWaiting(right);
  return urgency(left)-urgency(right)
    ||Number(rightWaiting)-Number(leftWaiting)
    ||(leftWaiting?followUpTime(left)-followUpTime(right):0)
    ||(right.priority??-1)-(left.priority??-1)
    ||left.position-right.position
    ||left.id.localeCompare(right.id);
}
function isInbox(s:Status|undefined):boolean{return s?.category==="inbox"||s?.status_id.toLowerCase()==="inbox";}
function matchesTodoFilter(item:Item,filter:TodoFilter):boolean{if(filter==="all_open")return true;return dailyClassification(item)?.filters?.[filter]===true;}
function keyOf(r:Row|undefined):EntityKey|undefined{return r?("operation_id" in r?`operation:${r.operation_id}`:"id" in r?r.id:"status_id" in r?`status:${r.project_id??""}\0${r.status_id}`:"identity" in r?`association:${r.project_id}\0${r.kind}\0${r.identity}`:undefined):undefined;}
function publicRowId(r:Row):string|undefined{return "operation_id" in r?r.operation_id:"id" in r?r.id:"status_id" in r?r.status_id:"identity" in r?r.identity:undefined;}
function summaryVisibleCount(snapshot:GlobalSnapshot,collection:string,data:unknown[],projectId:string|undefined,includeArchived:boolean):number{
  // Archived detail pages include records owned by archived projects, while
  // routine summaries deliberately omit those records. There is no reliable
  // raw collection offset for that mixed sample, so start at zero and let the
  // stable row keys deduplicate records already present in the summary.
  if(includeArchived)return 0;
  const archivedProjects=new Set(snapshot.projects.filter(project=>project.archived).map(project=>project.id));
  return data.filter(value=>{
    if(!value||typeof value!=="object")return false;
    const row=value as Record<string,unknown>;const owner=collection==="projects"&&typeof row.id==="string"?row.id:typeof row.project_id==="string"?row.project_id:undefined;
    if(projectId&&owner!==projectId)return false;
    if(row.archived===true)return false;
    if(owner&&archivedProjects.has(owner))return false;
    if(collection==="statuses"&&owner&&archivedProjects.has(owner))return false;
    return true;
  }).length;
}
function clamp(n:number,min:number,max:number):number{return Math.max(min,Math.min(max,n));}
function safe(s:string):string{return s.replace(/[\u0000-\u001f\u007f-\u009f\u001b]/g," ").slice(0,80);}
