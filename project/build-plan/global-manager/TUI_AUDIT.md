# Global TUI product and interaction audit — 2026-09-30

Verdict: independently implemented, but not comparable to the existing project
TUI's interaction maturity. This is a functional first pass over the global
API, not yet a fully designed personal/business project manager. The earlier
completion report overstated what the passing transport and happy-path tests
established about usability.

Scope: `apps/global-tui`, compared with `apps/tui/src/full-screen.ts` and its
`ui` modules. Inspected source, ran all seven existing tests, reproduced
interaction failures with a fake terminal/client, and launched the installed
dashboard in a real 80-column terminal using disposable global state. No
personal records or runtime code were changed by the audit.

## Confirmed findings

1. **P1 — actions can target invisible cards.** `interface.ts:102` only renders
   the first `floor(width / 22)` status columns. Selection still traverses every
   item, with no horizontal column navigation. At 80 columns, a selected Review
   card in the fifth column was invisible; the UI only said to widen the
   terminal. Even the default six-status workflow hides three columns in the
   actual terminal. Complete/archive still target the hidden selection.

2. **P1 — paste can become an action.** `interface.ts:163–174` implements a
   per-chunk ad hoc character parser without bracketed-paste handling. Feeding
   `ESC[200~aESC[201~` to the fake terminal issued `todo archive` for the selected
   task. This reproduction changed fake state only. Unlike the existing
   project's streaming key decoder, it does not treat paste as input data.
   Split escape sequences are also not buffered.

3. **P1 — list scrolling loses the selected row.** `interface.ts:138–140`
   calculates the scroll offset using the item index against rendered lines.
   Descriptions and parent references add lines per item. In a 40-item list
   with descriptions, selecting task 25 at 80×18 rendered tasks 9–15 instead.
   The user cannot tell which item the next action will affect.

4. **P2 — help is erased immediately.** `interface.ts:181` sets the help notice,
   then `:211` clears it before the final draw. Pressing `?` in both the fake
   terminal and actual installed dashboard displayed no help. The permanent
   single-line shortcut footer is clipped at normal terminal widths, hiding
   important commands. It advertises unavailable actions on unrelated routes.

5. **P2 — scope and navigation are incomplete.** `projectId` remains selected
   when switching routes; there is no full-screen action to return Board/List/
   Todos/Notes to all-project scope. Overview always renders global counts but
   can retain a selected project's heading. Overview shows at most 20 projects
   and 20 open items, without paging or an actionable selection. Route changes
   do not consistently reconcile selection. Board navigation uses the flat
   item array rather than column/card focus. List and Todos use identical rows
   and rendering rather than distinct planning and personal-action views.

6. **P2 — complex actions require internal IDs.** `interface.ts:196–209` asks
   users to type status IDs and comma-separated parent/item IDs, relationship
   kinds and workspace identity/path. Board cards do not expose item IDs to
   support these prompts. Child creation does not default to the selected
   parent. There are no searchable item/status/project pickers, prefilled
   multi-field editing forms, or a command palette. Commas in titles/paths are
   not handled by these tuple prompts.

7. **P2 — text editing is unsuitable for notes and everyday names.**
   `interface.ts:170` accepts only ASCII printable characters. Entering
   `Café 家` created `Caf` in the fake-client reproduction. Notes use one-line
   replacement prompts; display collapses whitespace and truncates the body.
   There is no full note reader, multiline editor, cursor navigation or
   selection-aware field editing. The entrypoint also decodes each input chunk
   with a fresh `TextDecoder` (`entrypoint.ts:29`). Width calculations use JS
   string length rather than terminal cells, so emoji/CJK layouts are unreliable.

8. **P2 — no item inspector or relationship/history views.** The UI accepts
   relationships but never renders `snapshot.relationships` as an inspectable
   dependency tree or detail list. Hierarchy is a subtask arrow or raw parent
   ID, not an expandable milestone/task tree. Enter does nothing on items.
   There is no activity/status-history viewer, archive browser/unarchive,
   dependency removal in full screen, or manual card-ordering interface.
   Project priority is available in the API but absent from the keyboard editor.

9. **P2 — linked progress is manual and shallow.** Refresh occurs at startup,
   after a mutation or on `r`; there is no live refresh coordinator or freshness
   indicator distinguishing a retained sample from current data. Linked counts
   are appended as long text rows that can be clipped off-screen. There is no
   navigable linked-work inspector or handoff into the linked project's TUI.

10. **P2 — uncertainty handling has a gap.** `client.ts:53–65,74` throws ordinary
    protocol errors for malformed inner envelopes, wrong versions/correlation
    or missing successful data after delivery. These do not all carry the
    unknown-outcome metadata used by `GlobalController.mutate` to freeze writes.
    A received but invalid application response must retain operation identity
    and require readback just as a disconnected mutation does. Existing tests
    establish disconnected-write protection, not every post-delivery failure.

## Comparison with the project TUI

The project TUI separates screen composition, viewport/layout, terminal-cell
text rendering, state, input editing and streaming key decoding. It provides
adaptive navigation/queue/inspector panes, focus traversal, searchable palettes,
prefilled forms, detail tabs, paging, help modals and explicit confirmation
flows. Those are concrete source features, not an assumption based on its test
count. The global UI concentrates its rendering and interaction logic into
`interface.ts` and lacks most of these affordances.

Global's separate database/API boundary, operation IDs, revision-bound writes,
custom workflows and association ownership are appropriate foundations. The
issue is how the user discovers, views and manipulates those capabilities.
Independent source files and many API commands do not establish a complete UX.

## Required redesign before calling the global TUI full featured

1. Establish a global information architecture: portfolio/home and personal
   inbox; persistent project navigation with explicit All projects; project
   board/list/planning/notes/linked-work views; selected-record inspector.
   Make project lifecycle, personal workflow and linked execution progress
   visibly distinct. Show actionable open/overdue/waiting work on the home view.
2. Use a terminal interaction foundation with buffered Unicode/paste-safe
   decoding, cell-aware rendering, focus and viewport rules. Every selection
   must remain visible at supported widths/heights; every status column must
   remain reachable without enlarging the terminal. Keep the global product
   layout and workflows its own, while reusing suitable low-level primitives.
3. Replace ID tuples with context-sensitive actions, searchable pickers and
   labeled forms. Preserve quick capture as a one-title action; offer detail
   editing, multiline notes, hierarchy, dependency browsing/removal, ordering,
   history/archive access and useful linked-progress inspection alongside it.
4. Add visible context-specific help and a command palette. Define predictable
   Enter/Escape/Tab/back behavior, explicit global/project scope, retained
   selection by stable ID, and a deliberate archive recovery experience.
5. Add live/freshness/error states and complete operation-readback handling.
   Do not let invalid replies or a hidden selection make the UI appear safe to
   continue writing.
6. Qualify realistic daily use rather than a single happy path: several Life/
   business projects, 50+ items, 8+ statuses, multiline notes, nested subtasks,
   multiple linked workspaces, long/wide Unicode names, keyboard paste, narrow
   terminals, interrupted writes and external progress updates. Cover the ten
   findings above with regression tests and actual terminal walkthroughs.

Recurring work, calendar views and integrations are separate product features;
they do not need to precede these fundamental usability corrections. All seven
existing global tests passed during this audit despite the reproduced failures.
