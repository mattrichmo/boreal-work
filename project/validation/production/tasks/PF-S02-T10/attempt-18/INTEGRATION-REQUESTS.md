# PF-S02-T10 attempt 18 — integration requests

## 1. Complete the protected application status integration — required owner

The concurrent PF-S03-T10 status/domain stream added `activation_at` and
`schedule` to `boreal_domain::StatusContext`. The store adapter has now been
reconciled in `crates/store/src/status_evaluation.rs:193-204`. The remaining
protected callsite is `crates/application/src/status.rs:291`.

Owner: PF-S03-T10/application integration steward. Copy the store row's
canonical `schedule` and `activation_at` into `StatusWorkInput`, or use the
accepted unavailable representation; do not invent fixture-only values. The
same application check also reports E0505 at `crates/application/src/evidence.rs:687`.
This attempt does not edit either protected path.

## 2. Resolve the two full-suite profile assertion failures

`cargo test --locked --offline -p boreal-store` reaches all targets but fails:

- `missing_pinned_child_is_detected_instead_of_reducing_requirements` at
  `crates/store/tests/production_profile_requirements.rs:576`;
- `malformed_pinned_profile_and_child_content_is_quarantined_on_readback` at
  `crates/store/tests/production_profile_requirements.rs:614`.

Next store reviewer: inspect the exact `read_pinned_requirements` error/result
after the read-only schema change and restore the fail-closed diagnostics
without weakening digest validation. Do not change the tests to accept a less
strict result.

## 3. Revalidate the production integration target

Once compilation is repaired, run on the exact combined source revision:

```sh
cargo test --locked --offline -p boreal-store --test production_store_seams
cargo test --locked --offline -p boreal-store --test production_integration
cargo test --locked --offline -p boreal-store
cargo clippy --locked --offline -p boreal-store --lib -- -D warnings
cargo fmt --all -- --check
python3 project/spec/validate_contracts.py
git diff --check
```

An independent reviewer must inspect the resulting diff and confirm that
terminal attempt mutations and close finalization cannot reuse a canonical
resource before release acknowledgement. The reviewer must also exercise the
fresh/upgrade/reopen and identity-bound replay cases from the new target.

## 4. Broader protected callsites remain separate

Application/service/memory/update external-job callsites from PF-S02-T11 remain
outside this attempt and must not be treated as fixed by these store changes.
Any direct non-store lifecycle writers discovered during review require a new
coordinator-owned integration request; do not silently expand attempt-18.
