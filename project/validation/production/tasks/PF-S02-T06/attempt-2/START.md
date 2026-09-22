# PF-S02-T06 — independent review attempt 2 start

## Review identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Review scope: exact current combined working tree
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Worktree: dirty; existing implementation and plan changes were read-only
- Task: PF-S02-T06 — durable recovery, resource ownership, and external jobs
- Prior worker evidence reviewed: `attempt-1/START.md`, `COMMANDS.md`,
  `EVIDENCE.md`, and `HANDOFF.md`
- Review output: this `attempt-2/` directory only

## Context loaded

The review loaded `AGENTS.md`, the production-completion plan README, the
execution startup/dispatch/shared-file rules, the complete PF-S02 sprint
context, the complete PF-S02-T06 card, the accepted PF-S02-T02 and PF-S02-T03
handoffs, the production contract manifest, the worker attempt-1 evidence,
and the current store, migration, application, CLI, and test sources.

## Review questions

1. Are `jobs` and `recovery` registered and installed by the canonical
   production open path with an ordered additive migration/ledger identity,
   including fresh, upgrade, reopen, and fail-closed behavior?
2. Do expiry, failure, stop, release, and uncertain external-effect paths
   create and resolve the durable records transactionally with operation,
   audit, revision, project, actor, and fence context?
3. Do verifier, Git, backup, update, and other external adapters register and
   reconcile jobs before and after side effects?
4. Does the combined tree satisfy every mandatory PF-S02-T06 acceptance item,
   rather than only compiling module-local scaffolding?

No production source, task card, STATE ledger, package manifest, or prior
evidence was edited. The requested checks and source inspection are recorded
in `COMMANDS.md` and `EVIDENCE.md`.
