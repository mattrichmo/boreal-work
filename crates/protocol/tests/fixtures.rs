use boreal_protocol::{
    schema, ApplicationOutcome, CapabilitySet, Envelope, ErrorCode, ProtocolError,
    ProtocolParseError, ProtocolValidationError, RequestEnvelope, TransportOutcome, API_VERSION,
};
use serde_json::{json, Value};

const ENVELOPES: &[(&str, ApplicationOutcome, TransportOutcome)] = &[
    (
        "envelope-success.json",
        ApplicationOutcome::Changed,
        TransportOutcome::Ok,
    ),
    (
        "envelope-empty.json",
        ApplicationOutcome::Unchanged,
        TransportOutcome::Ok,
    ),
    (
        "envelope-conflict.json",
        ApplicationOutcome::Conflict,
        TransportOutcome::Ok,
    ),
    (
        "envelope-busy.json",
        ApplicationOutcome::Busy,
        TransportOutcome::Ok,
    ),
    (
        "envelope-stale.json",
        ApplicationOutcome::Rejected,
        TransportOutcome::Ok,
    ),
    (
        "envelope-invalid.json",
        ApplicationOutcome::Rejected,
        TransportOutcome::Ok,
    ),
    (
        "envelope-service-unavailable.json",
        ApplicationOutcome::Failed,
        TransportOutcome::Error,
    ),
    (
        "envelope-unknown-outcome.json",
        ApplicationOutcome::Unknown,
        TransportOutcome::Error,
    ),
];

fn fixture(name: &str) -> &'static str {
    match name {
        "envelope-success.json" => {
            include_str!("../../../project/spec/protocol/envelope-success.json")
        }
        "envelope-empty.json" => include_str!("../../../project/spec/protocol/envelope-empty.json"),
        "envelope-conflict.json" => {
            include_str!("../../../project/spec/protocol/envelope-conflict.json")
        }
        "envelope-busy.json" => include_str!("../../../project/spec/protocol/envelope-busy.json"),
        "envelope-stale.json" => {
            include_str!("../../../project/spec/protocol/envelope-stale.json")
        }
        "envelope-invalid.json" => {
            include_str!("../../../project/spec/protocol/envelope-invalid.json")
        }
        "envelope-service-unavailable.json" => {
            include_str!("../../../project/spec/protocol/envelope-service-unavailable.json")
        }
        "envelope-unknown-outcome.json" => {
            include_str!("../../../project/spec/protocol/envelope-unknown-outcome.json")
        }
        _ => panic!("unknown fixture: {name}"),
    }
}

#[test]
fn all_envelope_fixtures_deserialize_and_validate() {
    for (name, expected_outcome, expected_transport) in ENVELOPES {
        let envelope = Envelope::<Value>::from_json(fixture(name))
            .unwrap_or_else(|error| panic!("{name} did not validate: {error}"));
        assert_eq!(envelope.api_version, API_VERSION, "{name}");
        assert_eq!(envelope.outcome, *expected_outcome, "{name}");
        assert_eq!(envelope.transport, *expected_transport, "{name}");
        assert!(envelope.operation_id.starts_with("op_"), "{name}");
    }
}

#[test]
fn non_envelope_protocol_fixtures_have_the_frozen_schema_names() {
    let fixtures = [
        ("status-dto.json", schema::STATUS),
        ("list-dto.json", schema::LIST),
        ("guide-dto.json", schema::ENVELOPE),
        ("next-dto.json", schema::ENVELOPE),
        ("receipt-success.json", schema::RECEIPT),
        ("receipt-failure.json", schema::RECEIPT),
        ("gate-diagnostics.json", schema::GATE_DIAGNOSTICS),
        ("error-registry.json", schema::ERROR_REGISTRY),
    ];
    for (name, expected_schema) in fixtures {
        let path = format!("../../../project/spec/protocol/{name}");
        let json: Value = serde_json::from_str(match name {
            "status-dto.json" => include_str!("../../../project/spec/protocol/status-dto.json"),
            "list-dto.json" => include_str!("../../../project/spec/protocol/list-dto.json"),
            "guide-dto.json" => include_str!("../../../project/spec/protocol/guide-dto.json"),
            "next-dto.json" => include_str!("../../../project/spec/protocol/next-dto.json"),
            "receipt-success.json" => {
                include_str!("../../../project/spec/protocol/receipt-success.json")
            }
            "receipt-failure.json" => {
                include_str!("../../../project/spec/protocol/receipt-failure.json")
            }
            "gate-diagnostics.json" => {
                include_str!("../../../project/spec/protocol/gate-diagnostics.json")
            }
            "error-registry.json" => {
                include_str!("../../../project/spec/protocol/error-registry.json")
            }
            _ => unreachable!(),
        })
        .unwrap_or_else(|error| panic!("{path}: {error}"));
        assert_eq!(json["schema_version"], expected_schema, "{name}");
    }
}

#[test]
fn unknown_additive_fields_are_ignored() {
    let mut value: Value = serde_json::from_str(fixture("envelope-empty.json")).unwrap();
    value["new_future_field"] = json!({"must_not_be_policy": true});
    value["error"] = Value::Null;
    let envelope: Envelope<Value> = serde_json::from_value(value).unwrap();
    envelope.validate().unwrap();
}

#[test]
fn wrong_version_is_rejected_after_json_decoding() {
    let mut value: Value = serde_json::from_str(fixture("envelope-empty.json")).unwrap();
    value["api_version"] = json!("1");
    let envelope: Envelope<Value> = serde_json::from_value(value).unwrap();
    assert!(matches!(
        envelope.validate(),
        Err(ProtocolValidationError::ApiVersionMismatch { .. })
    ));
}

#[test]
fn unknown_error_code_fails_closed() {
    let mut value: Value = serde_json::from_str(fixture("envelope-invalid.json")).unwrap();
    value["error"]["code"] = json!("future_policy_code");
    let result = serde_json::from_value::<Envelope<Value>>(value);
    assert!(result.is_err());
}

#[test]
fn typed_error_and_request_round_trip() {
    let error = ProtocolError::new(ErrorCode::InvalidArgument, "bad input", false);
    let request = RequestEnvelope::new("op_test_01", json!({"command": "status"}));
    request.validate().unwrap();
    let encoded = serde_json::to_string(&request).unwrap();
    let decoded: RequestEnvelope<Value> = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, request);
    assert_eq!(error.code.as_str(), "invalid_argument");
}

#[test]
fn every_registered_error_code_is_typed() {
    let registry: Value = serde_json::from_str(include_str!(
        "../../../project/spec/protocol/error-registry.json"
    ))
    .unwrap();
    let entries = registry["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 69);
    for entry in entries {
        let code = entry["code"].as_str().unwrap();
        assert_eq!(code.parse::<ErrorCode>().unwrap().as_str(), code);
    }
}

#[test]
fn capabilities_negotiate_versions_and_common_features() {
    let client = CapabilitySet {
        api_versions: vec!["2".into(), "1".into()],
        schema_versions: vec!["boreal.protocol.envelope.v1".into()],
        capabilities: vec!["detail_ref".into(), "events".into()],
    };
    let server = CapabilitySet {
        api_versions: vec!["2".into()],
        schema_versions: vec!["boreal.protocol.envelope.v1".into()],
        capabilities: vec!["events".into()],
    };
    let negotiated = client.negotiate(&server).unwrap();
    assert_eq!(negotiated.api_version, "2");
    assert_eq!(negotiated.capabilities, vec!["events"]);
}

#[test]
fn malformed_json_is_distinguished_from_validation_failure() {
    assert!(matches!(
        Envelope::<Value>::from_json("{"),
        Err(ProtocolParseError::Json(_))
    ));
}
