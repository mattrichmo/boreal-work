# Global TUI redesign qualification — 2026-09-30

The global manager now has its own product model, screen composition and
interaction layer in `apps/global-tui`. It shares low-level terminal primitives
with the code-project client, while its routes, personal-work views, forms and
service are independent. It continues to use the installation-wide global
SQLite through the versioned Rust service, regardless of the current folder.

## Audit dispositions

| Original finding | Delivered behavior and verification |
| --- | --- |
| Invisible board selection | Horizontal status windows and vertical card windows track the selected card, including late columns and deep cards. Large-fixture tests cover five viewport sizes. |
| Paste executes actions | Streaming UTF-8/escape decoder and bracketed paste handling keep pasted text out of action dispatch; split input and live paste regressions pass. |
| Wrapped lists hide selection | Viewports use rendered row heights, preserving visible stable-ID selection across refreshes and 50+ records. |
| Help disappears | Persistent help modal, searchable command palette, shared navigation order and labeled controls. Narrow help and navigation tests pass. |
| Unclear scope and duplicate views | Explicit portfolio/project scope, personal Inbox, Today/Overdue/Waiting/All open filters, portfolio overview, board/list/planning/notes/archive/history routes. |
| Actions require internal IDs | Searchable project/status/item/dependency pickers, prefilled labeled editors, parent-aware child creation, context actions and validated workspace associations. |
| Notes/Unicode are unusable | Grapheme-aware cursor editing, multiline fields/readers, terminal-cell wrapping, preserved commas and UTF-8 input. |
| No detail, relationships, recovery or ordering | Details/relationships/history/execution inspector tabs, nested planning, dependency add/remove, archive restore and atomic adjacent-sibling reorder. |
| Shallow, stale links | Coalesced five-second refresh, freshness/failure display, separate source counts/revisions/times per link, bounded source-item drilldown and explicit handoff to the source dashboard. |
| Invalid responses bypass uncertainty | Post-delivery malformed responses retain operation identity and freeze writes pending receipt readback; recovery regressions cover invalid inner envelopes/data/correlation. |

## Validation

- 39 global TUI regressions pass, including real framed Unix socket clients.
- Seven application tests and four CLI/service integration tests pass.
- The disposable real-service fixture has 12 management projects, 64 initial
  items, ten workflow statuses, Unicode names, multiline notes, nested work,
  dependencies and two real linked code workspaces.
- Qualification renders 36×12, 52×16, 80×24, 100×28 and 140×36 layouts and
  verifies deep selections. Keyboard-driven real service writes cover capture,
  completion/reopening, archive/restore, visible atomic reordering and paging
  older activity, plus terminal cleanup.
- Real 80×24 and 52×16 terminal walkthroughs verify help, portfolio scope, late
  board columns, multiline note reading, inspector focus and narrow navigation.
  A real linked code dashboard opens and returns with a full global repaint;
  success and rejection return paths have regression coverage.
- Plain rendering remains available for headless output. Full-screen rendering
  uses cell-safe styled rows and differential repaint; `NO_COLOR` selects mono.

Reproduce rich qualification with `scripts/validation/global/tui-fixture.py`
and `tui-qualification.mjs`. Both operate on explicitly disposable state;
fixture creation refuses an existing directory or a directory outside `/tmp`.

This delivery covers the audit and the global manager's documented core. It
makes no claim of calendar integrations, recurring-task scheduling, desktop
notifications or collaboration services that are not implemented.

## Installed release

The final macOS arm64 release is installed at `/Users/cybertron/.local`.
Packaged binary/global assets match the release manifest hashes. Installed
code-project and global service smoke checks pass, as does the rich real-service
qualification using shipped TUI modules. Comparing global records before and
after both installation passes confirms project, item, note, workflow,
relationship and association data preservation.

Launch `bwrk dashboard global` from any directory. `bwrk dashboard` continues
to open the current code project. Source lives in `apps/global-tui/src`.
