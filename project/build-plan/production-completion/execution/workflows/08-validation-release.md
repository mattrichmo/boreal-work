# Workflow 08 — real-service validation, security, release, and handover

## Scope

- PF-S16 — Integrated real-service product conformance
- PF-S17 — Adversarial security, fault tolerance, scale and soak
- PF-S18 — Reproducible packaging, installer and recoverable upgrades
- PF-S19 — User onboarding, operator runbooks and support readiness
- PF-S20 — Exact-artifact release qualification and independent cutover
- PF-S21 — Authorized publication, clean-install verification and operational
  handover

## Entry and exit

- PF-S16 and PF-S18 may run after their respective prerequisites are accepted.
- PF-S17 follows PF-S16; PF-S19 follows PF-S18 plus the workflow/TUI gates.
- PF-S20 requires PF-S17, PF-S18, and PF-S19.
- PF-S21 is sequential after PF-S20 and requires explicit publication authority.

## Worker boundary

- [ ] Use the absolute built binary, exact package identity, and declared
      runtime/platform—not whichever executable happens to be on PATH.
- [ ] Separate fixture/presentation evidence from genuine service, installer,
      platform, and release evidence.
- [ ] Exercise isolation, races, stale fences, expiry, corruption, unknown
      outcomes, migration, backup/restore, terminal behavior, and upgrade
      interruption.
- [ ] Verify package manifests, generated/embedded assets, installer behavior,
      rollback compatibility, and database migration boundaries.
- [ ] Record exact source, toolchain, binary, package, target, timestamps,
      commands, outcomes, and readback.
- [ ] Publish only the exact bytes that passed independent qualification.

## Parallelization

PF-S16 and PF-S18 can run concurrently. PF-S17 and PF-S19 can run concurrently
after their prerequisites. PF-S20 and PF-S21 remain final controlled joins.

## Handoff checklist

- [ ] All required acceptance rows identify evidence from the actual built
      product where required.
- [ ] Security findings have owners, severity, remediation, and residual risk.
- [ ] Release artifacts are reproducible and complete.
- [ ] Clean-install, upgrade, rollback, and publication readback are recorded.
- [ ] Support ownership, rollback path, and operational handover are explicit.
