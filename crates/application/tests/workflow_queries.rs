use boreal_application::{WorkflowAssetError, WorkflowRegistry};

#[test]
fn embedded_workflow_package_is_bounded_and_resolves_audit() {
    let registry = WorkflowRegistry::embedded().expect("embedded workflow package validates");

    assert_eq!(registry.schema_version(), "boreal.workflow_package.v1");
    assert_eq!(registry.package_id(), "boreal.core-workflows");
    assert_eq!(registry.package_version(), "1.1.0");
    assert_eq!(registry.assets().len(), 10);
    let audit = registry
        .get("boreal.workflow.audit.v1")
        .expect("audit workflow is present");
    assert_eq!(audit.kind, "audit");
    assert!(audit
        .typed_inputs
        .iter()
        .any(|input| input.name == "project_id" && input.input_type == "project_id"));
    assert!(audit
        .finish_criteria
        .iter()
        .any(|criterion| criterion.id == "audit.snapshot" && criterion.required));
}

#[test]
fn unknown_workflow_reference_is_typed_and_read_only() {
    let registry = WorkflowRegistry::embedded().expect("embedded workflow package validates");

    assert!(matches!(
        registry.get("boreal.workflow.missing.v1"),
        Err(WorkflowAssetError::UnknownReference(reference))
            if reference == "boreal.workflow.missing.v1"
    ));
}

#[test]
fn workflow_package_rejects_missing_server_action_contract() {
    let package = r#"{
      "schema_version":"boreal.workflow_package.v1",
      "package_id":"test","package_version":"1","asset_identity":"sha256:test",
      "state_authority":"boreal.application.v2",
      "assets":[{"ref":"boreal.workflow.one.v1","kind":"test","title":"Test",
        "allowed_commands":["bwrk next --json"],
        "typed_inputs":[{"name":"x","type":"id","source":"request","validation":"bounded"}],
        "finish_criteria":[{"id":"done","type":"proof","required":true}],"next_refs":[] }]
    }"#;

    assert!(matches!(
        WorkflowRegistry::from_package_json(package),
        Err(WorkflowAssetError::MissingField("required_server_actions"))
    ));
}
