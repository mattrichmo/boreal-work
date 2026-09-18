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
    assert_eq!(
        data["matches"]["unavailable"][0]["code"],
        "work_edit_not_implemented"
    );
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
    let routes = envelope["data"]["unavailable_routes"].as_array().unwrap();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0]["path"], "dep add");
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
fn commands_reports_exact_unavailable_routes_by_namespace() {
    let (success, envelope) = invoke(&["commands", "source", "--json"]);
    assert!(success);
    let data = &envelope["data"];
    assert_eq!(data["available"].as_array().unwrap().len(), 0);
    let routes = data["unavailable_routes"].as_array().unwrap();
    assert_eq!(routes.len(), 4);
    assert!(routes.iter().all(|route| {
        route["availability"] == "unavailable"
            && route["scope"] == "route"
            && route["adapters"]["direct"] == false
            && route["adapters"]["service"] == false
            && route["recovery"]["kind"] == "implementation_gap"
    }));
}

#[test]
fn unknown_discovery_path_is_a_typed_not_found_error() {
    let (success, envelope) = invoke(&["help", "not-a-route", "--json"]);
    assert!(!success);
    assert_eq!(envelope["outcome"], "rejected");
    assert_eq!(envelope["error"]["code"], "not_found");
}
