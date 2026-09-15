# P3-09 readiness review

Date: 2026-09-14
Scope: `crates/source`, `crates/memory`, their tests and governing v2 plans.

## Conclusion

P3-09 is not ready for acceptance. The crates contain useful pre-gate
groundwork and focused tests, but the S03 entry gate is explicitly queued on
P2-09, and the required independent review/reconciliation chain has not been
recorded. The smallest conclusion supported by the tree is: source/memory
implementation slices are promising; P3-09 remains open.

## Implemented evidence

- Source intake/integrity: `SourceCatalog::capture`, content-addressed blob
  storage, verification, citations, and scope checks are implemented in
  `crates/source/src/lib.rs:247-387`, `:510-622`, and `:1431-1519`.
  `crates/source/tests/source_engine.rs:25-53` proves concurrent duplicate
  capture is idempotent; `:58-71` proves changed bytes create a new immutable
  version; `:74-107` proves missing/tampered blobs are explicit; `:111-145`
  proves traversal and cross-project rejection.
- Parsing/index/retrieval: parser identity, retained parse failures, indexed
  retrieval, bounds, lag/revision reporting, doctor, and repair are present in
  `crates/source/src/lib.rs:624-760`, `:770-872`, and `:874-1080`.
  `crates/source/tests/source_index.rs:23-103` proves deterministic indexing
  and retrieval; `:105-150` proves result/excerpt bounds and invalid-query
  handling; `:152-206` covers missing/corrupt diagnostics; `:207-251`
  covers restart reload and stable repair; `:252-329` covers idempotent repair
  and retained parser failure.
- Memory draft/publication: cited drafts, explicit review state, canonical
  Markdown/manifest identity, Git publication, fresh-clone reimport, and
  tamper checks are exercised by
  `crates/memory/tests/publisher.rs:48-72`, `:74-103`, and `:137-174`.
- Memory retrieval/maintenance: project-scoped cited retrieval and bounded
  excerpts are covered at `crates/memory/tests/publisher.rs:176-207`;
  manifest/note doctor findings and non-destructive/index-only repair are
  covered at `:209-265`; derived-index retention without deleting published
  memory is covered at `:267-290`.
- Focused command result: `cargo test -p boreal-source -p boreal-memory
  --locked --offline` passed 23 tests (source: 2 unit + 4 + 6; memory: 3
  unit + 8), with 0 failures; doc-tests also passed with 0 tests.

## Groundwork versus formal acceptance

The S03 sprint says `State: queued on P2-09` and states that any existing
source/memory files are early groundwork, not P3 assignments or a passed entry
gate (`milestones/M01-v2-product/sprints/S03-source-memory/SPRINT.md:1-14`).
The task graph still requires P3-01 through P3-06 before P3-07 review and
P3-08 reconciliation (`project/build-plan/TASK_INDEX.md:60-68`). No
`P3-07` review or `P3-08` reconciliation artifact is present in
`project/build-plan/`, so the focused crate tests cannot constitute P3-09.

In particular, the P3-09 gate requires crash recovery at publication
boundaries, fresh-clone restoration, and evidence that source parsing/Git
publication do not materially extend claim lock holds
(`milestones/M01-v2-product/sprints/S03-source-memory/SPRINT.md:33-44`).
The current tests demonstrate fresh-clone/tamper behavior and local repair,
but do not demonstrate service/application integration, crash injection at
each publication boundary, blob backup/restore, or measured claim-hold versus
ingest/publication latency.

## Smallest remaining blockers

1. Close the prerequisite: P2-09 remains open only for
   no-goal guidance/directive-enforcement coverage. Its multi-harness
   service-routed evidence/closeout and restart/readback transcript, plus
   focused failure/replay coverage, now pass; the remaining evidence is recorded in
   `project/build-plan/P2-09-REVALIDATION.md`.
2. Dispatch and complete P3-01–P3-06 on the integrated domain/store/service
   seams, then record the required P3-07 independent provenance review and
   P3-08 dispositions; neither review nor reconciliation is evidenced here.
3. Run P3-09 revalidation on the reconciled snapshot: crash/retry recovery,
   fresh-clone restore, and a measured concurrency check showing source
   ingest/Git publication do not materially extend claim transaction holds.

P2-09 is explicitly still open; this report does not mark it passed or imply
that P3-09 can advance from the current bounded crate tests.
