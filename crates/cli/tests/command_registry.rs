use std::process::Command;

fn invoke(args: &[&str]) -> (bool, serde_json::Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .args(args)
        .output()
        .expect("bwrk should start");
    let value = serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON");
    (output.status.success(), value)
}

fn command_entry(path: &str) -> serde_json::Value {
    let mut args = vec!["commands"];
    args.extend(path.split_whitespace());
    args.push("--json");
    let (success, envelope) = invoke(&args);
    assert!(
        success,
        "command registry query for {path} should succeed: {envelope}"
    );
    envelope["data"]["available"]
        .as_array()
        .expect("command registry available routes")
        .iter()
        .find(|entry| entry["path"] == path)
        .unwrap_or_else(|| panic!("missing available route {path}"))
        .clone()
}

fn command_syntax(path: &str) -> String {
    command_entry(path)["syntax"]
        .as_str()
        .unwrap_or_else(|| panic!("route {path} has no syntax"))
        .to_owned()
}

fn command_summary(path: &str) -> String {
    command_entry(path)["summary"]
        .as_str()
        .unwrap_or_else(|| panic!("route {path} has no summary"))
        .to_owned()
}

#[test]
fn help_lists_available_and_unavailable_work_children() {
    let (success, envelope) = invoke(&["help", "work", "--json"]);
    assert!(success);
    let data = &envelope["data"];
    assert_eq!(data["kind"], "namespace");
    assert!(data["matches"]["available"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == "work create"));
    assert!(data["matches"]["available"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == "work edit"));
    assert!(!data["matches"]["unavailable"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["path"] == "work edit"));
}

#[test]
fn deep_help_resolves_a_concrete_available_route() {
    let (success, envelope) = invoke(&["help", "work", "create", "--json"]);
    assert!(success);
    assert_eq!(envelope["data"]["path"], "work create");
    assert_eq!(envelope["data"]["entry"]["path"], "work create");
    assert!(envelope["data"]["gap"].is_null());
    let syntax = envelope["data"]["entry"]["syntax"]
        .as_str()
        .expect("work create syntax");
    assert!(syntax.contains("[--session SESSION_ID]"));
    assert!(syntax.contains("--expected-revision N"));
}

#[test]
fn deep_commands_resolves_a_concrete_unavailable_route() {
    let (success, envelope) = invoke(&["commands", "dep", "add", "--json"]);
    assert!(success);
    let routes = envelope["data"]["available"].as_array().unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["path"], "dep add");
    assert_eq!(routes[0]["direct"], true);
    assert_eq!(routes[0]["service"], true);
}

#[test]
fn global_manager_routes_are_discovered_and_dashboard_uses_isolated_global_state() {
    let (success, envelope) = invoke(&["commands", "global", "--json"]);
    assert!(success);
    assert!(envelope["data"]["available"]
        .as_array()
        .unwrap()
        .iter()
        .any(|route| route["path"] == "global status"));

    let root = std::env::temp_dir().join(format!("boreal-global-registry-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .args(["dashboard", "global", "--json"])
        .env("BOREAL_GLOBAL_ROOT", &root)
        .output()
        .expect("bwrk should run global dashboard snapshot");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let dashboard: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(dashboard["data"]["projects"].is_array());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn global_bootstrap_and_cli_commands_use_the_global_store() {
    let root = std::env::temp_dir().join(format!("boreal-global-cli-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
            .args(args)
            .env("BOREAL_GLOBAL_ROOT", &root)
            .output()
            .expect("bwrk should run global command");
        let envelope: serde_json::Value =
            serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
                panic!(
                    "expected JSON output: {}",
                    String::from_utf8_lossy(&output.stdout)
                )
            });
        (output.status.success(), envelope)
    };

    let (bootstrapped, bootstrap) = run(&["global", "bootstrap", "--json"]);
    assert!(bootstrapped, "{bootstrap}");
    assert_eq!(bootstrap["data"]["provisioned"], true);

    let (created, project) = run(&[
        "global",
        "project",
        "add",
        "--name",
        "Planning",
        "--labels",
        "personal,roadmap",
        "--priority",
        "3",
        "--json",
    ]);
    assert!(created, "{project}");
    let project_id = project["data"]["id"].as_str().expect("created project id");

    let (listed, snapshot) = run(&["global", "snapshot", "--json"]);
    assert!(listed, "{snapshot}");
    let saved = snapshot["data"]["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == project_id)
        .expect("created project should be in global snapshot");
    assert_eq!(saved["labels"], serde_json::json!(["personal", "roadmap"]));
    assert_eq!(saved["priority"], 3);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn commands_report_dependency_reads_as_service_capable() {
    let (success, envelope) = invoke(&["commands", "dep", "--json"]);
    assert!(success);
    let available = envelope["data"]["available"].as_array().unwrap();
    for path in ["dep add", "dep remove", "dep tree", "dep cycles"] {
        let route = available
            .iter()
            .find(|entry| entry["path"] == path)
            .unwrap_or_else(|| panic!("missing route {path}"));
        assert_eq!(route["adapters"]["service"], true, "{path}");
    }
}

#[test]
fn commands_catalogue_lists_the_implemented_intake_capture_route_as_available() {
    let (success, envelope) = invoke(&["commands", "intake", "--json"]);
    assert!(success);
    let available = envelope["data"]["available"].as_array().unwrap();
    assert!(available.iter().any(|route| {
        route["path"] == "intake capture"
            && route["availability"] == "available"
            && route["adapters"]["direct"] == true
    }));
    let unavailable = envelope["data"]["unavailable_routes"].as_array().unwrap();
    assert!(!unavailable
        .iter()
        .any(|route| route["path"] == "intake capture"));
}

#[test]
fn commands_expose_revision_checked_planning_mutations() {
    for path in ["work hold add", "work hold resolve", "work dispatch set"] {
        let entry = command_entry(path);
        assert_eq!(entry["availability"], "available", "{path}");
        assert_eq!(entry["adapters"]["direct"], true, "{path}");
        assert_eq!(entry["adapters"]["service"], true, "{path}");
        assert!(
            entry["syntax"]
                .as_str()
                .unwrap()
                .contains("--expected-revision N"),
            "{path} must expose its revision fence"
        );
    }
}

#[test]
fn public_command_syntax_exposes_required_identity_and_proof_inputs() {
    let claim_entry = command_entry("work claim");
    assert_eq!(claim_entry["availability"], "available");
    assert_eq!(claim_entry["adapters"]["direct"], true);
    assert_eq!(claim_entry["adapters"]["service"], true);
    let claim = claim_entry["syntax"].as_str().unwrap();
    assert!(claim.contains("--source-version ID"));
    assert!(claim.contains("--config-identity ID"));

    let finish = command_syntax("agent finish");
    assert!(finish.contains("--close --receipt PATH --summary PATH"));

    for path in [
        "review approve",
        "review reject",
        "review return",
        "review revoke",
        "exception grant",
        "exception revoke",
        "dep waive",
        "work reopen",
        "work cancel",
        "work retry",
        "work publish",
        "cycle list",
        "cycle board",
        "cycle report",
        "cycle create",
        "sprint list",
        "sprint board",
        "sprint report",
        "memory draft",
        "memory review",
        "memory publish",
        "memory show",
        "memory search",
        "memory readback",
        "memory reconcile",
    ] {
        assert!(
            command_syntax(path).contains("--project PROJECT"),
            "{path} syntax must expose its project scope"
        );
    }

    for path in [
        "cycle board",
        "cycle report",
        "sprint board",
        "sprint report",
    ] {
        let syntax = command_syntax(path);
        assert!(syntax.contains("CYCLE_ID"), "{path} requires an ID");
        assert!(!syntax.contains("[CYCLE_ID]"), "{path} ID is not optional");
    }

    assert!(command_syntax("memory show").contains("DRAFT_ID"));
    assert!(command_syntax("memory search").contains("QUERY"));
    assert!(command_syntax("memory readback").contains("OPERATION_ID"));

    for path in ["memory draft", "memory review", "memory publish"] {
        let syntax = command_syntax(path);
        assert!(syntax.contains("--yes --expected-revision N"), "{path}");
        assert!(!syntax.contains("[--yes"), "{path}");
    }
    assert!(command_syntax("memory publish").contains("REVIEW_ID"));
    assert!(!command_syntax("memory publish").contains("DRAFT_ID"));
    assert!(command_summary("memory publish").contains("expected_manifest_identity"));

    let agent_start = command_syntax("agent start");
    assert!(agent_start.contains("[--source-version ID --config-identity ID]"));
    assert!(command_summary("agent start").contains("new attempt requires both"));

    for path in [
        "review approve",
        "review reject",
        "review return",
        "review revoke",
        "exception grant",
        "exception revoke",
        "dep waive",
        "work reopen",
        "work cancel",
        "work retry",
        "work publish",
    ] {
        let summary = command_summary(path);
        assert!(
            summary.contains("expected_entity_revision"),
            "{path}: {summary}"
        );
        assert!(
            summary.contains("expected_proof_revision"),
            "{path}: {summary}"
        );
    }
}

#[test]
fn version_reports_the_linked_sqlite_runtime_identity() {
    let (success, envelope) = invoke(&["version", "--json"]);
    assert!(success);
    assert!(envelope["data"]["sqlite_runtime"]["libversion"]
        .as_str()
        .is_some_and(|version| !version.is_empty()));
    assert!(envelope["data"]["sqlite_runtime"]["source_id"]
        .as_str()
        .is_some_and(|source_id| !source_id.is_empty()));
    assert_eq!(
        envelope["data"]["sqlite_runtime_release_floor"]["libversion_at_least"],
        "3.51.3"
    );
}

#[test]
fn commands_report_source_route_adapters_accurately() {
    let (success, envelope) = invoke(&["commands", "source", "--json"]);
    assert!(success);
    let data = &envelope["data"];
    let routes = data["available"].as_array().unwrap();
    let mut paths = routes
        .iter()
        .map(|route| route["path"].as_str().unwrap())
        .collect::<Vec<_>>();
    paths.sort_unstable();
    assert_eq!(
        paths,
        [
            "source add",
            "source list",
            "source search",
            "source show",
            "source verify",
        ]
    );
    for (path, service_supported) in [
        ("source add", true),
        ("source list", true),
        ("source search", true),
        ("source show", false),
        ("source verify", false),
    ] {
        let route = routes
            .iter()
            .find(|route| route["path"] == path)
            .expect("expected source route is advertised");
        assert_eq!(route["availability"], "available", "{path}");
        assert_eq!(route["adapters"]["direct"], true, "{path}");
        assert_eq!(route["adapters"]["service"], service_supported, "{path}");
        if path == "source list" {
            assert_eq!(
                route["syntax"],
                "bwrk source list PROJECT [--limit N] [--offset N]"
            );
        }
    }
    assert!(data["unavailable_routes"].as_array().unwrap().is_empty());
}

#[test]
fn unknown_discovery_path_is_a_typed_not_found_error() {
    let (success, envelope) = invoke(&["help", "not-a-route", "--json"]);
    assert!(!success);
    assert_eq!(envelope["outcome"], "rejected");
    assert_eq!(envelope["error"]["code"], "not_found");
}
