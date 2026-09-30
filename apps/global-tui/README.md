# Boreal Global TUI

The global manager has a separate terminal client for personal and business
projects. It reads and writes through the versioned global service over its
Unix socket; it never opens the management database or launches a CLI command
for refresh.

Build and launch it with Node 20 or newer:

```sh
npm run build
node dist/entrypoint.js --socket /path/to/boreal-global.sock --interactive
```

On a terminal, the interface provides an overview and inbox, persistent
project scope, board/list/planning/todo views, notes, custom workflows, linked
workspaces, archive recovery, and activity history. `Space` switches between
all-project and selected-project scope. `Tab` changes focus; the board supports
card and column movement. Enter opens a record inspector, where descriptions,
parents, dependencies, status history, and linked progress can be reviewed.
The activity reader pages through server history with `PgUp`/left for newer
events and `PgDn`/right for older events; up/down scrolls within the current
page.

Quick capture (`n`) asks only for a title. `N` opens the full item form; `e`
edits the selected record. Forms use labeled fields and searchable selection
where an existing project, status, item, or dependency is required. Notes and
descriptions support multiline Unicode editing. Labels are entered as one
field, so commas in other values such as titles and paths remain intact.

Use `:` for the command palette and `?` for context help. `m` selects a status,
`h` creates a child task, `g` creates a milestone, `b` adds a dependency, `D`
removes one, `[`/`]` move a card relative to its adjacent sibling in one
revisioned reorder, and `a`/`u` archive or restore records.
The streaming input decoder buffers UTF-8 and escape sequences and treats
bracketed paste as form text, never as a series of keyboard actions.

Snapshots refresh periodically and after successful writes. The interface
shows when its sample was taken or when refresh failed. It coalesces refreshes,
holds polling while a form or picker is open, and pauses interaction during a
write. A write with an uncertain result stays frozen until `r` reads its
operation receipt; writes are never replayed.

When connected to an installed launcher that supplies a validated linked
workspace handoff, press `H` on its inspector to open the linked project
dashboard. Without that callback, the workspace remains inspectable in the
global manager and no command is started from stored record text.

When input is piped, `--interactive` uses the line interface. Use `help`, route
names, `scope`, `select`, `search`, `add`, `inspect`, `complete`, `archive`,
`restore`, `status`, and `dependency` commands. Selection and status choices
use the visible row numbers from the current view; no internal IDs are needed.
