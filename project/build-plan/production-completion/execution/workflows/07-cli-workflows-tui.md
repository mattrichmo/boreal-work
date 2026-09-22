# Workflow 07 — public parity, trusted workflows, and terminal UX

## Scope

- PF-S13 — Complete human and machine CLI/service parity
- PF-S14 — Trusted workflows and no-goal multi-harness agent guidance
- PF-S15 — Production terminal workspace and recovery UX

## Entry and exit

- PF-S13 begins only after PF-S10 and PF-S12 revalidation.
- PF-S14 and PF-S15 run concurrently after PF-S13 revalidation.
- User-facing behavior is accepted only when it consumes the versioned Rust
  service contract and does not recreate policy in TypeScript or shell code.

## Worker boundary

- [ ] Preserve project-local initialization and never fall back to stale global
      project metadata.
- [ ] Keep CLI, TUI, and agent guidance on the same command registry,
      descriptors, reasons, revisions, and operation readback.
- [ ] Keep workflow assets trusted/versioned and non-authoritative for state.
- [ ] Surface actionable diagnostics for corrupted rows while preserving valid
      siblings and disabling unsafe mutations.
- [ ] Make confirmations show project, target, revision, impact, and changed
      context; never hide destructive actions behind an off-screen default.
- [ ] Support small terminals, resize, paste safety, unavailable service,
      cancellation, and project switching without stale repaint.

## Parallelization

PF-S14 and PF-S15 may run concurrently after PF-S13, but workflow registries,
CLI roots, service routes, and generated installer assets are serialized by
their stewards.

## Handoff checklist

- [ ] Every public operation has parity or an explicit disposition.
- [ ] An unfamiliar agent can discover context and next action without a
      bespoke goal prompt.
- [ ] TUI never reads the canonical database or fabricates service state.
- [ ] Corruption, unavailable-service, and stale-response fixtures are tested.
- [ ] User-facing language avoids raw internal enum/path/SQL terminology.
