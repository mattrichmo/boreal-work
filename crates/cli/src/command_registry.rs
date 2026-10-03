//! The executable public command registry.
//!
//! This is deliberately smaller than the planning catalog in
//! `project/spec/cli-contract.json`: a command is listed as available only
//! when this binary has a real adapter for it. Planned work is returned as a
//! typed gap so agents can discover the boundary without being handed an
//! argv recipe that cannot work.

use super::*;

pub(crate) fn syntax_for(path: &[String]) -> Option<&'static str> {
    let route = path.join(" ");
    COMMANDS
        .iter()
        .find(|spec| spec.path == route)
        .map(|spec| spec.syntax)
}

pub(crate) const REGISTRY_ID: &str = "boreal.cli.registry.v1";

#[derive(Clone, Copy)]
struct CommandSpec {
    path: &'static str,
    syntax: &'static str,
    action: &'static str,
    output: &'static str,
    direct: bool,
    service: bool,
    summary: &'static str,
}

#[derive(Clone, Copy)]
struct GapSpec {
    path: &'static str,
    code: &'static str,
    summary: &'static str,
    owner: &'static str,
    scope: &'static str,
}

// Keep this list close to the dispatch boundary. The registry is a product
// contract, not a copy of the aspirational command-plan document.
const COMMANDS: &[CommandSpec] = &[
    CommandSpec {path:"merge show",syntax:"bwrk merge show [--project PROJECT] --input PATH [--limit N] [--offset N] [--json]",action:"read",output:"maintenance_annotations",direct:true,service:true,summary:"inspect retained lineage and versioned summaries"},
    CommandSpec {path:"compact show",syntax:"bwrk compact show [--project PROJECT] --input PATH [--limit N] [--offset N] [--json]",action:"read",output:"maintenance_annotations",direct:true,service:true,summary:"inspect retained lineage and versioned summaries"},
    CommandSpec {path:"install status",syntax:"bwrk install status [--json]",action:"read",output:"installation",direct:true,service:false,summary:"inspect running binary and PATH conflicts"},
    CommandSpec {path:"integrations",syntax:"bwrk integrations [--agent codex|claude] [--scope project|user] [--json]",action:"read",output:"skills",direct:true,service:false,summary:"inspect project-local skill installation by default"},
    CommandSpec {path:"integrations status",syntax:"bwrk integrations status [--agent codex|claude] [--scope project|user] [--json]",action:"read",output:"skills",direct:true,service:false,summary:"verify installed skill bytes and managed asset identities"},
    CommandSpec {path:"integrations add",syntax:"bwrk integrations add [--agent codex|claude] [--scope project|user] --yes [--json]",action:"mutate",output:"skills",direct:true,service:false,summary:"install bundled skills through the managed project-local installer"},
    CommandSpec {path:"doctor skills",syntax:"bwrk doctor skills [--agent codex|claude] [--scope project|user] [--json]",action:"read",output:"diagnostics",direct:true,service:false,summary:"diagnose missing or stale installed workflow assets"},
    CommandSpec {path:"schema validate",syntax:"bwrk schema validate [--project PROJECT] [--json]",action:"read",output:"diagnostics",direct:true,service:true,summary:"validate actual store contract, SQLite integrity and references"},
    CommandSpec {path:"docs check",syntax:"bwrk docs check [--json]",action:"read",output:"diagnostics",direct:true,service:false,summary:"validate embedded workflow recipes, skill references and public grammar"},
    CommandSpec {path:"gate",syntax:"bwrk gate [--project PROJECT] [--agent codex|claude] [--json]",action:"read",output:"diagnostics",direct:true,service:false,summary:"aggregate project health, schema, workflow and skill checks without pruning"},
    CommandSpec {path:"gate closeout",syntax:"bwrk gate closeout [--project PROJECT] [--agent codex|claude] [--json]",action:"read",output:"diagnostics",direct:true,service:false,summary:"aggregate read-only closeout diagnostics; acceptance evidence remains separate"},
    CommandSpec {path:"registry set-state",syntax:"bwrk registry set-state PROJECT_ID --state linked|paused|archived --expected-revision N --yes [--json]",action:"mutate",output:"global_project",direct:true,service:false,summary:"apply revision-fenced management project participation transition"},
    CommandSpec {path:"registry pause",syntax:"bwrk registry pause PROJECT_ID --expected-revision N --yes [--json]",action:"mutate",output:"global_project",direct:true,service:false,summary:"pause management project participation without changing workspace work"},
    CommandSpec {path:"registry resume",syntax:"bwrk registry resume PROJECT_ID --expected-revision N --yes [--json]",action:"mutate",output:"global_project",direct:true,service:false,summary:"resume nonterminal management project participation"},
    CommandSpec {path:"registry doctor",syntax:"bwrk registry doctor [--json]",action:"read",output:"global_diagnostics",direct:true,service:false,summary:"validate linked workspace paths and project identity"},
    CommandSpec {path:"global next",syntax:"bwrk global next [--limit N] [--json]",action:"read",output:"global_guidance",direct:true,service:false,summary:"rank fresh advisory work recommendations across participating projects"},
    CommandSpec {path:"reservation list",syntax:"bwrk reservation list [--project PROJECT] [--owner ACTOR] [--work WORK_ID] [--status active|released|expired|release_pending|unknown|all] [--limit N] [--offset N] [--json]",action:"read",output:"reservations",direct:true,service:true,summary:"inspect attempt and resource reservations with filters before pagination"},
    CommandSpec {path:"snapshot list",syntax:"bwrk snapshot list [--project PROJECT] [--limit N] [--offset N] [--json]",action:"read",output:"snapshots",direct:true,service:true,summary:"browse durable project backup history"},
    CommandSpec {path:"snapshot show",syntax:"bwrk snapshot show [--project PROJECT] SNAPSHOT_ID [--json]",action:"read",output:"snapshot",direct:true,service:true,summary:"inspect a committed project backup manifest by operation identity"},
    CommandSpec {path:"lock inspect",syntax:"bwrk lock inspect [--project PROJECT] [--json]",action:"read",output:"ownership",direct:true,service:false,summary:"inspect live OS ownership locks and unresolved recovery obligations"},
    CommandSpec {path:"storage rotate-log",syntax:"bwrk storage rotate-log [--project PROJECT] --input .boreal/logs/NAME.log [--max-bytes N] --expected-revision N --yes [--json]",action:"mutate",output:"diagnostic_rotation",direct:true,service:false,summary:"rotate diagnostic logs with durable readback; canonical audit is retained"},
    CommandSpec {path:"duplicate scan",syntax:"bwrk duplicate scan [--project PROJECT] [--limit N] [--json]",action:"read",output:"duplicates",direct:true,service:true,summary:"scan bounded canonical records and validated published memory for duplicates"},
    CommandSpec {path:"merge plan",syntax:"bwrk merge plan [--project PROJECT] --input PATH [--json]",action:"read",output:"merge_plan",direct:true,service:true,summary:"prepare content-bound immutable duplicate lineage plan"},
    CommandSpec {path:"merge apply",syntax:"bwrk merge apply [--project PROJECT] --input PATH --plan DIGEST --expected-revision N --yes [--json]",action:"mutate",output:"merge_lineage",direct:true,service:true,summary:"apply reviewed supersession lineage while preserving originals and proof"},
    CommandSpec {path:"compact analyze",syntax:"bwrk compact analyze [--project PROJECT] [--limit N] [--minimum-bytes N] [--json]",action:"read",output:"compaction_plans",direct:true,service:true,summary:"prepare source-bound versioned summarization plans"},
    CommandSpec {path:"compact apply",syntax:"bwrk compact apply [--project PROJECT] --input PATH --plan DIGEST --expected-revision N --yes [--json]",action:"mutate",output:"compaction_summary",direct:true,service:true,summary:"record reviewed versioned summary without overwriting original content"},
    CommandSpec {path:"memory init",syntax:"bwrk memory init [--project PROJECT] [--json]",action:"mutate",output:"memory_layout",direct:true,service:true,summary:"idempotently create Git-portable memory scaffold inside current project"},
    CommandSpec {path:"vault init",syntax:"bwrk vault init [--project PROJECT] [--json]",action:"mutate",output:"memory_layout",direct:true,service:true,summary:"compatibility spelling for project memory initialization"},

    CommandSpec {
        path: "work split",
        syntax: "bwrk work split --project PROJECT WORK_ID --title TEXT [--description TEXT] [--priority N] [--label LABEL] [--acceptance focused|reviewed] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "work_split",
        direct: true,
        service: true,
        summary: "atomically create a prerequisite task, preserve split provenance and block the original",
    },
    CommandSpec {
        path: "work split show",
        syntax: "bwrk work split show --project PROJECT SPLIT_ID [--json]",
        action: "read",
        output: "work_split",
        direct: true,
        service: true,
        summary: "inspect immutable split lineage",
    },
    CommandSpec {
        path: "orchestrate pool configure",
        syntax: "bwrk orchestrate pool configure --project PROJECT POOL_ID --input PATH --expected-revision N --yes [--json]",
        action: "mutate",
        output: "orchestration_pool",
        direct: true,
        service: true,
        summary: "register an operator-authorized pool of distinct actor/session/harness identities",
    },
    CommandSpec {
        path: "orchestrate pool list",
        syntax: "bwrk orchestrate pool list --project PROJECT [--json]",
        action: "read",
        output: "orchestration_pool",
        direct: true,
        service: true,
        summary: "inspect registered worker pools",
    },
    CommandSpec {
        path: "orchestrate pool show",
        syntax: "bwrk orchestrate pool show --project PROJECT POOL_ID [--json]",
        action: "read",
        output: "orchestration_pool",
        direct: true,
        service: true,
        summary: "inspect exact pool policy and provenance",
    },
    CommandSpec {
        path: "orchestrate pool remove",
        syntax: "bwrk orchestrate pool remove --project PROJECT POOL_ID --expected-revision N --yes [--json]",
        action: "mutate",
        output: "orchestration_pool",
        direct: true,
        service: true,
        summary: "revoke pool policy while retaining its history",
    },
    CommandSpec {
        path: "start",
        syntax: "bwrk start --project PROJECT [WORK_ID] [--source-version ID --config-identity ID] [--session ID] [--json]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "compatibility alias for agent start using current canonical attempt rules",
    },
    CommandSpec {
        path: "done",
        syntax: "bwrk done WORK_ID --project PROJECT (--close --receipt PATH --summary PATH | --release [--reason CODE]) [--attempt ID --fence N] [--json]",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "compatibility alias for agent finish; explicit close or release is required",
    },
    CommandSpec {
        path: "run",
        syntax: "bwrk run --project PROJECT [RUN_ID] [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "compatibility adapter for orchestrate show",
    },
    CommandSpec {
        path: "events",
        syntax: "bwrk events --project PROJECT [RUN_ID] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "compatibility adapter for orchestrate events",
    },
    CommandSpec {
        path: "daemon status",
        syntax: "bwrk daemon status --project PROJECT [--json]",
        action: "read",
        output: "orchestration_worker",
        direct: true,
        service: true,
        summary: "compatibility adapter for orchestrate daemon status",
    },
    CommandSpec {
        path: "daemon run",
        syntax: "bwrk daemon run --project PROJECT --pool ID [--workers N] [--max-requests N] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration_worker",
        direct: true,
        service: false,
        summary: "bounded local worker under the canonical fenced lease",
    },
    CommandSpec {
        path: "sprint show",
        syntax: "bwrk sprint show --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "compatibility adapter for cycle board",
    },
    CommandSpec {
        path: "sprint status",
        syntax: "bwrk sprint status --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "compatibility adapter for cycle board",
    },
    CommandSpec {
        path: "sprint metrics",
        syntax: "bwrk sprint metrics --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "compatibility adapter for cycle report",
    },
    CommandSpec {
        path: "sprint launch",
        syntax: "bwrk sprint launch --project PROJECT CYCLE_ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "compatibility adapter for cycle activate with current canonical input contract",
    },
    CommandSpec {
        path: "sprint current",
        syntax: "bwrk sprint current --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "compatibility adapter for active cycle read",
    },
    CommandSpec {
        path: "templates list",
        syntax: "bwrk templates list --project PROJECT [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "plural compatibility spelling for template list",
    },
    CommandSpec {
        path: "templates show",
        syntax: "bwrk templates show --project PROJECT TEMPLATE_ID [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "plural compatibility spelling for template show",
    },
    CommandSpec {
        path: "templates validate",
        syntax: "bwrk templates validate --project PROJECT --input PATH [--var KEY=VALUE] [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "plural compatibility spelling for template validate",
    },
    CommandSpec {
        path: "templates run",
        syntax: "bwrk templates run --project PROJECT TEMPLATE_ID|--input .boreal/templates/NAME.json [--var KEY=VALUE] [--dry-run | --apply --prefix ID --expected-revision N --yes] [--json]",
        action: "mutate",
        output: "template",
        direct: true,
        service: true,
        summary: "plural compatibility spelling for template run",
    },
    CommandSpec {
        path: "templates capture",
        syntax: "bwrk templates capture --project PROJECT --work WORK_ID --out .boreal/templates/NAME.json [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "plural compatibility spelling for template capture",
    },
    CommandSpec {
        path: "orchestrate harness configure",
        syntax: "bwrk orchestrate harness configure --project PROJECT --input PATH --expected-revision N --yes [--json]",
        action: "mutate",
        output: "harness",
        direct: true,
        service: true,
        summary: "store validated operator harness policy as canonical configuration",
    },
    CommandSpec {
        path: "orchestrate harness list",
        syntax: "bwrk orchestrate harness list --project PROJECT [--json]",
        action: "read",
        output: "harness",
        direct: true,
        service: true,
        summary: "list configured operator harness policies",
    },
    CommandSpec {
        path: "orchestrate harness show",
        syntax: "bwrk orchestrate harness show --project PROJECT HARNESS_ID [--json]",
        action: "read",
        output: "harness",
        direct: true,
        service: true,
        summary: "inspect one configured operator harness policy",
    },
    CommandSpec {
        path: "orchestrate harness remove",
        syntax: "bwrk orchestrate harness remove --project PROJECT HARNESS_ID --expected-revision N --yes [--json]",
        action: "mutate",
        output: "harness",
        direct: true,
        service: true,
        summary: "remove a harness policy with revisioned audit history",
    },
    CommandSpec {
        path: "orchestrate daemon run",
        syntax: "bwrk orchestrate daemon run --project PROJECT --pool ID [--workers N] [--max-requests N] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration_worker",
        direct: true,
        service: false,
        summary: "run a bounded local worker under a durable fenced lease",
    },
    CommandSpec {
        path: "orchestrate daemon status",
        syntax: "bwrk orchestrate daemon status --project PROJECT [--json]",
        action: "read",
        output: "orchestration_worker",
        direct: true,
        service: true,
        summary: "inspect durable worker ownership and process readback",
    },
    CommandSpec {
        path: "intake note",
        syntax: "bwrk intake note --project PROJECT INTAKE_ID TITLE [--description TEXT] [--bucket ID] --expected-revision N [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: false,
        summary: "capture typed note intake through canonical application",
    },
    CommandSpec {
        path: "intake discovery",
        syntax: "bwrk intake discovery --project PROJECT INTAKE_ID TITLE [--description TEXT] [--bucket ID] --expected-revision N [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: false,
        summary: "capture typed discovery intake through canonical application",
    },
    CommandSpec {
        path: "intake question",
        syntax: "bwrk intake question --project PROJECT INTAKE_ID TITLE [--description TEXT] [--bucket ID] --expected-revision N [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: false,
        summary: "capture typed question intake through canonical application",
    },
    CommandSpec {
        path: "intake revisit",
        syntax: "bwrk intake revisit --project PROJECT INTAKE_ID TITLE [--description TEXT] [--bucket ID] --expected-revision N [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: false,
        summary: "capture typed revisit intake through canonical application",
    },
    CommandSpec {
        path: "review decide",
        syntax: "bwrk review decide --project PROJECT --work ID --decision approve|reject|return|revoke --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "explicit compatibility adapter to canonical independent review actions",
    },
    CommandSpec {
        path: "directives list",
        syntax: "bwrk directives list --project PROJECT [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "list versioned trusted guidance",
    },
    CommandSpec {
        path: "directives show",
        syntax: "bwrk directives show --project PROJECT DIRECTIVE_ID [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "show one trusted directive",
    },
    CommandSpec {
        path: "directives compile",
        syntax: "bwrk directives compile --project PROJECT [--work ID] [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "compile current contextual guide and action descriptors",
    },
    CommandSpec {
        path: "directives render",
        syntax: "bwrk directives render --project PROJECT [--work ID] [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "render current contextual guide and action descriptors",
    },
    CommandSpec {
        path: "directives explain",
        syntax: "bwrk directives explain --project PROJECT DIRECTIVE_ID [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "explain one trusted directive",
    },
    CommandSpec {
        path: "directives ack create",
        syntax: "bwrk directives ack create --project PROJECT DIRECTIVE_ID [--work ID] --expected-revision N [--json]",
        action: "mutate",
        output: "directive",
        direct: true,
        service: true,
        summary: "record awareness of a trusted directive without waiving gates",
    },
    CommandSpec {
        path: "directives ack list",
        syntax: "bwrk directives ack list --project PROJECT [DIRECTIVE_ID] [--work ID] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "list acknowledgements, optionally filtered before pagination",
    },
    CommandSpec {
        path: "directives ack show",
        syntax: "bwrk directives ack show --project PROJECT ACK_ID [--json]",
        action: "read",
        output: "directive",
        direct: true,
        service: true,
        summary: "show one exact directive acknowledgement",
    },
    CommandSpec {
        path: "work labels set",
        syntax: "bwrk work labels set --project PROJECT WORK_ID [--labels CSV] --expected-revision N [--json]",
        action: "mutate",
        output: "work_labels",
        direct: true,
        service: true,
        summary: "replace normalized project-scoped labels with a revisioned audit fact",
    },
    CommandSpec {
        path: "summary backfill show",
        syntax: "bwrk summary backfill show --project PROJECT IMPORT_ID [--json]",
        action: "read",
        output: "legacy_summary",
        direct: true,
        service: true,
        summary: "inspect retained historical imports that cannot satisfy evidence gates",
    },
    CommandSpec {
        path: "orchestration start",
        syntax: "bwrk orchestration start --project PROJECT [--name TEXT] [--work ID] --source-version ID --config-identity ID [--max-claims N] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration list",
        syntax: "bwrk orchestration list --project PROJECT [RUN_ID] [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration show",
        syntax: "bwrk orchestration show --project PROJECT [RUN_ID] [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration events",
        syntax: "bwrk orchestration events --project PROJECT [RUN_ID] [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration progress",
        syntax: "bwrk orchestration progress --project PROJECT [RUN_ID] [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration nudge",
        syntax: "bwrk orchestration nudge --project PROJECT [RUN_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration tick",
        syntax: "bwrk orchestration tick --project PROJECT RUN_ID --expected-revision N [--operation-id ID] [--dispatch-now] [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration pause",
        syntax: "bwrk orchestration pause --project PROJECT [RUN_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration resume",
        syntax: "bwrk orchestration resume --project PROJECT [RUN_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration cancel",
        syntax: "bwrk orchestration cancel --project PROJECT [RUN_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration complete",
        syntax: "bwrk orchestration complete --project PROJECT [RUN_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration fail",
        syntax: "bwrk orchestration fail --project PROJECT [RUN_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestration daemon status",
        syntax: "bwrk orchestration daemon status --project PROJECT [--json]",
        action: "read",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "durable coordination through canonical project authority",
    },
    CommandSpec {
        path: "orchestrate complete",
        syntax: "bwrk orchestrate complete --project PROJECT RUN_ID --expected-revision N [--json]",
        action: "mutate",
        output: "orchestration",
        direct: true,
        service: true,
        summary: "complete a durable coordination run",
    },
    CommandSpec {
        path: "decision create",
        syntax: "bwrk decision create --project PROJECT DECISION_ID --title TEXT --body TEXT --reason TEXT [--source-version ID] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "decision",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "decision supersede",
        syntax: "bwrk decision supersede --project PROJECT NEW_ID OLD_ID --title TEXT --body TEXT --reason TEXT --expected-revision N --yes [--json]",
        action: "mutate",
        output: "decision",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "decision list",
        syntax: "bwrk decision list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "decision",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "decision show",
        syntax: "bwrk decision show --project PROJECT DECISION_ID [--json]",
        action: "read",
        output: "decision",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "knowledge claim create",
        syntax: "bwrk knowledge claim create --project PROJECT CLAIM_ID [--input PATH | --statement TEXT --source-version ID --citation LOCATION] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "knowledge claim review",
        syntax: "bwrk knowledge claim review --project PROJECT CLAIM_ID [--input PATH | --decision accepted|rejected|needs_revision --reason TEXT] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "knowledge claim list",
        syntax: "bwrk knowledge claim list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "knowledge claim show",
        syntax: "bwrk knowledge claim show --project PROJECT CLAIM_ID [--json]",
        action: "read",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "knowledge context show",
        syntax: "bwrk knowledge context show --project PROJECT [--work ID] [--limit N] [--json]",
        action: "read",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "knowledge context search",
        syntax: "bwrk knowledge context search --project PROJECT --query TEXT [--limit N] [--json]",
        action: "read",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "knowledge context rebuild",
        syntax: "bwrk knowledge context rebuild --project PROJECT [--json]",
        action: "mutate",
        output: "knowledge",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "context show",
        syntax: "bwrk context show --project PROJECT [--work ID] [--limit N] [--json]",
        action: "read",
        output: "context",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "context search",
        syntax: "bwrk context search --project PROJECT [QUERY] [--query TEXT] [--limit N] [--json]",
        action: "read",
        output: "context",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "context rebuild",
        syntax: "bwrk context rebuild --project PROJECT [--json]",
        action: "mutate",
        output: "context",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "search query",
        syntax: "bwrk search query --project PROJECT QUERY [--limit N] [--explain] [--json]",
        action: "read",
        output: "search",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "search index",
        syntax: "bwrk search index --project PROJECT [--json]",
        action: "mutate",
        output: "search",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "claim create",
        syntax: "bwrk claim create --project PROJECT CLAIM_ID [--input PATH | --statement TEXT --source-version ID --citation LOCATION] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "claim",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "claim review",
        syntax: "bwrk claim review --project PROJECT CLAIM_ID [--input PATH | --decision accepted|rejected|needs_revision --reason TEXT] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "claim",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "claim list",
        syntax: "bwrk claim list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "claim",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "claim show",
        syntax: "bwrk claim show --project PROJECT CLAIM_ID [--json]",
        action: "read",
        output: "claim",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "intake promote",
        syntax: "bwrk intake promote --project PROJECT INTAKE_ID --target-kind draft_work|source_version|memory_draft --target-id ID [--create-work [--input PATH]] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "intake disposition",
        syntax: "bwrk intake disposition --project PROJECT INTAKE_ID --state triaged|deferred|resolved|archived [--revisit-at-ms N] --expected-revision N --yes [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "summary list",
        syntax: "bwrk summary list --project PROJECT [--work ID] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "summary",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "summary show",
        syntax: "bwrk summary show --project PROJECT SUMMARY_ID [--json]",
        action: "read",
        output: "summary",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "summary render",
        syntax: "bwrk summary render --project PROJECT SUMMARY_ID [--out PATH] [--json]",
        action: "read",
        output: "summary",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "summary compose",
        syntax: "bwrk summary compose --project PROJECT --work ID [--body TEXT] [--note TEXT] [--json]",
        action: "read",
        output: "summary",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "summary create",
        syntax: "bwrk summary create --project PROJECT --work ID (--body TEXT | --input PATH) --attempt ID --fence N --expected-revision N [--json]",
        action: "mutate",
        output: "summary",
        direct: true,
        service: true,
        summary: "persist an immutable summary body and matching metadata",
    },
    CommandSpec {
        path: "summary backfill",
        syntax: "bwrk summary backfill --project PROJECT --input PATH --expected-revision N --yes [--json]",
        action: "mutate",
        output: "summary",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "handoff compose",
        syntax: "bwrk handoff compose --project PROJECT --work ID [--note TEXT] [--out PATH] [--json]",
        action: "read",
        output: "handoff",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "handoff show",
        syntax: "bwrk handoff show --project PROJECT --work ID [--out PATH] [--json]",
        action: "read",
        output: "handoff",
        direct: true,
        service: true,
        summary: "compose a bounded handoff from current saved context",
    },
    CommandSpec {
        path: "template list",
        syntax: "bwrk template list --project PROJECT [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "template show",
        syntax: "bwrk template show --project PROJECT TEMPLATE_ID [--input PATH] [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "template validate",
        syntax: "bwrk template validate --project PROJECT --input PATH [--var KEY=VALUE] [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "template run",
        syntax: "bwrk template run --project PROJECT TEMPLATE_ID|--input .boreal/templates/NAME.json [--var KEY=VALUE] [--dry-run | --apply --prefix ID --expected-revision N --yes] [--json]",
        action: "mutate",
        output: "template",
        direct: true,
        service: true,
        summary: "dry-run or atomically instantiate a versioned work template",
    },
    CommandSpec {
        path: "template capture",
        syntax: "bwrk template capture --project PROJECT --work ID --out PATH [--json]",
        action: "read",
        output: "template",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "orchestrate start",
        syntax: "bwrk orchestrate start --project PROJECT [--name TEXT] [--work ID] --source-version ID --config-identity ID [--max-claims N] --expected-revision N [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate list",
        syntax: "bwrk orchestrate list --project PROJECT [--limit N] [--json]",
        action: "read",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "orchestrate show",
        syntax: "bwrk orchestrate show --project PROJECT RUN_ID [--limit N] [--json]",
        action: "read",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "orchestrate tick",
        syntax: "bwrk orchestrate tick --project PROJECT RUN_ID --expected-revision N [--operation-id ID] [--dispatch-now] [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate progress",
        syntax: "bwrk orchestrate progress --project PROJECT RUN_ID [--limit N] [--offset N] [--json]",
        action: "read",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "orchestrate nudge",
        syntax: "bwrk orchestrate nudge --project PROJECT RUN_ID --expected-revision N [--reason TEXT] [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate pause",
        syntax: "bwrk orchestrate pause --project PROJECT RUN_ID --expected-revision N [--reason TEXT] [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate resume",
        syntax: "bwrk orchestrate resume --project PROJECT RUN_ID --expected-revision N [--reason TEXT] [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate cancel",
        syntax: "bwrk orchestrate cancel --project PROJECT RUN_ID --expected-revision N [--reason TEXT] [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate fail",
        syntax: "bwrk orchestrate fail --project PROJECT RUN_ID --expected-revision N --reason TEXT [--json]",
        action: "mutate",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "apply a durable operation with retained history",
    },
    CommandSpec {
        path: "orchestrate events",
        syntax: "bwrk orchestrate events --project PROJECT RUN_ID [--limit N] [--json]",
        action: "read",
        output: "orchestrate",
        direct: true,
        service: true,
        summary: "read current project-scoped records",
    },
    CommandSpec {
        path: "dashboard global",
        syntax: "bwrk dashboard global [--json]",
        action: "read",
        output: "global_dashboard",
        direct: true,
        service: false,
        summary: "open the installation-wide management dashboard",
    },
    CommandSpec {
        path: "global dashboard",
        syntax: "bwrk global dashboard [--json]",
        action: "read",
        output: "global_dashboard",
        direct: true,
        service: false,
        summary: "open the installation-wide management dashboard",
    },
    CommandSpec {
        path: "global status",
        syntax: "bwrk global status [--json]",
        action: "read",
        output: "global_status",
        direct: true,
        service: true,
        summary: "show installation-wide management state",
    },
    CommandSpec {
        path: "global bootstrap",
        syntax: "bwrk global bootstrap [--json]",
        action: "mutate",
        output: "global_bootstrap",
        direct: true,
        service: false,
        summary: "idempotently provision installation-wide management storage",
    },
    CommandSpec {
        path: "global project add",
        syntax: "bwrk global project add --name NAME [--folder PATH] [--json]",
        action: "mutate",
        output: "global_project",
        direct: true,
        service: true,
        summary: "create a folderless management project",
    },
    CommandSpec {
        path: "global project list",
        syntax: "bwrk global project list [--json]",
        action: "read",
        output: "global_projects",
        direct: true,
        service: true,
        summary: "list management projects",
    },
    CommandSpec {
        path: "global project show",
        syntax: "bwrk global project show PROJECT [--json]",
        action: "read",
        output: "global_project",
        direct: true,
        service: true,
        summary: "show a management project and linked workspace progress",
    },
    CommandSpec {
        path: "global project edit",
        syntax: "bwrk global project edit PROJECT [--name NAME] [--description TEXT] [--json]",
        action: "mutate",
        output: "global_project",
        direct: true,
        service: true,
        summary: "edit a management project",
    },
    CommandSpec {
        path: "global project archive",
        syntax: "bwrk global project archive PROJECT [--json]",
        action: "mutate",
        output: "global_project",
        direct: true,
        service: true,
        summary: "archive a management project",
    },
    CommandSpec {
        path: "global project unarchive",
        syntax: "bwrk global project unarchive PROJECT [--json]",
        action: "mutate",
        output: "global_project",
        direct: true,
        service: true,
        summary: "restore an archived management project",
    },
    CommandSpec {
        path: "global project attach-folder",
        syntax: "bwrk global project attach-folder PROJECT --folder PATH [--json]",
        action: "mutate",
        output: "global_association",
        direct: true,
        service: true,
        summary: "associate a folder without initializing it",
    },
    CommandSpec {
        path: "global project link",
        syntax: "bwrk global project link PROJECT --workspace PATH [--json]",
        action: "mutate",
        output: "global_association",
        direct: true,
        service: true,
        summary: "link a validated Boreal workspace",
    },
    CommandSpec {
        path: "global project unlink",
        syntax: "bwrk global project unlink PROJECT [--workspace PATH|--folder PATH] [--json]",
        action: "mutate",
        output: "global_association",
        direct: true,
        service: true,
        summary: "remove a folder or workspace association",
    },
    CommandSpec {
        path: "global todo add",
        syntax: "bwrk global todo add --title TITLE [--project PROJECT] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "capture a personal todo",
    },
    CommandSpec {
        path: "global todo list",
        syntax: "bwrk global todo list [--project PROJECT] [--include-archived] [--json]",
        action: "read",
        output: "global_items",
        direct: true,
        service: true,
        summary: "list management tasks",
    },
    CommandSpec {
        path: "global todo show",
        syntax: "bwrk global todo show ITEM [--json]",
        action: "read",
        output: "global_item",
        direct: true,
        service: true,
        summary: "show a management task",
    },
    CommandSpec {
        path: "global todo edit",
        syntax: "bwrk global todo edit ITEM [--title TITLE] [--description TEXT] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "edit a management task",
    },
    CommandSpec {
        path: "global todo move",
        syntax: "bwrk global todo move ITEM --status STATUS [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "move a management task through its workflow",
    },
    CommandSpec {
        path: "global todo reorder",
        syntax: "bwrk global todo reorder ITEM --direction up|down [--expected-revision N] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "reorder an item among active siblings in its project and workflow column",
    },
    CommandSpec {
        path: "global todo complete",
        syntax: "bwrk global todo complete ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "complete a management task",
    },
    CommandSpec {
        path: "global todo reopen",
        syntax: "bwrk global todo reopen ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "reopen a completed management task",
    },
    CommandSpec {
        path: "global todo archive",
        syntax: "bwrk global todo archive ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "archive a management task while retaining history",
    },
    CommandSpec {
        path: "global todo unarchive",
        syntax: "bwrk global todo unarchive ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "restore an archived management task",
    },
    CommandSpec {
        path: "global task add",
        syntax: "bwrk global task add --title TITLE [--project PROJECT] [--parent ITEM] [--priority N] [--due-at TIME] [--labels JSON] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "create a structured management task",
    },
    CommandSpec {
        path: "global task list",
        syntax: "bwrk global task list [--project PROJECT] [--json]",
        action: "read",
        output: "global_items",
        direct: true,
        service: true,
        summary: "list structured management tasks",
    },
    CommandSpec {
        path: "global task show",
        syntax: "bwrk global task show ITEM [--json]",
        action: "read",
        output: "global_item",
        direct: true,
        service: true,
        summary: "show a structured management task",
    },
    CommandSpec {
        path: "global task edit",
        syntax: "bwrk global task edit ITEM [--title TITLE] [--description TEXT] [--status STATUS] [--priority N] [--due-at TIME] [--labels JSON] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "edit a structured management task",
    },
    CommandSpec {
        path: "global task archive",
        syntax: "bwrk global task archive ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "archive a structured management task",
    },
    CommandSpec {
        path: "global task unarchive",
        syntax: "bwrk global task unarchive ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "restore an archived structured task",
    },
    CommandSpec {
        path: "global milestone unarchive",
        syntax: "bwrk global milestone unarchive ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "restore an archived milestone",
    },
    CommandSpec {
        path: "global subtask add",
        syntax: "bwrk global subtask add --title TITLE --parent ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "create a child task",
    },
    CommandSpec {
        path: "global milestone add",
        syntax: "bwrk global milestone add --title TITLE [--project PROJECT] [--due-at TIME] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "create a planning milestone",
    },
    CommandSpec {
        path: "global milestone list",
        syntax: "bwrk global milestone list [--project PROJECT] [--json]",
        action: "read",
        output: "global_items",
        direct: true,
        service: true,
        summary: "list milestones",
    },
    CommandSpec {
        path: "global milestone show",
        syntax: "bwrk global milestone show ITEM [--json]",
        action: "read",
        output: "global_item",
        direct: true,
        service: true,
        summary: "show a milestone",
    },
    CommandSpec {
        path: "global milestone edit",
        syntax: "bwrk global milestone edit ITEM [--title TITLE] [--due-at TIME] [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "edit a milestone",
    },
    CommandSpec {
        path: "global milestone archive",
        syntax: "bwrk global milestone archive ITEM [--json]",
        action: "mutate",
        output: "global_item",
        direct: true,
        service: true,
        summary: "archive a milestone",
    },
    CommandSpec {
        path: "global workflow status add",
        syntax: "bwrk global workflow status add --project PROJECT --status-id ID --label LABEL --category CATEGORY [--position N] [--json]",
        action: "mutate",
        output: "global_workflow",
        direct: true,
        service: true,
        summary: "add a stable workflow status",
    },
    CommandSpec {
        path: "global workflow status edit",
        syntax: "bwrk global workflow status edit --project PROJECT --status-id ID [--label LABEL] [--category CATEGORY] [--position N] [--json]",
        action: "mutate",
        output: "global_workflow",
        direct: true,
        service: true,
        summary: "edit workflow presentation while preserving status identity",
    },
    CommandSpec {
        path: "global workflow status list",
        syntax: "bwrk global workflow status list --project PROJECT [--json]",
        action: "read",
        output: "global_workflow",
        direct: true,
        service: true,
        summary: "list project workflow statuses",
    },
    CommandSpec {
        path: "global relationship add",
        syntax: "bwrk global relationship add --source ITEM --target ITEM [--kind depends_on] [--json]",
        action: "mutate",
        output: "global_relationship",
        direct: true,
        service: true,
        summary: "add a task relationship",
    },
    CommandSpec {
        path: "global relationship remove",
        syntax: "bwrk global relationship remove --source ITEM --target ITEM [--kind depends_on] [--json]",
        action: "mutate",
        output: "global_relationship",
        direct: true,
        service: true,
        summary: "remove a task relationship",
    },
    CommandSpec {
        path: "global relationship list",
        syntax: "bwrk global relationship list [--project PROJECT] [--json]",
        action: "read",
        output: "global_relationships",
        direct: true,
        service: true,
        summary: "list task relationships",
    },
    CommandSpec {
        path: "global note add",
        syntax: "bwrk global note add --title TITLE --body BODY [--project PROJECT] [--json]",
        action: "mutate",
        output: "global_note",
        direct: true,
        service: true,
        summary: "add a personal note",
    },
    CommandSpec {
        path: "global note list",
        syntax: "bwrk global note list [--project PROJECT] [--json]",
        action: "read",
        output: "global_notes",
        direct: true,
        service: true,
        summary: "list personal notes",
    },
    CommandSpec {
        path: "global note show",
        syntax: "bwrk global note show NOTE [--json]",
        action: "read",
        output: "global_note",
        direct: true,
        service: true,
        summary: "show a personal note",
    },
    CommandSpec {
        path: "global note edit",
        syntax: "bwrk global note edit NOTE [--title TITLE] [--body BODY] [--json]",
        action: "mutate",
        output: "global_note",
        direct: true,
        service: true,
        summary: "edit a personal note",
    },
    CommandSpec {
        path: "global note archive",
        syntax: "bwrk global note archive NOTE [--json]",
        action: "mutate",
        output: "global_note",
        direct: true,
        service: true,
        summary: "archive a personal note",
    },
    CommandSpec {
        path: "global note unarchive",
        syntax: "bwrk global note unarchive NOTE [--json]",
        action: "mutate",
        output: "global_note",
        direct: true,
        service: true,
        summary: "restore an archived personal note",
    },
    CommandSpec {
        path: "global history",
        syntax: "bwrk global history [--project PROJECT] [--item ITEM] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "global_history",
        direct: true,
        service: true,
        summary: "browse retained global operation history",
    },
    CommandSpec {
        path: "global linked show",
        syntax: "bwrk global linked show MANAGEMENT_PROJECT WORKSPACE_PROJECT [--json]",
        action: "read",
        output: "global_linked_project",
        direct: true,
        service: true,
        summary: "inspect a bounded page of source workspace work and status",
    },
    CommandSpec {
        path: "global operation show",
        syntax: "bwrk global operation show OPERATION_ID [--json]",
        action: "read",
        output: "global_operation",
        direct: true,
        service: true,
        summary: "read back a global operation outcome",
    },
    CommandSpec {
        path: "global snapshot",
        syntax: "bwrk global snapshot [--json]",
        action: "read",
        output: "global_snapshot",
        direct: true,
        service: true,
        summary: "read a consistent management snapshot",
    },
    CommandSpec {
        path: "global export",
        syntax: "bwrk global export [--out PATH] [--json]",
        action: "read",
        output: "global_export",
        direct: true,
        service: true,
        summary: "export global management data",
    },
    CommandSpec {
        path: "global import",
        syntax: "bwrk global import --input PATH [--replace --yes --expected-revision N] [--json]",
        action: "mutate",
        output: "global_import",
        direct: true,
        service: true,
        summary: "restore an exported global snapshot with revision-bound replacement",
    },
    CommandSpec {
        path: "global service run",
        syntax: "bwrk global service run --socket PATH [--max-requests N] [--json]",
        action: "mutate",
        output: "global_service",
        direct: true,
        service: false,
        summary: "run the global versioned Unix service",
    },
    CommandSpec {
        path: "operation list",
        syntax: "bwrk operation list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "operation_page",
        direct: true,
        service: true,
        summary: "browse retained project operations",
    },
    CommandSpec {
        path: "operation stats",
        syntax: "bwrk operation stats --project PROJECT [--json]",
        action: "read",
        output: "operation_statistics",
        direct: true,
        service: true,
        summary: "aggregate operation outcomes without deleting history",
    },
    CommandSpec {
        path: "work history",
        syntax: "bwrk work history --project PROJECT WORK_ID [--limit N] [--offset N] [--json]",
        action: "read",
        output: "operation_page",
        direct: true,
        service: true,
        summary: "browse work audit and operation history",
    },
    CommandSpec {
        path: "export json",
        syntax: "bwrk export json --project PROJECT [--out PATH] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "project_export",
        direct: true,
        service: true,
        summary: "export a bounded project page with its revision and operation history",
    },
    CommandSpec {
        path: "export markdown",
        syntax: "bwrk export markdown --project PROJECT [--out PATH] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "project_export",
        direct: true,
        service: true,
        summary: "render a bounded project export for sharing",
    },
    CommandSpec {
        path: "completion",
        syntax: "bwrk completion [bash|zsh|fish] [--json]",
        action: "read",
        output: "shell_completion",
        direct: true,
        service: false,
        summary: "generate shell completion from executable command registry",
    },
    CommandSpec {
        path: "commands compatibility",
        syntax: "bwrk commands compatibility [--json]",
        action: "read",
        output: "command_compatibility",
        direct: true,
        service: false,
        summary: "inspect exact retained and replacement legacy command mappings",
    },
    CommandSpec {
        path: "work ready",
        syntax: "bwrk work ready --project PROJECT [--container ID] [--status STATUS[,STATUS...]] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--all] [--ready] [--closed] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "work_discovery",
        direct: true,
        service: true,
        summary: "actor-specific conditional discovery with deterministic priority and lineage",
    },
    CommandSpec {
        path: "work recent-closed",
        syntax: "bwrk work recent-closed --project PROJECT [--container ID] [--status STATUS[,STATUS...]] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--all] [--ready] [--closed] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "work_discovery",
        direct: true,
        service: true,
        summary: "actor-specific conditional discovery ordered by close revision",
    },
    CommandSpec {
        path: "work review-candidates",
        syntax: "bwrk work review-candidates --project PROJECT [--container ID] [--status STATUS[,STATUS...]] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--all] [--ready] [--closed] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "work_discovery",
        direct: true,
        service: true,
        summary: "actor-specific conditional discovery with deterministic priority and lineage",
    },
    CommandSpec {
        path: "work parallel",
        syntax: "bwrk work parallel --project PROJECT [--container ID] [--status STATUS[,STATUS...]] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--all] [--ready] [--closed] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "work_discovery",
        direct: true,
        service: true,
        summary: "actor-specific conditional discovery with deterministic priority and lineage",
    },
    CommandSpec {
        path: "work next",
        syntax: "bwrk work next --project PROJECT [--container ID] [--status STATUS[,STATUS...]] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--ready] [--closed] [--json]",
        action: "read",
        output: "work_discovery",
        direct: true,
        service: true,
        summary: "select actor-claimable work using conditional status and discovery filters",
    },
    CommandSpec {
        path: "cycle current",
        syntax: "bwrk cycle current --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "list currently active cycles from one revision-consistent snapshot",
    },
    CommandSpec {
        path: "recovery list",
        syntax: "bwrk recovery list --project PROJECT [AFTER_ID] [--limit N] [--json]",
        action: "read",
        output: "recovery",
        direct: true,
        service: true,
        summary: "list unresolved project recovery obligations",
    },
    CommandSpec {
        path: "recovery resolve",
        syntax: "bwrk recovery resolve --project PROJECT [OBLIGATION_ID] --input PATH --expected-revision N --yes [--json]",
        action: "mutate",
        output: "recovery",
        direct: true,
        service: true,
        summary: "record an operator decision and reconcile an original recovery obligation",
    },
    CommandSpec {
        path: "recovery recover",
        syntax: "bwrk recovery recover --project PROJECT --input PATH --expected-revision N --yes [--session ID] [--operation-id ID] [--socket PATH] [--json]",
        action: "mutate",
        output: "attempt_recovery",
        direct: true,
        service: true,
        summary: "apply the server-issued Recover descriptor to an exact eligible attempt and retain durable recovery history",
    },
    CommandSpec {
        path: "maintenance show",
        syntax: "bwrk maintenance show --project PROJECT OPERATION_ID [--input RESTORE_PACKAGE_DIR] [--socket PATH] [--json]",
        action: "read",
        output: "maintenance",
        direct: true,
        service: true,
        summary: "inspect durable backup or restore operation readback for this project",
    },
    CommandSpec {
        path: "work checkpoint",
        syntax: "bwrk work checkpoint --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "retain revision-bound checkpoint progress without fabricating acceptance evidence",
    },
    CommandSpec {
        path: "memory reconcile",
        syntax: "bwrk memory reconcile --project PROJECT OPERATION_ID --yes --expected-revision N [--json]",
        action: "mutate",
        output: "memory",
        direct: true,
        service: true,
        summary: "reconcile SQLite with verified Git publication readback",
    },
    CommandSpec {
        path: "memory draft",
        syntax: "bwrk memory draft --project PROJECT [DRAFT_ID] --input PATH --yes --expected-revision N [--json]",
        action: "mutate",
        output: "memory",
        direct: true,
        service: true,
        summary: "input needs entry_id, title, body and citations; provide draft_id in input or positionally",
    },
    CommandSpec {
        path: "memory review",
        syntax: "bwrk memory review --project PROJECT DRAFT_ID --input PATH --yes --expected-revision N [--json]",
        action: "mutate",
        output: "memory",
        direct: true,
        service: true,
        summary: "input needs decision and reason; review the named draft",
    },
    CommandSpec {
        path: "memory publish",
        syntax: "bwrk memory publish --project PROJECT REVIEW_ID --input PATH --yes --expected-revision N [--json]",
        action: "mutate",
        output: "memory",
        direct: true,
        service: true,
        summary: "input needs expected_manifest_identity; publish the named approved review",
    },
    CommandSpec {
        path: "memory show",
        syntax: "bwrk memory show --project PROJECT DRAFT_ID [--json]",
        action: "read",
        output: "memory",
        direct: true,
        service: true,
        summary: "durable cited memory through the application boundary",
    },
    CommandSpec {
        path: "memory search",
        syntax: "bwrk memory search --project PROJECT QUERY [--json]",
        action: "read",
        output: "memory",
        direct: true,
        service: true,
        summary: "durable cited memory through the application boundary",
    },
    CommandSpec {
        path: "memory readback",
        syntax: "bwrk memory readback --project PROJECT OPERATION_ID [--json]",
        action: "read",
        output: "memory",
        direct: true,
        service: true,
        summary: "durable cited memory through the application boundary",
    },
    CommandSpec {
        path: "intake capture",
        syntax: "bwrk intake capture [ARGS] [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: false,
        summary: "project-scoped intake through the canonical application",
    },
    CommandSpec {
        path: "intake bucket",
        syntax: "bwrk intake bucket [ARGS] [--json]",
        action: "mutate",
        output: "intake",
        direct: true,
        service: false,
        summary: "project-scoped intake through the canonical application",
    },
    CommandSpec {
        path: "intake show",
        syntax: "bwrk intake show [ARGS] [--json]",
        action: "read",
        output: "intake",
        direct: true,
        service: false,
        summary: "project-scoped intake through the canonical application",
    },
    CommandSpec {
        path: "intake list",
        syntax: "bwrk intake list [ARGS] [--json]",
        action: "read",
        output: "intake",
        direct: true,
        service: false,
        summary: "project-scoped intake through the canonical application",
    },
    CommandSpec {
        path: "cycle list",
        syntax: "bwrk cycle list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "read revision-consistent cycle planning",
    },
    CommandSpec {
        path: "cycle board",
        syntax: "bwrk cycle board --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "read revision-consistent cycle planning",
    },
    CommandSpec {
        path: "cycle report",
        syntax: "bwrk cycle report --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "read revision-consistent cycle planning",
    },
    CommandSpec {
        path: "cycle create",
        syntax: "bwrk cycle create --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle activate",
        syntax: "bwrk cycle activate --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle close",
        syntax: "bwrk cycle close --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle cancel",
        syntax: "bwrk cycle cancel --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle assign",
        syntax: "bwrk cycle assign --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle commit",
        syntax: "bwrk cycle commit --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle remove",
        syntax: "bwrk cycle remove --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle carry-over",
        syntax: "bwrk cycle carry-over --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "cycle map-legacy",
        syntax: "bwrk cycle map-legacy --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint list",
        syntax: "bwrk sprint list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "read revision-consistent cycle planning",
    },
    CommandSpec {
        path: "sprint board",
        syntax: "bwrk sprint board --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "read revision-consistent cycle planning",
    },
    CommandSpec {
        path: "sprint report",
        syntax: "bwrk sprint report --project PROJECT CYCLE_ID [--json]",
        action: "read",
        output: "planning",
        direct: true,
        service: true,
        summary: "read revision-consistent cycle planning",
    },
    CommandSpec {
        path: "sprint create",
        syntax: "bwrk sprint create --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint activate",
        syntax: "bwrk sprint activate --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint close",
        syntax: "bwrk sprint close --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint cancel",
        syntax: "bwrk sprint cancel --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint assign",
        syntax: "bwrk sprint assign --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint commit",
        syntax: "bwrk sprint commit --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint remove",
        syntax: "bwrk sprint remove --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint carry-over",
        syntax: "bwrk sprint carry-over --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "sprint map-legacy",
        syntax: "bwrk sprint map-legacy --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "planning",
        direct: true,
        service: true,
        summary: "apply an authenticated, revision-bound cycle operation",
    },
    CommandSpec {
        path: "review list",
        syntax: "bwrk review list --project PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "reviews",
        direct: true,
        service: true,
        summary: "list project-scoped independent review decisions",
    },
    CommandSpec {
        path: "review show",
        syntax: "bwrk review show --project PROJECT REVIEW_ID [--json]",
        action: "read",
        output: "review",
        direct: true,
        service: true,
        summary: "inspect one project-scoped immutable review decision",
    },
    CommandSpec {
        path: "review approve",
        syntax: "bwrk review approve --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound review approve; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "review reject",
        syntax: "bwrk review reject --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound review reject; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "review return",
        syntax: "bwrk review return --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound review return; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "review revoke",
        syntax: "bwrk review revoke --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound review revoke; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "exception grant",
        syntax: "bwrk exception grant --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound exception grant; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "exception revoke",
        syntax: "bwrk exception revoke --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound exception revoke; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "dep waive",
        syntax: "bwrk dep waive --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound dep waive; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "work reopen",
        syntax: "bwrk work reopen --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound work reopen; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "work cancel",
        syntax: "bwrk work cancel --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound work cancel; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "work retry",
        syntax: "bwrk work retry --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound work retry; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "work publish",
        syntax: "bwrk work publish --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",
        action: "mutate",
        output: "completion",
        direct: true,
        service: true,
        summary: "revision-bound work publish; input JSON needs expected_entity_revision and expected_proof_revision",
    },
    CommandSpec {
        path: "auth show",
        syntax: "bwrk auth show [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]",
        action: "read",
        output: "principal",
        direct: true,
        service: false,
        summary: "show authenticated principal and delegation root",
    },
    CommandSpec {
        path: "auth key",
        syntax: "bwrk auth key --actor ID [--actor-role agent|reviewer|operator|publisher] [--json]",
        action: "mutate",
        output: "principal",
        direct: true,
        service: false,
        summary: "create a private enrollment file without granting authority",
    },
    CommandSpec {
        path: "auth bootstrap",
        syntax: "bwrk auth bootstrap [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]",
        action: "mutate",
        output: "principal",
        direct: true,
        service: false,
        summary: "owner-only bootstrap for an initialized pre-key workspace",
    },
    CommandSpec {
        path: "auth grant",
        syntax: "bwrk auth grant [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]",
        action: "mutate",
        output: "principal",
        direct: true,
        service: false,
        summary: "grant or rotate a revision-bound project principal credential",
    },
    CommandSpec {
        path: "auth revoke",
        syntax: "bwrk auth revoke [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]",
        action: "mutate",
        output: "principal",
        direct: true,
        service: false,
        summary: "revoke a project credential or delegation subtree",
    },
    CommandSpec {
        path: "commands",
        syntax: "bwrk commands [PATH] [--json]",
        action: "read",
        output: "command_registry",
        direct: true,
        service: false,
        summary: "discover executable routes and their transport support",
    },
    CommandSpec {
        path: "help",
        syntax: "bwrk help [PATH]",
        action: "read",
        output: "help",
        direct: true,
        service: false,
        summary: "show the same registry-backed command help",
    },
    CommandSpec {
        path: "version",
        syntax: "bwrk version [--json]",
        action: "read",
        output: "version",
        direct: true,
        service: false,
        summary: "show binary, protocol, schema, and registry identity",
    },
    CommandSpec {
        path: "workflows list",
        syntax: "bwrk workflows list [--json]",
        action: "read",
        output: "workflow_package",
        direct: true,
        service: true,
        summary: "list the embedded, versioned workflow assets without project state",
    },
    CommandSpec {
        path: "workflows show",
        syntax: "bwrk workflows show WORKFLOW_REF [--json]",
        action: "read",
        output: "workflow",
        direct: true,
        service: true,
        summary: "show one exact embedded workflow asset",
    },
    CommandSpec {
        path: "init",
        syntax: "bwrk init [PROJECT_DIR] [--project ID] [--interactive|--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
        action: "mutate",
        output: "project",
        direct: true,
        service: false,
        summary: "initialize and scaffold a project; prompts for agent skill targets in a terminal",
    },
    CommandSpec {
        path: "setup",
        syntax: "bwrk setup [PROJECT_DIR] [--project ID] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
        action: "mutate",
        output: "project_setup",
        direct: true,
        service: false,
        summary: "recommended project setup alias for init",
    },
    CommandSpec {
        path: "install",
        syntax: "bwrk install [PROJECT_DIR] [--project ID] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
        action: "mutate",
        output: "project_setup",
        direct: true,
        service: false,
        summary: "compatibility alias for project setup",
    },
    CommandSpec {
        path: "update",
        syntax: "bwrk update [--json]",
        action: "mutate",
        output: "machine_update",
        direct: true,
        service: false,
        summary: "update a release-installed bwrk binary and its packaged TUI",
    },
    CommandSpec {
        path: "upgrade",
        syntax: "bwrk upgrade --machine [--json]",
        action: "mutate",
        output: "machine_update",
        direct: true,
        service: false,
        summary: "v1-compatible alias for the machine update operation",
    },
    CommandSpec {
        path: "backup",
        syntax: "bwrk backup --project PROJECT PACKAGE_DIR [--json]",
        action: "mutate",
        output: "backup_package",
        direct: true,
        service: true,
        summary: "create a manifest-bound consistent SQLite backup package",
    },
    CommandSpec {
        path: "restore",
        syntax: "bwrk restore PACKAGE_DIR [--db PATH] [--json]",
        action: "mutate",
        output: "restore_package",
        direct: true,
        service: false,
        summary: "validate and atomically restore a backup package at a new lineage epoch",
    },
    CommandSpec {
        path: "migration dry-run",
        syntax: "bwrk migration dry-run --project PROJECT --input PATH [--socket PATH] [--json]",
        action: "read",
        output: "migration_plan",
        direct: true,
        service: true,
        summary: "inspect legacy import disposition without changing project state",
    },
    CommandSpec {
        path: "migration verify",
        syntax: "bwrk migration verify --project PROJECT --input PATH [--socket PATH] [--json]",
        action: "read",
        output: "migration_verification",
        direct: true,
        service: true,
        summary: "verify deterministic legacy import readiness without applying it",
    },
    CommandSpec {
        path: "migration apply",
        syntax: "bwrk migration apply --project PROJECT --input PATH --expected-revision N --yes [--socket PATH] [--json]",
        action: "mutate",
        output: "migration_apply",
        direct: true,
        service: true,
        summary: "archive the verified import source and apply its safe work graph atomically",
    },
    CommandSpec {
        path: "status",
        syntax: "bwrk status PROJECT [--limit N] [--offset N] [--json]",
        action: "read",
        output: "status",
        direct: true,
        service: true,
        summary: "read the revisioned derived project status",
    },
    CommandSpec {
        path: "prime",
        syntax: "bwrk prime --project PROJECT [--container ID] [--status STATUS] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "status",
        direct: true,
        service: true,
        summary: "status compatibility alias",
    },
    CommandSpec {
        path: "dashboard",
        syntax: "bwrk dashboard [PROJECT] [--project PROJECT] [--db PATH]",
        action: "read",
        output: "dashboard",
        direct: true,
        service: false,
        summary: "launch the managed one-terminal dashboard",
    },
    CommandSpec {
        path: "view",
        syntax: "bwrk view [PROJECT] [--project PROJECT] [--db PATH]",
        action: "read",
        output: "dashboard",
        direct: true,
        service: false,
        summary: "dashboard compatibility alias",
    },
    CommandSpec {
        path: "work list",
        syntax: "bwrk work list --project PROJECT [--all] [--ready] [--closed] [--status STATUS[,STATUS...]] [--kind KIND] [--container ID] [--query TEXT] [--label LABEL] [--labels CSV] [--limit N] [--offset N] [--json]",
        action: "read",
        output: "work_list",
        direct: true,
        service: true,
        summary: "list work with bounded pagination",
    },
    CommandSpec {
        path: "work show",
        syntax: "bwrk work show PROJECT WORK_ID",
        action: "read",
        output: "work",
        direct: true,
        service: true,
        summary: "read one exact work item",
    },
    CommandSpec {
        path: "work create",
        syntax: "bwrk work create --project PROJECT WORK_ID TITLE [--kind milestone|sprint|task] [--parent WORK_ID] [--priority N] [--description TEXT] [--dispatch automatic|operator_only|paused] [--acceptance focused|reviewed] [--hold CODE] [--session SESSION_ID] --expected-revision N [--json]",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "create typed planning or executable work in an enrolled session",
    },
    CommandSpec {
        path: "work edit",
        syntax: "bwrk work edit PROJECT WORK_ID [--title TEXT] [--description TEXT] [--parent WORK_ID] [--priority N] [--dispatch automatic|operator_only|paused] --expected-revision N",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "edit planning fields under an expected project revision",
    },
    CommandSpec {
        path: "work rollup",
        syntax: "bwrk work rollup PROJECT CONTAINER_ID [--json]",
        action: "read",
        output: "container_rollup",
        direct: true,
        service: true,
        summary: "read a revision-consistent milestone/task descendant rollup",
    },
    CommandSpec {
        path: "dep add",
        syntax: "bwrk dep add PROJECT PREREQUISITE_ID DEPENDENT_ID [--expected-revision N]",
        action: "mutate",
        output: "dependency",
        direct: true,
        service: true,
        summary: "add a close-only dependency with cycle protection",
    },
    CommandSpec {
        path: "dep remove",
        syntax: "bwrk dep remove PROJECT PREREQUISITE_ID DEPENDENT_ID --expected-revision N",
        action: "mutate",
        output: "dependency",
        direct: true,
        service: true,
        summary: "remove one dependency under an expected project revision",
    },
    CommandSpec {
        path: "dep tree",
        syntax: "bwrk dep tree PROJECT",
        action: "read",
        output: "dependency_graph",
        direct: true,
        service: true,
        summary: "read the canonical dependency graph and cycle diagnostics",
    },
    CommandSpec {
        path: "dep cycles",
        syntax: "bwrk dep cycles PROJECT",
        action: "read",
        output: "dependency_graph",
        direct: true,
        service: true,
        summary: "report dependency cycles found in the project snapshot",
    },
    CommandSpec {
        path: "work claim",
        syntax: "bwrk work claim PROJECT WORK_ID --source-version ID --config-identity ID [--session SESSION_ID] [--lease-ttl DURATION] [--time-limit DURATION]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "atomically claim one work item with source-bound execution context",
    },
    CommandSpec {
        path: "work accept",
        syntax: "bwrk work accept PROJECT WORK_ID --attempt ID --fence N",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "acknowledge a claimed attempt",
    },
    CommandSpec {
        path: "work heartbeat",
        syntax: "bwrk work heartbeat PROJECT WORK_ID --attempt ID --fence N",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "record liveness without extending the hard deadline",
    },
    CommandSpec {
        path: "work renew",
        syntax: "bwrk work renew PROJECT WORK_ID --attempt ID --fence N [--lease-ttl DURATION]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "renew only the bounded renewable lease",
    },
    CommandSpec {
        path: "work release",
        syntax: "bwrk work release PROJECT WORK_ID --attempt ID --fence N [--reason CODE]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "release the current attempt while retaining history",
    },
    CommandSpec {
        path: "work finish",
        syntax: "bwrk work finish PROJECT WORK_ID --attempt ID --fence N",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "submit an attempt to the proof/closeout workflow",
    },
    CommandSpec {
        path: "agent status",
        syntax: "bwrk agent status --project PROJECT [--session ID]",
        action: "read",
        output: "status",
        direct: true,
        service: true,
        summary: "read current status in agent context",
    },
    CommandSpec {
        path: "agent guide",
        syntax: "bwrk agent guide --project PROJECT [--work WORK_ID] [--container ID] [--status STATUS] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--json]",
        action: "read",
        output: "agent_guide",
        direct: true,
        service: true,
        summary: "return a trusted contextual next action",
    },
    CommandSpec {
        path: "agent resume",
        syntax: "bwrk agent resume --project PROJECT --session SESSION_ID [--attempt ATTEMPT_ID]",
        action: "read",
        output: "agent_guide",
        direct: true,
        service: true,
        summary: "reload the session's current fenced handoff",
    },
    CommandSpec {
        path: "agent start",
        syntax: "bwrk agent start [WORK_ID] --project PROJECT [--source-version ID --config-identity ID] [--expected-revision N] [--session ID] [--json]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "resume a current attempt, or select and start work (a new attempt requires both source-version and config-identity)",
    },
    CommandSpec {
        path: "agent heartbeat",
        syntax: "bwrk agent heartbeat --project PROJECT --work WORK_ID --attempt ID --fence N",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "agent-context liveness update",
    },
    CommandSpec {
        path: "agent renew",
        syntax: "bwrk agent renew --project PROJECT --work WORK_ID --attempt ID --fence N [--lease-ttl DURATION]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "agent-context renewable lease update",
    },
    CommandSpec {
        path: "agent release",
        syntax: "bwrk agent release WORK_ID --project PROJECT --attempt ID --fence N",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "release an agent-owned attempt",
    },
    CommandSpec {
        path: "agent finish",
        syntax: "bwrk agent finish WORK_ID (--close --receipt PATH --summary PATH | --release [--reason CODE]) --project PROJECT --attempt ID --fence N [--expected-revision N] [--session SESSION_ID] [--json]",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "proof-gated close or explicit release",
    },
    CommandSpec {
        path: "next",
        syntax: "bwrk next --project PROJECT [--work WORK_ID] [--container ID] [--status STATUS] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--json]",
        action: "read",
        output: "agent_next",
        direct: true,
        service: true,
        summary: "select the next safe guided action",
    },
    CommandSpec {
        path: "agent next",
        syntax: "bwrk agent next --project PROJECT [--work WORK_ID] [--container ID] [--status STATUS] [--kind KIND] [--query TEXT] [--label LABEL] [--labels CSV] [--json]",
        action: "read",
        output: "agent_next",
        direct: true,
        service: true,
        summary: "guided next compatibility spelling",
    },
    CommandSpec {
        path: "evidence add",
        syntax: "bwrk evidence add --project PROJECT --work WORK_ID --gate GATE_ID --receipt PATH",
        action: "mutate",
        output: "receipt",
        direct: true,
        service: true,
        summary: "import external evidence without minting witness identity",
    },
    CommandSpec {
        path: "evidence run",
        syntax: "bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID --attempt ID --fence N [--json]",
        action: "mutate",
        output: "receipt",
        direct: true,
        service: true,
        summary: "run an admitted bounded verifier",
    },
    CommandSpec {
        path: "gate policy publish",
        syntax: "bwrk gate policy publish --project PROJECT --gate GATE_ID --input PATH --expected-revision N --yes",
        action: "mutate",
        output: "gate_policy",
        direct: true,
        service: true,
        summary: "publish an immutable, project-authorized gate policy revision",
    },
    CommandSpec {
        path: "session start",
        syntax: "bwrk session start --project PROJECT --session SESSION_ID --harness HARNESS_ID",
        action: "mutate",
        output: "session",
        direct: true,
        service: true,
        summary: "register a durable actor/harness session",
    },
    CommandSpec {
        path: "session show",
        syntax: "bwrk session show --project PROJECT --session SESSION_ID",
        action: "read",
        output: "session",
        direct: true,
        service: true,
        summary: "read an exact session binding",
    },
    CommandSpec {
        path: "session end",
        syntax: "bwrk session end --project PROJECT --session SESSION_ID",
        action: "mutate",
        output: "session",
        direct: true,
        service: true,
        summary: "end an idle session without abandoning live work",
    },
    CommandSpec {
        path: "operation show",
        syntax: "bwrk operation show PROJECT OPERATION_ID",
        action: "read",
        output: "operation",
        direct: true,
        service: true,
        summary: "read back a possibly delivered mutation",
    },
    CommandSpec {
        path: "doctor",
        syntax: "bwrk doctor [--project PROJECT] [--db PATH] [--json]",
        action: "read",
        output: "doctor",
        direct: true,
        service: true,
        summary: "run bounded read-only database/runtime diagnostics",
    },
    CommandSpec {
        path: "work hold add",
        syntax: "bwrk work hold add PROJECT WORK_ID --reason CODE --expected-revision N",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "add an operator hold while preserving the hold history",
    },
    CommandSpec {
        path: "work hold resolve",
        syntax: "bwrk work hold resolve PROJECT WORK_ID HOLD_ID --reason TEXT --expected-revision N",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "resolve one active hold with an explicit reason",
    },
    CommandSpec {
        path: "work dispatch set",
        syntax: "bwrk work dispatch set PROJECT WORK_ID --dispatch automatic|operator_only|paused --expected-revision N",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "change dispatch policy under an expected project revision",
    },
    CommandSpec {
        path: "source add",
        syntax: "bwrk source add PROJECT --input PATH --origin ORIGIN [--media-type TYPE] [--session ID --expected-revision N --socket PATH]",
        action: "mutate",
        output: "source",
        direct: true,
        service: true,
        summary: "capture and register a bounded immutable source file",
    },
    CommandSpec {
        path: "source show",
        syntax: "bwrk source show PROJECT SOURCE_VERSION_ID",
        action: "read",
        output: "source",
        direct: true,
        service: false,
        summary: "read one exact source version and its registration",
    },
    CommandSpec {
        path: "source list",
        syntax: "bwrk source list PROJECT [--limit N] [--offset N]",
        action: "read",
        output: "sources",
        direct: true,
        service: false,
        summary: "list bounded source versions for a project",
    },
    CommandSpec {
        path: "source search",
        syntax: "bwrk source search PROJECT QUERY [--limit N] [--json]",
        action: "read",
        output: "source_search",
        direct: true,
        service: true,
        summary: "retrieve project-scoped source excerpts with stable citation identities",
    },
    CommandSpec {
        path: "source verify",
        syntax: "bwrk source verify PROJECT SOURCE_VERSION_ID",
        action: "read",
        output: "source_verification",
        direct: true,
        service: false,
        summary: "verify a source blob against its immutable digest",
    },
];

// These are deliberately not emitted as available command entries. They are
// typed gaps so clients can explain why an aspirational plan route cannot be
// used yet, rather than guessing at an adapter or falling back to SQLite.
const GAPS: &[GapSpec] = &[];
const UNAVAILABLE_ROUTES: &[GapSpec] = &[];

pub(crate) fn is_registry_path(path: &[String]) -> bool {
    matches!(
        path.first().map(String::as_str),
        Some("commands" | "help" | "version" | "completion")
    )
}

/// Returns true when `path` is an exact executable public route. The parser
/// uses this for deeper command paths so dispatch and discovery share one
/// route definition.
pub(crate) fn is_available_path(path: &[String]) -> bool {
    let value = path.join(" ");
    COMMANDS.iter().any(|command| command.path == value)
}

/// Fail closed when the parser accepts an extra flag that the selected route
/// does not publish in its syntax contract.
pub(crate) fn validate_extra_flags(
    path: &[String],
    extra: &std::collections::BTreeMap<String, Vec<String>>,
) -> Result<(), CliError> {
    let route = path.join(" ");
    if path.first().is_some_and(|part| part == "global") {
        return Ok(());
    }
    let Some(command) = COMMANDS.iter().find(|command| command.path == route) else {
        if extra.is_empty() {
            return Ok(());
        }
        return Err(CliError::invalid(format!(
            "no executable registry contract for extra flags on '{route}'"
        )));
    };
    let declared = syntax_flag_names(command.syntax);
    if let Some(flag) = extra.keys().find(|flag| !declared.contains(flag.as_str())) {
        return Err(CliError::invalid(format!(
            "unsupported option {flag} for '{}'; inspect `bwrk help {route}`",
            command.path
        )));
    }
    Ok(())
}

fn syntax_flag_names(syntax: &str) -> std::collections::BTreeSet<String> {
    let bytes = syntax.as_bytes();
    let mut flags = std::collections::BTreeSet::new();
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] == b'-' && bytes[index + 1] == b'-' {
            let start = index;
            index += 2;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'-')
            {
                index += 1;
            }
            if index > start + 2 {
                flags.insert(syntax[start..index].to_owned());
            }
        } else {
            index += 1;
        }
    }
    flags
}

/// Returns true only for a route deliberately catalogued as unavailable.
/// Callers use this to fail closed instead of opening the local database and
/// accidentally treating a planned route as an offline implementation.
pub(crate) fn is_path_prefix(path: &[String], token: &str) -> bool {
    let candidate = format!("{} {}", path.join(" "), token);
    COMMANDS.iter().any(|command| {
        command.path == candidate || command.path.starts_with(&format!("{candidate} "))
    })
}

pub(crate) fn is_unavailable_path(path: &[String]) -> bool {
    let value = path.join(" ");
    if COMMANDS.iter().any(|entry| entry.path == value) {
        return false;
    }
    UNAVAILABLE_ROUTES.iter().any(|entry| entry.path == value)
        || GAPS.iter().any(|entry| {
            entry.scope == "family"
                && (entry.path == value || value.starts_with(&format!("{} ", entry.path)))
        })
}

pub(crate) fn result(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    let mut result = match parsed.path.first().map(String::as_str) {
        Some("completion") => completion_result(parsed),
        Some("commands") if parsed.path.get(1).is_some_and(|p| p == "compatibility") => {
            compatibility_result()
        }
        Some("commands") => {
            let filter = discovery_filter(parsed);
            registry_page(
                filter.as_deref(),
                parsed.options.limit.unwrap_or(25),
                parsed.options.offset.unwrap_or(0),
            )
        }
        Some("help") => {
            let filter = discovery_filter(parsed);
            help_result(filter.as_deref())
        }
        Some("version") if parsed.path.len() == 1 && parsed.options.positionals.is_empty() => {
            version_result()
        }
        _ => Err(CliError::invalid(format!(
            "unknown discovery path: {}",
            parsed.path.join(" ")
        ))),
    }?;
    result.outcome = ApplicationOutcome::Unchanged;
    Ok(result)
}

fn discovery_filter(parsed: &ParsedCommand) -> Option<String> {
    let mut tokens = parsed.path.iter().skip(1).cloned().collect::<Vec<_>>();
    tokens.extend(parsed.options.positionals.iter().cloned());
    (!tokens.is_empty()).then(|| tokens.join(" "))
}

fn path_matches(path: &str, filter: Option<&str>) -> bool {
    filter.is_none_or(|value| path == value || path.starts_with(&format!("{value} ")))
}

fn registry_result(filter: Option<&str>) -> Result<CliResult, CliError> {
    registry_page(filter, 25, 0)
}
fn registry_page(filter: Option<&str>, limit: u64, offset: u64) -> Result<CliResult, CliError> {
    if !(1..=50).contains(&limit) {
        return Err(CliError::invalid("commands --limit must be 1..50"));
    }
    let commands = COMMANDS
        .iter()
        .filter(|command| path_matches(command.path, filter))
        .map(command_json)
        .collect::<Vec<_>>();
    let gaps = GAPS
        .iter()
        .filter(|gap| {
            !COMMANDS.iter().any(|c| {
                c.path == gap.path
                    || (gap.scope == "family" && c.path.starts_with(&format!("{} ", gap.path)))
            })
        })
        .filter(|gap| path_matches(gap.path, filter))
        .map(gap_json)
        .collect::<Vec<_>>();
    let unavailable_routes = UNAVAILABLE_ROUTES
        .iter()
        .filter(|gap| {
            !COMMANDS.iter().any(|c| {
                c.path == gap.path
                    || (gap.scope == "family" && c.path.starts_with(&format!("{} ", gap.path)))
            })
        })
        .filter(|gap| path_matches(gap.path, filter))
        .map(gap_json)
        .collect::<Vec<_>>();
    if filter.is_some() && commands.is_empty() && gaps.is_empty() && unavailable_routes.is_empty() {
        return Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!(
                "command path is not in the Boreal registry: {}",
                filter.unwrap_or_default()
            ),
        ));
    }
    bounded_result(
        Some(json!({
            "command": "commands",
            "registry_id": REGISTRY_ID,
            "registry_version": "1",
            "filter": filter,
            "available": commands.iter().skip(offset as usize).take(limit as usize).collect::<Vec<_>>(),
            "matching_count": commands.len(),
            "offset":offset,"limit":limit,
            "has_more":offset.saturating_add(limit) < commands.len() as u64,
            "next_offset":if offset.saturating_add(limit) < commands.len() as u64 {Some(offset+limit)}else{None},
            "gaps": gaps,
            "unavailable_routes": unavailable_routes,
            "count": COMMANDS.len(),
            "gap_count": gaps.len(),
            "unavailable_count": unavailable_routes.len(),
        })),
        None,
    )
}

fn help_result(filter: Option<&str>) -> Result<CliResult, CliError> {
    let command = filter.and_then(|value| COMMANDS.iter().find(|entry| entry.path == value));
    let gap = filter
        .filter(|value| !COMMANDS.iter().any(|c| c.path == *value))
        .and_then(|value| {
            UNAVAILABLE_ROUTES
                .iter()
                .find(|entry| entry.path == value && !COMMANDS.iter().any(|c| c.path == value))
                .or_else(|| GAPS.iter().find(|entry| entry.path == value))
        });
    let available_children = COMMANDS
        .iter()
        .filter(|entry| {
            filter.is_some_and(|value| entry.path != value && path_matches(entry.path, Some(value)))
        })
        .map(|c|json!({"path":c.path,"syntax":c.syntax,"summary":c.summary,"action":c.action,"direct":c.direct,"service":c.service}))
        .collect::<Vec<_>>();
    let unavailable_children = UNAVAILABLE_ROUTES
        .iter()
        .filter(|entry| {
            filter.is_some_and(|value| entry.path != value && path_matches(entry.path, Some(value)))
                && !COMMANDS.iter().any(|c| c.path == entry.path)
        })
        .map(gap_json)
        .collect::<Vec<_>>();
    if filter.is_some()
        && command.is_none()
        && gap.is_none()
        && available_children.is_empty()
        && unavailable_children.is_empty()
    {
        return Err(CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!(
                "command path is not in the Boreal registry: {}",
                filter.unwrap_or_default()
            ),
        ));
    }
    let kind = if command.is_some() {
        "command"
    } else if gap.is_some() {
        "unavailable"
    } else {
        "namespace"
    };
    bounded_result(
        Some(json!({
            "command": "help",
            "registry_id": REGISTRY_ID,
            "path": filter,
            "kind": kind,
            "entry": command.map(command_json),
            "gap": gap.map(gap_json),
            "matches": {
                "available": available_children,
                "unavailable": unavailable_children,
            },
            "usage": HELP,
        })),
        None,
    )
}

fn version_result() -> Result<CliResult, CliError> {
    bounded_result(
        Some(json!({
            "command": "version",
            "binary": "bwrk",
            "package_version": env!("CARGO_PKG_VERSION"),
            "build_revision": env!("BOREAL_BUILD_REVISION"),
            "build_source_id": env!("BOREAL_BUILD_SOURCE_ID"),
            "skill_assets": "boreal.core-skills",
            "api_version": API_VERSION,
            "envelope_schema": schema::ENVELOPE,
            "command_registry": REGISTRY_ID,
            "workflow_assets": "boreal.workflow.assets.v1",
            "sqlite_runtime": boreal_store::sqlite_runtime_identity().as_json(),
            "sqlite_runtime_release_floor": {
                "libversion_at_least": "3.51.3",
                "reason": "SQLite WAL-reset fix required by the release policy",
                "enforced": true,
            },
        })),
        None,
    )
}

fn command_json(command: &CommandSpec) -> Value {
    json!({
        "path": command.path,
        "syntax": command.syntax,
        "action": command.action,
        "output": command.output,
        "direct": command.direct,
        "service": command.service,
        "adapters": {
            "direct": command.direct,
            "service": command.service,
        },
        "availability": "available",
        "kind": "command",
        "summary": command.summary,
        "behavior": {"read_only":command.action=="read","writes_state":command.action!="read","writes_canonical_state":command.action!="read","writes_generated_artifact":command.action=="read" && command.syntax.contains("--out"),"requires_expected_revision":command.syntax.contains("--expected-revision"),"requires_confirmation":command.syntax.contains("--yes"),"concurrency_control":if command.action=="read" {"revisioned_snapshot"}else{"application_rechecks_revision_and_ownership"},"preserves_history":true},
        "flags": flag_metadata(command),
        "input_schema": input_schema(command.path),
        "examples": [{"argv_template":command.syntax,"description":"Bind PROJECT and revision/fence values from the current project briefing."}],
        "envelope_schema": schema::ENVELOPE,
        "output_kind":command.output,
    })
}

fn gap_json(gap: &GapSpec) -> Value {
    json!({
        "path": gap.path,
        "available": false,
        "availability": "unavailable",
        "kind": "route_gap",
        "scope": gap.scope,
        "code": gap.code,
        "summary": gap.summary,
        "owner": gap.owner,
        "adapters": {"direct": false, "service": false},
        "recovery": {
            "kind": "implementation_gap",
            "owner": gap.owner,
            "inspect": format!("bwrk commands {}", gap.path),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(path: &[&str], positionals: &[&str]) -> ParsedCommand {
        ParsedCommand {
            path: path.iter().map(|value| (*value).to_owned()).collect(),
            options: CliOptions {
                service_workspace: None,
                extra: Default::default(),
                db: String::new(),
                socket: None,
                project: None,
                actor: String::new(),
                actor_explicit: false,
                actor_role: None,
                harness: String::new(),
                session: String::new(),
                session_explicit: false,
                operation_id: None,
                expected_revision: None,
                attempt: None,
                fence: None,
                work: None,
                gate: None,
                receipt: None,
                summary: None,
                reason: None,
                lease_ttl_ms: None,
                time_limit_ms: None,
                json: true,
                close: false,
                release: false,
                machine: false,
                include_expiry: false,
                limit: None,
                offset: None,
                max_requests: None,
                dispatch_workers: None,
                dispatch_capacity: None,
                kind: None,
                parent: None,
                description: None,
                title: None,
                priority: None,
                dispatch: None,
                hold: None,
                bucket: None,
                input: None,
                origin: None,
                media_type: None,
                source_version: None,
                config_identity: None,
                setup: SetupCliOptions::default(),
                positionals: positionals
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
            },
        }
    }

    #[test]
    fn deep_help_path_is_resolved_by_registry_when_parser_passes_it_through() {
        let result = result(&parsed(&["help", "dep"], &["add"])).unwrap();
        let data = result.data.unwrap();
        assert_eq!(data["path"], "dep add");
        assert_eq!(data["kind"], "command");
        assert_eq!(data["entry"]["path"], "dep add");
    }

    #[test]
    fn namespace_help_returns_available_and_unavailable_children() {
        let help = result(&parsed(&["help", "work"], &[])).unwrap();
        let data = help.data.unwrap();
        assert_eq!(data["kind"], "namespace");
        assert!(data["matches"]["available"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["path"] == "work create"));

        let help = result(&parsed(&["help", "dep"], &[])).unwrap();
        let data = help.data.unwrap();
        assert_eq!(data["kind"], "namespace");
        let available = data["matches"]["available"]
            .as_array()
            .expect("available dependency routes");
        assert!(available.iter().any(|entry| entry["path"] == "dep waive"));
        assert_eq!(available.len(), 5);
        assert_eq!(data["matches"]["unavailable"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn source_and_durable_memory_routes_are_advertised_truthfully() {
        let source = registry_result(Some("source show")).unwrap();
        let source_data = source.data.unwrap();
        let route = source_data["available"][0].clone();
        assert_eq!(route["path"], "source show");
        assert_eq!(route["availability"], "available");
        assert_eq!(route["adapters"]["direct"], true);
        assert_eq!(route["adapters"]["service"], false);

        let memory = registry_result(Some("memory")).unwrap();
        let memory_data = memory.data.unwrap();
        assert_eq!(memory_data["available"].as_array().unwrap().len(), 8);
        assert!(memory_data["unavailable_routes"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn version_reports_the_sqlite_release_floor_as_enforced() {
        let version = version_result().unwrap();
        let floor = &version.data.unwrap()["sqlite_runtime_release_floor"];
        assert_eq!(floor["libversion_at_least"], "3.51.3");
        assert_eq!(floor["enforced"], true);
    }

    #[test]
    fn version_rejects_a_nested_discovery_path() {
        let error = result(&parsed(&["version", "extra"], &[])).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }
}

fn flag_metadata(command: &CommandSpec) -> Vec<Value> {
    let tokens = command.syntax.split_whitespace().collect::<Vec<_>>();
    tokens.iter().enumerate().filter_map(|(i,token)| {
        let flag=token.trim_matches(|c| c=='[' || c==']');
        if !flag.starts_with("--") {return None;}
        let value=tokens.get(i+1).map(|v|v.trim_matches(|c|c=='[' || c==']')).filter(|v|!v.starts_with('-'));
        Some(json!({"name":flag,"type":if value.is_some(){"value"}else{"boolean"},"value_name":value,"required":!token.starts_with('['),"repeatable":matches!(flag,"--var"|"--label"|"--citation"|"--acceptance")}))
    }).collect()
}
fn input_schema(path: &str) -> Value {
    match path {
        "merge plan" | "merge apply" | "compact apply" => {
            let merging = path.starts_with("merge");
            let applying = path.ends_with("apply");
            let mut schema = json!({"type":"object","required":["source_kind","source_id"],"properties":{
                "source_kind":{"enum":["work","source","decision","claim","memory_draft","published_memory"]},
                "source_id":{"type":"string","minLength":1},
                "source_revision":{"type":"integer","minimum":0},"source_digest":{"type":"string","minLength":1},
                "manifest_identity":{"type":"string","minLength":1},"git_revision":{"type":"string","minLength":1},
                "source_citations":{"type":"array","items":{"type":"string","minLength":1},"minItems":1,"uniqueItems":true},
                "title":{"type":"string"},"memory_entry_id":{"type":"string"},"review_reason":{"type":"string"},"plan_digest":{"type":"string"}
            },"description":"Same-kind project sources. SQLite maintenance preserves originals and records lineage or summaries. Published memory stages a cited draft requiring independent review and publication. Input is bounded to 1 MiB."});
            if merging {
                schema["properties"]["canonical_kind"] =
                    schema["properties"]["source_kind"].clone();
                schema["properties"]["canonical_id"] = json!({"type":"string","minLength":1});
                schema["required"]
                    .as_array_mut()
                    .unwrap()
                    .extend([json!("canonical_kind"), json!("canonical_id")]);
            } else {
                schema["properties"]["source_kind"] =
                    json!({"enum":["work","decision","claim","memory_draft","published_memory"]});
                schema["properties"]["summary"] =
                    json!({"type":"string","minLength":1,"maxLength":65536});
                schema["required"].as_array_mut().unwrap().extend([
                    json!("source_revision"),
                    json!("source_digest"),
                    json!("summary"),
                ]);
            }
            if applying {
                let mut required = vec![
                    "manifest_identity",
                    "git_revision",
                    "source_digest",
                    "source_citations",
                ];
                if merging {
                    schema["properties"]["canonical_digest"] =
                        json!({"type":"string","minLength":1});
                    schema["properties"]["merged_body"] =
                        json!({"type":"string","minLength":1,"maxLength":65536});
                    required.extend(["canonical_digest", "merged_body"]);
                }
                schema["allOf"] = json!([{"if":{"properties":{"source_kind":{"const":"published_memory"}},"required":["source_kind"]},"then":{"required":required}}]);
            }
            schema
        }
        "merge show" | "compact show" => {
            json!({"type":"object","required":["source_kind","source_id"],"properties":{"source_kind":{"type":"string"},"source_id":{"type":"string"}}})
        }
        "orchestrate pool configure" => {
            json!({"type":"object","additionalProperties":false,"required":["workers"],"properties":{"workers":{"type":"array","minItems":1,"maxItems":32,"items":{"type":"object","additionalProperties":false,"required":["actor_id","session_id","harness_id"],"properties":{"actor_id":{"type":"string"},"session_id":{"type":"string"},"harness_id":{"type":"string"}}}}},"description":"Distinct active sessions with project-local private credentials and registered harness policies."})
        }
        "orchestrate harness configure" => {
            json!({"type":"object","additionalProperties":false,"required":["harness_id","executable","cwd","timeout_ms"],"properties":{"harness_id":{"type":"string"},"executable":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"environment":{"type":"array","items":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"string"}}},"timeout_ms":{"type":"integer"},"output_cap_bytes":{"type":"integer"}},"description":"Trusted absolute executable, confined working directory and bounded execution; arguments are passed without a shell."})
        }
        "cycle create" | "sprint create" => {
            json!({"type":"object","description":"CycleMutationRequest; use cycle show for persisted scope identity","required":["cycle_id","name","timezone","start"],"properties":{"cycle_id":{"type":"string"},"name":{"type":"string"},"timezone":{"type":"string"},"start":{"type":"object","required":["year","month","day","hour","minute","second"]},"end":{"type":["object","null"]}}})
        }
        "review approve" | "review reject" | "review return" | "review revoke" | "work reopen"
        | "work cancel" | "work retry" | "work publish" | "exception grant"
        | "exception revoke" | "dep waive" => {
            json!({"type":"object","required":["expected_entity_revision","expected_proof_revision"],"properties":{"expected_entity_revision":{"type":"integer"},"expected_proof_revision":{"type":"integer"}},"description":"Action-specific fields must match the current work show action descriptor"})
        }
        "decision create" | "decision supersede" => {
            json!({"type":"object","required":["decision_id","title","body","rationale"],"properties":{"decision_id":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"},"rationale":{"type":"string"},"source_version_id":{"type":["string","null"]},"supersedes_id":{"type":["string","null"]}}})
        }
        "claim create" | "knowledge claim create" => {
            json!({"type":"object","required":["claim_id","statement","source_version_id","citation_location"],"properties":{"claim_id":{"type":"string"},"statement":{"type":"string"},"source_version_id":{"type":"string"},"citation_location":{"type":"string"}}})
        }
        "claim review" | "knowledge claim review" => {
            json!({"type":"object","required":["decision","reason"],"properties":{"decision":{"enum":["accepted","rejected","needs_revision"]},"reason":{"type":"string"}}})
        }
        "summary backfill" => {
            json!({"type":"object","description":"Historical import only; requires summary_id or id (or --subject). Preserves the supplied legacy JSON record and never establishes live acceptance proof.","properties":{"summary_id":{"type":"string"},"id":{"type":"string"},"work_id":{"type":"string"},"body":{},"title":{},"metadata":{}}})
        }
        "recovery recover" => {
            json!({
                "type": "object",
                "required": ["descriptor", "disposition"],
                "properties": {
                    "descriptor": {
                        "type": "object",
                        "required": [
                            "action", "target", "expected_project_revision",
                            "expected_entity_revision", "expected_proof_revision", "attempt",
                            "required_roles", "required_inputs", "confirmation", "read_only", "recovery"
                        ],
                        "properties": {
                            "action": {"const": "recover"},
                            "target": {
                                "type": "object",
                                "required": ["project_id", "work_id", "entity_revision"],
                                "properties": {
                                    "project_id": {"type": "string", "minLength": 1},
                                    "work_id": {"type": "string", "minLength": 1},
                                    "entity_revision": {"type": "integer", "minimum": 0}
                                }
                            },
                            "expected_project_revision": {"type": "integer", "minimum": 0},
                            "expected_entity_revision": {"type": "integer", "minimum": 0},
                            "expected_proof_revision": {"type": ["integer", "null"], "minimum": 0},
                            "attempt": {
                                "type": "object",
                                "required": ["attempt_id", "fence"],
                                "properties": {
                                    "attempt_id": {"type": "string", "minLength": 1},
                                    "fence": {"type": "integer", "minimum": 1}
                                }
                            },
                            "required_roles": {"type": "array", "items": {"type": "string"}},
                            "required_inputs": {"type": "array", "items": {"type": "string"}},
                            "confirmation": {"type": "string", "minLength": 1},
                            "read_only": {"const": false},
                            "recovery": {"const": true}
                        }
                    },
                    "disposition": {"enum": ["adapter_acknowledged", "reviewed_safe_recovery"]}
                },
                "description": "Copy the current server-issued Recover descriptor exactly. Pass its expected_project_revision again as --expected-revision; --yes confirms the descriptor confirmation. Disposition records the typed recovery choice; it does not replace recovery.resolve."
            })
        }
        "template validate" | "template run" => {
            json!({
                "type": "object",
                "required": ["schema_version", "id", "version", "title", "description", "parameters", "items"],
                "properties": {
                    "schema_version": {"const": 1},
                    "id": {"type": "string"},
                    "version": {"type": "integer", "minimum": 1},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "parameters": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["name", "description", "required"],
                            "properties": {
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "required": {"type": "boolean"},
                                "default": {"type": ["string", "null"]}
                            }
                        }
                    },
                    "items": {
                        "type": "array", "minItems": 1, "maxItems": 100,
                        "items": {
                            "type": "object",
                            "required": ["key", "kind", "title", "description", "priority", "dispatch"],
                            "properties": {
                                "key": {"type": "string"},
                                "kind": {"enum": ["milestone", "sprint", "task"]},
                                "parent": {"type": ["string", "null"]},
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "priority": {"type": "integer", "minimum": 0, "maximum": 9},
                                "dispatch": {"enum": ["automatic", "operator_only", "paused"]},
                                "dependencies": {"type": "array", "items": {"type": "string"}, "uniqueItems": true},
                                "labels": {"type": "array", "items": {"type": "string"}, "uniqueItems": true},
                                "acceptance_profile": {"enum": ["focused", "reviewed"], "default": "focused"}
                            }
                        }
                    }
                }
            })
        }
        "memory draft" => {
            json!({"type":"object","required":["entry_id","title","body","citations"]})
        }
        "memory review" => json!({"type":"object","required":["decision","reason"]}),
        "memory publish" => json!({"type":"object","required":["expected_manifest_identity"]}),
        "intake promote" => {
            json!({"type":"object","description":"Without --create-work, link an existing same-project target. With --create-work and target-kind draft_work, atomically create the named work and promotion; optional JSON fields are title, description, kind, parent, priority, dispatch, acceptance_profile. Defaults come from intake content. Both modes require the current expected project revision."})
        }
        _ => Value::Null,
    }
}

fn completion_result(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    let shell = parsed
        .options
        .positionals
        .first()
        .map(String::as_str)
        .unwrap_or("bash");
    let cases = completion_cases();
    let fish_cases = completion_fish_cases();
    let script = match shell {
        "bash" => format!(
            "_bwrk_candidates() {{\n  case \"$1\" in\n{cases}    *) return 0 ;;\n  esac\n}}\n_bwrk_complete() {{\n  local prefix= word i choices\n  for ((i=1; i<COMP_CWORD; i++)); do\n    word=\"${{COMP_WORDS[i]}}\"\n    [[ $word == -* ]] && break\n    prefix=\"${{prefix:+$prefix }}$word\"\n  done\n  choices=\"$(_bwrk_candidates \"$prefix\")\"\n  COMPREPLY=( $(compgen -W \"$choices\" -- \"${{COMP_WORDS[COMP_CWORD]}}\") )\n}}\ncomplete -F _bwrk_complete bwrk\n"
        ),
        "zsh" => format!(
            "#compdef bwrk\n_bwrk_candidates() {{\n  case \"$1\" in\n{cases}    *) return 0 ;;\n  esac\n}}\n_bwrk_complete() {{\n  local prefix= word i\n  for ((i=2; i<CURRENT; i++)); do\n    word=\"${{words[i]}}\"\n    [[ $word == -* ]] && break\n    prefix=\"${{prefix:+$prefix }}$word\"\n  done\n  local -a candidates\n  candidates=(\"${{(@f)$(_bwrk_candidates \"$prefix\")}}\")\n  _describe 'bwrk command or option' candidates\n}}\ncompdef _bwrk_complete bwrk\n"
        ),
        "fish" => format!(
            "function __bwrk_candidates\n  set -l words (commandline -opc)\n  if test (count $words) -gt 0; set -e words[1]; end\n  set -l prefix\n  for word in $words\n    if string match -q -- '-*' $word; break; end\n    set -a prefix $word\n  end\n  set -l joined (string join ' ' $prefix)\n  switch $joined\n{fish_cases}    case '*'\n      return\n  end\nend\ncomplete -c bwrk -f -a '(__bwrk_candidates)'\n"
        ),
        _ => return Err(CliError::invalid("completion supports bash, zsh, and fish")),
    };
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        data: Some(json!({"shell":shell,"script":script})),
        human: Some(script),
        ..CliResult::default()
    })
}
fn completion_cases() -> String {
    let mut rules = std::collections::BTreeMap::<String, std::collections::BTreeSet<String>>::new();
    for command in COMMANDS {
        let parts = command.path.split_whitespace().collect::<Vec<_>>();
        for length in 0..=parts.len() {
            let key = parts[..length].join(" ");
            let candidates = rules.entry(key).or_default();
            if length < parts.len() {
                candidates.insert(parts[length].to_owned());
            } else {
                candidates.extend(syntax_flag_names(command.syntax));
            }
        }
    }
    let mut result = String::new();
    for (prefix, candidates) in rules {
        let values = candidates
            .iter()
            .map(|value| shell_single_quote(value))
            .collect::<Vec<_>>()
            .join(" ");
        result.push_str(&format!(
            "    {}) printf '%s\\n' {} ;;\n",
            shell_single_quote(&prefix),
            values
        ));
    }
    result
}
fn completion_fish_cases() -> String {
    let mut rules = std::collections::BTreeMap::<String, std::collections::BTreeSet<String>>::new();
    for command in COMMANDS {
        let parts = command.path.split_whitespace().collect::<Vec<_>>();
        for length in 0..=parts.len() {
            let key = parts[..length].join(" ");
            let candidates = rules.entry(key).or_default();
            if length < parts.len() {
                candidates.insert(parts[length].to_owned());
            } else {
                candidates.extend(syntax_flag_names(command.syntax));
            }
        }
    }
    let mut result = String::new();
    for (prefix, candidates) in rules {
        let values = candidates
            .iter()
            .map(|value| fish_quote(value))
            .collect::<Vec<_>>()
            .join(" ");
        result.push_str(&format!(
            "    case {}\n      printf '%s\\n' {}\n",
            fish_quote(&prefix),
            values
        ));
    }
    result
}
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn fish_quote(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}
fn compatibility_result() -> Result<CliResult, CliError> {
    let entries=LEGACY_COMMANDS.iter().map(|path| {
        let replacement=match *path {
            "start"=>Some("agent start"),"done"=>Some("agent finish"),"pause"=>Some("work dispatch set"),
            "work reserve"=>Some("work claim"),"work close"=>Some("agent finish"),"work verify"=>Some("evidence run"),
            "raw add"|"capture"=>Some("intake capture"),"raw list"=>Some("intake list"),"raw show"=>Some("intake show"),"raw triage"=>Some("intake disposition"),
            "wiki list"=>Some("memory search"),"wiki show"=>Some("memory show"),"wiki create"=>Some("memory draft"),"vault status"|"sync status"=>Some("doctor"),
            "snapshot create"|"export ledgers"=>Some("backup"),"import json"|"import ledgers"=>Some("migration apply"),
            "resolve"|"operation repair"=>Some("recovery resolve"),
            "registry list"=>Some("global project list"),"registry add"=>Some("global project add"),"registry remove"=>Some("global project archive"),
            "registry import-setup"=>Some("global import"),"global"=>Some("global status"),"global init"=>Some("global bootstrap"),
            "link"=>Some("global project link"),"unlink"=>Some("global project unlink"),
            "heartbeat create"|"heartbeat advance"=>Some("agent heartbeat"),"heartbeat show"=>Some("session show"),
            "work block"=>Some("work hold add"),
            "sync refresh"=>Some("memory reconcile"),"storage migrate"=>Some("migration apply"),"ledger status"=>Some("status"),
"work reconcile"=>Some("recovery list"),"agent renew"=>Some("agent renew"),
            "sprint show"|"sprint status"=>Some("cycle board"),"sprint metrics"=>Some("cycle report"),"rollup show"=>Some("work rollup"),
            "install codex"|"install claude"|"install skills"|"integrations add"=>Some("install"),"update self"|"update repo"=>Some("update"),
            _=>None,
        };
        let replacement = replacement.filter(|target| COMMANDS.iter().any(|c|c.path==*target));
        let exact=COMMANDS.iter().any(|c|c.path==*path);
        let retired=matches!(*path,"operation prune"|"ledger delete"|"lock break");
        json!({"legacy_path":path,"status":if retired{"retired"}else if exact{"available"}else if replacement.is_some(){"replacement"}else{"unmapped"},"retirement_reason":match *path{"operation prune"=>Some("durable operation identities and retry history are preserved"),"ledger delete"=>Some("canonical history uses explicit retirement or revocation; derived data can be rebuilt"),"lock break"=>Some("use ownership inspection and identity-bound recovery; live fencing is never force-broken"),_=>None},"current_path":if exact{Some(*path)}else{replacement},"exact_spelling":exact,"inspect":replacement.map(|p|format!("bwrk help {p} --json"))})
    }).collect::<Vec<_>>();
    bounded_result(
        Some(
            json!({"schema_version":"boreal.command-compatibility/1","entries":entries,"note":"Replacement mappings describe workflows; flags and persistence contracts may differ."}),
        ),
        None,
    )
}

const LEGACY_COMMANDS: &[&str] = &[
    "init",
    "setup",
    "update self",
    "update repo",
    "upgrade",
    "commands",
    "directives list",
    "directives show",
    "directives compile",
    "directives render",
    "directives explain",
    "directives ack create",
    "directives ack list",
    "directives ack show",
    "completion",
    "version",
    "start",
    "done",
    "pause",
    "status",
    "workflows list",
    "workflows show",
    "resolve",
    "template list",
    "template show",
    "template validate",
    "template run",
    "template capture",
    "install",
    "install codex",
    "install claude",
    "install skills",
    "install status",
    "integrations",
    "integrations add",
    "integrations status",
    "registry list",
    "registry add",
    "registry remove",
    "registry set-state",
    "registry pause",
    "registry resume",
    "registry import-setup",
    "registry doctor",
    "dashboard",
    "view",
    "dashboard global",
    "global",
    "global init",
    "global next",
    "global status",
    "link",
    "unlink",
    "run",
    "events",
    "orchestrate start",
    "orchestrate list",
    "orchestrate show",
    "orchestrate tick",
    "orchestrate progress",
    "orchestrate nudge",
    "orchestrate pause",
    "orchestrate resume",
    "orchestrate cancel",
    "orchestrate fail",
    "daemon status",
    "sprint list",
    "sprint launch",
    "sprint show",
    "sprint status",
    "sprint current",
    "sprint activate",
    "sprint board",
    "sprint report",
    "sprint metrics",
    "sprint close",
    "prime",
    "next",
    "work create",
    "work ready",
    "work list",
    "work rollup",
    "work recent-closed",
    "work review-candidates",
    "work next",
    "work parallel",
    "work show",
    "work block",
    "dep add",
    "dep remove",
    "dep tree",
    "dep cycles",
    "work reserve",
    "work claim",
    "work release",
    "work renew",
    "work verify",
    "work reconcile",
    "work close",
    "work edit",
    "work cancel",
    "work reopen",
    "work split",
    "evidence add",
    "evidence run",
    "summary create",
    "summary compose",
    "summary show",
    "summary list",
    "summary render",
    "summary backfill",
    "source add",
    "source list",
    "source show",
    "claim create",
    "claim list",
    "claim show",
    "claim review",
    "decision create",
    "decision list",
    "decision show",
    "decision supersede",
    "context rebuild",
    "context show",
    "context search",
    "search index",
    "search query",
    "rollup show",
    "reservation list",
    "heartbeat create",
    "heartbeat show",
    "heartbeat advance",
    "agent finish",
    "agent renew",
    "agent start",
    "agent guide",
    "agent status",
    "session start",
    "session end",
    "operation list",
    "operation show",
    "operation stats",
    "operation prune",
    "operation repair",
    "export json",
    "export markdown",
    "export ledgers",
    "import json",
    "import ledgers",
    "vault init",
    "vault status",
    "capture",
    "raw add",
    "raw list",
    "raw show",
    "raw triage",
    "wiki list",
    "wiki show",
    "wiki create",
    "duplicate scan",
    "merge plan",
    "merge apply",
    "compact analyze",
    "compact apply",
    "sync status",
    "sync refresh",
    "storage migrate",
    "storage rotate-log",
    "ledger status",
    "ledger delete",
    "snapshot create",
    "snapshot list",
    "snapshot show",
    "doctor",
    "doctor skills",
    "schema validate",
    "docs check",
    "gate",
    "gate closeout",
    "lock inspect",
    "lock break",
];

pub(crate) fn is_mutating_path(path: &[String]) -> bool {
    COMMANDS
        .iter()
        .find(|c| c.path == path.join(" "))
        .is_none_or(|c| c.action != "read")
}
