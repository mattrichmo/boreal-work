# PF-S02-T11 — attempt 17 application-integration start

## Identity and disposition

- Task: `PF-S02-T11 — Wire application adapters to durable recovery and external jobs`
- Attempt: `17`
- Worker: application-integration worker
- Repository: `/Users/cybertron/Code/boreal-work`
- Initial observed HEAD: `87d87a0c36429765e00163b255a8588ebc08839a`
- Final validation HEAD: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
- Final branch: `codex/apply-responsive-terminal-overlay`
- Requested state: `ready_for_review`; no acceptance, plan/state update, commit, or push

The HEAD change from `87d87a0c` to `0d9611a0` occurred during this attempt
through the coordinator checkpoint `chore: checkpoint recovery facade
integration`; no commit command was run by this worker. The checkpoint touched
the prior runtime façade and attempt-16 evidence. The current dirty tree and
all unrelated paths were preserved.

## Loaded context

Read before editing: `AGENTS.md`, `project/README.md`,
`project/build-plan/README.md`, the production-completion README and
`MASTER_PLAN.md`, `PF-S02/SPRINT.md`, the complete `PF-S02-T11.md`,
`MULTI_AGENT_STREAM_PLAN.md`, `AGENT_START.md`, `PARALLEL_DISPATCH.md`,
`SHARED_FILES.md`, the accepted PF-S02-T03 attempt-4 handoff, PF-S02-T06
attempt-3 recovery handoff, PF-S02-T11 attempt-16 evidence/handoff, and the
current runtime/recovery/identity/store APIs.

Direct prerequisite `PF-S02-T03` is accepted for its bounded identity leaf;
its broader application/store mutation-wiring limitation remains recorded.
PF-S02-T06 attempt-3 is used as recovery/store context only and is not treated
as task acceptance.

## Exclusive write boundary

Production source/test writes are limited to:

- `crates/application/src/runtime.rs`
- `crates/application/tests/production_external_jobs.rs`

Evidence writes are limited to this attempt directory. Store roots, CLI,
memory, domain, plan/state, manifests, prior evidence, and other agents’
paths were read-only. No destructive command, live-lock break, acceptance
mutation, commit, or push was performed.

## Invariant and verification plan

Terminal release/recovery must use the identity-bound application/store seam;
the canonical terminal release evidence reference is exactly
`attempt-terminal:{attempt_id}:{fence}`. Project/database identity, attempt
fence, operation request-digest replay, wrong-project rejection, unresolved
release state, and idempotent acknowledgement remain store-authoritative.

Before behavior was source-bound at runtime hash
`f0b30ecb26d3ad0ac373ce5de0559006a04ae92d5ea663ac3a95862e9e9951be` and test
hash `ddfbe915bb95a6150905d9cbd899db26ee94a7a187e186ba4d4a9c2f0f7b4ccb`.
The terminal fallback still constructed an unbound recovery adapter and used a
non-canonical release event/evidence pair; existing tests did not exercise
that production-schema fallback path.

After behavior is validated by runtime tests, the full application suite,
production external-job terminal/recovery tests, store recovery/integration
tests, strict application Clippy, formatting, contract validation, and diff
checks. Genuine service/verifier/memory/update/backup execution remains an
integration gap outside this write set.
