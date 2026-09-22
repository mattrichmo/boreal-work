# Serial source-candidate handoff

Source revision: local baseline `7731b05`. Candidate production commits:
`10cf699` (domain/store/application), `28a974c` (protocol/CLI/TUI), `e33d65f`
(packaging and reproducible checks). Contract notes are `0b5b22d` and
`3fd95f5`. The original uploaded snapshot is the source, not an upstream branch.

No task is accepted complete. `TASKS.json` enumerates all 48 task IDs, exact
plan owner/dependencies, candidate evidence and remaining acceptance work.
One editor made all changes; no two agents owned a schema/evaluator/registry
at once. No parallel subagents or independently approved dispatches are claimed.
S00-T07 did not pass. Later source changes are unaccepted review candidates,
not a completed dependency-ordered sprint; see the explicit limitation in
`REVIEW.md`.

| Candidate task | Serial write boundary | Inputs and invariants | Tests / handoff state |
| --- | --- | --- | --- |
| S00-T01 | parity docs + registry inventory | supplied v2 code/legacy-map only; no silent v1 parity claim | `PARITY.md`; requires actual v1 evidence |
| S00-T02 | status/transition contract | exact precedence, primary plus remaining reasons | contract validator passes structurally; independent freeze pending |
| S00-T03 | transition/override target policy | no writable display status or boolean force authority | target only, executable policy matrix incomplete |
| S00-T04 | acceptance-profile fixture | focused/1 and reviewed/1 use summary, work-scoped gate IDs | rejected version attempt retained and reconciled |
| S00-T05 | sprint strategy decision | bounded fixed hierarchy, no complete v3 claim | review/rollup/cycle gates still open |
| S00-T06 | fixture inventory | list missing cases, do not substitute another evaluator | `FIXTURE_MATRIX.json`, not full conformance |
| S01-T01 | domain evaluator and reason/decision types | one pure implementation, preserved secondary reasons | 15 domain tests authored, not run |
| S01-T02 | same evaluator (same serial owner) | pause/retry before ordinary dependencies, holds higher | combined-condition tests authored, unrun |
| S01-T03 | store actor read + application projection | durable role inside canonical read/claim transaction | 2 application tests authored, unrun; authentication not completed |
| S01-T04 | domain/store clock adapter | numeric retry/lease/hard budget, not product due dates | clock tests authored, unrun; schedules/expiry disposition open |
| S01-T05 | domain container label test | containers cannot claim or pretend to be task blockers | provisional label only, no rollup acceptance |
| S01-T06 | domain regression suite | history/permutation/terminal/close-only invariants | source evidence only until Rust tests run |
| S02-T01 | canonical read + claim transaction | re-read all available canonical inputs under write lock | 10 store regressions authored, unrun; profile integrity open |
| S02-T04 | existing hold resolution transaction only | durable operator, exact project subject, replay identity | force/waiver records/routes still not implemented |
| S02-T06 | raw claim race/replay fixtures | one-winner and no duplicate replay writes | unrun; full crash/unknown-outcome matrix still open |
| S04-T06 | TUI + owned protocol/CLI encoder addition | no client status machine or SQLite; primary reason validation | 98 Node, 15 premium, 13 responsive tests pass; real service not run |
| S05-T02 | shared read diagnostics + TUI binding | corrupt direct endpoints/clocks do not authorize a claim | Rust unrun; duplicate TUI diagnostic identity regression passes |
| S06-T01 | candidate check harness | retain failure/tool-unavailable outcomes | runner exit 1; no release gate acceptance |
| S06-T02 | source ZIP selector + recovered wizard | preserve exact full TUI text tree and canonical embedded wizard | actual generator/extracted TUI checks pass; no binary release |

Shared edits to `crates/cli/src/main.rs`, protocol compatibility and
`create-zips.mjs` were made serially by the same coordinator/editor, not by
concurrent lanes. `Cargo.lock`, both schema SQL files, migrations, command
registry, install.sh embedded payload and original M02 plan were not changed.
No historical receipts/attempts/reviews or real project records were deleted,
rewritten or used as fabricated passing evidence. Test inputs remain isolated.

The report's changed-file appendix gives every path and purpose. Executed
commands and their scope are under `evidence/run-01/`. Remaining critical
risks and next safe task are in `REVIEW.md`; independent review and Rust
revalidation are required before these candidates can be accepted.
