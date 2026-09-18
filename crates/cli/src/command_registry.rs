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
        path: "init",
        syntax: "bwrk init PROJECT [--db PATH] [--json]",
        action: "mutate",
        output: "project",
        direct: true,
        service: true,
        summary: "initialize a project through the application boundary",
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
        service: false,
        summary: "read one exact work item",
    },
    CommandSpec {
        path: "work create",
        syntax: "bwrk work create PROJECT WORK_ID TITLE [--kind milestone|sprint|task] [--parent WORK_ID]",
        action: "mutate",
        output: "work",
        direct: true,
        service: true,
        summary: "create typed planning or executable work",
    },
    CommandSpec {
        path: "work claim",
        syntax: "bwrk work claim PROJECT WORK_ID [--session ID] [--lease-ttl DURATION]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "atomically claim one work item",
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
        syntax: "bwrk agent start [WORK_ID] --project PROJECT [--session ID]",
        action: "mutate",
        output: "attempt",
        direct: true,
        service: true,
        summary: "resume or atomically select, claim, accept, and start",
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
        syntax: "bwrk agent finish WORK_ID (--close|--release) --project PROJECT --attempt ID --fence N",
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
        path: "operation show",
        syntax: "bwrk operation show PROJECT OPERATION_ID",
        action: "read",
        output: "operation",
        direct: true,
        service: true,
        summary: "read back a possibly delivered mutation",
    },
];

// These are deliberately not emitted as available command entries. They are
// typed gaps so clients can explain why an aspirational plan route cannot be
// used yet, rather than guessing at an adapter or falling back to SQLite.
const GAPS: &[GapSpec] = &[
    GapSpec {
        path: "session end",
        code: "session_end_not_implemented",
        summary: "the current store has registration/read semantics but no safe end transition",
        owner: "lifecycle",
        scope: "route",
    },
    GapSpec {
        path: "work edit",
        code: "work_edit_not_implemented",
        summary: "planning-field edits require the expected-revision mutation adapter",
        owner: "planning",
        scope: "route",
    },
    GapSpec {
        path: "dep add|remove|tree|cycles",
        code: "dependency_routes_not_implemented",
        summary: "dependency APIs exist below the public adapter but are not exposed here",
        owner: "planning",
        scope: "family",
    },
    GapSpec {
        path: "summary|review",
        code: "closeout_routes_not_implemented",
        summary: "typed summary/review records are currently reachable through finish_close only",
        owner: "closeout",
        scope: "family",
    },
    GapSpec {
        path: "source|memory|migration",
        code: "knowledge_routes_not_implemented",
        summary: "standalone libraries still need application/CLI adapters",
        owner: "integration",
        scope: "family",
    },
    GapSpec {
        path: "doctor",
        code: "operator_routes_not_implemented",
        summary: "operator diagnosis and repair need a public bounded adapter",
        owner: "release",
        scope: "route",
    },
];

// Keep the compatibility `GAPS` families above stable for clients that already
// consume this registry. These exact route entries are the canonical lookup
// surface for discovery and help: a grouped description must not make a real
// route such as `dep add` or `source show` appear to be unknown.
const UNAVAILABLE_ROUTES: &[GapSpec] = &[
    GapSpec {
        path: "session end",
        code: "session_end_not_implemented",
        summary: "the current store has registration/read semantics but no safe end transition",
        owner: "lifecycle",
        scope: "route",
    },
    GapSpec {
        path: "work edit",
        code: "work_edit_not_implemented",
        summary: "planning-field edits require the expected-revision mutation adapter",
        owner: "planning",
        scope: "route",
    },
    GapSpec {
        path: "dep add",
        code: "dependency_add_not_implemented",
        summary: "dependency mutation is not exposed through the public adapter",
        owner: "planning",
        scope: "route",
    },
    GapSpec {
        path: "dep remove",
        code: "dependency_remove_not_implemented",
        summary: "dependency mutation is not exposed through the public adapter",
        owner: "planning",
        scope: "route",
    },
    GapSpec {
        path: "dep tree",
        code: "dependency_tree_not_implemented",
        summary: "dependency explanation is not exposed through the public adapter",
        owner: "planning",
        scope: "route",
    },
    GapSpec {
        path: "dep cycles",
        code: "dependency_cycles_not_implemented",
        summary: "dependency cycle diagnostics are not exposed through the public adapter",
        owner: "planning",
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
        path: "review list",
        code: "review_list_not_implemented",
        summary: "independent review listing is not exposed as a public route",
        owner: "closeout",
        scope: "route",
    },
    GapSpec {
        path: "review show",
        code: "review_show_not_implemented",
        summary: "independent review inspection is not exposed as a public route",
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
    GapSpec {
        path: "source add",
        code: "source_add_not_implemented",
        summary: "source ingestion is not exposed through the public adapter",
        owner: "integration",
        scope: "route",
    },
    GapSpec {
        path: "source list",
        code: "source_list_not_implemented",
        summary: "source listing is not exposed through the public adapter",
        owner: "integration",
        scope: "route",
    },
    GapSpec {
        path: "source show",
        code: "source_show_not_implemented",
        summary: "source inspection is not exposed through the public adapter",
        owner: "integration",
        scope: "route",
    },
    GapSpec {
        path: "source verify",
        code: "source_verify_not_implemented",
        summary: "source verification is not exposed through the public adapter",
        owner: "integration",
        scope: "route",
    },
    GapSpec {
        path: "memory",
        code: "memory_routes_not_implemented",
        summary: "memory draft, review, publication, and search routes need application adapters",
        owner: "integration",
        scope: "family",
    },
    GapSpec {
        path: "migration",
        code: "migration_routes_not_implemented",
        summary: "migration dry-run/apply/verify routes need a public adapter",
        owner: "integration",
        scope: "family",
    },
    GapSpec {
        path: "doctor",
        code: "operator_routes_not_implemented",
        summary: "operator diagnosis and repair need a public bounded adapter",
        owner: "release",
        scope: "route",
    },
];

pub(crate) fn is_registry_path(path: &[String]) -> bool {
    matches!(
        path.first().map(String::as_str),
        Some("commands" | "help" | "version")
    )
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
                include_expiry: false,
                limit: None,
                offset: None,
                max_requests: None,
                kind: None,
                parent: None,
                description: None,
                priority: None,
                source_version: None,
                config_identity: None,
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
        assert_eq!(data["kind"], "unavailable");
        assert_eq!(data["gap"]["code"], "dependency_add_not_implemented");
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
        assert_eq!(data["matches"]["unavailable"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn unavailable_routes_are_exact_and_typed() {
        let result = registry_result(Some("source show")).unwrap();
        let route = result.data.unwrap()["unavailable_routes"][0].clone();
        assert_eq!(route["path"], "source show");
        assert_eq!(route["availability"], "unavailable");
        assert_eq!(route["scope"], "route");
        assert_eq!(route["adapters"]["direct"], false);
        assert_eq!(route["recovery"]["kind"], "implementation_gap");
    }

    #[test]
    fn version_rejects_a_nested_discovery_path() {
        let error = result(&parsed(&["version", "extra"], &[])).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArgument);
    }
}
