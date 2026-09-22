# source-archive

Command: `python3 scripts/validation/m02/source_archive_test.py --exercise`

Scope: real root ZIP generator + isolated TUI rebuild; NOT release binary

Result: **passed**; exit 0.

```text
+ node /mnt/data/workspace/boreal-v2/create-zips.mjs --output-dir /tmp/boreal-m02-archive-bi_9tagj/archives
Created /tmp/boreal-m02-archive-bi_9tagj/archives/boreal-v2-reference-20260921T182942903Z.zip (413 source files)
PASS: 414 ZIP files; 19 required paths; 27 TUI text files byte-identical
+ npm --prefix apps/tui test

> test
> tsc && node dist/test.js && node --test tests/*.test.mjs

TUI mounted workflow, protocol/error, monitoring, disabled-action, pagination, recovery, terminal, and refresh tests passed
TAP version 13
# Subtest: M02 primary reason and all secondary reasons survive service decoding
ok 1 - M02 primary reason and all secondary reasons survive service decoding
  ---
  duration_ms: 2.225875
  type: 'test'
  ...
# Subtest: older service responses remain readable without a primary field
ok 2 - older service responses remain readable without a primary field
  ---
  duration_ms: 0.979306
  type: 'test'
  ...
# Subtest: contradictory primary reason is rejected, not locally repaired
ok 3 - contradictory primary reason is rejected, not locally repaired
  ---
  duration_ms: 0.431901
  type: 'test'
  ...
# Subtest: M02 reason detail stays bounded at required terminal sizes
ok 4 - M02 reason detail stays bounded at required terminal sizes
  ---
  duration_ms: 27.103546
  type: 'test'
  ...
# Subtest: a degraded row has one selectable identity and no mutation actions
ok 5 - a degraded row has one selectable identity and no mutation actions
  ---
  duration_ms: 0.439242
  type: 'test'
  ...
# Subtest: grapheme-aware widths, truncation, deletion and input tails
ok 6 - grapheme-aware widths, truncation, deletion and input tails
  ---
  duration_ms: 2.41555
  type: 'test'
  ...
# Subtest: service strings cannot introduce ANSI, OSC, controls or bidi overrides
ok 7 - service strings cannot introduce ANSI, OSC, controls or bidi overrides
  ---
  duration_ms: 15.104683
  type: 'test'
  ...
# Subtest: overwriting either half of a wide cell leaves a coherent grid
ok 8 - overwriting either half of a wide cell leaves a coherent grid
  ---
  duration_ms: 0.21919
  type: 'test'
  ...
# Subtest: row-diff renderer does not repaint unchanged frames or clear on navigation
ok 9 - row-diff renderer does not repaint unchanged frames or clear on navigation
  ---
  duration_ms: 0.428296
  type: 'test'
  ...
# Subtest: monochrome emits no colour SGR sequences
ok 10 - monochrome emits no colour SGR sequences
  ---
  duration_ms: 7.815558
  type: 'test'
  ...
# Subtest: streaming decoder retains split Unicode and split CSI input
ok 11 - streaming decoder retains split Unicode and split CSI input
  ---
  duration_ms: 1.03523
  type: 'test'
  ...
# Subtest: bracketed paste is a single inert event across chunk boundaries
ok 12 - bracketed paste is a single inert event across chunk boundaries
  ---
  duration_ms: 0.165389
  type: 'test'
  ...
# Subtest: standalone Escape is delivered only when the timeout flushes it
ok 13 - standalone Escape is delivered only when the timeout flushes it
  ---
  duration_ms: 0.174964
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 1x1
ok 14 - dashboard and every modal stay cell-bounded at 1x1
  ---
  duration_ms: 7.718142
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 30x10
ok 15 - dashboard and every modal stay cell-bounded at 30x10
  ---
  duration_ms: 21.105747
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 44x14
ok 16 - dashboard and every modal stay cell-bounded at 44x14
  ---
  duration_ms: 24.197466
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 60x20
ok 17 - dashboard and every modal stay cell-bounded at 60x20
  ---
  duration_ms: 32.619017
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 80x24
ok 18 - dashboard and every modal stay cell-bounded at 80x24
  ---
  duration_ms: 42.401489
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 100x32
ok 19 - dashboard and every modal stay cell-bounded at 100x32
  ---
  duration_ms: 59.509211
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 124x40
ok 20 - dashboard and every modal stay cell-bounded at 124x40
  ---
  duration_ms: 77.921719
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 160x48
ok 21 - dashboard and every modal stay cell-bounded at 160x48
  ---
  duration_ms: 96.765637
  type: 'test'
  ...
# Subtest: dashboard and every modal stay cell-bounded at 200x60
ok 22 - dashboard and every modal stay cell-bounded at 200x60
  ---
  duration_ms: 122.263412
  type: 'test'
  ...
# Subtest: breakpoints remove panes, not contents, and narrow inspector is a full view
ok 23 - breakpoints remove panes, not contents, and narrow inspector is a full view
  ---
  duration_ms: 2.019173
  type: 'test'
  ...
# Subtest: selection is stable by ID through reorder and reconciles when hidden
ok 24 - selection is stable by ID through reorder and reconciles when hidden
  ---
  duration_ms: 0.261875
  type: 'test'
  ...
# Subtest: search covers title, ID, description, owner and parent on the loaded page
ok 25 - search covers title, ID, description, owner and parent on the loaded page
  ---
  duration_ms: 0.223497
  type: 'test'
  ...
# Subtest: palette explains disabled actions and never invents unsupported commands
ok 26 - palette explains disabled actions and never invents unsupported commands
  ---
  duration_ms: 0.1527
  type: 'test'
  ...
# Subtest: missing detail data is explicitly labelled instead of fabricated
ok 27 - missing detail data is explicitly labelled instead of fabricated
  ---
  duration_ms: 0.708788
  type: 'test'
  ...
# Subtest: service errors take precedence over the default Ready footer
ok 28 - service errors take precedence over the default Ready footer
  ---
  duration_ms: 4.938352
  type: 'test'
  ...
# Subtest: paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once
ok 29 - paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once
  ---
  duration_ms: 97.683185
  type: 'test'
  ...
# Subtest: a stale revision cancels the exact confirmation without sending a mutation
ok 30 - a stale revision cancels the exact confirmation without sending a mutation
  ---
  duration_ms: 45.612929
  type: 'test'
  ...
# Subtest: standalone Escape cancels the draft; later Enter only inspects
ok 31 - standalone Escape cancels the draft; later Enter only inspects
  ---
  duration_ms: 93.534077
  type: 'test'
  ...
# Subtest: create-work form accepts shortcut letters as text and submits the real fields
ok 32 - create-work form accepts shortcut letters as text and submits the real fields
  ---
  duration_ms: 428.064512
  type: 'test'
  ...
# Subtest: JSON arrays are rejected as evidence; real receipt objects remain unchanged
ok 33 - JSON arrays are rejected as evidence; real receipt objects remain unchanged
  ---
  duration_ms: 110.586614
  type: 'test'
  ...
# Subtest: unknown operations are read back, never automatically replayed
ok 34 - unknown operations are read back, never automatically replayed
  ---
  duration_ms: 41.928647
  type: 'test'
  ...
# Subtest: later pages pause polling instead of being silently replaced by page zero
ok 35 - later pages pause polling instead of being silently replaced by page zero
  ---
  duration_ms: 693.539797
  type: 'test'
  ...
# Subtest: resize preserves access to the currently focused inspector
ok 36 - resize preserves access to the currently focused inspector
  ---
  duration_ms: 22.305034
  type: 'test'
  ...
# Subtest: EOF restores raw mode and disposes terminal resources
ok 37 - EOF restores raw mode and disposes terminal resources
  ---
  duration_ms: 14.730619
  type: 'test'
  ...
# Subtest: NO_COLOR and explicit plain/theme flags resolve predictably
ok 38 - NO_COLOR and explicit plain/theme flags resolve predictably
  ---
  duration_ms: 3.061434
  type: 'test'
  ...
# Subtest: ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art
ok 39 - ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art
  ---
  duration_ms: 0.369837
  type: 'test'
  ...
# Subtest: agent multi-select keeps both actual adapters and rejects zero selections
ok 40 - agent multi-select keeps both actual adapters and rejects zero selections
  ---
  duration_ms: 0.464991
  type: 'test'
  ...
# Subtest: explicit CLI choices cannot be changed by the wizard
ok 41 - explicit CLI choices cannot be changed by the wizard
  ---
  duration_ms: 0.249356
  type: 'test'
  ...
# Subtest: custom skill root rejects ambiguous multi-agent setup
ok 42 - custom skill root rejects ambiguous multi-agent setup
  ---
  duration_ms: 0.093311
  type: 'test'
  ...
# Subtest: prefix validation rejects relative, root, normalized root and control characters
ok 43 - prefix validation rejects relative, root, normalized root and control characters
  ---
  duration_ms: 0.194813
  type: 'test'
  ...
# Subtest: existing-command protection follows the edited destination
ok 44 - existing-command protection follows the edited destination
  ---
  duration_ms: 1.21401
  type: 'test'
  ...
# Subtest: compact review must be scrolled before final confirmation
ok 45 - compact review must be scrolled before final confirmation
  ---
  duration_ms: 3.173412
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 30x10
ok 46 - every installer screen stays bounded at 30x10
  ---
  duration_ms: 8.556334
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 48x18
ok 47 - every installer screen stays bounded at 48x18
  ---
  duration_ms: 11.47306
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 60x24
ok 48 - every installer screen stays bounded at 60x24
  ---
  duration_ms: 12.709032
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 80x24
ok 49 - every installer screen stays bounded at 80x24
  ---
  duration_ms: 18.771959
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 100x36
ok 50 - every installer screen stays bounded at 100x36
  ---
  duration_ms: 27.301243
  type: 'test'
  ...
# Subtest: every installer screen stays bounded at 144x44
ok 51 - every installer screen stays bounded at 144x44
  ---
  duration_ms: 42.210822
  type: 'test'
  ...
# Subtest: wizard cancellation and back navigation produce no apply result
ok 52 - wizard cancellation and back navigation produce no apply result
  ---
  duration_ms: 0.13897
  type: 'test'
  ...
# Subtest: terminal control strings cannot leak shortcut letters into commands
ok 53 - terminal control strings cannot leak shortcut letters into commands
  ---
  duration_ms: 0.208474
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 24x6
ok 54 - operable content across dashboard, sheets, and both wizards at 24x6
  ---
  duration_ms: 44.348063
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 32x8
ok 55 - operable content across dashboard, sheets, and both wizards at 32x8
  ---
  duration_ms: 39.566908
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 40x8
ok 56 - operable content across dashboard, sheets, and both wizards at 40x8
  ---
  duration_ms: 35.381801
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 40x10
ok 57 - operable content across dashboard, sheets, and both wizards at 40x10
  ---
  duration_ms: 38.336323
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 48x10
ok 58 - operable content across dashboard, sheets, and both wizards at 48x10
  ---
  duration_ms: 39.047255
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 60x12
ok 59 - operable content across dashboard, sheets, and both wizards at 60x12
  ---
  duration_ms: 56.413155
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x10
ok 60 - operable content across dashboard, sheets, and both wizards at 80x10
  ---
  duration_ms: 51.480902
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x12
ok 61 - operable content across dashboard, sheets, and both wizards at 80x12
  ---
  duration_ms: 71.79114
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 96x16
ok 62 - operable content across dashboard, sheets, and both wizards at 96x16
  ---
  duration_ms: 80.13932
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 100x18
ok 63 - operable content across dashboard, sheets, and both wizards at 100x18
  ---
  duration_ms: 93.989833
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 120x8
ok 64 - operable content across dashboard, sheets, and both wizards at 120x8
  ---
  duration_ms: 52.1963
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 120x12
ok 65 - operable content across dashboard, sheets, and both wizards at 120x12
  ---
  duration_ms: 80.884103
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 160x12
ok 66 - operable content across dashboard, sheets, and both wizards at 160x12
  ---
  duration_ms: 89.598887
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 190x12
ok 67 - operable content across dashboard, sheets, and both wizards at 190x12
  ---
  duration_ms: 103.501779
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 190x16
ok 68 - operable content across dashboard, sheets, and both wizards at 190x16
  ---
  duration_ms: 165.069211
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 220x10
ok 69 - operable content across dashboard, sheets, and both wizards at 220x10
  ---
  duration_ms: 96.691224
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 76x32
ok 70 - operable content across dashboard, sheets, and both wizards at 76x32
  ---
  duration_ms: 114.802529
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 80x32
ok 71 - operable content across dashboard, sheets, and both wizards at 80x32
  ---
  duration_ms: 145.661994
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 104x10
ok 72 - operable content across dashboard, sheets, and both wizards at 104x10
  ---
  duration_ms: 63.751294
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 136x26
ok 73 - operable content across dashboard, sheets, and both wizards at 136x26
  ---
  duration_ms: 145.452138
  type: 'test'
  ...
# Subtest: operable content across dashboard, sheets, and both wizards at 160x48
ok 74 - operable content across dashboard, sheets, and both wizards at 160x48
  ---
  duration_ms: 225.992473
  type: 'test'
  ...
# Subtest: height, not only width, decides chrome and available queue rows
ok 75 - height, not only width, decides chrome and available queue rows
  ---
  duration_ms: 0.322596
  type: 'test'
  ...
# Subtest: all panel content rects are contained even at threshold edges
ok 76 - all panel content rects are contained even at threshold edges
  ---
  duration_ms: 1.288742
  type: 'test'
  ...
# Subtest: invalid, zero and transient dimensions preserve known values; env never overrides a live PTY
ok 77 - invalid, zero and transient dimensions preserve known values; env never overrides a live PTY
  ---
  duration_ms: 0.65016
  type: 'test'
  ...
# Subtest: live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH
ok 78 - live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH
  ---
  duration_ms: 0.503358
  type: 'test'
  ...
# Subtest: literal resize-warning implementation is removed, including installer input guards
ok 79 - literal resize-warning implementation is removed, including installer input guards
  ---
  duration_ms: 0.764042
  type: 'test'
  ...
# Subtest: wide-shallow dashboard is navigable and opens a real inspector
ok 80 - wide-shallow dashboard is navigable and opens a real inspector
  ---
  duration_ms: 32.552327
  type: 'test'
  ...
# Subtest: focused inspector survives shrink and returns to the split layout after growth
ok 81 - focused inspector survives shrink and returns to the split layout after growth
  ---
  duration_ms: 27.977332
  type: 'test'
  ...
# Subtest: command views remain accessible without a rail, including the last choice
ok 82 - command views remain accessible without a rail, including the last choice
  ---
  duration_ms: 12.370863
  type: 'test'
  ...
# Subtest: density and focus toggles never strand keyboard focus in a hidden rail
ok 83 - density and focus toggles never strand keyboard focus in a hidden rail
  ---
  duration_ms: 43.790854
  type: 'test'
  ...
# Subtest: search text and a form draft survive resize with in-place cursor editing
ok 84 - search text and a form draft survive resize with in-place cursor editing
  ---
  duration_ms: 119.578076
  type: 'test'
  ...
# Subtest: small confirmation pages first and submits only the reviewed work once
ok 85 - small confirmation pages first and submits only the reviewed work once
  ---
  duration_ms: 39.985709
  type: 'test'
  ...
# Subtest: confirmation cannot submit in an unreadable two-row panel; growing preserves the draft
ok 86 - confirmation cannot submit in an unreadable two-row panel; growing preserves the draft
  ---
  duration_ms: 43.102916
  type: 'test'
  ...
# Subtest: stale confirmation remains blocked after resizing and scrolling
ok 87 - stale confirmation remains blocked after resizing and scrolling
  ---
  duration_ms: 33.730522
  type: 'test'
  ...
# Subtest: full status is scrollable, including the end of a long service error
ok 88 - full status is scrollable, including the end of a long service error
  ---
  duration_ms: 19.108687
  type: 'test'
  ...
# Subtest: Ctrl-L repaints without losing the focused draft
ok 89 - Ctrl-L repaints without losing the focused draft
  ---
  duration_ms: 20.148133
  type: 'test'
  ...
# Subtest: caret editing is grapheme-safe, bounded, and supports delete/home/end/paste
ok 90 - caret editing is grapheme-safe, bounded, and supports delete/home/end/paste
  ---
  duration_ms: 18.781314
  type: 'test'
  ...
# Subtest: density options are validated and no runtime dependency is introduced
ok 91 - density options are validated and no runtime dependency is introduced
  ---
  duration_ms: 0.640405
  type: 'test'
  ...
# Subtest: a long review can be fully navigated and confirmed at every small size
ok 92 - a long review can be fully navigated and confirmed at every small size
  ---
  duration_ms: 170.76187
  type: 'test'
  ...
# Subtest: installer selection, path caret and help state survive shrinking/growing
ok 93 - installer selection, path caret and help state survive shrinking/growing
  ---
  duration_ms: 4.742457
  type: 'test'
  ...
# Subtest: every multi-select option can be focused and changed at 24x6
ok 94 - every multi-select option can be focused and changed at 24x6
  ---
  duration_ms: 1.184315
  type: 'test'
  ...
# Subtest: large ASCII banner appears only when it fits, not at the expense of review space
ok 95 - large ASCII banner appears only when it fits, not at the expense of review space
  ---
  duration_ms: 0.082995
  type: 'test'
  ...
# Subtest: review errors and choice explanations remain readable in the full help sheet
ok 96 - review errors and choice explanations remain readable in the full help sheet
  ---
  duration_ms: 2.265154
  type: 'test'
  ...
# Subtest: an inspector selection has real content even below recommended dimensions
ok 97 - an inspector selection has real content even below recommended dimensions
  ---
  duration_ms: 7.521845
  type: 'test'
  ...
# Subtest: short split inspector shows the actual next action before low-priority metadata
ok 98 - short split inspector shows the actual next action before low-priority metadata
  ---
  duration_ms: 3.434866
  type: 'test'
  ...
1..98
# tests 98
# suites 0
# pass 98
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2525.485567
+ node scripts/build-installer.mjs --check
Installer bundles match their source.
+ python3 project/spec/validate_contracts.py
PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed
PASS: isolated source extraction rebuilds/tests the TUI; installer identity and contract checks pass
NOT A RELEASE GATE: no rebuilt Rust binary, live service E2E, independent audit, or platform release is implied.

```
