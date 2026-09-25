use std::process::Command;

fn invoke(args: &[&str]) -> (bool, serde_json::Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .args(args)
        .output()
        .expect("bwrk should start");
    let value = serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON");
    (output.status.success(), value)
}

fn command_syntax(envelope: &serde_json::Value, path: &str) -> String {
    envelope["data"]["available"]
        .as_array()
        .expect("command registry available routes")
        .iter()
        .find(|entry| entry["path"] == path)
        .unwrap_or_else(|| panic!("missing available route {path}"))["syntax"]
        .as_str()
        .unwrap_or_else(|| panic!("route {path} has no syntax"))
        .to_owned()
}

fn command_summary(envelope: &serde_json::Value, path: &str) -> String {
    envelope["data"]["available"]
        .as_array()
        .expect("command registry available routes")
        .iter()
        .find(|entry| entry["path"] == path)
        .unwrap_or_else(|| panic!("missing available route {path}"))["summary"]
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
    let (success, envelope) = invoke(&["commands", "work", "--json"]);
    assert!(success);
    let paths = envelope["data"]["available"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(paths.contains(&"work hold add"));
    assert!(paths.contains(&"work hold resolve"));
    assert!(paths.contains(&"work dispatch set"));
}

#[test]
fn public_command_syntax_exposes_required_identity_and_proof_inputs() {
    let (success, envelope) = invoke(&["commands", "--json"]);
    assert!(success);

    let claim = command_syntax(&envelope, "work claim");
    assert!(claim.contains("--source-version ID"));
    assert!(claim.contains("--config-identity ID"));

    let finish = command_syntax(&envelope, "agent finish");
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
            command_syntax(&envelope, path).contains("--project PROJECT"),
            "{path} syntax must expose its project scope"
        );
    }

    for path in [
        "cycle board",
        "cycle report",
        "sprint board",
        "sprint report",
    ] {
        let syntax = command_syntax(&envelope, path);
        assert!(syntax.contains("CYCLE_ID"), "{path} requires an ID");
        assert!(!syntax.contains("[CYCLE_ID]"), "{path} ID is not optional");
    }

    assert!(command_syntax(&envelope, "memory show").contains("DRAFT_ID"));
    assert!(command_syntax(&envelope, "memory search").contains("QUERY"));
    assert!(command_syntax(&envelope, "memory readback").contains("OPERATION_ID"));

    for path in ["memory draft", "memory review", "memory publish"] {
        let syntax = command_syntax(&envelope, path);
        assert!(syntax.contains("--yes --expected-revision N"), "{path}");
        assert!(!syntax.contains("[--yes"), "{path}");
    }
    assert!(command_syntax(&envelope, "memory publish").contains("REVIEW_ID"));
    assert!(!command_syntax(&envelope, "memory publish").contains("DRAFT_ID"));
    assert!(command_summary(&envelope, "memory publish").contains("expected_manifest_identity"));

    let agent_start = command_syntax(&envelope, "agent start");
    assert!(agent_start.contains("[--source-version ID --config-identity ID]"));
    assert!(command_summary(&envelope, "agent start").contains("new attempt requires both"));

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
        let summary = command_summary(&envelope, path);
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
fn commands_reports_source_routes_as_direct_only() {
    let (success, envelope) = invoke(&["commands", "source", "--json"]);
    assert!(success);
    let data = &envelope["data"];
    let routes = data["available"].as_array().unwrap();
    assert_eq!(routes.len(), 4);
    assert!(routes.iter().all(|route| {
        route["availability"] == "available"
            && route["adapters"]["direct"] == true
            && route["adapters"]["service"] == false
    }));
    assert!(data["unavailable_routes"].as_array().unwrap().is_empty());
}

#[test]
fn unknown_discovery_path_is_a_typed_not_found_error() {
    let (success, envelope) = invoke(&["help", "not-a-route", "--json"]);
    assert!(!success);
    assert_eq!(envelope["outcome"], "rejected");
    assert_eq!(envelope["error"]["code"], "not_found");
}
