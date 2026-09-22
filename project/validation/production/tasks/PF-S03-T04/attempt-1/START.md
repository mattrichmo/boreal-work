# PF-S03-T04 attempt 1 — start record

## Task and source identity

- Task: `PF-S03-T04` — implement requirement, evidence and review interpretation.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Source state: dirty combined tree; `git status --porcelain=v1` reported 64 entries at final evidence capture. The dirty state predates this task and includes the accepted PF-S03-T01 integration plus unrelated work.
- Host/toolchain: Darwin arm64; `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Accepted PF-S03-T01 review handoff: `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md`, SHA-256 `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.

## Prerequisite and interpreted invariant

The accepted PF-S03-T01 handoff supplies public typed identities for entity,
proof, attempt/fence, profile, and proof context. This task consumes those
types and does not reopen PF-S01 policy. The implementation treats a pinned
requirement declaration, an observation, a review decision, and an exception
as separate append-only facts.

The bounded invariant is: proof candidates must match the complete accepted
subject and declaration identity before recency selection; deleted,
mismatched, missing, failed, stale, altered, and irrelevant facts remain
distinct; a valid operator exception changes only effective satisfaction while
retaining raw failure and exception identity; review approval requires an
independent authorized principal; and task-attempt proof cannot substitute for
container scope or container closeout summary requirements.

## Exclusive write set

This attempt edits only:

- `crates/domain/src/acceptance.rs`
- `crates/domain/tests/production_acceptance_policy.rs`
- `project/validation/production/tasks/PF-S03-T04/attempt-1/`

The protected shared root `crates/domain/src/lib.rs` is not edited. The
coordinator integration request is the additive public registration:

```diff
diff --git a/crates/domain/src/lib.rs b/crates/domain/src/lib.rs
@@
 pub mod decision_inputs;
+pub mod acceptance;
```

After that registration, the coordinator should replace the test-only local
shim with `use boreal_domain::acceptance::*`. No plan JSON, `STATE.json`, prior
evidence, service/runtime state, or unrelated path is in this write set.

## Baseline limitation and verification strategy

Before the new target existed, `cargo test --locked -p boreal-domain --test
production_acceptance_policy` failed with `error: no test target named
production_acceptance_policy`; this is preserved in `COMMANDS.md` as the
baseline unsupported check.

The focused pure-domain suite covers complete-subject filtering before
recency, deleted/mismatched/wrong-version declarations, distinct proof states,
typed force exceptions, review independence and outcomes, and task/container
closeout separation. Workspace formatting, domain test-target compilation,
the focused target, full domain tests, and scoped clippy are run. No service,
runtime, genuine verifier, database, native, publication, or release claim is
in scope.

## Initial coordination observation

`bwrk prime boreal-work --json` returned typed `busy` / `service_busy` because
database owner `process:68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8`
holds the local owner lock. No lock was broken and no application-owned
claim, finish, close, review, or release mutation was attempted.
