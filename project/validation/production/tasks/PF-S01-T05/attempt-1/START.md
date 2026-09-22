# PF-S01-T05 attempt 1 — start

Status: started; implementation and independent acceptance remain open.

Started: 2026-09-22T04:11:01Z
Input source revision: `784a41b3802c29a76721c55eef2e9493283396c2`
Workspace: `/Users/cybertron/Code/boreal-work`

## Bounded outcome

Freeze the production status/action contract for PF-S01-T05: deterministic
precedence, separate availability/integrity/product axes, structured stable
reasons and reevaluation, actor-specific allowed/denied actions, safe recovery
actions, scheduled capability versioning, migration/protocol impact, and
conformance vectors.

## Accepted prerequisite inputs

- PF-S01-T01 attempt 2 handoff: `project/spec/production/scope-and-boundaries.md`
- PF-S01-T02 attempt 2 handoff: `project/spec/production/identity-revisions-authority.md`
- PF-S01-T03 attempt 2 handoff: `project/spec/production/planning-and-cycle-contract.md`
- PF-S01-T04 attempt 2 handoff: `project/spec/production/execution-submission-contract.md`

The task also consumes the current `project/STATUS_MODEL.md`,
`project/spec/transition-table.md`, `crates/domain/src/status_evaluator.rs`,
the TUI client action helpers, and
`project/spec/protocol/protocol-manifest.json`, plus the PF-S01 execution
startup/dispatch instructions.

## Exclusive write boundary

Only these paths may be changed:

- `project/spec/production/status-and-actions.md`
- `project/spec/production/reason-registry.json`
- `project/validation/production/tasks/PF-S01-T05/attempt-1/`

Source, plan state, shared manifests, existing specs, prior attempts, live
databases, and unrelated worktree changes are read-only. No product,
service, native-platform, publication, or release claim is authorized.

## Verification plan

Run the applicable contract/JSON/Markdown checks against the final combined
tree, record exact commands and outcomes in `COMMANDS.md` and `EVIDENCE.md`,
and provide a complete `HANDOFF.md`. Contract vectors will cover terminal and
expiry precedence, hard holds versus queued prerequisites, draft/attempt/gate
states, pause/retry/schedule, ready/operator-only claimability, actor actions,
safe recovery, and protocol/migration compatibility.

## Coordination note

The local Boreal service/database was already owned by another process during
startup workflow lookup. No lock was broken and no live project state was
mutated; this documentation-only task proceeds within its registered paths.
