import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GlobalController, isOverdue } from "../dist/model.js";
import { render, ROUTE_MENU } from "../dist/view.js"

const now = new Date().toISOString();
const SYSTEM_CIVIL_DATE = "2026-09-30";
const CIVIL_TIME = { observed_at_unix_ms: Date.parse(`${SYSTEM_CIVIL_DATE}T12:00:00Z`), timezone: "UTC", system_civil_date: SYSTEM_CIVIL_DATE, tzdb_identity: `sha256:${"a".repeat(64)}` };
function dailyClassification(item,snapshot){
 const category=snapshot.statuses.find(status=>status.project_id===item.project_id&&status.status_id===item.status_id)?.category??"open";
 const day=item.due_at===null?undefined:/^\d{4}-\d{2}-\d{2}$/u.test(item.due_at)?item.due_at:Number.isFinite(Date.parse(item.due_at))?new Date(item.due_at).toISOString().slice(0,10):undefined;
 const deadline=day===undefined?item.due_at===null?"unscheduled":"unknown":day<SYSTEM_CIVIL_DATE?"overdue":day===SYSTEM_CIVIL_DATE?"due_today":"later";
 const waiting=category==="waiting";
 const group=deadline==="overdue"?"overdue":deadline==="due_today"?"due_today":deadline==="unscheduled"?(waiting?"waiting":"unscheduled"):deadline==="later"?(waiting?"waiting":"later"):waiting?"waiting":"unknown";
 return {group,deadline,waiting,filters:{today:deadline==="due_today",overdue:deadline==="overdue",waiting,unscheduled:deadline==="unscheduled",all_open:true}};
}
function attentionForOwner(snapshot,owner){
 const owns=item=>item.project_id===owner;
 const archivedProjects=new Set(snapshot.projects.filter(project=>project.archived).map(project=>project.id));
 const items=snapshot.items.filter(item=>owns(item)&&!item.archived&&!(owner&&archivedProjects.has(owner)));
 const category=item=>snapshot.statuses.find(status=>status.project_id===item.project_id&&status.status_id===item.status_id)?.category;
 const active=items.filter(item=>!new Set(["completed","cancelled"]).has(category(item)));
 const counts={open:active.length,waiting:0,overdue:0,due_today:0,unscheduled:0,later:0};
 for(const item of active){const classification=item.daily_classification;if(classification.waiting)counts.waiting++;if(Object.hasOwn(counts,classification.deadline))counts[classification.deadline]++;}
 const sortByUrgency=(left,right)=>{const rank={overdue:0,due_today:1,later:2,unscheduled:3,unknown:4};return rank[left.daily_classification.deadline]-rank[right.daily_classification.deadline]||(right.priority??0)-(left.priority??0)||left.position-right.position||left.id.localeCompare(right.id);};
 const action=items.filter(item=>["open","active"].includes(category(item))&&["task","subtask"].includes(item.kind)).sort(sortByUrgency)[0];
 const milestone=items.filter(item=>item.kind==="milestone"&&!new Set(["completed","cancelled"]).has(category(item))).sort(sortByUrgency)[0];
 const children=milestone?snapshot.items.filter(item=>item.parent_id===milestone.id&&owns(item)):[];
 return {...counts,next_action:action?{item_id:action.id,title:action.title,due_at:action.due_at,priority:action.priority,status_id:action.status_id,status_label:category(action)?snapshot.statuses.find(status=>status.project_id===action.project_id&&status.status_id===action.status_id)?.label??action.status_id:action.status_id,kind:action.kind}:null,next_milestone:milestone?{item_id:milestone.id,title:milestone.title,due_at:milestone.due_at,completed_children:children.filter(child=>category(child)==="completed").length,total_children:children.length}:null,blocked_by:[],next_action_unavailable_reason:action?null:"no_open_action"};
}
function serverSnapshot(source){
 const snapshot=structuredClone(source);snapshot.civil_time=structuredClone(CIVIL_TIME);
 snapshot.items=snapshot.items.map(item=>({...item,daily_classification:dailyClassification(item,snapshot)}));
 {
  const projects=Object.fromEntries(snapshot.projects.map(project=>[project.id,attentionForOwner(snapshot,project.id)]));
  const personal=attentionForOwner(snapshot,null);const portfolio={open:personal.open,waiting:personal.waiting,overdue:personal.overdue,due_today:personal.due_today,unscheduled:personal.unscheduled,later:personal.later};
  for(const summary of Object.values(projects))for(const key of Object.keys(portfolio))portfolio[key]+=summary[key];
  snapshot.attention={portfolio,projects,projects_total:snapshot.projects.length,projects_limit:snapshot.projects.length,projects_has_more:false,projects_truncated:false,personal};
 }
 return snapshot;
}
function fixture(){
 const projects=[{id:"life",name:"Life",description:"Personal",archived:false,created_at:now,updated_at:now},{id:"biz",name:"Business",description:"Launch",archived:false,created_at:now,updated_at:now}];
 const statuses=[{project_id:null,status_id:"personal-inbox",label:"Inbox",category:"inbox",position:-1},{project_id:null,status_id:"todo",label:"To do",category:"open",position:0}];for(const id of ["life","biz"])for(let n=0;n<9;n++)statuses.push({project_id:id,status_id:`s${n}`,label:`Status ${n}`,category:n===8?"completed":"open",position:n});
 const items=[];for(let n=0;n<55;n++)items.push({id:`item${n}`,project_id:n%2?"life":"biz",parent_id:n===40?"item2":null,kind:n===2?"milestone":"task",title:`Task ${n}`,description:n===25?"Long detail ".repeat(24):"",labels:[],status_id:`s${n%9}`,priority:n%4,due_at:n===3?"2001-01-01T00:00:00Z":null,follow_up_at:null,archived:false,position:n,created_at:now,updated_at:now});
 const snapshot={schema_version:2,revision:6,projects,items,notes:[],statuses,relationships:[{source_id:"item25",target_id:"item2",kind:"depends_on"}],associations:[{project_id:"biz",kind:"workspace",identity:"code-project",path:"/work/code",updated_at:now}],linked_projects:[{management_project_id:"biz",project_id:"code-project",path:"/work/code",availability:"available",revision:3,as_of:now,counts:{open:4}}]};
 return {snapshot,client:{snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({})}};
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
 c.setRoute("list");c.selectId("item2");c.inspectorTab="relationships";assert.match(render(c,140,30),/Blocks Task 25 \[item25\]/);c.setScope("life");c.selectId("item25");assert.match(render(c,140,30),/Waiting on Task 2 \[item2\]/);
 c.setRoute("projects");c.selectId("biz");const projectDetails=render(c,140,30);assert.match(projectDetails,/Lifecycle/);assert.match(projectDetails,/Health/);c.inspectorTab="relationships";assert.match(render(c,140,30),/available/);
});
test("overdue calculation is date based and archive route retains archived records",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();assert.equal(isOverdue(c.snapshot.items.find(i=>i.id==="item3")),true);
 c.snapshot.items[3].archived=true;c.setRoute("archive");assert.ok(c.rows().some(i=>i.id==="item3"));
});
test("deep board card is selected and visible after vertical scrolling",async()=>{
 const {client}=fixture();const s=await client.snapshot();for(let n=0;n<30;n++)s.items.push({...s.items[1],id:`deep${n}`,title:`Deep card ${n}`,project_id:"life",status_id:"s7",position:60+n});
 const c=new GlobalController({snapshot:async()=>serverSnapshot(s),execute:async()=>({})});await c.refresh();c.setScope("life");c.setRoute("board");c.boardColumn=c.boardStatuses.findIndex(x=>x.status_id==="s7");for(let n=0;n<25;n++)c.moveSelection(1);
 assert.equal(c.selectedRow()?.id,c.boardSelected?.id);const screen=render(c,40,14);assert.match(screen,new RegExp(c.boardSelected.title));assert.match(screen,/Status 7/);
});
test("inspector can take over a narrow screen on focus",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("list");c.selectId("item25");c.focus="inspector";const screen=render(c,80,16);assert.match(screen,/INSPECT/);assert.match(screen,/Task 25/);assert.ok(screen.split("\n").every(line=>line.length<=80));
});
test("history route shows retained status transitions",async()=>{
 const {client,snapshot}=fixture();snapshot.status_history=[{item_id:"item25",from_status_id:"s1",to_status_id:"s7",revision:4,changed_at:"2026-09-29T14:00:00Z"}];const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("history");c.selectId("item25");const screen=render(c,100,20);assert.match(screen,/s1 → s7/);assert.match(screen,/Sep 29, 2026/);
});
test("capture provenance stays compact in rows and loads its verified witness through bounded history on demand",async()=>{
 const {snapshot}=fixture();const text="Captured note with preserved whitespace.\nSecond line.";const digest=`sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;
 const captured={...snapshot.items[0],id:"captured-item",project_id:null,status_id:"personal-inbox",title:text,capture_origin:{digest,source_ref:"legacy:raw-7"}};snapshot.items.push(captured);snapshot.capture_witnesses=[{item_id:captured.id,revision:7,captured_at:"2026-10-01T12:00:00Z",text,digest,source_ref:"legacy:raw-7"}];
 let itemDetailCalls=0,entityHistoryCalls=0,operationCalls=0;
 const client={snapshot:async()=>serverSnapshot(snapshot),execute:async(command,payload)=>{assert.equal(command,"task show");assert.equal(payload.item_id,captured.id);itemDetailCalls++;return structuredClone(captured);},history:async(options={})=>{
   if(options.entityId){entityHistoryCalls++;assert.equal(options.entityId,captured.id);assert.equal(options.limit,200);assert.equal(options.offset,0);return{events:[{operation_id:"capture-op",revision:7,command:"todo add",entity_kind:"todo",entity_id:captured.id,title:captured.title,summary:"Created captured item",created_at:"2026-10-01T12:00:00Z"}],current_revision:7,total:1,limit:200,offset:0,has_more:false,next_offset:null};}
   return{events:[],current_revision:7,total:0,limit:50,offset:0,has_more:false,next_offset:null};
 },operationShow:async(id)=>{operationCalls++;assert.equal(id,"capture-op");return{operation_id:id,request_digest:"request-digest",revision:7,created_at:"2026-10-01T12:00:00Z",result:{...captured,capture_witness:{item_id:captured.id,revision:7,captured_at:"2026-10-01T12:00:00Z",text,digest,source_ref:"legacy:raw-7"}}};}};
 const c=new GlobalController(client);await c.refresh();assert.equal(Object.hasOwn(c.snapshot,"capture_witnesses"),false);c.setRoute("inbox");c.selectId(captured.id);
 assert.match(render(c,100,20),/captured/);assert.equal(itemDetailCalls,0);assert.equal(entityHistoryCalls,0);assert.equal(operationCalls,0);assert.equal(c.captureInspectionFor(c.selectedItem).status,"not_loaded");
 c.focus="inspector";assert.match(render(c,90,30),/Digest: sha256:/);assert.match(render(c,90,30),/not loaded/);
 await c.loadSelectedDetail();assert.equal(itemDetailCalls,1);assert.equal(entityHistoryCalls,1);assert.equal(operationCalls,1);assert.equal(c.captureInspectionFor(c.selectedItem).status,"available");
 const screen=render(c,90,40);assert.match(screen,/Capture provenance/);assert.match(screen,new RegExp(digest));assert.match(screen,/Source reference: legacy:raw-7/);assert.match(screen,/Original capture text:/);assert.match(screen,/Captured note with preserved whitespace/);assert.match(screen,/Second line/);
});
test("capture provenance keeps its digest visible when original history is missing or beyond the bound",async()=>{
 const {snapshot}=fixture();const text="Imported capture";const digest=`sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;const captured={...snapshot.items[0],id:"old-capture",title:text,capture_origin:{digest,source_ref:null}};snapshot.items.push(captured);
 let beyondBound=false;const client={snapshot:async()=>serverSnapshot(snapshot),execute:async()=>structuredClone(captured),history:async options=>options.entityId?{events:beyondBound?Array.from({length:200},(_,index)=>({operation_id:`update-${index}`,revision:300-index,command:"todo move",entity_kind:"todo",entity_id:captured.id,title:captured.title,summary:"Updated captured item",created_at:"2026-10-01T12:00:00Z"})):[],current_revision:400,total:beyondBound?250:0,limit:200,offset:0,has_more:beyondBound,next_offset:beyondBound?200:null}:{events:[],current_revision:9,total:0,limit:50,offset:0,has_more:false,next_offset:null}};
 const c=new GlobalController(client);await c.refresh();c.setRoute("list");c.selectId(captured.id);c.focus="inspector";await c.loadSelectedDetail();let screen=render(c,90,30);assert.match(screen,new RegExp(digest));assert.match(screen,/No retained capture operation was found/);
 beyondBound=true;const c2=new GlobalController(client);await c2.refresh();c2.setRoute("list");c2.selectId(captured.id);c2.focus="inspector";await c2.loadSelectedDetail();screen=render(c2,90,30);assert.match(screen,new RegExp(digest));assert.match(screen,/newest 200 retained item history events/);
});
test("capture witness whose text does not match its immutable digest is not displayed",async()=>{
 const {snapshot}=fixture();const text="original capture";const digest=`sha256:${createHash("sha256").update(text,"utf8").digest("hex")}`;const captured={...snapshot.items[0],id:"tampered-capture",title:text,capture_origin:{digest}};snapshot.items.push(captured);
 const event={operation_id:"capture-op",revision:7,command:"todo add",entity_kind:"todo",entity_id:captured.id,title:text,summary:"Created captured item",created_at:"2026-10-01T12:00:00Z"};
 const client={snapshot:async()=>serverSnapshot(snapshot),execute:async()=>structuredClone(captured),history:async options=>options.entityId?{events:[event],current_revision:7,total:1,limit:200,offset:0,has_more:false,next_offset:null}:{events:[],current_revision:7,total:0,limit:50,offset:0,has_more:false,next_offset:null},operationShow:async()=>({operation_id:"capture-op",revision:7,request_digest:"request",created_at:"now",result:{id:captured.id,capture_witness:{item_id:captured.id,revision:7,captured_at:"2026-10-01T12:00:00Z",text:"tampered witness",digest,source_ref:null}}})};
 const c=new GlobalController(client);await c.refresh();c.setRoute("list");c.selectId(captured.id);c.focus="inspector";await c.loadSelectedDetail();assert.equal(c.captureInspectionFor(c.selectedItem).status,"unavailable");const screen=render(c,90,30);assert.match(screen,new RegExp(digest));assert.match(screen,/no witness matching this item and origin digest/);assert.doesNotMatch(screen,/tampered witness/);
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
 const client={snapshot:async()=>serverSnapshot(snapshot),history:async()=>({events:structuredClone(events),total:60,has_more:false}),execute:async()=>({})};const c=new GlobalController(client);await c.refresh();
 const cases=[
  ["projects","p49","Project 49"],["board","wide49","Wide task 49"],["list","wide49","Wide task 49"],
  ["todos","wide49","Wide task 49"],["inbox","personal49","Personal capture 49"],["notes","note49","Note 49"],
  ["links","workspace-49","workspace-49"],["planning","wide49","Wide task 49"],["archive","wide55","Wide task 55"],
  ["history","op49","Activity 49"],["overview","wide49","Wide task 49"]
 ];
 snapshot.items.push(...Array.from({length:60},(_,n)=>({id:`personal${n}`,project_id:null,parent_id:null,kind:"task",title:`Personal capture ${n}`,description:"",labels:[],status_id:"personal-inbox",priority:null,due_at:null,archived:false,position:200+n,created_at:now,updated_at:now})));await c.refresh();
 for(const [route,id,visible] of cases){c.setScope();c.todoFilter="all_open";c.setRoute(route);if(route==="archive")c.selectId(id);else if(route==="todos")c.selectId(id);else c.selectId(id);assert.equal(c.selectedRow()?.id??c.selectedRow()?.identity,id,`${route} selected ID`);const screen=render(c,120,24);assert.match(screen,new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),`${route} selected record visible`);}
 // Personal quick captures are immediately discoverable in All projects Inbox.
 c.setRoute("inbox");c.selectId("personal59");assert.equal(c.selectedRow()?.title,"Personal capture 59");assert.match(render(c,120,16),/Personal capture 59/);
});
test("todo views filter Today, overdue, waiting, and all open independently",async()=>{
 const {snapshot}=fixture();const today=SYSTEM_CIVIL_DATE;const project="life";
 snapshot.statuses.push({project_id:project,status_id:"waiting",label:"Waiting",category:"waiting",position:10});
 snapshot.items[3].archived=true;snapshot.items.push(
  {...snapshot.items[0],id:"due-today",project_id:project,title:"Due today",status_id:"s0",due_at:`${today}T23:00:00Z`},
  {...snapshot.items[0],id:"due-old",project_id:project,title:"Overdue work",status_id:"s0",due_at:"2001-01-01T00:00:00Z"},
  {...snapshot.items[0],id:"waiting",project_id:project,title:"Waiting reply",status_id:"waiting",due_at:null},
  {...snapshot.items[0],id:"unscheduled",project_id:project,title:"Unscheduled",status_id:"s0",due_at:null}
 );const c=new GlobalController({snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({})});await c.refresh();c.setScope(project);c.setRoute("todos");
 c.todoFilter="today";assert.deepEqual(c.rows().map(x=>x.id),["due-today"]);assert.ok(!c.rows().some(x=>x.id==="due-old"));assert.ok(!c.rows().some(x=>x.id==="waiting"));
 c.todoFilter="unscheduled";assert.ok(c.rows().some(x=>x.id==="unscheduled"));
 c.todoFilter="overdue";assert.deepEqual(c.rows().map(x=>x.id),["due-old"]);
 c.todoFilter="waiting";assert.deepEqual(c.rows().map(x=>x.id),["waiting"]);
 c.todoFilter="all_open";for(const id of ["due-today","due-old","waiting","unscheduled"])assert.ok(c.rows().some(x=>x.id===id));
 snapshot.items.push(
  {...snapshot.items[0],id:"personal-inbox-item",project_id:null,title:"Personal inbox capture",status_id:"personal-inbox",due_at:null},
  {...snapshot.items[0],id:"personal-triaged-item",project_id:null,title:"Triaged personal task",status_id:"todo",due_at:null}
 );await c.refresh();c.setScope();c.setRoute("inbox");assert.ok(c.rows().some(x=>x.id==="personal-inbox-item"));assert.ok(!c.rows().some(x=>x.id==="personal-triaged-item"));
});
test("Today/Open renders explicit service-classified groups and keeps the selected item visible when narrow",async()=>{
 const {snapshot}=fixture();const project="life";
 snapshot.statuses.push({project_id:project,status_id:"waiting",label:"Waiting",category:"waiting",position:10});
 const base=snapshot.items[0];snapshot.items=[
  {...base,id:"daily-overdue",project_id:project,title:"Overdue task",status_id:"s0",due_at:"2026-09-29",position:0},
  {...base,id:"daily-today",project_id:project,title:"Today task",status_id:"s0",due_at:"2026-09-30",position:1},
  {...base,id:"daily-waiting",project_id:project,title:"Waiting task",status_id:"waiting",due_at:null,position:2},
  {...base,id:"daily-unscheduled",project_id:project,title:"Unscheduled task",status_id:"s0",due_at:null,position:3},
  {...base,id:"daily-later",project_id:project,title:"Later task",status_id:"s0",due_at:"2026-10-01",position:4}
 ];
 const c=new GlobalController({snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({})});await c.refresh();c.setScope(project);c.setRoute("todos");c.todoFilter="all_open";
 const screen=render(c,120,30);let previous=-1;
 for(const heading of ["Overdue","Due today","Waiting","Unscheduled","Later"]){const position=screen.indexOf(heading);assert.ok(position>previous,`${heading} group appears in the expected order`);previous=position;}
 c.selectId("daily-later");const narrow=render(c,40,12);
 assert.match(narrow,/Later task/);assert.ok(narrow.split("\n").length<=12);assert.ok(narrow.split("\n").every(line=>line.length<=40));
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

test("bodyless note summaries render their titles in Archive, Notes, and the inspector across project restore",async()=>{
 const {snapshot}=fixture();snapshot.items=[];snapshot.projects.find(p=>p.id==="biz").archived=true;
 snapshot.notes=[
  {id:"archive-note",project_id:"biz",title:"Archived project reference",archived:false,created_at:now,updated_at:now},
  {id:"active-note",project_id:"life",title:"Active reference",archived:false,created_at:now,updated_at:now},
  {id:"independent-note",project_id:"biz",title:"Independently archived reference",archived:true,created_at:now,updated_at:now}
 ];
 const c=new GlobalController({snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({})});await c.refresh();c.setRoute("archive");c.selectId("archive-note");
 assert.match(render(c,80,20),/▤ Archived project reference/);assert.doesNotMatch(render(c,80,20),/undefined/);
 c.focus="inspector";assert.match(render(c,80,20),/Archived project reference/);assert.match(render(c,80,20),/Updated/);assert.doesNotMatch(render(c,80,20),/Progress unavailable/);
 c.focus="work";c.setRoute("notes");assert.deepEqual(c.rows().map(n=>n.id),["active-note"]);assert.match(render(c,80,20),/▤ Active reference/);
 snapshot.projects.find(p=>p.id==="biz").archived=false;await c.refresh();c.setScope("biz");c.setRoute("notes");assert.deepEqual(c.rows().map(n=>n.id),["archive-note"]);assert.match(render(c,80,20),/▤ Archived project reference/);
 c.setRoute("archive");assert.deepEqual(c.rows().map(n=>n.id),["independent-note"]);assert.match(render(c,80,20),/▤ Independently archived reference/);
});

test("Home uses its selectable rows for project summaries and mixed rows show project origin",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("overview");const rows=c.rows();for(let i=0;i<rows.length;i++){c.selected=i;c.selectedId="id" in rows[i]?rows[i].id:undefined;const row=rows[i];const screen=render(c,120,16);const id="id" in row?row.id:undefined;assert.equal(c.selectedRow()?.id,id);if("title" in row&&"status_id" in row)assert.match(screen,new RegExp(c.projectName(row.project_id)));if("name" in row)assert.match(screen,new RegExp(row.name));}
});

test("committed mutation reports a refresh failure without retrying the saved command",async()=>{
 let writes=0,reads=0;const {snapshot}=fixture();const client={snapshot:async()=>{reads++;if(reads>1)throw new Error("refresh unavailable");return serverSnapshot(snapshot);},execute:async()=>{writes++;return{operation_id:"saved-once",revision:7};}};const c=new GlobalController(client);await c.refresh();await c.mutate("todo add",{title:"saved"});assert.equal(writes,1);assert.equal(c.lastMutationRefreshFailed,true);assert.match(c.notice,/Saved; refresh failed/);assert.equal(c.snapshot.revision,6);
});

test("Home search with no matches leaves rendered and selectable rows empty",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setRoute("overview");c.searchQuery="no such record";assert.deepEqual(c.rows(),[]);assert.equal(c.selectedRow(),undefined);assert.match(render(c,100,24),/Home · 0 loaded records and project summaries/);assert.doesNotMatch(render(c,100,24),/Task \d/);
});

test("search loads complete server matches and visible note detail on demand",async()=>{
 const {snapshot}=fixture();snapshot.notes=[{id:"long-note",project_id:"life",title:"Kitchen",body:undefined,archived:false,created_at:now,updated_at:now}];let pageCalls=0,detailCalls=0;
 const client={snapshot:async()=>serverSnapshot(snapshot),execute:async(command,payload)=>{detailCalls++;assert.equal(command,"note show");return{id:payload.note_id,project_id:"life",title:"Kitchen",body:"needle lives beyond summary",archived:false,created_at:now,updated_at:now};},detailPage:async(collection,options)=>{pageCalls++;assert.equal(collection,"notes");assert.equal(options.query,"needle");return{rows:[{...snapshot.notes[0]}],total:1,limit:100,offset:0,next_offset:null,revision:6};}};
 const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("notes");await c.search("needle");assert.deepEqual(c.rows().map(x=>x.id),["long-note"]);assert.equal(pageCalls,1);await c.loadSelectedDetail();assert.equal(c.snapshot.notes[0].body,"needle lives beyond summary");assert.equal(detailCalls,1);
});

test("waiting follow-up date stays distinct from obligation due date and unscheduled has its own filter",async()=>{
 const {snapshot}=fixture();snapshot.statuses.push({project_id:"life",status_id:"waiting",label:"Waiting",category:"waiting",position:11});snapshot.items.push({...snapshot.items[1],id:"waiting-follow-up",project_id:"life",status_id:"waiting",title:"Call supplier",due_at:null,follow_up_at:"2026-09-29T12:00:00Z"},{...snapshot.items[1],id:"waiting-no-follow-up",project_id:"life",status_id:"waiting",title:"Await reply",due_at:"2001-01-01T00:00:00Z",follow_up_at:null});
 const c=new GlobalController({snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({})});await c.refresh();c.setScope("life");c.setRoute("todos");c.setTodoFilter("waiting");assert.equal(c.rows()[0].id,"waiting-follow-up");assert.equal(c.rows()[1].id,"waiting-no-follow-up");c.setTodoFilter("unscheduled");const unscheduled=c.rows().map(x=>x.id);assert.ok(unscheduled.includes("waiting-follow-up"));assert.ok(unscheduled.includes("item1"));assert.ok(!unscheduled.includes("waiting-no-follow-up"));
});

test("date-only obligations and RFC3339 timestamps use server civil-day classification",()=>{
 const overdue={due_at:"2026-09-29",daily_classification:{group:"overdue",deadline:"overdue",waiting:false,filters:{today:false,overdue:true,waiting:false,unscheduled:false,all_open:true}}};
 const dueToday={due_at:"2026-09-30",daily_classification:{group:"due_today",deadline:"due_today",waiting:false,filters:{today:true,overdue:false,waiting:false,unscheduled:false,all_open:true}}};
 const timestampOverdue={due_at:"2026-09-30T00:15:00+02:00",daily_classification:{group:"overdue",deadline:"overdue",waiting:false,filters:{today:false,overdue:true,waiting:false,unscheduled:false,all_open:true}}};
 assert.equal(isOverdue(overdue),true);assert.equal(isOverdue(dueToday),false);assert.equal(isOverdue(timestampOverdue),true);
});

test("route paging appends rows without changing the selected record",async()=>{
 const {snapshot}=fixture();snapshot.snapshot_limit=100;const extra={...snapshot.items[0],id:"page-101",title:"Page 101",project_id:"life",position:101};let calls=0;const client={snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({}),detailPage:async(collection,options)=>{calls++;assert.equal(collection,"items");assert.equal(options.offset,55);return{rows:[extra],total:56,limit:100,offset:55,next_offset:null,revision:6};}};const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("list");c.selectId("item1");await c.loadMoreRows();assert.equal(c.selectedRow().id,"item1");assert.ok(c.rows().some(x=>x.id==="page-101"));assert.equal(calls,1);
});

test("refresh rehydrates the selected item detail after it falls outside the capped summary",async()=>{
 const {snapshot}=fixture();const selected={...snapshot.items[0],id:"off-page",title:"Stable off-page record",position:101};let include=false;const client={snapshot:async()=>{const s=structuredClone(snapshot);if(include)s.snapshot_limit=100;return serverSnapshot(s);},execute:async(command,payload)=>{assert.equal(command,"task show");assert.equal(payload.item_id,"off-page");return selected;},detailPage:async()=>({rows:[selected],total:56,limit:100,offset:55,next_offset:null,revision:6})};const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("list");await c.loadMoreRows();c.selectId("off-page");assert.equal(c.selectedRow().title,"Stable off-page record");include=true;await c.refresh();assert.equal(c.selectedRow().id,"off-page");assert.equal(c.selectedRow().title,"Stable off-page record");
});

test("linked refresh keeps last-good execution sample stale and drops it after unlink",async()=>{
 const {snapshot}=fixture();snapshot.associations=[{project_id:"life",kind:"workspace",identity:"workspace",path:"/workspace",updated_at:now}];snapshot.linked_projects=[{management_project_id:"life",project_id:"workspace",path:"/workspace",availability:"available",revision:12,as_of:"2026-09-30T12:00:00Z",counts:{open:3},items:[{work_id:"w1",project_id:"workspace",title:"Execution task",kind:"task",parent_id:null,lifecycle:"active",display_status:"Doing",status:"doing",priority:1,reason_codes:[]}]}];let offline=false,unlinked=false;const client={snapshot:async()=>{const s=structuredClone(snapshot);if(offline)s.linked_projects=[{management_project_id:"life",project_id:"workspace",path:"/workspace",availability:"unavailable",revision:null,as_of:null,error:"service unavailable"}];if(unlinked)s.associations=[];return serverSnapshot(s);},execute:async()=>({})};const c=new GlobalController(client);await c.refresh();offline=true;await c.refresh();const stale=c.snapshot.linked_projects[0];assert.equal(stale.availability,"stale");assert.equal(stale.revision,12);assert.equal(stale.as_of,"2026-09-30T12:00:00Z");assert.equal(stale.counts.open,3);assert.equal(stale.items[0].title,"Execution task");unlinked=true;await c.refresh();assert.equal(c.snapshot.linked_projects.length,0);
});

test("authoritative project attention supplies full-state action and milestone summaries",async()=>{
 const {snapshot}=fixture();const prepared=serverSnapshot(snapshot);prepared.attention.projects.biz={...prepared.attention.projects.biz,open:2,waiting:0,overdue:1,due_today:0,unscheduled:1,later:0,next_action:{item_id:"off-page-action",title:"Review supplier contract",due_at:"2026-10-02",priority:3,status_id:"s1",status_label:"Doing",kind:"task"},next_milestone:{item_id:"off-page-milestone",title:"Launch review",due_at:"2026-10-15",completed_children:7,total_children:12},blocked_by:[],next_action_unavailable_reason:null};
 const c=new GlobalController({snapshot:async()=>structuredClone(prepared),execute:async()=>({})});await c.refresh();const project=c.projects.find(p=>p.id==="biz");assert.equal(c.projectNextAction(project).item_id,"off-page-action");assert.equal(c.projectNextMilestone(project).completed_children,7);c.setScope("biz");c.setRoute("overview");c.selectId("biz");assert.match(render(c,100,30),/Review supplier contract/);assert.match(render(c,100,30),/7\/12 children complete/);
});

test("planning collapse, breadcrumbs, milestone progress and bulk selection share row order",async()=>{
 const {client,snapshot}=fixture();snapshot.statuses.find(s=>s.project_id==="biz"&&s.status_id==="s8").category="completed";const c=new GlobalController(client);await c.refresh();c.setScope("biz");c.setRoute("planning");const before=c.rows().map(x=>x.id);assert.ok(before.includes("item40"));assert.ok(c.itemBreadcrumb(c.snapshot.items.find(x=>x.id==="item40")).includes("Task 2"));const milestone=c.snapshot.items.find(x=>x.id==="item2");assert.deepEqual(c.milestoneProgress(milestone),{completed:0,total:1,visibleOnly:false});c.toggleBulkSelected("item2");assert.ok(c.bulkSelectedIds.has("item2"));c.toggleCollapsed("item2");assert.ok(!c.rows().some(x=>x.id==="item40"));const screen=render(c,100,30);assert.match(screen,/Task 2/);assert.match(screen,/☑/);assert.match(screen,/children/);assert.match(screen,/z collapse · y\/Y bulk select/);assert.deepEqual(c.rows().map(x=>x.id).filter(id=>id==="item40"),[]);c.toggleCollapsed("item2");assert.ok(c.rows().some(x=>x.id==="item40"));c.clearBulkSelection();assert.equal(c.bulkSelectedIds.size,0);
});

test("all-project board retains empty project workflows and labels every status by project",async()=>{
 const {client,snapshot}=fixture();snapshot.statuses.push({project_id:"biz",status_id:"biz-only",label:"Ready",category:"open",position:20});const c=new GlobalController(client);await c.refresh();c.setScope();c.setRoute("board");assert.ok(c.boardStatuses.some(s=>s.project_id==="biz"&&s.status_id==="biz-only"));const ix=c.boardStatuses.findIndex(s=>s.status_id==="biz-only");c.moveBoardColumn(ix-c.boardColumn);const text=render(c,140,40);assert.match(text,/Business · Ready/);
});

test("linked page polls async job, caches rows and keeps pagination offset",async()=>{
 const {snapshot}=fixture();const pageItem={work_id:"work-1",project_id:"code-project",title:"Execution detail",kind:"task",parent_id:null,lifecycle:"active",display_status:"Doing",status:"doing",priority:1,reason_codes:[]};let offsetSeen=[];const client={snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({}),linkedPage:async(_p,_i,options)=>{offsetSeen.push(options.offset);return options.offset===0?{items:[],total:2,next_offset:0,availability:"refreshing",revision:null,as_of:null,error:null,job_id:"job-1"}:{items:[{...pageItem,work_id:"work-2"}],total:2,next_offset:null,availability:"available",revision:4,as_of:now,error:null};},linkedJobShow:async()=>({job_id:"job-1",state:"complete",page:{items:[pageItem],total:2,next_offset:1,availability:"available",revision:4,as_of:now,error:null}})};const c=new GlobalController(client);await c.refresh();c.setScope("biz");c.setRoute("links");c.inspectorTab="linked";assert.equal(await c.loadMoreLinked(),true);assert.deepEqual(offsetSeen,[0]);assert.equal(c.snapshot.linked_projects[0].items[0].title,"Execution detail");assert.equal(await c.loadMoreLinked(),true);assert.deepEqual(offsetSeen,[0,1]);assert.equal(c.snapshot.linked_projects[0].items.length,2);assert.equal(c.linkedPageError,undefined);
});

test("responsive layouts preserve selected row, scope, freshness and bounded lines",async()=>{
 const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("life");c.setRoute("list");c.selectId("item25");for(const [width,height] of [[60,18],[80,24],[100,30],[140,40]]){const screen=render(c,width,height);assert.ok(screen.split("\n").length<=height);assert.ok(screen.split("\n").every(line=>line.length<=width));assert.match(screen,/Life/);assert.match(screen,/Task 25/);assert.match(screen,/fresh/,`freshness missing at width ${width}`);}
});

test("bulk selection marker is visible on ordinary item rows",async()=>{const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("biz");c.setRoute("list");c.toggleBulkSelected("item2");assert.match(render(c,100,24),/☑ Status 2/);});

test("Home labels missing project activity as absent from the recent sample",async()=>{const {client}=fixture();const c=new GlobalController(client);await c.refresh();c.setScope("biz");c.setRoute("overview");c.selectId("biz");assert.match(render(c,100,40),/Last management activity: not in recent activity sample/);});

test("Home shows portfolio and Personal next action and milestone from attention summaries",async()=>{
 const {snapshot}=fixture();
 snapshot.items.push(
  {...snapshot.items[0],id:"personal-next",project_id:null,parent_id:null,kind:"task",title:"Book dentist",status_id:"todo",due_at:"2026-10-20"},
  {...snapshot.items[0],id:"personal-milestone",project_id:null,parent_id:null,kind:"milestone",title:"Home repairs",status_id:"todo",due_at:"2026-11-01"}
 );
 const prepared=serverSnapshot(snapshot);
 prepared.attention.portfolio={...prepared.attention.portfolio,next_action:{item_id:"portfolio-next",title:"Review launch blockers",due_at:"2026-10-16"},next_milestone:{item_id:"portfolio-milestone",title:"Launch milestone",due_at:"2026-10-30",completed_children:2,total_children:5},blocked_by:[],next_action_unavailable_reason:null};
 const c=new GlobalController({snapshot:async()=>structuredClone(prepared),execute:async()=>({})});await c.refresh();c.setRoute("overview");
 const screen=render(c,100,40);
 assert.match(screen,/PORTFOLIO NEXT ACTION · Review launch blockers/);
 assert.match(screen,/PORTFOLIO NEXT MILESTONE · Launch milestone/);
 assert.match(screen,/PERSONAL NEXT ACTION · Book dentist/);
 assert.match(screen,/PERSONAL NEXT MILESTONE · Home repairs/);
});

test("Home keeps authored project metadata and linked execution freshness/counts in separate blocks",async()=>{
 const {snapshot}=fixture();const project=snapshot.projects.find(p=>p.id==="biz");project.lifecycle="paused";project.health="watch";
 snapshot.linked_projects[0]={...snapshot.linked_projects[0],availability:"stale",revision:3,as_of:"2026-10-12",counts:{open:4,completed:2}};
 const c=new GlobalController({snapshot:async()=>serverSnapshot(snapshot),execute:async()=>({})});await c.refresh();c.setScope("biz");c.setRoute("overview");c.selectId("biz");
 const screen=render(c,240,40);
 assert.deepEqual(c.snapshot.linked_projects[0].counts,{open:4,completed:2});
 assert.match(screen,/PROJECT METADATA · lifecycle paused · health watch/);
 assert.match(screen,/MANAGEMENT ·/);
 assert.match(screen,/LINKED EXECUTION · 1 workspaces · 0 current · 1 stale · 0 unavailable/);
 assert.match(screen,/latest known 2026-10-12/);
 assert.match(screen,/last-known counts · open 4 · completed 2/);
});
