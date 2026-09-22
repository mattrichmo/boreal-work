# Workflow 03 — identity, isolation, service, and operation plumbing

## Scope

PF-S04 — Authenticated actors and project/workspace isolation, followed by
PF-S05 — Versioned service, durable operations and snapshot plumbing.

PF-S04 is the gate. PF-S05 may begin only after PF-S04 revalidation, although
its interface design can be prepared earlier without accepted implementation.

## Entry and exit

- PF-S04 entry requires accepted PF-S02 and PF-S03 gates.
- PF-S05 entry requires accepted PF-S02, PF-S03, and PF-S04 gates.
- Each sprint exits only after its own review, reconciliation, and revalidation
  gates pass.

## Worker boundary

- [ ] Bind project identity to the working directory and validated database
      target; never select a project from stale global metadata.
- [ ] Re-check canonical paths after resolution and reject symlink/`..` escapes.
- [ ] Distinguish caller authentication from a caller-supplied actor ID/role.
- [ ] Version service envelopes, operation IDs, payload digests, snapshots,
      subscriptions, and unknown-outcome readback.
- [ ] Keep application authorization and store transactions authoritative.
- [ ] Do not let service restart, UI cache, or a late response cross project
      boundaries.

## Parallelization

PF-S05 and PF-S09 may be implemented in parallel after PF-S04, but PF-S05 owns
shared protocol/service contract edits. Planning agents submit consumer patches
against accepted interfaces instead of editing the same roots concurrently.

## Handoff checklist

- [ ] Isolation cases cover two roots, copied metadata, symlinks, moved roots,
      stale caches, and late responses.
- [ ] Operation lifecycle distinguishes committed, rejected, pending, expired,
      and unresolved outcomes.
- [ ] Snapshot and pagination consistency rules are explicit.
- [ ] Service restart behavior and compatibility versions are tested.
