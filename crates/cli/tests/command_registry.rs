use std::process::Command;

fn invoke(args: &[&str]) -> (bool, serde_json::Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .args(args)
        .output()
        .expect("bwrk should start");
    let value = serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON");
    (output.status.success(), value)
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
fn commands_catalogue_v3_routes_as_unavailable_future_capabilities() {
    let (success, envelope) = invoke(&["commands", "intake", "--json"]);
    assert!(success);
    let unavailable = envelope["data"]["unavailable_routes"]
        .as_array()
        .unwrap();
    assert!(unavailable
        .iter()
        .any(|route| route["path"] == "intake capture"
            && route["code"] == "work_model_v3_not_enabled"));
    assert!(envelope["data"]["available"]
        .as_array()
        .unwrap()
        .is_empty());
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
