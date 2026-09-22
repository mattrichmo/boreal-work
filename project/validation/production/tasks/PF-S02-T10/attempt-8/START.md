# PF-S02-T10 attempt 8 — bounded recovery resolution

- Worker scope: identity-bound, revision/fence-aware, idempotent recovery resolution.
- Allowed source scope: `crates/store/src/recovery.rs` and the focused recovery test target.
- Protected scope: `crates/store/src/lib.rs`, application, CLI, `execution/STATE.json`, and the plan manifest.
- Acceptance boundary: this is a bounded store contribution only. It does not claim full PF-S02-T10 or PF-S02-T06 completion.
- Existing compatibility: the legacy `resolve_recovery_obligation` method remains unchanged for existing callers.
- No direct database access was added outside the store boundary.
