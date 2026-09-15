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
