# PF-S02-T11 — attempt 34 evidence

## Exact source identity

- Git `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Working tree: dirty by design; no commit or push in this lane.
- Scoped file SHA-256 values at validation time:

| File | SHA-256 |
| --- | --- |
| `crates/cli/src/main.rs` | `a32057edec4e9e4a548ad0441f320b245a1c4a14630105f342e16d0ba49528cd` |
| `crates/cli/src/service.rs` | `c562b0b48bbbfb763a24af334756b8e31c2e039a39ee4e9e2dde0e87563d67de` |

## Bounded changes

- Goal-less `next`, direct status, direct goal-less `start`, and service goal-less `start` use a compatibility selection hint when the legacy status read reports unavailable v3 identity facts. The actual claim/start mutation remains the canonical application/store transaction and can reject the candidate.
- Status envelopes retain server-derived action decisions, but inline serialization includes the action subset consumed by the current terminal client. This keeps paginated status within the 65,536-byte protocol bound without changing domain policy or making the TUI authoritative.

## Results

- `direct_status_uses_derived_hierarchy_and_readiness`: passed.
- `no_goal_next_emits_one_required_contract_valid_action`: passed.
- `no_goal_start_selects_and_starts_a_claimable_task`: passed.
- `service_start_without_work_selects_a_claimable_task`: passed.
- Full `boreal-cli`: 120 passed, 1 ignored.
- Release acceptance status/doctor bounded-payload test: passed.
- Formatting and `git diff --check`: passed.

## Residual limits

This is not PF-S02 acceptance. The CLI strict-Clippy baseline remains outside this scoped diff, native Unix-socket validation can be unavailable in the sandbox, and full production identity/authentication, verifier recovery, and backup/restore acceptance remain open for their owning tasks.
