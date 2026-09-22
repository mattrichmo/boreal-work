# R-APP-OP — crates/application/src/operation_identity.rs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `crates/application/src/operation_identity.rs:L1–L162`  
**File SHA-256:** `793564334df21b753e4b3566a14478fa6d4444158e0b993f75536fe4cfe8c464`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Operation identity and replay binding; retain command, actor, subject and request digest semantics.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,162p' 'crates/application/src/operation_identity.rs'
```

## Exact baseline excerpt

````text
    1 | //! Deterministic semantic identities for durable operations.
    2 | //!
    3 | //! Operation IDs identify one logical intent. The digest below identifies the
    4 | //! complete, versioned semantic request attached to that intent. Transport
    5 | //! details such as socket paths and local receipt filenames do not belong in
    6 | //! the request payload; their immutable content identities do.
    7 | 
    8 | use serde_json::{Map, Value};
    9 | 
   10 | const DIGEST_PREFIX: &str = "sha256:";
   11 | 
   12 | pub fn canonical_request_digest(command: &str, payload: Value) -> String {
   13 |     let canonical = canonicalize(Value::Object(Map::from_iter([
   14 |         ("command".to_owned(), Value::String(command.to_owned())),
   15 |         ("payload".to_owned(), payload),
   16 |         (
   17 |             "schema".to_owned(),
   18 |             Value::String("boreal.operation-request.v1".to_owned()),
   19 |         ),
   20 |     ])));
   21 |     let bytes = serde_json::to_vec(&canonical).expect("JSON values always serialize");
   22 |     format!("{DIGEST_PREFIX}{}", hex(&sha256(&bytes)))
   23 | }
   24 | 
   25 | /// Content identity for immutable bytes referenced by proof and summary facts.
   26 | pub fn sha256_content_digest(bytes: &[u8]) -> String {
   27 |     format!("{DIGEST_PREFIX}{}", hex(&sha256(bytes)))
   28 | }
   29 | 
   30 | fn canonicalize(value: Value) -> Value {
   31 |     match value {
   32 |         Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
   33 |         Value::Object(values) => {
   34 |             let mut entries = values.into_iter().collect::<Vec<_>>();
   35 |             entries.sort_by(|left, right| left.0.cmp(&right.0));
   36 |             Value::Object(
   37 |                 entries
   38 |                     .into_iter()
   39 |                     .map(|(key, value)| (key, canonicalize(value)))
   40 |                     .collect(),
   41 |             )
   42 |         }
   43 |         value => value,
   44 |     }
   45 | }
   46 | 
   47 | fn hex(bytes: &[u8]) -> String {
   48 |     const HEX: &[u8; 16] = b"0123456789abcdef";
   49 |     let mut result = String::with_capacity(bytes.len() * 2);
   50 |     for byte in bytes {
   51 |         result.push(HEX[(byte >> 4) as usize] as char);
   52 |         result.push(HEX[(byte & 0x0f) as usize] as char);
   53 |     }
   54 |     result
   55 | }
   56 | 
   57 | fn sha256(input: &[u8]) -> [u8; 32] {
   58 |     let mut state = [
   59 |         0x6a09e667_u32,
   60 |         0xbb67ae85,
   61 |         0x3c6ef372,
   62 |         0xa54ff53a,
   63 |         0x510e527f,
   64 |         0x9b05688c,
   65 |         0x1f83d9ab,
   66 |         0x5be0cd19,
   67 |     ];
   68 |     let bit_len = (input.len() as u64).wrapping_mul(8);
   69 |     let mut padded = input.to_vec();
   70 |     padded.push(0x80);
   71 |     while padded.len() % 64 != 56 {
   72 |         padded.push(0);
   73 |     }
   74 |     padded.extend_from_slice(&bit_len.to_be_bytes());
   75 | 
   76 |     for chunk in padded.chunks_exact(64) {
   77 |         let mut words = [0_u32; 64];
   78 |         for (index, word) in chunk.chunks_exact(4).enumerate() {
   79 |             words[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
   80 |         }
   81 |         for index in 16..64 {
   82 |             let s0 = words[index - 15].rotate_right(7)
   83 |                 ^ words[index - 15].rotate_right(18)
   84 |                 ^ (words[index - 15] >> 3);
   85 |             let s1 = words[index - 2].rotate_right(17)
   86 |                 ^ words[index - 2].rotate_right(19)
   87 |                 ^ (words[index - 2] >> 10);
   88 |             words[index] = words[index - 16]
   89 |                 .wrapping_add(s0)
   90 |                 .wrapping_add(words[index - 7])
   91 |                 .wrapping_add(s1);
   92 |         }
   93 |         let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
   94 |         for (index, constant) in SHA256_ROUND_CONSTANTS.iter().enumerate() {
   95 |             let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
   96 |             let choice = (e & f) ^ ((!e) & g);
   97 |             let temp1 = h
   98 |                 .wrapping_add(s1)
   99 |                 .wrapping_add(choice)
  100 |                 .wrapping_add(*constant)
  101 |                 .wrapping_add(words[index]);
  102 |             let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
  103 |             let majority = (a & b) ^ (a & c) ^ (b & c);
  104 |             let temp2 = s0.wrapping_add(majority);
  105 |             h = g;
  106 |             g = f;
  107 |             f = e;
  108 |             e = d.wrapping_add(temp1);
  109 |             d = c;
  110 |             c = b;
  111 |             b = a;
  112 |             a = temp1.wrapping_add(temp2);
  113 |         }
  114 |         for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
  115 |             *slot = slot.wrapping_add(value);
  116 |         }
  117 |     }
  118 | 
  119 |     let mut result = [0_u8; 32];
  120 |     for (chunk, word) in result.chunks_exact_mut(4).zip(state) {
  121 |         chunk.copy_from_slice(&word.to_be_bytes());
  122 |     }
  123 |     result
  124 | }
  125 | 
  126 | const SHA256_ROUND_CONSTANTS: [u32; 64] = [
  127 |     0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  128 |     0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  129 |     0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  130 |     0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  131 |     0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  132 |     0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  133 |     0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  134 |     0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  135 | ];
  136 | 
  137 | #[cfg(test)]
  138 | mod tests {
  139 |     use super::*;
  140 |     use serde_json::json;
  141 | 
  142 |     #[test]
  143 |     fn sha256_matches_the_empty_vector() {
  144 |         assert_eq!(
  145 |             sha256_content_digest(b""),
  146 |             "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  147 |         );
  148 |     }
  149 | 
  150 |     #[test]
  151 |     fn canonical_digest_sorts_objects_and_preserves_punctuation() {
  152 |         let left = canonical_request_digest("work.create/v1", json!({"b": 2, "a": "x-y"}));
  153 |         let reordered = canonical_request_digest("work.create/v1", json!({"a": "x-y", "b": 2}));
  154 |         let punctuation = canonical_request_digest("work.create/v1", json!({"a": "x_y", "b": 2}));
  155 |         let other_command =
  156 |             canonical_request_digest("project.init/v1", json!({"a": "x-y", "b": 2}));
  157 |         assert_eq!(left, reordered);
  158 |         assert_ne!(left, punctuation);
  159 |         assert_ne!(left, other_command);
  160 |         assert_eq!(left.len(), DIGEST_PREFIX.len() + 64);
  161 |     }
  162 | }
````
