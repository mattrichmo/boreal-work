# PF-S03-T10 attempt 10 — start

- Task: PF-S03-T10, deterministic oracle coverage for status and transitions.
- Worker scope: pure-domain validation only.
- Input source revision: `5584d461a8192cd06999f14069b3fe590b059406`.
- Source state: dirty. This attempt added only its new test/evidence files;
  unrelated pre-existing CLI/TUI changes were present in
  `crates/cli/src/main.rs` and `apps/tui/src/client.ts`, and the local
  `memory/` runtime directory was not inspected or modified.
- Allowed implementation path: `crates/domain/tests/production_*`.
- Allowed evidence path: this attempt directory.
- Off-limits: production source, `STATE.json`, plan graph, acceptance ledger,
  and `memory/`.

## Intended invariant

For one canonical pure-domain input, status precedence, reasons, deadlines,
dependency exceptions, and action descriptors must be deterministic. An
override/waiver may change the scoped decision while retaining the original
failed or open fact; it must not manufacture a passing upstream outcome.

## Planned coverage

- table-driven terminal, expiry, hard-block, queued, scheduled, and ready
  precedence;
- primary reason first with stable secondary reasons retained;
- exact lease/hard-budget equality and expiry-pending → expired recovery;
- edge-scoped waiver truth preservation and revocation;
- deterministic action descriptors and status-specific claim authorization.
