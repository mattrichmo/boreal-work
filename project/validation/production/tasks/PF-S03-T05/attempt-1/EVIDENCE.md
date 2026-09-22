# PF-S03-T05 attempt 1 — evidence

## Record and evidence class

- Record: `PF-S03-T05 / attempt-1`.
- Evidence class: pure domain source, public-module integration, and focused
  deterministic unit tests.
- Input source: dirty combined tree at HEAD
  `784a41b3802c29a76721c55eef2e9493283396c2` on
  `codex/apply-responsive-terminal-overlay`; this is not a release identity.
- Contract identity: `project/spec/production/contract-manifest.json` SHA-256
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- Dependency contract SHA-256:
  `3543fb5f1c3af51304826c66e02a3eb10dd0c1972cc35e77585c1b43a5a0a151`.
- Accepted prerequisite handoffs:
  - PF-S01-T92 attempt 3:
    `ba94da456f397b9250a9fde5a55ad6c4479834bfd55af6c4fc0dbeb22ef84e2a`.
  - PF-S03-T01 attempt 2:
    `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
  - PF-S03-T04 attempt 4:
    `9f2fbe7a8535e10934d70ab7b119e2e0657a83214047be500ebac2ab9aed427d`.
- Setup: pure in-process Rust inputs; no service, database, external verifier,
  native package, publication channel, or live lifecycle operation.
- Runtime: Darwin arm64; Rust `1.85.0`; Cargo `1.85.0`.

## Implemented contract behavior

`crates/domain/src/dependencies.rs` provides a public pure policy boundary for:

1. project-scoped canonical graph construction with direct-task-only endpoint
   validation;
2. deterministic duplicate node/edge/endpoint, missing endpoint, self-edge,
   foreign project, unsupported endpoint kind, and cycle rejections;
3. accepted-closed-only satisfaction bound to exact `EntityIdentity` and
   `ProofRevision`, with complete/verified/cancelled/open/failed, unaccepted,
   stale-identity, and revoked outcomes remaining unsatisfied;
4. edge-revision and successor-scoped waivers with validity/revocation
   boundaries, while `EdgeEvaluation` retains the raw outcome and waiver
   context;
5. deterministic direct/transitive affected-subgraph output; and
6. pure reopen, accepted-outcome revocation, and waiver-revocation impact
   previews that classify pending, active, historically closed, and cancelled
   successors, preserve historical facts, and propagate only through current
   accepted-close references.

`crates/domain/tests/production_dependency_policy.rs` exercises the public
`boreal_domain::dependencies` module after coordinator registration. The 11
focused cases cover endpoint/scope policy, duplicate/self/cycle determinism,
accepted-close identity, raw unmet outcomes, edge-specific waiver scope and
revocation, insertion-order-invariant affected subgraphs, pending/active/
historical reopen impact, outcome revocation, waiver revocation propagation,
malformed observations, and missing observations.

## Exact observed results

- `cargo check --locked -p boreal-domain --test production_dependency_policy`:
  exit `0`.
- `cargo test --locked -p boreal-domain --test production_dependency_policy --
  --test-threads=1`: exit `0`; `11 passed, 0 failed, 0 ignored`.
- `rustfmt --check` on both owned Rust files: exit `0`.
- `cargo check --locked -p boreal-domain --tests`: exit `0`.
- `git diff --check`: exit `0`.
- Current combined-tree revalidation after coordinator reconciliation:
  `cargo fmt --all -- --check`, `cargo check --locked -p boreal-domain --tests`,
  `cargo test --locked -p boreal-domain`,
  `cargo clippy --locked -p boreal-domain --tests -- -D warnings`, and
  `git diff --check` all exited `0`.
- The full domain test run completed all targets successfully; the focused
  dependency-policy target reported `11 passed, 0 failed`.
- An earlier combined-tree capture had the shared `lib.rs` order and
  `time_policy.rs:398` compile blockers; those are retained in
  `COMMANDS.md` as historical results and were resolved by the coordinator
  before the final revalidation.

Raw command details and source/runtime identity are retained in
`COMMANDS.md`. Owned source hashes at final capture are:

- `crates/domain/src/dependencies.rs`:
  `fd383467d213bcb956c9e54b92e1a2feae0397ee8f9443b394b15bbda2490cf8`.
- `crates/domain/tests/production_dependency_policy.rs`:
  `434e3cac5f04bfc886ff7c94b94ad0b06703e8f464387bacd6730c18ceeef555`.

## Limitations and authority boundary

- This is not task, sprint, service, native, publication, or release
  acceptance. Coordinator/reviewer/revalidation decisions remain outstanding.
- The current full-domain gates pass, but they are combined-tree evidence and
  do not replace independent review or task-level acceptance.
- The coordinator reconciled `lib.rs` module ordering and the
  `time_policy.rs:398` compile issue; this worker did not edit either shared
  production file.
- Existing duplicate dependency helpers in legacy/schema-2-facing domain
  code remain untouched by this bounded task. The coordinator/application
  integration must select this versioned policy boundary for production
  dependency decisions rather than silently retaining a second authority.
- Boreal workflow resolution was `service_busy`; no lock was broken and no
  state-changing workflow command was attempted.

No secrets, synthetic service receipts, fabricated runtime output, or
acceptance claims are included.
