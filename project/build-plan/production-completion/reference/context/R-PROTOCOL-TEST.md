# R-PROTOCOL-TEST — crates/protocol/tests/m02_status_wire.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/protocol/tests/m02_status_wire.rs:L1–L23`  
**File SHA-256:** `ba1c0f9cf3950461e7694085ca94cbdc33894711a580ce72a7d39898b9f77ecf`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Primary reason optional compatibility test; broader status/action contract remains to be proven.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,23p' 'crates/protocol/tests/m02_status_wire.rs'
```

## Exact baseline excerpt

````text
    1 | use boreal_protocol::models::StatusDto;
    2 | use serde_json::json;
    3 | 
    4 | #[test]
    5 | fn primary_reason_is_additive_and_roundtrips_without_a_major_version_bump() {
    6 |     let mut value = json!({
    7 |         "schema_version": "boreal.status.v1", "fixture_id": null,
    8 |         "work_id": "task", "display_status": "paused", "lifecycle": "open",
    9 |         "reason_codes": ["paused", "prerequisite_open(upstream)"],
   10 |         "claimable_for_actor": false, "next_action": null, "attempt": null,
   11 |         "gates": {"open": [], "satisfied": []}, "dependency": {"prerequisites": []},
   12 |         "as_of": "unix-ms:10", "next_status_change_at": null
   13 |     });
   14 |     let old: StatusDto = serde_json::from_value(value.clone()).unwrap();
   15 |     assert_eq!(old.primary_reason, None);
   16 |     value["primary_reason"] = json!("paused");
   17 |     let new: StatusDto = serde_json::from_value(value).unwrap();
   18 |     assert_eq!(new.primary_reason.as_deref(), Some("paused"));
   19 |     assert_eq!(
   20 |         serde_json::to_value(new).unwrap()["primary_reason"],
   21 |         "paused"
   22 |     );
   23 | }
````
