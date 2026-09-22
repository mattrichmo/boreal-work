# Workflow 06 — sources, memory, migration, backup, and maintenance recovery

## Scope

- PF-S11 — Versioned sources, curated memory and recoverable handoff
- PF-S12 — Legacy parity, backup/restore and explicit maintenance recovery

## Entry and exit

- PF-S11 starts after PF-S05 and PF-S07 gates.
- PF-S12 starts after PF-S08, PF-S09, and PF-S11 gates.
- Both require source-bound evidence and independent review; retained historical
  importer or fixture results do not automatically apply to the current tree.

## Worker boundary

- [ ] Preserve source provenance, exact revisions, citations, and integrity
      diagnostics from intake through retrieval and publication.
- [ ] Keep live operational memory in the transactional store and published
      curated memory in Git with explicit reconciliation state.
- [ ] Make Git publication and database reconciliation recoverable after either
      side commits first.
- [ ] Produce machine-readable migration dispositions, preserving historical
      vocabulary and distinguishing reported completion from accepted closeout.
- [ ] Bind backup/restore to database identity, referenced artifacts, schema
      version, and published-memory revision.
- [ ] Never use migration, backup, or maintenance commands as a second
      lifecycle engine.

## Parallelization

PF-S11 may run with PF-S08 after PF-S06/PF-S07. PF-S12 may run with PF-S10 once
PF-S08, PF-S09, and PF-S11 are accepted. Migration ordering, manifests, and
application/store roots remain stewarded.

## Handoff checklist

- [ ] Source and memory failure paths have readback/recovery evidence.
- [ ] Import output reports unsupported, transformed, historical, and accepted
      records separately.
- [ ] Restore tests prove isolation and referenced-artifact consistency.
- [ ] Legacy parity gaps are explicit and assigned, never silently dropped.
