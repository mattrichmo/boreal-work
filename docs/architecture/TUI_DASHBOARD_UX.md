# TUI Dashboard UX

The terminal dashboard is the active `bwrk dashboard` client. It renders a compact, windowed table inside a shared shell with a top bar, route rail, body, status line, and context-sensitive footer hints. Column widths adapt to terminal width; rows are windowed around the cursor and selected-row identity is retained when refreshed data reorders.

Repo navigation is Roll-Up -> Sprint Board -> Task Detail. Sprint Board shows the selected sprint, visible/total work counts, assigned/dependency counts, blocker context, and a compact table. `s` opens the sprint picker, `f` cycles status filters, and `d` toggles scope presentation. `/` searches routes, sprints, work, issues, and project context; repo search loads the roll-up so work outside the selected sprint is searchable. `?` opens scrollable help and diagnostics. Task detail supports `PgUp`/`PgDn` and `g`/`G` scrolling. `Esc` returns to the previous route.

Refresh is quiet by default: both surfaces revalidate the current route 30 seconds after the previous request completes. Repo revalidation also updates time-dependent reservation expiry when no event is written. The scheduler serializes refreshes within a route; requests made during a read become one trailing refresh, manual `r` runs immediately or after the current read, and repeated failures back off to a bounded maximum. Route changes cancel obsolete global child processes and discard obsolete results. In-progress filesystem reads may finish in the background. The last successful body remains visible while revalidation runs, with stale/warning state and a stable update timestamp in the shell. Automatic checks pause while search, help, or command confirmation is open; explicit refresh and post-action revalidation take precedence. There is no idle age ticker.

The active shell is `apps/tui/src/shell.tsx`. Legacy `app.tsx`, `load.ts`, `nav.ts`, and `bindings.ts` remain isolated for compatibility with legacy tests and are not imported by the active launcher. Terminal alternate-screen and mouse cleanup is centralized in `runtime.ts` and restores exactly once on unmount, normal exit, or signal.

Color behavior is controlled by `NO_COLOR`, `BOREAL_TUI_NO_COLOR=1`, `BOREAL_TUI_COLOR_MODE=light|terminal-default|high-contrast`, and `BOREAL_TUI_HIGH_CONTRAST=1`. `--mouse` is opt-in because it captures terminal mouse events and affects native text selection.

Useful checks:

```bash
./node_modules/.bin/vitest run tests/runtime/tui-head-poll.test.ts tests/runtime/tui-runtime.test.ts tests/runtime/tui-shell.test.ts tests/runtime/tui-shell-interaction.test.tsx
./node_modules/.bin/vitest run tests/runtime/tui-routes.test.ts tests/runtime/tui-route-bindings.test.ts tests/runtime/tui-palette.test.ts
```

This document describes the implemented terminal client. Browser console styling, event-log tail reads, and full-corpus incremental indexing are separate concerns.
