# PF-S01-T09 attempt 2 — evidence

## Bounded result

`project/spec/production/release-support-and-budgets.md` freezes:

- the current macOS arm64, macOS Intel, and Linux x86_64 release target
  matrix;
- fixed dashboard, bounded-read, writer-queue, transaction, heartbeat,
  reconnect, history, and offline-view budgets;
- nonwaivable project-isolation, canonical-path, authority, fence/deadline,
  evidence, quarantine, verifier, workflow, secret, and live-lock invariants;
- archive, checksum, signature, dependency, runtime-floor, and installer
  trust rules;
- backup completeness, RPO/RTO, restore epoch, upgrade, and rollback rules;
- exact per-target evidence requirements and `pass`/`fail`/`unsupported`/
  `unmeasured` dispositions.

## Evidence limits

This is a normative contract artifact. It does not claim that the current
implementation meets any threshold. Historical security/performance fixtures,
fake releases, source archives, and unavailable native/platform checks remain
limitations until later tasks run them on the exact combined source or
installed artifact. Attempt 1 was interrupted after its start record and is
preserved under `../attempt-1/`; no result was inferred from it.

The first independent review rejected four omissions (source/receipt limits,
process cleanup budget, credential/audit controls, and explicit T08/schema/
protocol traceability); see `REVIEW-DIRAC.md`. The artifact was amended within
the registered write scope to address all four.

## Changed path

- `project/spec/production/release-support-and-budgets.md`
