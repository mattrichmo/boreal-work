# PF-S03-T09 attempt 1 — evidence record

Evidence class: pure domain / bounded integration contract.

Input source commit: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`.

Working tree state: dirty. Relevant source hashes at execution:

| Path | SHA-256 |
| --- | --- |
| `crates/domain/src/lib.rs` | `ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c` |
| `crates/domain/src/actions.rs` | `8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7` |
| `crates/domain/src/status_evaluator.rs` | `3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f` |
| `crates/domain/tests/production_domain_api.rs` | `d407b3dceffd1349485c23b4d3aad4f145b43154a31769947eb4923201b600b0` |
| `project/spec/production/status-and-actions.md` | `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94` |
| `project/spec/production/service-contract.md` | `2eda4da55262f0f068487d0a16becf8d1bc648bdef7d2da4fc3508e9ea30a3a3` |

Host: macOS local workspace, Rust/Cargo offline locked mode. No service,
database, terminal, package or real verifier was used.

## Positive checks

- Six focused T09 contract tests passed. They cover descriptor identity and
  project/entity revision bindings, complete action partition and descriptor
  round-trip, status-reason-driven authority, safe recovery under a hold,
  stale project/entity/proof/fence denial, and quarantined repair versus
  forward progress.
- Full `boreal-domain` tests passed: 140 tests passed across unit, status,
  acceptance, decision-input, dependency, action, property, rollup, time and
  work-model targets; the new target contributed 6 passing tests and 1 ignored
  witness.
- Strict domain Clippy, formatting and diff checks passed.
- `boreal-application` and `boreal-cli` compiled in locked offline mode.

## Retained failure

The ignored test
`ordinary_operator_status_and_action_claimability_are_one_contract` was run
explicitly with `--ignored` and failed with:

```text
assertion `left == right` failed: status and action projections must agree
left: true
right: false
```

This is PF-S03-R7, not a harness normalization. The status evaluator reports
ordinary Operator work as claimable, while `actions::required_roles` denies
ordinary Claim to Operator and requires Agent. The test remains ignored in
the normal target solely so the bounded positive suite stays runnable while
the coordinator resolves the policy choice.

## Integration limits

The task could not prove PF-S03-R1 through R6 because their writers are
coordinator-managed application/store/service/TUI paths. The exact required
patches are in `project/validation/production/domain/api-handoff.md`.
No fixture-only test is presented as service acceptance.
