# PF-S02-T07 — Attempt 2 independent review handoff

## Decision

**REJECTED for PF-S02-T07.**

The worker-owned journal and audit modules are present and their focused
regression tests pass, but the required production integration is not present
on the exact combined working tree. The new path is therefore a standalone
store seam rather than the authoritative operation path for consequential
mutations.

## Required correction

The coordinator must introduce a bounded integration correction before this
task can be reviewed again:

1. Route every consequential store/application/CLI mutation through one
   root-owned transaction bundle that records the semantic mutation, operation
   identity context, outcome, and redacted audit event together.
2. Ensure existing-operation replay compares command, actor, session, target,
   request digest, project, database instance, and restore epoch before any
   result is returned.
3. Remove or make non-authoritative the public legacy append path so new
   production code cannot bypass identity registration and audit requirements.
4. Prove the finish/close parent-operation path has one audit event and one
   identity-bound outcome, including rejected and unknown outcomes.
5. Add combined-tree regression coverage for at least claim, start, finish/
   close, project initialization, and one planning mutation, then rerun the
   required store and native/service checks.

Do not mark this task accepted from the current focused test result. Preserve
this rejected review when a correction child is created, as required by the
plan review loop.

## Evidence locations

- `START.md` — source identity and review boundary
- `COMMANDS.md` — exact checks and source inspection
- `EVIDENCE.md` — findings and checklist disposition

