# Boreal Global TUI

The global manager is an installation-wide personal and business project
manager with its own projects and database. It reads and writes through the
versioned global service over its Unix socket; it never opens the management
database or launches a CLI command to refresh. A management project may have
no folder or code workspace. Linked execution remains separately labeled and
does not own personal task completion.

Build and launch it with Node 20 or newer:

```sh
npm run build
node dist/entrypoint.js --socket /path/to/boreal-global.sock --interactive
```

## Full-screen use

The views cover Home, Projects, Board, List, Todos, Notes, Workflow, Linked,
Plan, Archive, History, and Inbox. Press `:` to search every view and action;
`?` opens scrollable help for the current view. The numbered shortcuts open
the first eight views. `Tab` changes focus, `↑`/`↓` selects rows or cards, and
`←`/`→` moves between board columns. On a narrow terminal, focus work to open
the same inspector shown in the wide layout.

`Space` switches between all projects and the last explicitly chosen project.
Press `s` to choose scope; the current scope stays visible as routes change.
In the global scope, quick capture (`n`) creates a task in **Personal inbox**.
In a project scope it defaults to that project. `N` opens a detailed form with
destination, parent, workflow status, priority, due date, follow-up date, and
labels. The destination picker can route it to a project or Personal inbox.

On a selected work item, `Enter` opens its full detail, `e` edits it, `h` adds
a child, `m` maps it to a workflow status, `c` completes it, `o` reopens it,
`b` adds a dependency, `D` removes one, and `[`/`]` reorders it. `a` archives
the selected item, project, or note; `u` restores an archived record. Pickers
search labels and titles, so users do not need to enter internal IDs.

Forms use `Tab`/`↑`/`↓` to move between fields, arrows to change fixed choices,
and `Enter` to add a newline in multiline fields or move to the next field.
`Ctrl-S` saves and `Esc` cancels. Multiline text scrolls to the cursor while
the form title, error, and save/cancel instructions stay visible. Date-only
values use `YYYY-MM-DD` as a UTC calendar date and remain unchanged when shown. Timestamps must include
`Z` or an explicit UTC offset. Priority accepts whole numbers from 0 to 255;
blank on a new item uses the service default, and blank while editing keeps the
current value. A waiting follow-up date is separate from an obligation due
date and does not send a reminder.

The streaming decoder buffers UTF-8 and split escape sequences. Bracketed paste
is inserted as text and cannot trigger keyboard actions. Multiline notes and
descriptions support Unicode, wrapped cursor movement, and pasted newlines.

## Refresh and recovery

Snapshots refresh periodically and after successful writes. A saved mutation
whose follow-up read fails closes the submission and reports “Saved; refresh
failed”; `r` retries only the read. When delivery is unknown, the UI freezes
further writes until `r` reads the operation receipt. A revision conflict keeps
the form values, refreshes the snapshot, and requires the user to press
`Ctrl-S` deliberately to reapply.

When connected to an installed launcher that supplies a validated linked
workspace handoff, press `H` on a linked workspace inspector to open that
execution dashboard. Without that callback, linked progress remains readable
in the global manager; stored record text never starts a command.

When input is piped, `--interactive` uses the line interface. `help` lists
route and record commands; `scope all` or `scope N` sets scope, and `select N`
selects a row from the current visible route. `search TEXT`, `add TITLE`,
`inspect`, `complete`, `archive`, `restore`, `status N`, and
`dependency add|remove N` act on the selected record where appropriate. The
line interface uses displayed row/status numbers rather than internal ID
tuples.
