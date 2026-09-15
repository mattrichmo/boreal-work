# Boreal v2 contributor instructions

## Scope

This is the authoritative v2 workspace. Do not add imports from the legacy
workspace. If legacy behavior is needed, document it in `docs/MIGRATION.md`
and port the behavior behind the v2 boundary.

## Architecture rules

- Keep dependencies flowing from adapters to application to domain.
- Keep domain code free of storage, terminal UI, JSON, and process concerns.
- Keep the store responsible for transaction and revision boundaries.
- Keep lifecycle transitions in the application/domain layer, never in CLI or
  TUI handlers.
- Keep the TypeScript TUI on the versioned Rust service API. It must not read
  the canonical database directly or spawn one CLI process per refresh.
- Treat projections, search indexes, and dashboard rollups as rebuildable
  derived data.
- Keep published curated memory in Git with explicit publication/reconciliation
  state; keep live work and attempts in the transactional store.
- Preserve failed evidence and historical attempts.
- Preserve the self-guiding agent protocol: conditional status, trusted
  versioned directives, contextual `guide`/`next`, required gates, and the
  consolidated claim/evidence/finish or release path. Do not ship a CRUD-only
  CLI as feature parity.
- Never force-break a live lock as a normal recovery mechanism.
- Read `project/README.md`, `project/build-plan/README.md`, and the assigned
  leaf's vertical handoff before implementing a new v2 slice. Start from
  `MASTER_PLAN.md`, the assigned milestone sprint's `SPRINT.md`, and
  `AGENT_HANDOFF.md` for file-based dispatch. The build-plan task graph and
  write boundaries govern multi-agent assignments. Do not use legacy `bwrk`
  to create or close these plan items.

## Browser automation

Do not launch `/Applications/Google Chrome.app` for automated screenshots,
CDP, Playwright, Puppeteer, or browser smoke tests. Use Playwright-managed
Chromium and do not use `--channel=chrome`.
