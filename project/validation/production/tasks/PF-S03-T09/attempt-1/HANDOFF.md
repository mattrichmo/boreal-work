# Task handoff — PF-S03-T09 / attempt 1

## Identity and disposition

Task / plan version / attempt: `PF-S03-T09` / production completion / `1`

Worker / reviewer: domain integration worker / independent review still required

State requested: `awaiting_integration`

Input source identity: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`

Final combined source identity: not established; the new test and handoff are
uncommitted on the coordinator's dirty tree.

Prerequisites and contracts: PF-S03-T08 pure-domain evidence at the same HEAD;
`boreal.work-status/3`; `boreal.service/2`; accepted production status/action,
identity/revision/authority and acceptance/proof contracts.

## Changes and invariant

Changed files within the granted boundary:

- `crates/domain/tests/production_domain_api.rs`
- `project/validation/production/domain/api-handoff.md`
- `project/validation/production/tasks/PF-S03-T09/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T09/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T09/attempt-1/EVIDENCE.md`
- this handoff

No shared production file was edited. No state, plan, ledger, memory, commit,
push, schema or protocol mutation was made.

Invariant audited: descriptors retain the exact target and expected project,
entity, proof and attempt/fence context; typed reasons and actor authority
determine allowed/denied actions; safe recovery remains available under a
forward-progress hold; stale or quarantined contexts fail closed.

Before/after behavior: the bounded domain target now exercises this seam. The
current R7 mismatch remains reproduced and explicitly requested for
coordinator resolution.

## Validation

See `COMMANDS.md` and `EVIDENCE.md` for exact argv, cwd, exits and outcomes.
The focused target passed 6 tests with 1 ignored R7 witness; the explicit
ignored run failed with the expected mismatch. Full domain tests, strict
domain Clippy, formatting, diff checks and adapter compilation passed.

Real service operation/readback IDs: none; outside task scope.

Verifier/reviewer/native identities: none; outside task scope.

## Impact and residual work

Schema/migration/rollback: none in this bounded task.

Protocol/status/reason/action compatibility: domain-only contract coverage;
service serialization and status/2 mapping remain unintegrated.

Authority/isolation/security/history: the domain vectors are fail-closed, but
caller authentication and project-wide corruption isolation require the
coordinator patches listed in the API handoff.

Known findings: PF-S03-R1 through R7 remain integration requests; R7 has a
reproducible executable failure. The action API is not yet wired into
application/store/service/TUI production paths.

Next safe task: coordinator applies the root decision/action seam and creates
bounded adapter remediation for R1–R7, then reruns this target plus real
application/service/TUI checks on the resulting exact combined commit.

- [x] No test or service success was inferred or fabricated.
- [x] The R7 failure is retained explicitly.
- [x] All changed paths fit the granted boundary.
- [ ] Coordinator integration and acceptance are still outstanding.
