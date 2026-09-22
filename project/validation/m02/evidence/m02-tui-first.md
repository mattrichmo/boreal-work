# Retained execution: m02-tui-first

Command: `npm --prefix apps/tui test`

Exit: 0. Core suite and 97 Node tests after primary-reason changes.

```text

> test
> tsc && node dist/test.js && node --test tests/*.test.mjs

TUI mounted workflow, protocol/error, monitoring, disabled-action, pagination, recovery, terminal, and refresh tests passed
TAP version 13
# Subtest: M02 primary reason and all secondary reasons survive service decoding
ok 1 - M02 primary reason and all secondary reasons survive service decoding
  ---
  duration_ms: 2.518625
  type: 'test'
  ...
# Subtest: older service responses remain readable without a primary field
ok 2 - older service responses remain readable without a primary field
  ---
  duration_ms: 0.238839
  type: 'test'
  ...
# Subtest: contradictory primary reason is rejected, not locally repaired
ok 3 - contradictory primary reason is rejected, not locally repaired
  ---
  duration_ms: 1.366859
  type: 'test'
  ...
# Subtest: M02 reason detail stays bounded at required terminal sizes
ok 4 - M02 reason detail stays bounded at required terminal sizes
  ---
  duration_ms: 33.228052
  type: 'test'
  ...
# Subtest: grapheme-aware widths, truncation, deletion and input tails
ok 5 - grapheme-aware widths, truncation, deletion and input tails
  ---
  duration_ms: 2.48868
  type: 'test'
  ...
# Subtest: service strings cannot introduce ANSI, OSC, controls or bidi overrides
ok 6 - service strings cannot introduce ANSI, OSC, controls or bidi overrides
  ---
  duration_ms: 25.233194
  type: 'test'
  ...
# Subtest: overwriting either half of a wide cell leaves a coherent grid
ok 7 - overwriting either half of a wide cell leaves a coherent grid
  ---
  duration_ms: 0.268675
  type: 'test'
  ...
# Subtest: row-diff renderer does not repaint unchanged frames or clear on navigation
ok 8 - row-diff renderer does not repaint unchanged frames or clear on navigation
  ---
  duration_ms: 0.380804
  type: 'test'
  ...
# Subtest: monochrome emits no colour SGR sequences
ok 9 - monochrome emits no colour SGR sequences
  ---
  duration_ms: 6.259332
  type: 'test'
  ...
# Subtest: streaming decoder retains split Unicode and split CSI input
ok 10 - streaming decoder retains split Unicode and split CSI input
  ---
  duration_ms: 1.154019
  type: 'test'
  ...
# Subtest: bracketed paste is a single inert event across chunk boundaries
ok 11 - bracketed paste is a single inert event across chunk boundaries
  ---
  duration_ms: 0.143896
  type: 'test'
  ...
# Subtest: standalone Escape is delivered only when the timeout flushes it
ok 12 - standalone Escape is delivered only when the timeout flushes it
  ---
  duration_ms: 0.167973
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 1x1
ok 13 - dashboard and every modal stay cell-bounded at 1x1
  ---
  duration_ms: 10.207121
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 30x10
ok 14 - dashboard and every modal stay cell-bounded at 30x10
  ---
  duration_ms: 24.785079
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 44x14
ok 15 - dashboard and every modal stay cell-bounded at 44x14
  ---
  duration_ms: 36.959269
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 60x20
ok 16 - dashboard and every modal stay cell-bounded at 60x20
  ---
  duration_ms: 42.900176
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 80x24
ok 17 - dashboard and every modal stay cell-bounded at 80x24
  ---
  duration_ms: 69.850182
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 100x32
ok 18 - dashboard and every modal stay cell-bounded at 100x32
  ---
  duration_ms: 100.783641
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 124x40
ok 19 - dashboard and every modal stay cell-bounded at 124x40
  ---
  duration_ms: 90.750522
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 160x48
ok 20 - dashboard and every modal stay cell-bounded at 160x48
  ---
  duration_ms: 98.826902
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 200x60
ok 21 - dashboard and every modal stay cell-bounded at 200x60
  ---
  duration_ms: 145.72999
  type: 'test'
  ...
# Subtest: breakpoints remove panes, not contents, and narrow inspector is a full view
ok 22 - breakpoints remove panes, not contents, and narrow inspector is a full view
  ---
  duration_ms: 2.047656
  type: 'test'
  ...
# Subtest: selection is stable by ID through reorder and reconciles when hidden
ok 23 - selection is stable by ID through reorder and reconciles when hidden
  ---
  duration_ms: 0.190968
  type: 'test'
  ...
# Subtest: search covers title, ID, description, owner and parent on the loaded page
ok 24 - search covers title, ID, description, owner and parent on the loaded page
  ---
  duration_ms: 0.213502
  type: 'test'
  ...
# Subtest: palette explains disabled actions and never invents unsupported commands
ok 25 - palette explains disabled actions and never invents unsupported commands
  ---
  duration_ms: 0.150567
  type: 'test'
  ...
# Subtest: missing detail data is explicitly labelled instead of fabricated
ok 26 - missing detail data is explicitly labelled instead of fabricated
  ---
  duration_ms: 0.508016
  type: 'test'
  ...
# Subtest: service errors take precedence over the default Ready footer
ok 27 - service errors take precedence over the default Ready footer
  ---
  duration_ms: 5.155689
  type: 'test'
  ...
# Subtest: paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once
ok 28 - paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once
  ---
  duration_ms: 92.829204
  type: 'test'
  ...
# Subtest: a stale revision cancels the exact confirmation without sending a mutation
ok 29 - a stale revision cancels the exact confirmation without sending a mutation
  ---
  duration_ms: 44.553578
  type: 'test'
  ...
# Subtest: standalone Escape cancels the draft; later Enter only inspects
ok 30 - standalone Escape cancels the draft; later Enter only inspects
  ---
  duration_ms: 93.620747
  type: 'test'
  ...
# Subtest: create-work form accepts shortcut letters as text and submits the real fields
ok 31 - create-work form accepts shortcut letters as text and submits the real fields
  ---
  duration_ms: 433.527202
  type: 'test'
  ...
# Subtest: JSON arrays are rejected as evidence; real receipt objects remain unchanged
ok 32 - JSON arrays are rejected as evidence; real receipt objects remain unchanged
  ---
  duration_ms: 128.239083
  type: 'test'
  ...
# Subtest: unknown operations are read back, never automatically replayed
ok 33 - unknown operations are read back, never automatically replayed
  ---
  duration_ms: 41.328519
  type: 'test'
  ...
# Subtest: later pages pause polling instead of being silently replaced by page zero
ok 34 - later pages pause polling instead of being silently replaced by page zero
  ---
  duration_ms: 700.175955
  type: 'test'
  ...
# Subtest: resize preserves access to the currently focused inspector
ok 35 - resize preserves access to the currently focused inspector
  ---
  duration_ms: 23.88328
  type: 'test'
  ...
# Subtest: EOF restores raw mode and disposes terminal resources
ok 36 - EOF restores raw mode and disposes terminal resources
  ---
  duration_ms: 15.002028
  type: 'test'
  ...
# Subtest: NO_COLOR and explicit plain/theme flags resolve predictably
ok 37 - NO_COLOR and explicit plain/theme flags resolve predictably
  ---
  duration_ms: 0.744992
  type: 'test'
  ...
# Subtest: ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art
ok 38 - ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art
  ---
  duration_ms: 0.374384
  type: 'test'
  ...
# Subtest: agent multi-select keeps both actual adapters and rejects zero selections
ok 39 - agent multi-select keeps both actual adapters and rejects zero selections
  ---
  duration_ms: 0.450379
  type: 'test'
  ...
# Subtest: explicit CLI choices cannot be changed by the wizard
ok 40 - explicit CLI choices cannot be changed by the wizard
  ---
  duration_ms: 0.2258
  type: 'test'
  ...
# Subtest: custom skill root rejects ambiguous multi-agent setup
ok 41 - custom skill root rejects ambiguous multi-agent setup
  ---
  duration_ms: 0.087892
  type: 'test'
  ...
# Subtest: prefix validation rejects relative, root, normalized root and control characters
ok 42 - prefix validation rejects relative, root, normalized root and control characters
  ---
  duration_ms: 0.190136
  type: 'test'
  ...
# Subtest: existing-command protection follows the edited destination
ok 43 - existing-command protection follows the edited destination
  ---
  duration_ms: 1.337185
  type: 'test'
  ...
# Subtest: compact review must be scrolled before final confirmation
ok 44 - compact review must be scrolled before final confirmation
  ---
  duration_ms: 3.083757
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 30x10
ok 45 - every installer screen stays bounded at 30x10
  ---
  duration_ms: 7.494024
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 48x18
ok 46 - every installer screen stays bounded at 48x18
  ---
  duration_ms: 11.153909
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 60x24
ok 47 - every installer screen stays bounded at 60x24
  ---
  duration_ms: 13.407124
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 80x24
ok 48 - every installer screen stays bounded at 80x24
  ---
  duration_ms: 20.043175
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 100x36
ok 49 - every installer screen stays bounded at 100x36
  ---
  duration_ms: 29.779567
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 144x44
ok 50 - every installer screen stays bounded at 144x44
  ---
  duration_ms: 40.105849
  type: 'test'
  ...
# Subtest: wizard cancellation and back navigation produce no apply result
ok 51 - wizard cancellation and back navigation produce no apply result
  ---
  duration_ms: 0.15889
  type: 'test'
  ...
# Subtest: terminal control strings cannot leak shortcut letters into commands
ok 52 - terminal control strings cannot leak shortcut letters into commands
  ---
  duration_ms: 0.223127
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 24x6
ok 53 - operable content across dashboard, sheets, and both wizards at 24x6
  ---
  duration_ms: 49.364378
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 32x8
ok 54 - operable content across dashboard, sheets, and both wizards at 32x8
  ---
  duration_ms: 32.106802
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 40x8
ok 55 - operable content across dashboard, sheets, and both wizards at 40x8
  ---
  duration_ms: 39.757
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 40x10
ok 56 - operable content across dashboard, sheets, and both wizards at 40x10
  ---
  duration_ms: 49.505661
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 48x10
ok 57 - operable content across dashboard, sheets, and both wizards at 48x10
  ---
  duration_ms: 65.749608
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 60x12
ok 58 - operable content across dashboard, sheets, and both wizards at 60x12
  ---
  duration_ms: 85.011003
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x10
ok 59 - operable content across dashboard, sheets, and both wizards at 80x10
  ---
  duration_ms: 57.251097
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x12
ok 60 - operable content across dashboard, sheets, and both wizards at 80x12
  ---
  duration_ms: 54.817164
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 96x16
ok 61 - operable content across dashboard, sheets, and both wizards at 96x16
  ---
  duration_ms: 81.353682
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 100x18
ok 62 - operable content across dashboard, sheets, and both wizards at 100x18
  ---
  duration_ms: 113.266757
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 120x8
ok 63 - operable content across dashboard, sheets, and both wizards at 120x8
  ---
  duration_ms: 61.779134
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 120x12
ok 64 - operable content across dashboard, sheets, and both wizards at 120x12
  ---
  duration_ms: 93.351567
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 160x12
ok 65 - operable content across dashboard, sheets, and both wizards at 160x12
  ---
  duration_ms: 102.267897
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 190x12
ok 66 - operable content across dashboard, sheets, and both wizards at 190x12
  ---
  duration_ms: 115.93367
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 190x16
ok 67 - operable content across dashboard, sheets, and both wizards at 190x16
  ---
  duration_ms: 161.82575
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 220x10
ok 68 - operable content across dashboard, sheets, and both wizards at 220x10
  ---
  duration_ms: 111.372878
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 76x32
ok 69 - operable content across dashboard, sheets, and both wizards at 76x32
  ---
  duration_ms: 158.287774
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x32
ok 70 - operable content across dashboard, sheets, and both wizards at 80x32
  ---
  duration_ms: 138.214515
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 104x10
ok 71 - operable content across dashboard, sheets, and both wizards at 104x10
  ---
  duration_ms: 64.708829
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 136x26
ok 72 - operable content across dashboard, sheets, and both wizards at 136x26
  ---
  duration_ms: 158.374614
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 160x48
ok 73 - operable content across dashboard, sheets, and both wizards at 160x48
  ---
  duration_ms: 217.514382
  type: 'test'
  ...
# Subtest: height, not only width, decides chrome and available queue rows
ok 74 - height, not only width, decides chrome and available queue rows
  ---
  duration_ms: 0.189876
  type: 'test'
  ...
# Subtest: all panel content rects are contained even at threshold edges
ok 75 - all panel content rects are contained even at threshold edges
  ---
  duration_ms: 1.078225
  type: 'test'
  ...
# Subtest: invalid, zero and transient dimensions preserve known values; env never overrides a live PTY
ok 76 - invalid, zero and transient dimensions preserve known values; env never overrides a live PTY
  ---
  duration_ms: 0.786325
  type: 'test'
  ...
# Subtest: live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH
ok 77 - live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH
  ---
  duration_ms: 0.57079
  type: 'test'
  ...
# Subtest: literal resize-warning implementation is removed, including installer input guards
ok 78 - literal resize-warning implementation is removed, including installer input guards
  ---
  duration_ms: 0.698633
  type: 'test'
  ...
# Subtest: wide-shallow dashboard is navigable and opens a real inspector
ok 79 - wide-shallow dashboard is navigable and opens a real inspector
  ---
  duration_ms: 33.62527
  type: 'test'
  ...
# Subtest: focused inspector survives shrink and returns to the split layout after growth
ok 80 - focused inspector survives shrink and returns to the split layout after growth
  ---
  duration_ms: 31.020434
  type: 'test'
  ...
# Subtest: command views remain accessible without a rail, including the last choice
ok 81 - command views remain accessible without a rail, including the last choice
  ---
  duration_ms: 15.812408
  type: 'test'
  ...
# Subtest: density and focus toggles never strand keyboard focus in a hidden rail
ok 82 - density and focus toggles never strand keyboard focus in a hidden rail
  ---
  duration_ms: 52.043815
  type: 'test'
  ...
# Subtest: search text and a form draft survive resize with in-place cursor editing
ok 83 - search text and a form draft survive resize with in-place cursor editing
  ---
  duration_ms: 120.271882
  type: 'test'
  ...
# Subtest: small confirmation pages first and submits only the reviewed work once
ok 84 - small confirmation pages first and submits only the reviewed work once
  ---
  duration_ms: 36.945066
  type: 'test'
  ...
# Subtest: confirmation cannot submit in an unreadable two-row panel; growing preserves the draft
ok 85 - confirmation cannot submit in an unreadable two-row panel; growing preserves the draft
  ---
  duration_ms: 42.147526
  type: 'test'
  ...
# Subtest: stale confirmation remains blocked after resizing and scrolling
ok 86 - stale confirmation remains blocked after resizing and scrolling
  ---
  duration_ms: 35.918869
  type: 'test'
  ...
# Subtest: full status is scrollable, including the end of a long service error
ok 87 - full status is scrollable, including the end of a long service error
  ---
  duration_ms: 18.356203
  type: 'test'
  ...
# Subtest: Ctrl-L repaints without losing the focused draft
ok 88 - Ctrl-L repaints without losing the focused draft
  ---
  duration_ms: 19.972538
  type: 'test'
  ...
# Subtest: caret editing is grapheme-safe, bounded, and supports delete/home/end/paste
ok 89 - caret editing is grapheme-safe, bounded, and supports delete/home/end/paste
  ---
  duration_ms: 18.409522
  type: 'test'
  ...
# Subtest: density options are validated and no runtime dependency is introduced
ok 90 - density options are validated and no runtime dependency is introduced
  ---
  duration_ms: 0.565211
  type: 'test'
  ...
# Subtest: a long review can be fully navigated and confirmed at every small size
ok 91 - a long review can be fully navigated and confirmed at every small size
  ---
  duration_ms: 172.135263
  type: 'test'
  ...
# Subtest: installer selection, path caret and help state survive shrinking/growing
ok 92 - installer selection, path caret and help state survive shrinking/growing
  ---
  duration_ms: 5.205745
  type: 'test'
  ...
# Subtest: every multi-select option can be focused and changed at 24x6
ok 93 - every multi-select option can be focused and changed at 24x6
  ---
  duration_ms: 1.173048
  type: 'test'
  ...
# Subtest: large ASCII banner appears only when it fits, not at the expense of review space
ok 94 - large ASCII banner appears only when it fits, not at the expense of review space
  ---
  duration_ms: 0.08639
  type: 'test'
  ...
# Subtest: review errors and choice explanations remain readable in the full help sheet
ok 95 - review errors and choice explanations remain readable in the full help sheet
  ---
  duration_ms: 1.744018
  type: 'test'
  ...
# Subtest: an inspector selection has real content even below recommended dimensions
ok 96 - an inspector selection has real content even below recommended dimensions
  ---
  duration_ms: 7.713454
  type: 'test'
  ...
# Subtest: short split inspector shows the actual next action before low-priority metadata
ok 97 - short split inspector shows the actual next action before low-priority metadata
  ---
  duration_ms: 3.29133
  type: 'test'
  ...
1..97
# tests 97
# suites 0
# pass 97
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2736.633206

```
