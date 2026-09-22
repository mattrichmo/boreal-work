//! Deterministic semantic identities for durable operations.
//!
//! Operation IDs identify one logical intent. The digest below identifies the
//! complete, versioned semantic request attached to that intent. Transport
//! details such as socket paths and local receipt filenames do not belong in
//! the request payload; their immutable content identities do.

use boreal_store::{
    identity::IdentityContext, AuditEventRecord, OperationReadback, OperationRecord, SqliteStore,
    StoreError,
};
use serde_json::{Map, Value};

use crate::{ApplicationError, WorkApplication};

const DIGEST_PREFIX: &str = "sha256:";

pub fn canonical_request_digest(command: &str, payload: Value) -> String {
    let canonical = canonicalize(Value::Object(Map::from_iter([
        ("command".to_owned(), Value::String(command.to_owned())),
        ("payload".to_owned(), payload),
        (
            "schema".to_owned(),
            Value::String("boreal.operation-request.v1".to_owned()),
        ),
    ])));
    let bytes = serde_json::to_vec(&canonical).expect("JSON values always serialize");
    format!("{DIGEST_PREFIX}{}", hex(&sha256(&bytes)))
}

/// Content identity for immutable bytes referenced by proof and summary facts.
pub fn sha256_content_digest(bytes: &[u8]) -> String {
    format!("{DIGEST_PREFIX}{}", hex(&sha256(bytes)))
}

/// Application-owned port for consequential operation journal access.
///
/// The caller must provide the authenticated, project/database/workspace-bound
/// context obtained by the adapter's authentication/session boundary. There
/// is deliberately no constructor that accepts only a project identifier, and
/// every append/readback is delegated to the store's identity-bound journal.
/// This keeps CLI and service handlers from accidentally falling back to an
/// unbound operation write or lookup.
pub struct AuthenticatedOperationJournal<'a> {
    store: &'a SqliteStore,
    identity: &'a IdentityContext,
}

impl<'a> AuthenticatedOperationJournal<'a> {
    pub(crate) const fn new(store: &'a SqliteStore, identity: &'a IdentityContext) -> Self {
        Self { store, identity }
    }

    pub fn project_id(&self) -> &str {
        &self.identity.project_id
    }

    pub fn append(
        &self,
        operation: OperationRecord,
        audit: AuditEventRecord,
    ) -> Result<OperationReadback, ApplicationError> {
        if operation.project_id != self.identity.project_id {
            return Err(ApplicationError::Store(StoreError::WrongSubject {
                expected: self.identity.project_id.clone(),
                actual: operation.project_id,
            }));
        }
        if audit.project_id != self.identity.project_id {
            return Err(ApplicationError::Store(StoreError::WrongSubject {
                expected: self.identity.project_id.clone(),
                actual: audit.project_id,
            }));
        }
        self.store
            .append_identity_operation_audit(self.identity, operation, audit)
            .map_err(ApplicationError::from)
    }

    /// Read an operation in the authenticated project without requiring the
    /// caller to guess its immutable fields. This is for recovery/subject
    /// discovery; replay validation must still compare the returned record to
    /// the complete request identity before reusing it.
    pub fn readback(
        &self,
        operation_id: &str,
    ) -> Result<Option<OperationReadback>, ApplicationError> {
        boreal_store::operations::OperationJournal::new(self.store)
            .readback_in_context(self.identity, operation_id)
            .map_err(ApplicationError::from)
    }

    /// Reads the audit envelope through the same project/database identity as
    /// the operation readback. Finish-close recovery uses this to distinguish
    /// its immutable intent/result pair from an unrelated operation that was
    /// given a colliding identifier.
    pub fn audit_event(
        &self,
        operation_id: &str,
    ) -> Result<Option<AuditEventRecord>, ApplicationError> {
        boreal_store::operations::OperationJournal::new(self.store)
            .audit_event_in_context(self.identity, operation_id)
            .map_err(ApplicationError::from)
    }
}

impl WorkApplication<'_> {
    pub fn authenticated_operation_journal<'a>(
        &'a self,
        identity: &'a IdentityContext,
    ) -> AuthenticatedOperationJournal<'a> {
        AuthenticatedOperationJournal::new(self.store, identity)
    }
}

fn canonicalize(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonicalize(value)))
                    .collect(),
            )
        }
        value => value,
    }
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(HEX[(byte >> 4) as usize] as char);
        result.push(HEX[(byte & 0x0f) as usize] as char);
    }
    result
}

fn sha256(input: &[u8]) -> [u8; 32] {
    let mut state = [
        0x6a09e667_u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut words = [0_u32; 64];
        for (index, word) in chunk.chunks_exact(4).enumerate() {
            words[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for (index, constant) in SHA256_ROUND_CONSTANTS.iter().enumerate() {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(*constant)
                .wrapping_add(words[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut result = [0_u8; 32];
    for (chunk, word) in result.chunks_exact_mut(4).zip(state) {
        chunk.copy_from_slice(&word.to_be_bytes());
    }
    result
}

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sha256_matches_the_empty_vector() {
        assert_eq!(
            sha256_content_digest(b""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn canonical_digest_sorts_objects_and_preserves_punctuation() {
        let left = canonical_request_digest("work.create/v1", json!({"b": 2, "a": "x-y"}));
        let reordered = canonical_request_digest("work.create/v1", json!({"a": "x-y", "b": 2}));
        let punctuation = canonical_request_digest("work.create/v1", json!({"a": "x_y", "b": 2}));
        let other_command =
            canonical_request_digest("project.init/v1", json!({"a": "x-y", "b": 2}));
        assert_eq!(left, reordered);
        assert_ne!(left, punctuation);
        assert_ne!(left, other_command);
        assert_eq!(left.len(), DIGEST_PREFIX.len() + 64);
    }
}
