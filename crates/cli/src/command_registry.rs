//! The executable public command registry.
//!
//! This is deliberately smaller than the planning catalog in
//! `project/spec/cli-contract.json`: a command is listed as available only
//! when this binary has a real adapter for it. Planned work is returned as a
//! typed gap so agents can discover the boundary without being handed an
//! argv recipe that cannot work.

use super::*;

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
    CommandSpec { path: "recovery list", syntax: "bwrk recovery list --project PROJECT [AFTER_ID] [--limit N] [--json]", action: "read", output: "recovery", direct: true, service: true, summary: "list unresolved project recovery obligations" },
    CommandSpec { path: "recovery resolve", syntax: "bwrk recovery resolve --project PROJECT [OBLIGATION_ID] --input PATH --expected-revision N --yes [--json]", action: "mutate", output: "recovery", direct: true, service: true, summary: "record an operator decision and reconcile an original recovery obligation" },
    CommandSpec { path: "maintenance show", syntax: "bwrk maintenance show --project PROJECT OPERATION_ID [--input RESTORE_PACKAGE_DIR] [--socket PATH] [--json]", action: "read", output: "maintenance", direct: true, service: true, summary: "inspect durable backup or restore operation readback for this project" },
    CommandSpec {path:"work checkpoint",syntax:"bwrk work checkpoint --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]",action:"mutate",output:"completion",direct:true,service:true,summary:"retain revision-bound checkpoint progress without fabricating acceptance evidence"},
    CommandSpec {path:"memory reconcile",syntax:"bwrk memory reconcile --project PROJECT OPERATION_ID --yes --expected-revision N [--json]",action:"mutate",output:"memory",direct:true,service:true,summary:"reconcile SQLite with verified Git publication readback"},
    CommandSpec {path:"memory draft",syntax:"bwrk memory draft --project PROJECT [DRAFT_ID] --input PATH --yes --expected-revision N [--json]",action:"mutate",output:"memory",direct:true,service:true,summary:"input needs entry_id, title, body and citations; provide draft_id in input or positionally"},
    CommandSpec {path:"memory review",syntax:"bwrk memory review --project PROJECT DRAFT_ID --input PATH --yes --expected-revision N [--json]",action:"mutate",output:"memory",direct:true,service:true,summary:"input needs decision and reason; review the named draft"},
    CommandSpec {path:"memory publish",syntax:"bwrk memory publish --project PROJECT REVIEW_ID --input PATH --yes --expected-revision N [--json]",action:"mutate",output:"memory",direct:true,service:true,summary:"input needs expected_manifest_identity; publish the named approved review"},
    CommandSpec {path:"memory show",syntax:"bwrk memory show --project PROJECT DRAFT_ID [--json]",action:"read",output:"memory",direct:true,service:true,summary:"durable cited memory through the application boundary"},
    CommandSpec {path:"memory search",syntax:"bwrk memory search --project PROJECT QUERY [--json]",action:"read",output:"memory",direct:true,service:true,summary:"durable cited memory through the application boundary"},
    CommandSpec {path:"memory readback",syntax:"bwrk memory readback --project PROJECT OPERATION_ID [--json]",action:"read",output:"memory",direct:true,service:true,summary:"durable cited memory through the application boundary"},
    CommandSpec {path:"intake capture",syntax:"bwrk intake capture [ARGS] [--json]",action:"mutate",output:"intake",direct:true,service:false,summary:"project-scoped intake through the canonical application"},
    CommandSpec {path:"intake bucket",syntax:"bwrk intake bucket [ARGS] [--json]",action:"mutate",output:"intake",direct:true,service:false,summary:"project-scoped intake through the canonical application"},
    CommandSpec {path:"intake show",syntax:"bwrk intake show [ARGS] [--json]",action:"read",output:"intake",direct:true,service:false,summary:"project-scoped intake through the canonical application"},
    CommandSpec {path:"intake list",syntax:"bwrk intake list [ARGS] [--json]",action:"read",output:"intake",direct:true,service:false,summary:"project-scoped intake through the canonical application"},
    CommandSpec { path: "cycle list", syntax: "bwrk cycle list --project PROJECT [--limit N] [--offset N] [--json]", action: "read", output: "planning", direct: true, service: true, summary: "read revision-consistent cycle planning" },
    CommandSpec { path: "cycle board", syntax: "bwrk cycle board --project PROJECT CYCLE_ID [--json]", action: "read", output: "planning", direct: true, service: true, summary: "read revision-consistent cycle planning" },
    CommandSpec { path: "cycle report", syntax: "bwrk cycle report --project PROJECT CYCLE_ID [--json]", action: "read", output: "planning", direct: true, service: true, summary: "read revision-consistent cycle planning" },
    CommandSpec { path: "cycle create", syntax: "bwrk cycle create --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle activate", syntax: "bwrk cycle activate --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle close", syntax: "bwrk cycle close --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle cancel", syntax: "bwrk cycle cancel --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle assign", syntax: "bwrk cycle assign --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle commit", syntax: "bwrk cycle commit --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle remove", syntax: "bwrk cycle remove --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle carry-over", syntax: "bwrk cycle carry-over --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "cycle map-legacy", syntax: "bwrk cycle map-legacy --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint list", syntax: "bwrk sprint list --project PROJECT [--limit N] [--offset N] [--json]", action: "read", output: "planning", direct: true, service: true, summary: "read revision-consistent cycle planning" },
    CommandSpec { path: "sprint board", syntax: "bwrk sprint board --project PROJECT CYCLE_ID [--json]", action: "read", output: "planning", direct: true, service: true, summary: "read revision-consistent cycle planning" },
    CommandSpec { path: "sprint report", syntax: "bwrk sprint report --project PROJECT CYCLE_ID [--json]", action: "read", output: "planning", direct: true, service: true, summary: "read revision-consistent cycle planning" },
    CommandSpec { path: "sprint create", syntax: "bwrk sprint create --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint activate", syntax: "bwrk sprint activate --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint close", syntax: "bwrk sprint close --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint cancel", syntax: "bwrk sprint cancel --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint assign", syntax: "bwrk sprint assign --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint commit", syntax: "bwrk sprint commit --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint remove", syntax: "bwrk sprint remove --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint carry-over", syntax: "bwrk sprint carry-over --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "sprint map-legacy", syntax: "bwrk sprint map-legacy --project PROJECT [CYCLE_ID] --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "planning", direct: true, service: true, summary: "apply an authenticated, revision-bound cycle operation" },
    CommandSpec { path: "review list", syntax: "bwrk review list --project PROJECT [--limit N] [--offset N] [--json]", action: "read", output: "reviews", direct: true, service: true, summary: "list project-scoped independent review decisions" },
    CommandSpec { path: "review show", syntax: "bwrk review show --project PROJECT REVIEW_ID [--json]", action: "read", output: "review", direct: true, service: true, summary: "inspect one project-scoped immutable review decision" },
    CommandSpec { path: "review approve", syntax: "bwrk review approve --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound review approve; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "review reject", syntax: "bwrk review reject --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound review reject; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "review return", syntax: "bwrk review return --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound review return; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "review revoke", syntax: "bwrk review revoke --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound review revoke; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "exception grant", syntax: "bwrk exception grant --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound exception grant; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "exception revoke", syntax: "bwrk exception revoke --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound exception revoke; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "dep waive", syntax: "bwrk dep waive --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound dep waive; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "work reopen", syntax: "bwrk work reopen --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound work reopen; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "work cancel", syntax: "bwrk work cancel --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound work cancel; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "work retry", syntax: "bwrk work retry --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound work retry; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "work publish", syntax: "bwrk work publish --project PROJECT --work ID --input PATH --expected-revision N --reason TEXT --yes [--json]", action: "mutate", output: "completion", direct: true, service: true, summary: "revision-bound work publish; input JSON needs expected_entity_revision and expected_proof_revision" },
    CommandSpec { path: "auth show", syntax: "bwrk auth show [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]", action: "read", output: "principal", direct: true, service: false, summary: "show authenticated principal and delegation root" },
    CommandSpec { path: "auth key", syntax: "bwrk auth key [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]", action: "mutate", output: "principal", direct: true, service: false, summary: "create a local enrollment key without granting authority" },
    CommandSpec { path: "auth bootstrap", syntax: "bwrk auth bootstrap [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]", action: "mutate", output: "principal", direct: true, service: false, summary: "owner-only bootstrap for an initialized pre-key workspace" },
    CommandSpec { path: "auth grant", syntax: "bwrk auth grant [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]", action: "mutate", output: "principal", direct: true, service: false, summary: "grant or rotate a revision-bound project principal credential" },
    CommandSpec { path: "auth revoke", syntax: "bwrk auth revoke [--input PATH] [--expected-revision N --reason TEXT --yes] [--json]", action: "mutate", output: "principal", direct: true, service: false, summary: "revoke a project credential or delegation subtree" },
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
        syntax: "bwrk init [PROJECT] [--interactive|--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
        action: "mutate",
        output: "project",
        direct: true,
        service: false,
        summary: "initialize and scaffold a project; prompts for agent skill targets in a terminal",
    },
    CommandSpec {
        path: "setup",
        syntax: "bwrk setup [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
        action: "mutate",
        output: "project_setup",
        direct: true,
        service: false,
        summary: "recommended project setup alias for init",
    },
    CommandSpec {
        path: "install",
        syntax: "bwrk install [PROJECT] [--yes] [--agents codex,claude] [--project-root PATH] [--db PATH] [--dry-run] [--json]",
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
        syntax: "bwrk prime PROJECT [--limit N] [--offset N] [--json]",
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
        syntax: "bwrk work list PROJECT [--limit N] [--offset N]",
        action: "read",
        output: "work_list",
        direct: true,
        service: false,
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
        syntax: "bwrk work create PROJECT WORK_ID TITLE [--kind milestone|sprint|task] [--parent WORK_ID] [--priority N] [--description TEXT] [--dispatch automatic|operator_only|paused] [--hold CODE] [--session SESSION_ID] --expected-revision N",
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
        syntax: "bwrk agent guide --project PROJECT [--work WORK_ID]",
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
        syntax: "bwrk agent start [WORK_ID] --project PROJECT [--source-version ID --config-identity ID] [--session ID]",
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
        syntax: "bwrk agent finish WORK_ID (--close --receipt PATH --summary PATH | --release [--reason CODE]) --project PROJECT --attempt ID --fence N [--session SESSION_ID]",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "proof-gated close or explicit release",
    },
    CommandSpec {
        path: "next",
        syntax: "bwrk next --project PROJECT [--work WORK_ID]",
        action: "read",
        output: "agent_next",
        direct: true,
        service: true,
        summary: "select the next safe guided action",
    },
    CommandSpec {
        path: "agent next",
        syntax: "bwrk agent next --project PROJECT [--work WORK_ID]",
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
        syntax: "bwrk evidence run --project PROJECT --work WORK_ID --gate GATE_ID",
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
const GAPS: &[GapSpec] = &[
    GapSpec {
        path: "summary",
        code: "closeout_routes_not_implemented",
        summary: "typed summary creation is available through the finish/close workflow",
        owner: "closeout",
        scope: "family",
    },
];

// Keep the compatibility `GAPS` families above stable for clients that already
// consume this registry. These exact route entries are the canonical lookup
// surface for discovery and help: a grouped description must not make a real
// route such as `dep add` or `source show` appear to be unknown.
const UNAVAILABLE_ROUTES: &[GapSpec] = &[
    GapSpec {
        path: "intake note",
        code: "intake_note_not_implemented",
        summary: "use intake capture --kind note; this compatibility alias is not exposed",
        owner: "knowledge",
        scope: "route",
    },
    GapSpec {
        path: "intake discovery",
        code: "intake_discovery_not_implemented",
        summary: "use intake capture --kind discovery; this compatibility alias is not exposed",
        owner: "knowledge",
        scope: "route",
    },
    GapSpec {
        path: "intake question",
        code: "intake_question_not_implemented",
        summary: "use intake capture --kind question; this compatibility alias is not exposed",
        owner: "knowledge",
        scope: "route",
    },
    GapSpec {
        path: "intake revisit",
        code: "intake_revisit_not_implemented",
        summary: "use intake capture --kind revisit; this compatibility alias is not exposed",
        owner: "knowledge",
        scope: "route",
    },
    GapSpec {
        path: "intake promote",
        code: "intake_promote_not_implemented",
        summary: "typed intake promotion needs a public application adapter",
        owner: "knowledge",
        scope: "route",
    },
    GapSpec {
        path: "intake disposition",
        code: "intake_disposition_not_implemented",
        summary: "intake disposition needs a public application adapter",
        owner: "knowledge",
        scope: "route",
    },
    GapSpec {
        path: "summary compose",
        code: "summary_compose_not_implemented",
        summary: "typed summary composition is not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
    GapSpec {
        path: "summary create",
        code: "summary_create_not_implemented",
        summary: "typed summary creation is not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
    GapSpec {
        path: "summary show",
        code: "summary_show_not_implemented",
        summary: "typed summary inspection is not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
    GapSpec {
        path: "summary list",
        code: "summary_list_not_implemented",
        summary: "typed summary listing is not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
    GapSpec {
        path: "summary render",
        code: "summary_render_not_implemented",
        summary: "typed summary rendering is not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
    GapSpec {
        path: "review decide",
        code: "review_decide_not_implemented",
        summary: "independent review decisions are not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
];

pub(crate) fn is_registry_path(path: &[String]) -> bool {
    matches!(
        path.first().map(String::as_str),
        Some("commands" | "help" | "version")
    )
}

/// Returns true only for a route deliberately catalogued as unavailable.
/// Callers use this to fail closed instead of opening the local database and
/// accidentally treating a planned route as an offline implementation.
pub(crate) fn is_unavailable_path(path: &[String]) -> bool {
    let value = path.join(" ");
    UNAVAILABLE_ROUTES.iter().any(|entry| entry.path == value)
}

pub(crate) fn result(parsed: &ParsedCommand) -> Result<CliResult, CliError> {
    match parsed.path.first().map(String::as_str) {
        Some("commands") => {
            let filter = discovery_filter(parsed);
            registry_result(filter.as_deref())
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
    }
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
    let commands = COMMANDS
        .iter()
        .filter(|command| path_matches(command.path, filter))
        .map(command_json)
        .collect::<Vec<_>>();
    let gaps = GAPS
        .iter()
        .filter(|gap| path_matches(gap.path, filter))
        .map(gap_json)
        .collect::<Vec<_>>();
    let unavailable_routes = UNAVAILABLE_ROUTES
        .iter()
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
            "available": commands,
            "gaps": gaps,
            "unavailable_routes": unavailable_routes,
            "count": COMMANDS.len(),
            "gap_count": GAPS.len(),
            "unavailable_count": UNAVAILABLE_ROUTES.len(),
        })),
        None,
    )
}

fn help_result(filter: Option<&str>) -> Result<CliResult, CliError> {
    let command = filter.and_then(|value| COMMANDS.iter().find(|entry| entry.path == value));
    let gap = filter.and_then(|value| {
        UNAVAILABLE_ROUTES
            .iter()
            .find(|entry| entry.path == value)
            .or_else(|| GAPS.iter().find(|entry| entry.path == value))
    });
    let available_children = COMMANDS
        .iter()
        .filter(|entry| {
            filter.is_some_and(|value| entry.path != value && path_matches(entry.path, Some(value)))
        })
        .map(command_json)
        .collect::<Vec<_>>();
    let unavailable_children = UNAVAILABLE_ROUTES
        .iter()
        .filter(|entry| {
            filter.is_some_and(|value| entry.path != value && path_matches(entry.path, Some(value)))
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
            "api_version": API_VERSION,
            "envelope_schema": schema::ENVELOPE,
            "command_registry": REGISTRY_ID,
            "workflow_assets": "boreal.workflow.assets.v1",
            "sqlite_runtime": boreal_store::sqlite_runtime_identity().as_json(),
            "sqlite_runtime_release_floor": {
                "libversion_at_least": "3.51.3",
                "reason": "SQLite WAL-reset fix required by the release policy",
                "enforced": false,
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
                db: String::new(),
                socket: None,
                project: None,
                actor: String::new(),
                actor_role: None,
                harness: String::new(),
                session: String::new(),
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
        assert_eq!(memory_data["available"].as_array().unwrap().len(), 7);
        assert!(memory_data["unavailable_routes"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn version_rejects_a_nested_discovery_path() {
        let error = result(&parsed(&["version", "extra"], &[])).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }
}
