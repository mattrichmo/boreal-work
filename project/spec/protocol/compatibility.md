# Protocol compatibility fixture

Protocol version `2` uses `boreal.protocol.envelope.v1` and fixture revision
`p0-03.v2`. A client must negotiate the protocol before mutation. An
unsupported major version returns `invalid_argument` with no state change;
an unsupported optional field is ignored after validation and is never
interpreted as policy. Required fields, enum values, identity bindings,
revision, and fence rules are strict. Unknown mutation outcomes require
operation-id readback before retry.

The Rust CLI, local service, TUI, and fixture client consume these same JSON
examples. They do not maintain adapter-specific transition or DTO contracts.

## M02 candidate additive status field

`primary_reason` is optional when decoding old `boreal.status.v1` rows. New
status responses include it and repeat it at `reason_codes[0]`, followed by
deduplicated lexical secondary codes. The TUI preserves that ordering, rejects
a contradictory primary field, and never uses it to override claimability.
The envelope/API major and SQLite schema remain unchanged. New domain reason
codes are read vocabulary, not supported override commands. Gate force, waiver,
cycle operations and full M02 public parity remain unavailable unless explicitly
listed by the executable command registry.
