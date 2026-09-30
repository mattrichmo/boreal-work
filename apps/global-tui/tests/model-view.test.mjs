import test from "node:test";
import assert from "node:assert/strict";
import { GlobalController, isOverdue } from "../dist/model.js";
import { render, ROUTE_MENU } from "../dist/view.js"

const now = new Date().toISOString();
function fixture(){
 const projects=[{id:"life",name:"Life",description:"Personal",archived:false,created_at:now,updated_at:now},{id:"biz",name:"Business",description:"Launch",archived:false,created_at:now,updated_at:now}];
 const statuses=[];for(const id of ["life","biz"])for(let n=0;n<9;n++)statuses.push({project_id:id,status_id:`s${n}`,label:`Status ${n}`,category:n===8?"completed":"open",position:n});
 const items=[];for(let n=0;n<55;n++)items.push({id:`item${n}`,project_id:n%2?"life":"biz",parent_id:n===40?"item2":null,kind:n===2?"milestone":"task",title:`Task ${n}`,description:n===25?"Long detail ".repeat(24):"",labels:[],status_id:`s${n%9}`,priority:n%4,due_at:n===3?"2001-01-01T00:00:00Z":null,archived:false,position:n,created_at:now,updated_at:now});
 const snapshot={schema_version:2,revision:6,projects,items,notes:[],statuses,relationships:[{source_id:"item25",target_id:"item2",kind:"depends_on"}],associations:[{project_id:"biz",kind:"workspace",identity:"code-project",path:"/work/code",updated_at:now}],linked_projects:[{management_project_id:"biz",project_id:"code-project",path:"/work/code",availability:"available",revision:3,as_of:now,counts:{open:4}}]};
 return {snapshot,client:{snapshot:async()=>structuredClone(snapshot),execute:async()=>({})}};
}
test("board selection stays visible across every status at narrow terminal widths",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("board");
 // Seven down to the seventh status, even though only one column fits.
 for(let n=0;n<7;n++)c.moveBoardColumn(1);
 assert.equal(c.boardStatuses[c.boardColumn].status_id,"s7");
 const screen=render(c,40,14);assert.match(screen,/Status 7/);assert.match(screen,/Task/);assert.doesNotMatch(screen,/widen terminal/);
});
test("list viewport keeps selected row visible when descriptions wrap into many lines",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("list");c.selectId("item25");
 const screen=render(c,80,16);assert.match(screen,/Task 25/);assert.match(screen,/Task 25/);assert.ok(screen.split("\n").length<=16);assert.ok(screen.split("\n").every(line=>line.length<=80));
});
test("All projects scope exposes portfolio work and a selected project retains stable ID after refresh",async()=>{
 const {client,snapshot}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("overview");
 const home=render(c,120,30);assert.match(home,/Portfolio/);assert.match(home,/Life/);assert.match(home,/Business/);assert.match(home,/OVERDUE/);
 c.setRoute("projects");c.selectId("biz");snapshot.projects.reverse();await c.refresh();assert.equal(c.selectedId,"biz");assert.equal(c.selectedProject?.id,"biz");
});
test("planning preserves nested records and inspector shows relationships and linked progress",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("biz");c.setRoute("planning");assert.match(render(c,120,30),/Task 2/);
 c.setRoute("list");c.selectId("item2");c.inspectorTab="relationships";assert.match(render(c,140,30),/depends_on/);
 c.setRoute("projects");c.selectId("biz");const projectDetails=render(c,140,30);assert.match(projectDetails,/Lifecycle/);assert.match(projectDetails,/Health/);c.inspectorTab="relationships";assert.match(render(c,140,30),/available/);
});
test("overdue calculation is date based and archive route retains archived records",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();assert.equal(isOverdue(c.snapshot.items.find(i=>i.id==="item3")),true);
 c.snapshot.items[3].archived=true;c.setRoute("archive");assert.ok(c.rows().some(i=>i.id==="item3"));
});
test("deep board card is selected and visible after vertical scrolling",async()=>{
 const {client}=fixture();const s=await client.snapshot();for(let n=0;n<30;n++)s.items.push({...s.items[1],id:`deep${n}`,title:`Deep card ${n}`,project_id:"life",status_id:"s7",position:60+n});
 const c=new GlobalController({snapshot:async()=>structuredClone(s),execute:async()=>({})});await c.refresh();c.setScope("life");c.setRoute("board");c.boardColumn=c.boardStatuses.findIndex(x=>x.status_id==="s7");for(let n=0;n<25;n++)c.moveSelection(1);
 assert.equal(c.selectedRow()?.id,c.boardSelected?.id);const screen=render(c,40,14);assert.match(screen,new RegExp(c.boardSelected.title));assert.match(screen,/Status 7/);
});
test("inspector can take over a narrow screen on focus",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("list");c.selectId("item25");c.focus="inspector";const screen=render(c,80,16);assert.match(screen,/INSPECT/);assert.match(screen,/Task 25/);assert.ok(screen.split("\n").every(line=>line.length<=80));
});
test("history route shows retained status transitions",async()=>{
 const {client,snapshot}=fixture();snapshot.status_history=[{item_id:"item25",from_status_id:"s1",to_status_id:"s7",revision:4,changed_at:"2026-09-29T14:00:00Z"}];const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("history");c.selectId("item25");const screen=render(c,100,20);assert.match(screen,/s1 → s7/);assert.match(screen,/Sep 29, 2026/);
});
test("all record routes preserve a deep selection across 50+ rows",async()=>{
 const {snapshot}=fixture();
 for(let n=0;n<60;n++){
   snapshot.projects.push({id:`p${n}`,name:`Project ${n}`,description:"",archived:n>50,created_at:now,updated_at:now});
   snapshot.items.push({id:`wide${n}`,project_id:n%2?"life":"biz",parent_id:null,kind:"task",title:`Wide task ${n}`,description:"",labels:[],status_id:`s${n%9}`,priority:null,due_at:null,archived:n>=50,position:100+n,created_at:now,updated_at:now});
   snapshot.notes.push({id:`note${n}`,project_id:n%2?"life":"biz",title:`Note ${n}`,body:"Body",archived:n>=50,created_at:now,updated_at:now});
   snapshot.associations.push({project_id:"biz",kind:"workspace",identity:`workspace-${n}`,path:`/workspace/${n}`,updated_at:now});
   snapshot.statuses.push({project_id:"life",status_id:`extra${n}`,label:`Extra ${n}`,category:"open",position:20+n});
 }
 const events=Array.from({length:60},(_,n)=>({operation_id:`op${n}`,revision:n+1,command:"todo edit",entity_kind:"item",entity_id:`wide${n}`,title:`Activity ${n}`,summary:`Changed task ${n}`,created_at:now}));
 const client={snapshot:async()=>structuredClone(snapshot),history:async()=>({events:structuredClone(events),total:60,has_more:false}),execute:async()=>({})};const c=new GlobalController(client);await c.refresh();
 const cases=[
  ["projects","p49","Project 49"],["board","wide49","Wide task 49"],["list","wide49","Wide task 49"],
  ["todos","wide49","Wide task 49"],["inbox","personal49","Personal capture 49"],["notes","note49","Note 49"],
  ["links","workspace-49","workspace-49"],["planning","wide49","Wide task 49"],["archive","wide55","Wide task 55"],
  ["history","op49","Activity 49"],["overview","wide49","Wide task 49"]
 ];
 snapshot.items.push(...Array.from({length:60},(_,n)=>({id:`personal${n}`,project_id:null,parent_id:null,kind:"task",title:`Personal capture ${n}`,description:"",labels:[],status_id:"todo",priority:null,due_at:null,archived:false,position:200+n,created_at:now,updated_at:now})));await c.refresh();
 for(const [route,id,visible] of cases){c.setScope();c.todoFilter="all_open";c.setRoute(route);if(route==="archive")c.selectId(id);else if(route==="todos")c.selectId(id);else c.selectId(id);assert.equal(c.selectedRow()?.id??c.selectedRow()?.identity,id,`${route} selected ID`);const screen=render(c,120,24);assert.match(screen,new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),`${route} selected record visible`);}
 // Personal quick captures are immediately discoverable in All projects Inbox.
 c.setRoute("inbox");c.selectId("personal59");assert.equal(c.selectedRow()?.title,"Personal capture 59");assert.match(render(c,80,16),/Personal capture 59/);
});
test("todo views filter Today, overdue, waiting, and all open independently",async()=>{
 const {snapshot}=fixture();const local=new Date();const today=`${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,"0")}-${String(local.getDate()).padStart(2,"0")}`;const project="life";
 snapshot.statuses.push({project_id:project,status_id:"waiting",label:"Waiting",category:"waiting",position:10});
 snapshot.items[3].archived=true;snapshot.items.push(
  {...snapshot.items[0],id:"due-today",project_id:project,title:"Due today",status_id:"s0",due_at:`${today}T23:00:00Z`},
  {...snapshot.items[0],id:"due-old",project_id:project,title:"Overdue work",status_id:"s0",due_at:"2001-01-01T00:00:00Z"},
  {...snapshot.items[0],id:"waiting",project_id:project,title:"Waiting reply",status_id:"waiting",due_at:null},
  {...snapshot.items[0],id:"unscheduled",project_id:project,title:"Unscheduled",status_id:"s0",due_at:null}
 );const c=new GlobalController({snapshot:async()=>structuredClone(snapshot),execute:async()=>({})});await c.refresh();c.setScope(project);c.setRoute("todos");
 c.todoFilter="today";assert.ok(c.rows().some(x=>x.id==="due-today"));assert.ok(c.rows().some(x=>x.id==="unscheduled"));assert.ok(!c.rows().some(x=>x.id==="due-old"));assert.ok(!c.rows().some(x=>x.id==="waiting"));
 c.todoFilter="overdue";assert.deepEqual(c.rows().map(x=>x.id),["due-old"]);
 c.todoFilter="waiting";assert.deepEqual(c.rows().map(x=>x.id),["waiting"]);
 c.todoFilter="all_open";for(const id of ["due-today","due-old","waiting","unscheduled"])assert.ok(c.rows().some(x=>x.id===id));
 snapshot.items.push({...snapshot.items[0],id:"personal0",project_id:null,title:"Personal inbox capture",status_id:"todo",due_at:null});await c.refresh();c.setScope();c.setRoute("inbox");assert.ok(c.rows().some(x=>x.id==="personal0"));
});
test("archive respects project scope and keeps archived project children reachable",async()=>{
 const {client,snapshot}=fixture();snapshot.projects[1].archived=true;snapshot.items[0].archived=true;snapshot.items.push({...snapshot.items[0],id:"biz-child",project_id:"biz",archived:false,title:"Child of archived project"},{...snapshot.items[0],id:"life-archived",project_id:"life",archived:true});const c=new GlobalController(client);await c.refresh();c.setRoute("archive");assert.ok(c.rows().some(x=>x.id==="biz"));assert.ok(c.rows().some(x=>x.id==="biz-child"));c.setScope("life");assert.ok(c.rows().some(x=>x.id==="life-archived"));assert.ok(!c.rows().some(x=>x.id==="biz"));
});
test("inspector tabs show distinct details, relationship, history, and execution content",async()=>{
 const {client,snapshot}=fixture();snapshot.status_history=[{item_id:"item1",from_status_id:"inbox",to_status_id:"done",revision:2,changed_at:now}];snapshot.linked_projects=[{management_project_id:"life",project_id:"workspace-x",path:"/work/x",availability:"available",revision:8,as_of:now,counts:{open:2},items:[{work_id:"w1",project_id:"workspace-x",title:"Linked task",kind:"task",parent_id:null,lifecycle:"active",display_status:"In progress",status:"in_progress",priority:0,reason_codes:[]}]}];snapshot.associations=[{project_id:"life",kind:"workspace",identity:"workspace-x",path:"/work/x",updated_at:now}];const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("list");c.selectId("item1");
 c.inspectorTab="details";assert.match(render(c,140,30),/Task 1/);
 c.inspectorTab="relationships";assert.match(render(c,140,30),/No relationships recorded/);
 c.inspectorTab="history";assert.match(render(c,140,30),/inbox → done/);
 c.inspectorTab="linked";assert.match(render(c,140,30),/Linked task/);
});

test("narrow navigation focus shows a reachable window in shared route order",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setRoute("inbox");c.focus="navigation";const screen=render(c,60,12);assert.match(screen,/Inbox/);assert.match(screen,/▸ Inbox/);assert.deepEqual(ROUTE_MENU.map(([route])=>route),["overview","projects","board","list","todos","notes","workflow","links","planning","archive","history","inbox"]);assert.ok(screen.split("\n").length<=12);assert.ok(screen.split("\n").every(line=>line.length<=60));
});

test("Tab focus wraps between work, inspector and navigation",()=>{ const c=new GlobalController({});c.focus="work";c.moveFocus(1);assert.equal(c.focus,"inspector");c.moveFocus(1);assert.equal(c.focus,"navigation");c.moveFocus(-1);assert.equal(c.focus,"inspector");});

test("scope toggle returns to the last explicit project and route changes keep the chosen scope",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("biz");c.setRoute("list");c.toggleScope();assert.equal(c.projectId,undefined);c.setRoute("overview");c.toggleScope();assert.equal(c.projectId,"biz");assert.equal(c.route,"overview");
});

test("search is shared by projects, notes, and planning retains matching child ancestors",async()=>{
 const {client,snapshot}=fixture();snapshot.items.push({...snapshot.items[0],id:"child-match",parent_id:"item1",project_id:"life",title:"Needle child",status_id:"s1"});snapshot.notes.push({id:"n1",project_id:"life",title:"Reference",body:"needle inside note",archived:false,created_at:now,updated_at:now});const c=new GlobalController(client);await c.refresh();c.searchQuery="needle";c.setScope("life");c.setRoute("planning");assert.deepEqual(c.rows().map(x=>x.id),["item1","child-match"]);assert.equal(c.selectedRow()?.id,"item1");c.setRoute("notes");assert.deepEqual(c.rows().map(x=>x.id),["n1"]);c.setRoute("projects");assert.deepEqual(c.rows().map(x=>x.id),[]);
});

test("archived project hides active children from Home and active views while archive keeps independent records",async()=>{
 const {client,snapshot}=fixture();snapshot.projects.find(p=>p.id==="biz").archived=true;snapshot.items.push({...snapshot.items[0],id:"biz-unarchived-child",project_id:"biz",archived:false,title:"Retained child"});const c=new GlobalController(client);await c.refresh();c.setRoute("overview");assert.ok(!c.rows().some(r=>r.id==="biz-unarchived-child"));c.setRoute("archive");assert.ok(c.rows().some(r=>r.id==="biz-unarchived-child"));
});

test("Home uses its selectable rows for project summaries and mixed rows show project origin",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("overview");const rows=c.rows();for(let i=0;i<rows.length;i++){c.selected=i;c.selectedId="id" in rows[i]?rows[i].id:undefined;const row=rows[i];const screen=render(c,120,16);const id="id" in row?row.id:undefined;assert.equal(c.selectedRow()?.id,id);if("title" in row&&"status_id" in row)assert.match(screen,new RegExp(c.projectName(row.project_id)));if("name" in row)assert.match(screen,new RegExp(row.name));}
});

test("committed mutation reports a refresh failure without retrying the saved command",async()=>{
 let writes=0,reads=0;const {snapshot}=fixture();const client={snapshot:async()=>{reads++;if(reads>1)throw new Error("refresh unavailable");return structuredClone(snapshot);},execute:async()=>{writes++;return{operation_id:"saved-once",revision:7};}};const c=new GlobalController(client);await c.refresh();await c.mutate("todo add",{title:"saved"});assert.equal(writes,1);assert.equal(c.lastMutationRefreshFailed,true);assert.match(c.notice,/Saved; refresh failed/);assert.equal(c.snapshot.revision,6);
});

test("Home search with no matches leaves rendered and selectable rows empty",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setRoute("overview");c.searchQuery="no such record";assert.deepEqual(c.rows(),[]);assert.equal(c.selectedRow(),undefined);assert.match(render(c,100,24),/Home · 0 actionable records/);assert.doesNotMatch(render(c,100,24),/Task \d/);
});

test("search loads complete server matches and visible note detail on demand",async()=>{
 const {snapshot}=fixture();snapshot.notes=[{id:"long-note",project_id:"life",title:"Kitchen",body:undefined,archived:false,created_at:now,updated_at:now}];let pageCalls=0,detailCalls=0;
 const client={snapshot:async()=>structuredClone(snapshot),execute:async(command,payload)=>{detailCalls++;assert.equal(command,"note show");return{id:payload.note_id,project_id:"life",title:"Kitchen",body:"needle lives beyond summary",archived:false,created_at:now,updated_at:now};},detailPage:async(collection,options)=>{pageCalls++;assert.equal(collection,"notes");assert.equal(options.query,"needle");return{rows:[{...snapshot.notes[0]}],total:1,limit:100,offset:0,next_offset:null,revision:6};}};
 const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("notes");await c.search("needle");assert.deepEqual(c.rows().map(x=>x.id),["long-note"]);assert.equal(pageCalls,1);await c.loadSelectedDetail();assert.equal(c.snapshot.notes[0].body,"needle lives beyond summary");assert.equal(detailCalls,1);
});

test("waiting follow-up date stays distinct from obligation due date and unscheduled has its own filter",async()=>{
 const {snapshot}=fixture();snapshot.statuses.push({project_id:"life",status_id:"waiting",label:"Waiting",category:"waiting",position:11});snapshot.items.push({...snapshot.items[1],id:"waiting-follow-up",project_id:"life",status_id:"waiting",title:"Call supplier",due_at:null,follow_up_at:"2026-09-29T12:00:00Z"},{...snapshot.items[1],id:"waiting-no-follow-up",project_id:"life",status_id:"waiting",title:"Await reply",due_at:"2001-01-01T00:00:00Z",follow_up_at:null});
 const c=new GlobalController({snapshot:async()=>structuredClone(snapshot),execute:async()=>({})});await c.refresh();c.setScope("life");c.setRoute("todos");c.setTodoFilter("waiting");assert.equal(c.rows()[0].id,"waiting-follow-up");assert.equal(c.rows()[1].id,"waiting-no-follow-up");c.setTodoFilter("unscheduled");assert.ok(!c.rows().some(x=>x.id.startsWith("waiting-")));
});

test("date-only obligations and RFC3339 timestamps use UTC calendar-day boundaries",()=>{
 const now=Date.parse("2026-09-30T12:00:00Z");assert.equal(isOverdue({due_at:"2026-09-29"},now),true);assert.equal(isOverdue({due_at:"2026-09-30"},now),false);assert.equal(isOverdue({due_at:"2026-09-30T00:15:00Z"},now),false);assert.equal(isOverdue({due_at:"2026-10-01T00:15:00+02:00"},now),false);
});

test("route paging appends rows without changing the selected record",async()=>{
 const {snapshot}=fixture();snapshot.snapshot_limit=100;const extra={...snapshot.items[0],id:"page-101",title:"Page 101",project_id:"life",position:101};let calls=0;const client={snapshot:async()=>structuredClone(snapshot),execute:async()=>({}),detailPage:async(collection,options)=>{calls++;assert.equal(collection,"items");assert.equal(options.offset,55);return{rows:[extra],total:56,limit:100,offset:55,next_offset:null,revision:6};}};const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("list");c.selectId("item1");await c.loadMoreRows();assert.equal(c.selectedRow().id,"item1");assert.ok(c.rows().some(x=>x.id==="page-101"));assert.equal(calls,1);
});

test("refresh rehydrates the selected item detail after it falls outside the capped summary",async()=>{
 const {snapshot}=fixture();const selected={...snapshot.items[0],id:"off-page",title:"Stable off-page record",position:101};let include=false;const client={snapshot:async()=>{const s=structuredClone(snapshot);if(include)s.snapshot_limit=100;return s;},execute:async(command,payload)=>{assert.equal(command,"task show");assert.equal(payload.item_id,"off-page");return selected;},detailPage:async()=>({rows:[selected],total:56,limit:100,offset:55,next_offset:null,revision:6})};const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("list");await c.loadMoreRows();c.selectId("off-page");assert.equal(c.selectedRow().title,"Stable off-page record");include=true;await c.refresh();assert.equal(c.selectedRow().id,"off-page");assert.equal(c.selectedRow().title,"Stable off-page record");
});

test("linked refresh keeps last-good execution sample stale and drops it after unlink",async()=>{
 const {snapshot}=fixture();snapshot.associations=[{project_id:"life",kind:"workspace",identity:"workspace",path:"/workspace",updated_at:now}];snapshot.linked_projects=[{management_project_id:"life",project_id:"workspace",path:"/workspace",availability:"available",revision:12,as_of:"2026-09-30T12:00:00Z",counts:{open:3},items:[{work_id:"w1",project_id:"workspace",title:"Execution task",kind:"task",parent_id:null,lifecycle:"active",display_status:"Doing",status:"doing",priority:1,reason_codes:[]}]}];let offline=false,unlinked=false;const client={snapshot:async()=>{const s=structuredClone(snapshot);if(offline)s.linked_projects=[{management_project_id:"life",project_id:"workspace",path:"/workspace",availability:"unavailable",revision:null,as_of:null,error:"service unavailable"}];if(unlinked)s.associations=[];return s;},execute:async()=>({})};const c=new GlobalController(client);await c.refresh();offline=true;await c.refresh();const stale=c.snapshot.linked_projects[0];assert.equal(stale.availability,"stale");assert.equal(stale.revision,12);assert.equal(stale.as_of,"2026-09-30T12:00:00Z");assert.equal(stale.counts.open,3);assert.equal(stale.items[0].title,"Execution task");unlinked=true;await c.refresh();assert.equal(c.snapshot.linked_projects.length,0);
});
