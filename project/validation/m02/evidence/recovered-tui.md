# Retained execution: recovered-tui

Command: `npm --prefix apps/tui test`

Exit: 0. Core suite and 93 existing Node tests after source recovery.

```text

> test
> tsc && node dist/test.js && node --test tests/*.test.mjs

TUI mounted workflow, protocol/error, monitoring, disabled-action, pagination, recovery, terminal, and refresh tests passed
TAP version 13
# Subtest: grapheme-aware widths, truncation, deletion and input tails
ok 1 - grapheme-aware widths, truncation, deletion and input tails
  ---
  duration_ms: 2.482972
  type: 'test'
  ...
# Subtest: service strings cannot introduce ANSI, OSC, controls or bidi overrides
ok 2 - service strings cannot introduce ANSI, OSC, controls or bidi overrides
  ---
  duration_ms: 17.424511
  type: 'test'
  ...
# Subtest: overwriting either half of a wide cell leaves a coherent grid
ok 3 - overwriting either half of a wide cell leaves a coherent grid
  ---
  duration_ms: 0.220893
  type: 'test'
  ...
# Subtest: row-diff renderer does not repaint unchanged frames or clear on navigation
ok 4 - row-diff renderer does not repaint unchanged frames or clear on navigation
  ---
  duration_ms: 0.402567
  type: 'test'
  ...
# Subtest: monochrome emits no colour SGR sequences
ok 5 - monochrome emits no colour SGR sequences
  ---
  duration_ms: 6.687178
  type: 'test'
  ...
# Subtest: streaming decoder retains split Unicode and split CSI input
ok 6 - streaming decoder retains split Unicode and split CSI input
  ---
  duration_ms: 1.647923
  type: 'test'
  ...
# Subtest: bracketed paste is a single inert event across chunk boundaries
ok 7 - bracketed paste is a single inert event across chunk boundaries
  ---
  duration_ms: 0.140402
  type: 'test'
  ...
# Subtest: standalone Escape is delivered only when the timeout flushes it
ok 8 - standalone Escape is delivered only when the timeout flushes it
  ---
  duration_ms: 0.214363
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 1x1
ok 9 - dashboard and every modal stay cell-bounded at 1x1
  ---
  duration_ms: 8.588684
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 30x10
ok 10 - dashboard and every modal stay cell-bounded at 30x10
  ---
  duration_ms: 25.438098
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 44x14
ok 11 - dashboard and every modal stay cell-bounded at 44x14
  ---
  duration_ms: 27.82866
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 60x20
ok 12 - dashboard and every modal stay cell-bounded at 60x20
  ---
  duration_ms: 38.109045
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 80x24
ok 13 - dashboard and every modal stay cell-bounded at 80x24
  ---
  duration_ms: 54.440953
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 100x32
ok 14 - dashboard and every modal stay cell-bounded at 100x32
  ---
  duration_ms: 77.412799
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 124x40
ok 15 - dashboard and every modal stay cell-bounded at 124x40
  ---
  duration_ms: 83.546453
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 160x48
ok 16 - dashboard and every modal stay cell-bounded at 160x48
  ---
  duration_ms: 98.209552
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 200x60
ok 17 - dashboard and every modal stay cell-bounded at 200x60
  ---
  duration_ms: 130.746383
  type: 'test'
  ...
# Subtest: breakpoints remove panes, not contents, and narrow inspector is a full view
ok 18 - breakpoints remove panes, not contents, and narrow inspector is a full view
  ---
  duration_ms: 2.189189
  type: 'test'
  ...
# Subtest: selection is stable by ID through reorder and reconciles when hidden
ok 19 - selection is stable by ID through reorder and reconciles when hidden
  ---
  duration_ms: 0.208474
  type: 'test'
  ...
# Subtest: search covers title, ID, description, owner and parent on the loaded page
ok 20 - search covers title, ID, description, owner and parent on the loaded page
  ---
  duration_ms: 0.228744
  type: 'test'
  ...
# Subtest: palette explains disabled actions and never invents unsupported commands
ok 21 - palette explains disabled actions and never invents unsupported commands
  ---
  duration_ms: 0.18565
  type: 'test'
  ...
# Subtest: missing detail data is explicitly labelled instead of fabricated
ok 22 - missing detail data is explicitly labelled instead of fabricated
  ---
  duration_ms: 0.598983
  type: 'test'
  ...
# Subtest: service errors take precedence over the default Ready footer
ok 23 - service errors take precedence over the default Ready footer
  ---
  duration_ms: 5.064933
  type: 'test'
  ...
# Subtest: paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once
ok 24 - paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once
  ---
  duration_ms: 93.160632
  type: 'test'
  ...
# Subtest: a stale revision cancels the exact confirmation without sending a mutation
ok 25 - a stale revision cancels the exact confirmation without sending a mutation
  ---
  duration_ms: 44.683513
  type: 'test'
  ...
# Subtest: standalone Escape cancels the draft; later Enter only inspects
ok 26 - standalone Escape cancels the draft; later Enter only inspects
  ---
  duration_ms: 92.835412
  type: 'test'
  ...
# Subtest: create-work form accepts shortcut letters as text and submits the real fields
ok 27 - create-work form accepts shortcut letters as text and submits the real fields
  ---
  duration_ms: 510.198453
  type: 'test'
  ...
# Subtest: JSON arrays are rejected as evidence; real receipt objects remain unchanged
ok 28 - JSON arrays are rejected as evidence; real receipt objects remain unchanged
  ---
  duration_ms: 133.885491
  type: 'test'
  ...
# Subtest: unknown operations are read back, never automatically replayed
ok 29 - unknown operations are read back, never automatically replayed
  ---
  duration_ms: 31.295345
  type: 'test'
  ...
# Subtest: later pages pause polling instead of being silently replaced by page zero
ok 30 - later pages pause polling instead of being silently replaced by page zero
  ---
  duration_ms: 693.768298
  type: 'test'
  ...
# Subtest: resize preserves access to the currently focused inspector
ok 31 - resize preserves access to the currently focused inspector
  ---
  duration_ms: 25.496306
  type: 'test'
  ...
# Subtest: EOF restores raw mode and disposes terminal resources
ok 32 - EOF restores raw mode and disposes terminal resources
  ---
  duration_ms: 16.024961
  type: 'test'
  ...
# Subtest: NO_COLOR and explicit plain/theme flags resolve predictably
ok 33 - NO_COLOR and explicit plain/theme flags resolve predictably
  ---
  duration_ms: 0.898123
  type: 'test'
  ...
# Subtest: ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art
ok 34 - ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art
  ---
  duration_ms: 0.422166
  type: 'test'
  ...
# Subtest: agent multi-select keeps both actual adapters and rejects zero selections
ok 35 - agent multi-select keeps both actual adapters and rejects zero selections
  ---
  duration_ms: 0.673605
  type: 'test'
  ...
# Subtest: explicit CLI choices cannot be changed by the wizard
ok 36 - explicit CLI choices cannot be changed by the wizard
  ---
  duration_ms: 0.213162
  type: 'test'
  ...
# Subtest: custom skill root rejects ambiguous multi-agent setup
ok 37 - custom skill root rejects ambiguous multi-agent setup
  ---
  duration_ms: 0.085579
  type: 'test'
  ...
# Subtest: prefix validation rejects relative, root, normalized root and control characters
ok 38 - prefix validation rejects relative, root, normalized root and control characters
  ---
  duration_ms: 0.372511
  type: 'test'
  ...
# Subtest: existing-command protection follows the edited destination
ok 39 - existing-command protection follows the edited destination
  ---
  duration_ms: 1.503115
  type: 'test'
  ...
# Subtest: compact review must be scrolled before final confirmation
ok 40 - compact review must be scrolled before final confirmation
  ---
  duration_ms: 4.303045
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 30x10
ok 41 - every installer screen stays bounded at 30x10
  ---
  duration_ms: 13.447577
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 48x18
ok 42 - every installer screen stays bounded at 48x18
  ---
  duration_ms: 16.245794
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 60x24
ok 43 - every installer screen stays bounded at 60x24
  ---
  duration_ms: 16.16985
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 80x24
ok 44 - every installer screen stays bounded at 80x24
  ---
  duration_ms: 23.763314
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 100x36
ok 45 - every installer screen stays bounded at 100x36
  ---
  duration_ms: 38.182596
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 144x44
ok 46 - every installer screen stays bounded at 144x44
  ---
  duration_ms: 43.63289
  type: 'test'
  ...
# Subtest: wizard cancellation and back navigation produce no apply result
ok 47 - wizard cancellation and back navigation produce no apply result
  ---
  duration_ms: 0.140331
  type: 'test'
  ...
# Subtest: terminal control strings cannot leak shortcut letters into commands
ok 48 - terminal control strings cannot leak shortcut letters into commands
  ---
  duration_ms: 0.478451
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 24x6
ok 49 - operable content across dashboard, sheets, and both wizards at 24x6
  ---
  duration_ms: 40.013675
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 32x8
ok 50 - operable content across dashboard, sheets, and both wizards at 32x8
  ---
  duration_ms: 31.614536
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 40x8
ok 51 - operable content across dashboard, sheets, and both wizards at 40x8
  ---
  duration_ms: 34.039301
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 40x10
ok 52 - operable content across dashboard, sheets, and both wizards at 40x10
  ---
  duration_ms: 41.441642
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 48x10
ok 53 - operable content across dashboard, sheets, and both wizards at 48x10
  ---
  duration_ms: 54.788311
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 60x12
ok 54 - operable content across dashboard, sheets, and both wizards at 60x12
  ---
  duration_ms: 63.788716
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x10
ok 55 - operable content across dashboard, sheets, and both wizards at 80x10
  ---
  duration_ms: 54.313681
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x12
ok 56 - operable content across dashboard, sheets, and both wizards at 80x12
  ---
  duration_ms: 61.241537
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 96x16
ok 57 - operable content across dashboard, sheets, and both wizards at 96x16
  ---
  duration_ms: 84.914094
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 100x18
ok 58 - operable content across dashboard, sheets, and both wizards at 100x18
  ---
  duration_ms: 95.95278
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 120x8
ok 59 - operable content across dashboard, sheets, and both wizards at 120x8
  ---
  duration_ms: 55.587226
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 120x12
ok 60 - operable content across dashboard, sheets, and both wizards at 120x12
  ---
  duration_ms: 80.502776
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 160x12
ok 61 - operable content across dashboard, sheets, and both wizards at 160x12
  ---
  duration_ms: 91.317355
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 190x12
ok 62 - operable content across dashboard, sheets, and both wizards at 190x12
  ---
  duration_ms: 140.966396
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 190x16
ok 63 - operable content across dashboard, sheets, and both wizards at 190x16
  ---
  duration_ms: 169.210533
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 220x10
ok 64 - operable content across dashboard, sheets, and both wizards at 220x10
  ---
  duration_ms: 156.123946
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 76x32
ok 65 - operable content across dashboard, sheets, and both wizards at 76x32
  ---
  duration_ms: 175.337494
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x32
ok 66 - operable content across dashboard, sheets, and both wizards at 80x32
  ---
  duration_ms: 117.711835
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 104x10
ok 67 - operable content across dashboard, sheets, and both wizards at 104x10
  ---
  duration_ms: 65.502691
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 136x26
ok 68 - operable content across dashboard, sheets, and both wizards at 136x26
  ---
  duration_ms: 148.531734
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 160x48
ok 69 - operable content across dashboard, sheets, and both wizards at 160x48
  ---
  duration_ms: 215.939595
  type: 'test'
  ...
# Subtest: height, not only width, decides chrome and available queue rows
ok 70 - height, not only width, decides chrome and available queue rows
  ---
  duration_ms: 0.201003
  type: 'test'
  ...
# Subtest: all panel content rects are contained even at threshold edges
ok 71 - all panel content rects are contained even at threshold edges
  ---
  duration_ms: 1.190624
  type: 'test'
  ...
# Subtest: invalid, zero and transient dimensions preserve known values; env never overrides a live PTY
ok 72 - invalid, zero and transient dimensions preserve known values; env never overrides a live PTY
  ---
  duration_ms: 0.679885
  type: 'test'
  ...
# Subtest: live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH
ok 73 - live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH
  ---
  duration_ms: 0.482467
  type: 'test'
  ...
# Subtest: literal resize-warning implementation is removed, including installer input guards
ok 74 - literal resize-warning implementation is removed, including installer input guards
  ---
  duration_ms: 0.791393
  type: 'test'
  ...
# Subtest: wide-shallow dashboard is navigable and opens a real inspector
ok 75 - wide-shallow dashboard is navigable and opens a real inspector
  ---
  duration_ms: 42.210321
  type: 'test'
  ...
# Subtest: focused inspector survives shrink and returns to the split layout after growth
ok 76 - focused inspector survives shrink and returns to the split layout after growth
  ---
  duration_ms: 32.276795
  type: 'test'
  ...
# Subtest: command views remain accessible without a rail, including the last choice
ok 77 - command views remain accessible without a rail, including the last choice
  ---
  duration_ms: 14.339471
  type: 'test'
  ...
# Subtest: density and focus toggles never strand keyboard focus in a hidden rail
ok 78 - density and focus toggles never strand keyboard focus in a hidden rail
  ---
  duration_ms: 45.062694
  type: 'test'
  ...
# Subtest: search text and a form draft survive resize with in-place cursor editing
ok 79 - search text and a form draft survive resize with in-place cursor editing
  ---
  duration_ms: 134.902553
  type: 'test'
  ...
# Subtest: small confirmation pages first and submits only the reviewed work once
ok 80 - small confirmation pages first and submits only the reviewed work once
  ---
  duration_ms: 43.570375
  type: 'test'
  ...
# Subtest: confirmation cannot submit in an unreadable two-row panel; growing preserves the draft
ok 81 - confirmation cannot submit in an unreadable two-row panel; growing preserves the draft
  ---
  duration_ms: 50.516289
  type: 'test'
  ...
# Subtest: stale confirmation remains blocked after resizing and scrolling
ok 82 - stale confirmation remains blocked after resizing and scrolling
  ---
  duration_ms: 37.229159
  type: 'test'
  ...
# Subtest: full status is scrollable, including the end of a long service error
ok 83 - full status is scrollable, including the end of a long service error
  ---
  duration_ms: 18.634584
  type: 'test'
  ...
# Subtest: Ctrl-L repaints without losing the focused draft
ok 84 - Ctrl-L repaints without losing the focused draft
  ---
  duration_ms: 20.923164
  type: 'test'
  ...
# Subtest: caret editing is grapheme-safe, bounded, and supports delete/home/end/paste
ok 85 - caret editing is grapheme-safe, bounded, and supports delete/home/end/paste
  ---
  duration_ms: 21.107352
  type: 'test'
  ...
# Subtest: density options are validated and no runtime dependency is introduced
ok 86 - density options are validated and no runtime dependency is introduced
  ---
  duration_ms: 0.908208
  type: 'test'
  ...
# Subtest: a long review can be fully navigated and confirmed at every small size
ok 87 - a long review can be fully navigated and confirmed at every small size
  ---
  duration_ms: 178.419729
  type: 'test'
  ...
# Subtest: installer selection, path caret and help state survive shrinking/growing
ok 88 - installer selection, path caret and help state survive shrinking/growing
  ---
  duration_ms: 4.900906
  type: 'test'
  ...
# Subtest: every multi-select option can be focused and changed at 24x6
ok 89 - every multi-select option can be focused and changed at 24x6
  ---
  duration_ms: 1.177244
  type: 'test'
  ...
# Subtest: large ASCII banner appears only when it fits, not at the expense of review space
ok 90 - large ASCII banner appears only when it fits, not at the expense of review space
  ---
  duration_ms: 0.100001
  type: 'test'
  ...
# Subtest: review errors and choice explanations remain readable in the full help sheet
ok 91 - review errors and choice explanations remain readable in the full help sheet
  ---
  duration_ms: 1.84469
  type: 'test'
  ...
# Subtest: an inspector selection has real content even below recommended dimensions
ok 92 - an inspector selection has real content even below recommended dimensions
  ---
  duration_ms: 7.844623
  type: 'test'
  ...
# Subtest: short split inspector shows the actual next action before low-priority metadata
ok 93 - short split inspector shows the actual next action before low-priority metadata
  ---
  duration_ms: 3.673686
  type: 'test'
  ...
1..93
# tests 93
# suites 0
# pass 93
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2732.499287

```
