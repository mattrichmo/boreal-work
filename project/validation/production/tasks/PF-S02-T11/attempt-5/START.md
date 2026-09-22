# PF-S02-T11 — attempt 5 independent review start

## Review scope

Task / plan / attempt: `PF-S02-T11 / production-completion v1 / attempt-5`

Review type: independent review of the bounded external-effect readback
contribution in attempt 4.

Repository: `/Users/cybertron/Code/boreal-work`

Branch: `codex/apply-responsive-terminal-overlay`

Observed source HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`

Review date: `2026-09-22`

## Write boundary

This reviewer did not edit production source, `execution/STATE.json`, plan
manifests, or any prior attempt evidence. The only intended outputs of this
review are this file and `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md` in
this attempt-5 directory.

The reviewed bounded implementation paths are:

- `crates/application/src/evidence.rs`
- `crates/application/tests/production_external_jobs.rs`

The attempt-4 handoff and evidence were read as prior evidence; their claims
were checked against the current source and fresh command results rather than
promoted automatically.

## Review questions

1. Is external-effect readback bound to project, job, operation, request
   digest, side-effect reference, and result digest?
2. Is reconciliation rejected before the durable `readback_required` stage?
3. Is identical replay idempotent while identity or result drift is rejected?
4. Does the adapter retain pending/unknown states without manufacturing a
   receipt, accepted proof, or success result?
5. What remains outside this bounded contribution and therefore prevents full
   task acceptance?

