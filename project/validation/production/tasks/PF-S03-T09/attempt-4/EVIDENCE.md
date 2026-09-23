# PF-S03-T09 — attempt 4 evidence

## Source binding

- Input finding reviewed: exact-review findings for 5584d461a8192cd06999f14069b3fe590b059406.
- Current HEAD: 6d2ded13616615ef7866695b6ac5fe1341583db8.
- Working tree: dirty; this attempt is file-bound and uncommitted.
- No plan/state/ledger/memory/store path was edited by this attempt.

Scoped source hashes at evidence capture:

| File | SHA-256 |
| --- | --- |
| crates/application/src/status.rs | 85e83bd8a1ea72521dc24864f90166023daff22298b25e3495c15850435993b3 |
| crates/cli/src/main.rs | 5c78e8e0d6a7bb328d13f2ea6b422ff43229eeff550bb9fa894c6dafe6ecc4e9 |
| apps/tui/src/client.ts | 92dd8ee1393e36281467c9d814f1347c95765191e684f9354da486cf93a08707 |
| apps/tui/src/test.ts | 894956eb3eaeb741e986c08e25d767b78de64beebcdf23ca66c27478df247188 |

## Remediation

### Application bridge

- StatusWork.actions is optional for the legacy projection.
- The bridge no longer constructs sentinel entity revisions, fake proof
  subjects, or an unavailable action decision from fabricated facts.
- StatusWork.claimable_for_actor() uses the legacy deterministic readiness hint
  only when no canonical action set exists. When an action set is present, it
  uses that set and therefore remains fail-closed.
- The application test explicitly verifies unavailable context, absent
  descriptors, and retained discovery claimability.

### CLI/service compatibility

- The shared status_item_json serializer now emits actions: null for the
  legacy unavailable context and preserves action_context.state plus its
  missing-fact list.
- claimable and claimable_for_actor use the same application bridge value, so
  a legacy row no longer reports true while a serialized action set says Claim
  is denied.
- Direct and service status routes both use this shared serializer.
- Status/2 continues to encode expired_review as blocked; the richer
  display_status, primary_reason, and ordered reason_codes retain the expiry
  recovery meaning.

### TUI compatibility and safety

- actions: null is treated as the absent legacy path; a present action set
  remains authoritative and disables denied actions.
- A status/2 blocked row with structured expiry reasons such as
  expiry_review_required, lease_elapsed, or hard_budget_elapsed is normalized
  to expired_review for recovery presentation.
- TUI action descriptors are rejected when their target does not match the
  containing work row, preventing a valid descriptor from being applied to a
  different selectable identity.
- Tests cover the exact CLI-shaped legacy JSON, expiry presentation and
  disabled recovery reason, descriptor target mismatch, and the existing
  server-denial/server-allowance behavior.

## Validation disposition

- Focused Rust application/CLI checks: passed.
- Real CLI JSON to compiled TUI decoder: passed.
- TUI typecheck: passed.
- TUI suite: 98/98 passed with local Unix-socket permission.
- Formatting and git diff --check: passed for this scope.
- Full CLI suite: not green because an unrelated project-setup integration
  test failed after 82 unit tests and several integration groups passed. This
  attempt does not claim a full workspace or release pass.

## Residual boundaries

This remediation does not claim that the store now supplies v3 entity/proof/
session facts, nor does it authorize legacy status hints to perform a
mutation. Claim/start mutations still pass through their canonical Rust
transactional routes. PF-S03-T09 independent review and PF-S03-T90/T91/T92
remain required; no plan or acceptance state was changed here.
