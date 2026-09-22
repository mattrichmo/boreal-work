use serde_json::Value;
use std::process::Command;

fn invoke(args: &[&str]) -> (bool, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .args(args)
        .output()
        .expect("bwrk should start");
    let value = serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON");
    (output.status.success(), value)
}

#[test]
fn direct_workflow_queries_do_not_require_project_state() {
    let (success, list) = invoke(&["workflows", "list", "--json"]);
    assert!(success);
    assert_eq!(list["outcome"], "changed");
    assert_eq!(list["data"]["assets"].as_array().unwrap().len(), 10);

    let (success, show) = invoke(&["workflows", "show", "boreal.workflow.audit.v1", "--json"]);
    assert!(success);
    assert_eq!(
        show["data"]["asset"]["reference"],
        "boreal.workflow.audit.v1"
    );
    assert_eq!(
        show["data"]["package"]["package_id"],
        "boreal.core-workflows"
    );
}

#[test]
fn workflow_discovery_is_advertised_and_unknown_refs_fail_closed() {
    let (success, commands) = invoke(&["commands", "workflows", "--json"]);
    assert!(success);
    let available = commands["data"]["available"].as_array().unwrap();
    assert!(available
        .iter()
        .any(|entry| entry["path"] == "workflows list"));
    assert!(available
        .iter()
        .any(|entry| entry["path"] == "workflows show"));
    assert!(available.iter().all(|entry| {
        entry["adapters"]["direct"] == true && entry["adapters"]["service"] == true
    }));

    let (success, unknown) = invoke(&["workflows", "show", "boreal.workflow.missing.v1", "--json"]);
    assert!(!success);
    assert_eq!(unknown["outcome"], "rejected");
    assert_eq!(unknown["error"]["code"], "not_found");
}
