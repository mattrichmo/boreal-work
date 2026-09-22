use boreal_protocol::models::StatusDto;
use serde_json::json;

#[test]
fn primary_reason_is_additive_and_roundtrips_without_a_major_version_bump() {
    let mut value = json!({
        "schema_version": "boreal.status.v1", "fixture_id": null,
        "work_id": "task", "display_status": "paused", "lifecycle": "open",
        "reason_codes": ["paused", "prerequisite_open(upstream)"],
        "claimable_for_actor": false, "next_action": null, "attempt": null,
        "gates": {"open": [], "satisfied": []}, "dependency": {"prerequisites": []},
        "as_of": "unix-ms:10", "next_status_change_at": null
    });
    let old: StatusDto = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(old.primary_reason, None);
    value["primary_reason"] = json!("paused");
    let new: StatusDto = serde_json::from_value(value).unwrap();
    assert_eq!(new.primary_reason.as_deref(), Some("paused"));
    assert_eq!(
        serde_json::to_value(new).unwrap()["primary_reason"],
        "paused"
    );
}
