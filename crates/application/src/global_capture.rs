//! Explicit Global capture provenance helpers.
//!
//! Item records retain only their origin digest and optional legacy source
//! reference. Exact text lives once in the snapshot-level witness ledger and
//! in the durable operation result for the capture that created it.

use boreal_domain::global_manager::CaptureOrigin;
use serde_json::{json, Value};

pub(super) fn origin_for_capture(
    text: &str,
    source_ref: Option<&str>,
) -> Result<CaptureOrigin, String> {
    let origin = CaptureOrigin {
        digest: crate::sha256_content_digest(text.as_bytes()),
        source_ref: source_ref.map(str::to_owned),
    };
    origin.validate().map_err(|error| error.to_string())?;
    Ok(origin)
}

pub(super) fn origin_json(origin: &CaptureOrigin) -> Value {
    json!({
        "digest": origin.digest,
        "source_ref": origin.source_ref,
    })
}

pub(super) fn witness_json(
    item_id: &str,
    revision: u64,
    captured_at: &str,
    text: &str,
    origin: &CaptureOrigin,
) -> Value {
    json!({
        "item_id": item_id,
        "revision": revision,
        "captured_at": captured_at,
        "text": text,
        "digest": origin.digest,
        "source_ref": origin.source_ref,
    })
}

/// Validates the immutable item origin against the exact-text witness in a
/// logical snapshot. Historical schema-2 items without origin remain valid.
pub(super) fn validate_snapshot_provenance(snapshot: &Value) -> Result<(), String> {
    let items = snapshot
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| "items must be an array".to_owned())?;
    let witnesses = match snapshot.get("capture_witnesses") {
        None => &[][..],
        Some(Value::Array(rows)) => rows.as_slice(),
        Some(_) => return Err("capture_witnesses must be an array".to_owned()),
    };

    let mut witnesses_by_item = std::collections::BTreeMap::new();
    let item_ids = items
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .collect::<std::collections::BTreeSet<_>>();
    let snapshot_revision = snapshot.get("revision").and_then(Value::as_u64);
    for witness in witnesses {
        let item_id = witness
            .get("item_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "capture witness item_id is required".to_owned())?;
        let text = witness
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| "capture witness text is required".to_owned())?;
        let revision = witness.get("revision").and_then(Value::as_u64);
        if revision
            .is_none_or(|value| value == 0 || snapshot_revision.is_some_and(|top| value > top))
        {
            return Err("capture witness revision must be a non-negative integer".to_owned());
        }
        let captured_at = witness
            .get("captured_at")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "capture witness captured_at is required".to_owned())?;
        if !item_ids.contains(item_id) {
            return Err(format!("capture witness item {item_id} is missing"));
        }
        let item = items
            .iter()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(item_id))
            .expect("item id was checked above");
        if item.get("created_at").and_then(Value::as_str) != Some(captured_at) {
            return Err(format!(
                "capture witness captured_at does not match item {item_id} created_at"
            ));
        }
        let origin = origin_from_object(witness)?;
        let actual_digest = crate::sha256_content_digest(text.as_bytes());
        if actual_digest != origin.digest {
            return Err(format!(
                "capture witness digest does not match exact text for item {item_id}"
            ));
        }
        if witnesses_by_item
            .insert(item_id.to_owned(), (origin, text, captured_at))
            .is_some()
        {
            return Err(format!("duplicate capture witness for item {item_id}"));
        }
    }

    let mut origins = std::collections::BTreeSet::new();
    for item in items {
        let Some(origin_value) = item.get("capture_origin") else {
            continue;
        };
        if origin_value.is_null() {
            continue;
        }
        let item_id = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "capture origin item id is required".to_owned())?;
        let origin = origin_from_object(origin_value)?;
        let Some((witness_origin, _, _)) = witnesses_by_item.get(item_id) else {
            return Err(format!(
                "capture origin for item {item_id} has no exact-text witness"
            ));
        };
        if witness_origin != &origin {
            return Err(format!(
                "capture origin and witness disagree for item {item_id}"
            ));
        }
        origins.insert(item_id.to_owned());
    }

    for item_id in witnesses_by_item.keys() {
        if !origins.contains(item_id) {
            return Err(format!(
                "capture witness for item {item_id} has no matching capture origin"
            ));
        }
    }
    Ok(())
}

fn origin_from_object(value: &Value) -> Result<CaptureOrigin, String> {
    let digest = value
        .get("digest")
        .and_then(Value::as_str)
        .ok_or_else(|| "capture origin digest is required".to_owned())?
        .to_owned();
    let source_ref = match value.get("source_ref") {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(_) => return Err("capture origin source_ref must be a string or null".to_owned()),
    };
    let origin = CaptureOrigin { digest, source_ref };
    origin.validate().map_err(|error| error.to_string())?;
    Ok(origin)
}

#[cfg(test)]
mod tests {
    use super::{origin_for_capture, validate_snapshot_provenance, witness_json};
    use serde_json::json;

    #[test]
    fn origin_digest_hashes_exact_utf8_bytes_without_normalizing_text() {
        let text = "  Café – notes\n";
        let origin = origin_for_capture(text, None).unwrap();
        assert_eq!(
            origin.digest,
            "sha256:8b167964ac7adc09362f702cfcabcebfd3660084e3bc77119da37b2fb2569cc3"
        );
        assert_ne!(
            origin.digest,
            origin_for_capture(text.trim(), None).unwrap().digest
        );
    }

    #[test]
    fn provenance_validation_requires_matching_verifiable_witness() {
        let text = "Original capture";
        let origin = origin_for_capture(text, Some("legacy:raw-1")).unwrap();
        let witness = witness_json("item-1", 4, "capture-time", text, &origin);
        let valid = json!({
            "revision": 4,
            "items": [{"id":"item-1","created_at":"capture-time","capture_origin":super::origin_json(&origin)}],
            "capture_witnesses": [witness]
        });
        assert!(validate_snapshot_provenance(&valid).is_ok());

        let mut tampered = valid;
        tampered["capture_witnesses"][0]["text"] = json!("edited capture");
        assert!(validate_snapshot_provenance(&tampered)
            .unwrap_err()
            .contains("does not match exact text"));
    }

    #[test]
    fn historical_items_without_provenance_are_not_given_a_witness() {
        let legacy = json!({"items":[{"id":"old-item","title":"Old record"}]});
        assert!(validate_snapshot_provenance(&legacy).is_ok());
    }
}
