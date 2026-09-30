# Worktree consolidation — 2026-09-30

Main retains the current v2 implementation and global dashboard. Four dirty
worktrees based on abf87bb5 were committed to named preservation branches:
`codex/consolidate-9c06`, `codex/consolidate-b54c`,
`codex/consolidate-s3-t03-credential-migration`, and
`codex/consolidate-s5-t04-container-disposition`.

These are older overlapping production-completion snapshots. Their implementation
was already carried forward and subsequently evolved in the current v2 source;
consolidation retains the current implementation while merging their history.
The two clean detached worktrees point at abf87bb5, already an ancestor of main.
Missing temporary worktrees are pruned only from Git's registration metadata.

The older credential/container regression files remain preserved in their
snapshot commits. They were tried against the current code: container tests
refer to replaced APIs (`ContainerDispositionIntentV3`,
`container_scope_snapshot_v3`, `record_container_disposition_v3`); the old CLI
credential fixture conflicts with current stored principal identity attributes.
They are not added to the current runnable suite. Current production identity,
container disposition, CLI onboarding and schema tests remain authoritative.

The missing readiness-cascade worktree belongs to the archived TypeScript v1
engine. Its history is retained without reintroducing legacy packages across
the v2 boundary. The missing project-scoped-dashboard worktree is an older
Rust dashboard implementation; the current nearest-project binding and launcher
implementation remain authoritative. No old file tree replaces current source.

Generated Node caches are ignored. Project-local `memory/` is a separate Git
repository; its scaffold is committed there and excluded from the application
repository rather than staged as an accidental submodule.
