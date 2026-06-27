# Component Copy Audit

Status: Sprint 03 Phase 03D copy pass  
Scope: converted `apps/console` component primitives and gallery fixture

## Rules

- Use CLI command labels when the UI action maps to a CLI command.
- Keep state labels concrete: `ready`, `blocked`, `in progress`, `closed`, `stale`, `missing`.
- Keep empty states concise and operational.
- Avoid marketing language in product surfaces.
- Do not hide machine-readable command names behind icon-only controls.

## Checked Surfaces

- Foundation controls: buttons, badges, cards, fields, notices, skeletons, dialogs, chips, avatars, metrics.
- Entity/detail surfaces: entity headers, source refs, timelines, verification, dependencies, lineage, raw previews, wiki detail, health findings.
- Sprint/global surfaces: sprint header, kanban board, work table, progress metrics, global overview, ready queue, search results, command palette.
- Operations surfaces: doctor health, sync status, lock status, event stream, diff, inspector.

## Result

The deterministic gallery fixture includes these command labels:

- `bwrk work claim --json`
- `bwrk sync refresh --json`
- `bwrk doctor --strict --json`

Automated copy checks assert that banned marketing words are absent from the rendered gallery and that required command labels are present.
