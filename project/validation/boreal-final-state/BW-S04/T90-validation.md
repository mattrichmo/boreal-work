# BW-S04-T90 validation handoff

**Record status:** validation evidence recorded; this report does not claim BW-S04 is closed.

## Task handoff

Task ID / attempt: `BW-S04-T90` / independent T90 validation; no attempt ID was issued.
Worker / lane: `/root/bw_s04_t90` / `INTEGRATION`.
Input source identity: integration head `982ac8e6d3e3bcce744e5cca8c120678e5ab2c6d`.
Final branch/source identity used for the combined smoke and repeatable probes: branch `codex/v4-gap-completion`, commit `8305cbec1eeb981d5952c66e6d2b65e9adfe316f`.
S04 implementation source identity: `982ac8e6d3e3bcce744e5cca8c120678e5ab2c6d`; the S04 implementation, tests, and validation paths audited here are byte-identical at `8305cbec1eeb981d5952c66e6d2b65e9adfe316f`. The only commit delta from `982ac8e` to `8305cbec` is `project/spec/workflows/artifacts-acceptance.json.fixture` (58 lines); it does not change S04 paths.

The combined smoke's recorded source SHA-256 is `eb6ffc6ab2adc970fda60056932b07b66e4c1c5117f897388245708ca05036fd` (clean source). Its binary SHA-256 is `3d7cc82dbcdcde5926a615499900696169bfe8cd164659e77af21f9029f30268`; Global TUI bundle SHA-256 is `66ab437d9dd831802e292eef3055ec5aa914e3f74809f348829043f1557daaf1` (11 files).

## Sprint validation matrix

| Sprint criterion | Result | Evidence |
| --- | --- | --- |
| All accepted records remain reachable beyond summary caps; totals remain exact. | **PASS** | `cargo test -p boreal-application -p boreal-cli --locked` at `8305cbec` passed. `snapshot_attention_is_bounded_and_pages_are_revision_bound_and_complete` covers 125 projects/items and exact totals; `global_detail_reads_pass_summary_cap_and_mark_the_configured_limit_partial` reads all 105 projects and 105 associations after the 100-row summary sample. The latter also verifies that a configured 100-row detail ceiling returns `complete=false`, total 105, and `configured_global_detail_limit_reached`, rather than silently claiming completeness. Combined workspace smoke also passed (`cargo test --workspace --locked`). |
| Project attention is bounded/pageable and cannot alone overflow the interactive frame. | **PASS** | The same application test verifies a 100-project attention sample, exact 125-project portfolio open/overdue counts, complete 37-row pages at a stable revision, and serialized summary/page sizes below `INTERACTIVE_RESPONSE_MAX_BYTES`. Stale page reads require resnapshot and return no rows. |
| Search/filter happens before pagination; picker options do not silently stop at the summary sample. | **PASS** | `npm test --prefix apps/global-tui` passed 91/91 tests (0 failed/skipped); full-suite smoke also passed Global TUI typecheck. Tests include `search uses server-filtered revision-pinned pages and retains selection through paging and refresh`, `detailed item form searches and selects project, parent, and status choices on page 101`, and `dependency picker can search and choose an item beyond the snapshot sample`. Application filtering is applied before page slicing in `crates/application/src/global_manager.rs` (`detail page` filter at lines 544–633); the TUI passes the query and expected revision through `apps/global-tui/src/client.ts` and surfaces incomplete-choice errors. |
| `global next` / registry diagnostics enumerate eligible associations completely or explicitly return partial state. | **PASS after the T90 fix.** | The final exact-source probe at `eabc70e4d202f6bc924a73d2ef88d2364e4b7597` selected the claimable task at association index 100 with complete 101/101 association and project coverage. Missing, wrong-actor, and ended sessions each produced partial coverage and `passed=false`. The pre-fix omission is preserved below as historical evidence. |
| Linked worker saturation cannot block ordinary Global management or convert stale counts to zero. | **PASS** | `python3 scripts/validation/global/linked_saturation.py --binary target/debug/bwrk --associations 80` on `8305cbec` exited 0 with `status=PASS`: snapshot 113.27 ms, Global todo 49.16 ms, Global note 47.7 ms, last-good availability `stale`, last-good total `1`, max pool wait 2408 ms, max refresh 405 ms, 9 queue rejections. The focused Rust test `linked_worker_and_queue_saturation_leave_global_mutations_available_and_measure_wait` also passed; `linked_failure_keeps_last_good_counts_and_updates_sample_age` verifies stale counts are retained. |
| Large valid logical state is physically backupable even when logical transfer refuses it. | **PASS** | `python3 /tmp/BW-S04/large_state_validation.py` on `8305cbec` passed both transfer probes. A 1,632,017-byte note body exported to a 3,268,562-byte mode-0600 transfer, imported to a fresh Global root, then read back through file-backed export with the same body SHA-256 (`63c709de7d1e9174014404f177e756152f4f08db0276c4df2efc2c7a8df796fa`) and 1,632,017-byte body. A 67,112,960-byte note body produced a 134,228,515-byte logical transfer; export exited 2 with the 64 MiB import-limit diagnostic and preserved an existing destination sentinel. `global backup --out oversized` then returned `validated=true`; manifest database bytes and the packaged `database.sqlite` were both 134,393,856 bytes, with matching package checksum metadata. Test fixtures used disposable Global roots and direct SQLite edits only to create valid-shaped note records beyond normal command argument sizes. A physical restore of this >64 MiB package was not run; the criterion here is physical backupability. `global note show` itself is interactively bounded, so the >1 MiB readback used file-backed export. |

## Checks actually run and source identity

The focused Rust command was rerun at the exact combined head (therefore at the S04 code tree byte-identical to `982ac8e`):

```text
cargo test -p boreal-application -p boreal-cli --locked
exit 0
```

The full combined smoke was run at `8305cbec` with current binary required:

```text
TMPDIR=/tmp python3 scripts/validation/run_full_suite.py --profile smoke --online --require-current-binary --output /tmp/BW-S04/full-suite-smoke.json
```

Result: 9 checks passed, 0 failed, 0 skipped. Checks were `cargo-workspace`, `binary-build`, `binary-identity`, `binary-freshness`, `tui`, `global-tui-typecheck`, `global-tui-tests`, `creation`, and `validation-identity`. The report records `cargo test --workspace --locked` exit 0. Machine-readable report: `/tmp/BW-S04/full-suite-smoke.json` (SHA-256 `36c6993ca043ddad200a20672ddbd13e740a2d813f750ffb1fdc058e96f2b6b3`); logs: `/private/tmp/BW-S04/full-suite-20261013T183424Z`.

Additional focused probe commands and their exact temporary harness sources/results:

```text
python3 scripts/validation/global/linked_saturation.py --binary target/debug/bwrk --associations 80
python3 /tmp/BW-S04/association_coverage.py
python3 /tmp/BW-S04/large_state_validation.py
```

`association_coverage.py` SHA-256: `5525f83b6a945082fbdef3c423fd9e99bfdb427ed415d7242fcf241b0183aa52`; result JSON: `/tmp/BW-S04/association-coverage-evidence.json` (SHA-256 `2c9af8e2a156eea228b4708be9289941cae92f24259b120e1d37fb14e2067429`). `large_state_validation.py` SHA-256: `c231ad2cb6a8b00d422d9e26e1d6a3a9c60bf5b683b15a1566d4822aa28222c7`; result JSON: `/tmp/BW-S04/large-state-evidence.json` (SHA-256 `20773761b4fd4af711f92e0cf08385a33563b5d6e6820bdbcd36c4bc859163e3`). These harnesses and smoke artifacts are temporary files outside the repository; the report captures their relevant outputs.

## Outcome / integration notes

The bounded T90 production repair is committed as `eabc70e4d202f6bc924a73d2ef88d2364e4b7597`; it changes only the authorized `crates/cli/src/global_discovery.rs`. It reads the workspace's configured `operator_actor` and `operator_session`, validates that the session exists, is active, belongs to the configured actor and project, and validates again after discovery. It passes the validated session to `discover_work` and rejects a changed project revision. Missing, ended, or wrong-actor sessions become explicit partial workspace coverage. No schema/API/migration changes were made.

The report, disposable candidate-probe script, and its result JSON are the only evidence files under this task's write boundary. They will be committed together in the follow-up evidence commit after the final rerun below. The temporary smoke and harness outputs remain under `/tmp`. This handoff does not close BW-S04 or assert dependent-work readiness.

## Next

The candidate-selection criterion passes after the fix. Remaining sprint acceptance, including the source-bound full-suite harness on the final combined tree, remains for the coordinator/review process; this T90 report does not close BW-S04.

## Historical exact-head candidate-selection follow-up (pre-fix)

This follow-up was run after the combined-smoke record above. Its exact source identity is `52bae4180609a23218b4f22190a54f6e235eca99`; the rebuilt `target/debug/bwrk` SHA-256 is `2a70b56bb82e844cf457d9cc443e1a18b9d2d4bee85cf68ccd7ca51dbc14204e`. The head includes the later Global maintenance-admission commit; the tested S04 discovery/status source paths remain the same as the preceding integration source.

Exact commands and outcomes:

```text
cargo build --bin bwrk --locked
exit 0; binary SHA-256 2a70b56bb82e844cf457d9cc443e1a18b9d2d4bee85cf68ccd7ca51dbc14204e

python3 project/validation/boreal-final-state/BW-S04/global-next-candidate-probe.py
exit 0; result BUG_REPRODUCED (the harness exits 0 when the intended omission is reproduced)

git diff --quiet 8305cbec1eeb981d5952c66e6d2b65e9adfe316f HEAD -- crates/cli/src/global_discovery.rs crates/store/src/status_evaluation.rs crates/application/src/status.rs crates/cli/src/command_registry.rs
exit 0; the candidate-selection source paths match the preceding combined S04 source
```

The reproducible harness and machine-readable result are [global-next-candidate-probe.py](global-next-candidate-probe.py) and [global-next-candidate-probe.json](global-next-candidate-probe.json). The probe creates and deletes a disposable Global root and workspace. It creates task `candidate-beyond-cap` at project revision 5, confirms `claimable_for_actor=true` for actor `agent-a` with active session `candidate-session`, then links the workspace as the 101st association (zero-based index 100, after the 100-row summary sample). The Global Next result reports complete registry coverage (`101/101` associations and projects, configured detail limit 1000), `passed=true`, and a valid participating workspace check, but returns candidate count 0, no candidates, and `selected=null`.

Artifact SHA-256: probe script `6cb81708f9f3bc143e8d62ac241dff91bc8f2c535324246d3719b68a988226e8`; result JSON `f89781513affe94e65dcdd56fcb0fb05c24b59065bf37330907c5cab22bfc227`.

Identity matters: the fresh setup metadata originally recorded actor `operator` and session `session-operator`, which do **not** match the status probe's `agent-a` / `candidate-session`. The harness then rebinds only its disposable workspace metadata to `operator_actor=agent-a` and `operator_session=candidate-session`. Thus the reproduced omission is not caused by a mismatch between the tested claimable actor and the actor Global Next reads: those identities match in the isolating run. However, the default initialized operator and the claimable Agent do differ, and the Global Next command has no typed `--actor` or `--session` input. Its registered syntax is `bwrk global next [--limit N] [--json]` (`crates/cli/src/command_registry.rs:62`).

Source evidence: `crates/cli/src/global_discovery.rs:369-375` reads `operator_actor` and its principal role; `:376-385` calls `discover_work(..., None, ...)`, ignoring the `operator_session` present in the disposable metadata; `:387-394` maps no claimable item to `idle_or_blocked`. Canonical status records `authenticated_session` as missing when no session is supplied (`crates/store/src/status_evaluation.rs:399-404`), and `StatusWork::claimable_for_actor` treats the resulting action set as authoritative (`crates/application/src/status.rs:236-241`).


Historical finding: association enumeration was complete, but candidate absence was not evaluated in the active session context. Global Next had no typed actor/session input and passed no session. This established an auth-context/candidate-selection gap, not a row-101 enumeration bug. The fix and exact-source rerun below supersede this pre-fix result. The default `operator` versus Agent identity mismatch remains a separate contract choice; Global Next does not substitute an arbitrary Agent.

## T90 repair and exact-source validation

Production source identity: commit `eabc70e4d202f6bc924a73d2ef88d2364e4b7597` (`fix(cli): honor linked workspace session in global next`). The only production path changed is `crates/cli/src/global_discovery.rs`. Focused Rust tests completed on this exact source:

```text
cargo test -p boreal-application -p boreal-cli --locked
exit 0; all tests passed
```

Other exact-source checks:

```text
cargo fmt --check
exit 0

cargo build --bin bwrk --locked
exit 0; binary SHA-256 4f34f4f1279a934ff49a0c9226efdc273e184cd9193f1646eb64d4719381c8ad

python3 project/validation/boreal-final-state/BW-S04/global-next-candidate-probe.py
exit 0; result PASS; source commit eabc70e4d202f6bc924a73d2ef88d2364e4b7597

git diff --check
exit 0
```

The final disposable probe created 101 global associations, placed `candidate-workspace` at zero-based association index 100, and verified that `candidate-beyond-cap` is claimable for `agent-a` with active `candidate-session`. The workspace fixture initially had `operator` / `session-operator`, so the harness explicitly rebound only disposable metadata to `agent-a` / `candidate-session` for the matching-identity case. Global Next selected `candidate-beyond-cap` with complete coverage (`associations read=101/total=101`, `projects read=101/total=101`, `candidate_count=1`, `passed=true`). The registered syntax remains `bwrk global next [--limit N] [--json]` and offers no typed actor/session input; it uses the workspace metadata. Missing session, a session bound to `agent-b`, and an ended `candidate-session` each yielded `coverage.complete=false`, `coverage.state=partial`, `passed=false`, and a `read_failed` workspace check.

Machine-readable result: [global-next-candidate-probe.json](global-next-candidate-probe.json). The exact command is the Python probe above. Its final rerun recorded source commit `eabc70e4d202f6bc924a73d2ef88d2364e4b7597`, binary SHA-256 `4f34f4f1279a934ff49a0c9226efdc273e184cd9193f1646eb64d4719381c8ad`, `result=PASS`, `candidate_selected=true`, and `invalid_sessions_are_partial=true`. The script and JSON are disposable evidence only; the harness removes its temporary Global root and workspace.

The direct command `cargo test --workspace --locked --quiet` was also attempted on the preceding combined source and failed at `crates/domain/tests/production_properties.rs::oracle_identity_and_minimal_counterexample_replay_are_explicit` because `BOREAL_PRODUCTION_ORACLE_MANIFEST` was not set. This invocation is not a valid workspace gate: `scripts/validation/run_full_suite.py` generates the source-bound manifest before running the workspace suite. The coordinator will run that harness on the final combined tree; no full-suite pass is claimed here.
