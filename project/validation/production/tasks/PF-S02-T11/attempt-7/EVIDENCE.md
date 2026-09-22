# PF-S02-T11 — attempt 7 bounded store authority evidence

## Disposition

**Ready for independent review; full task remains rejected/unaccepted.**

## Bounded implementation observed

`crates/store/src/jobs.rs` now provides identity-bound external-job methods
for registration, transition, readback and readback-required marking. The
identity path validates the current database/project context, operation
readback, request digest, actor/session, audit identity and audited subject.
Canonical or already-bound stores reject the legacy public registration,
transition and read methods; raw private reads are used only inside the
identity-bound transaction path. Identical operation replay remains
idempotent, while stage, subject, lineage and identity drift are rejected.

`crates/store/tests/production_external_job_boundary.rs` covers:

- bound registration and exact replay;
- registered → admitted → running → side-effect-started → readback-required;
- identity-bound readback and rejection of legacy access on canonical/bound
  stores;
- mismatched audited subject, actor, session and request digest;
- illegal transition rollback without fabricated progress;
- restore-lineage rejection; and
- preserved legacy behavior on a genuinely legacy schema fixture.

## Passing evidence

- New focused boundary tests: **4/4 passed**.
- Existing recovery records tests: **7/7 passed**.
- Existing operation/audit tests: **15/15 passed**.
- Formatting and diff checks passed.

No receipt, acceptance, external process result, update, backup, memory
publication or release success was fabricated.

## Remaining task-level gaps

This bounded store seam is not the complete PF-S02-T11 outcome. The
application/service paths still need to route verifier execution, memory
publication, backup, update, stop, release, cancellation and restart recovery
through the same durable operation/job/readback boundary. Genuine service,
platform and release evidence is also outstanding. Independent review is
required before this contribution can be accepted as a bounded result.
