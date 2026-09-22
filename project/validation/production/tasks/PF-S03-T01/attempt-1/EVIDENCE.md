# PF-S03-T01 attempt 1 — evidence

## Record and evidence class

- Task / attempt: `PF-S03-T01` / `attempt-1`.
- Evidence class: pure domain source and focused deterministic tests.
- Acceptance scope: PF-S03-T01 implementation evidence only; not coordinator acceptance.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree.
- Contract prerequisite: PF-S01-T92 attempt 3 accepted for AC-01 only.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Host/toolchain: `Darwin arm64`; `rustc 1.85.0`; `cargo 1.85.0`.

## Implemented invariant

`decision_inputs.rs` defines a pure canonical decision-input envelope with:

- non-convertible `EntityRevision`, `ProofRevision`, and `AttemptFence` newtypes;
- entity, attempt, profile, and proof identities bound to source,
  configuration, policy, and proof generation;
- typed lifecycle, authenticated/delegated actor authority, pinned requirements,
  dependency outcomes, holds, execution, sealed submissions, reviews, and
  unresolved recovery facts;
- `Fact<T>` variants for `Present`, `Absent`, `Unreadable`, `Stale`, and
  `Failed`, each carrying an explicit typed diagnostic;
- an injected `EvaluationClock` containing `evaluated_at` and an optional next
  change time;
- independent `Availability`, scoped integrity input, and permitted/denied
  action input types; and
- structural validation that reports foreign identities, contradictory terminal
  state, invalid proof/fence bindings, malformed proof context, duplicate facts,
  self-review, unsafe recovery disposition, and action conflicts explicitly.

The module imports only existing domain value types and standard collections;
it has no store, service, process, terminal, JSON, or transport dependency.

## Focused test assertions

The ten focused tests cover valid builders, injected clock preservation,
revision/fence non-interchangeability, all four unavailable fact states,
required versus optional absence, terminal/action contradictions, malformed
proof context, proof-revision/current-execution mismatch, transport-independent
integrity/action inputs, and cross-project dependency/proof rejection.

Observed final result: `cargo test --locked -p boreal-domain --test
production_decision_inputs` — `10 passed, 0 failed`.

## Exact final artifacts

- `crates/domain/src/decision_inputs.rs` SHA-256:
  `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d`
- `crates/domain/tests/production_decision_inputs.rs` SHA-256:
  `2f936e3f58fc8c0531f04f3037abfae779767432b93453e37161df6a1f64f8af`
- `project/validation/production/tasks/PF-S03-T01/attempt-1/START.md` SHA-256:
  `eb2b1cc4788b52d767fb6e85acf494ba533fe0169bb6871bd5ce0a1b0818ef75`

## Limits and failed/blocked observations

The strict clippy command without an exception remains blocked by one existing
warning in the protected `crates/domain/src/status_evaluator.rs`; no source
change was made to hide or repair it. The assigned module/test passed with only
that named lint allowed. `bwrk prime boreal-work --json` returned typed
`service_busy` because another process owns the local database; no runtime
evidence was inferred from that result. The finish-skill workflow resolution
`bwrk workflows show boreal.workflow.finish.v1 --json` returned the same typed
`service_busy`; no application-owned evidence attachment, finish, close, or
release action was attempted.

No service/runtime/release evidence is claimed. The test-path shim exists only
because `crates/domain/src/lib.rs` is a protected shared file and this worker
was not permitted to register the new module there.

## Coordinator combined-tree integration

The coordinator registered the module in the public domain crate root and
removed the test-only source-path shim. The integrated focused test, complete
domain package tests, workspace formatting check, and domain test-target check
all pass. This supersedes the worker-only shim limitation for the combined
tree, while preserving the worker's original evidence and its clippy/runtime
limits.
