# BW-S02-T90 combined acceptance evidence

**Status: BLOCKED — BW-S02-T90 is not accepted.** This report captures the
combined-tree results at source commit
`6fe9913136f1414adee433b5e1563da85e8316e2` on branch `codex/v4-s02-t90`.
No production files were changed. The only additions are this report and the
raw logs in [`logs/`](logs/).

The project and Global TUI tests both fail on the combined source, while the
same suites pass at baseline `88b867a3340deab073ec15772c261fbc58504540`
(`origin/main` at dispatch). This blocks acceptance and release workflow
dispatch. The native macOS ARM64 release target passed its local package
build/install/launch smoke. macOS x86-64 and Linux x86-64 were not run locally.

## Source and environment

- Combined source: `6fe9913136f1414adee433b5e1563da85e8316e2`
- Baseline comparison: `88b867a3340deab073ec15772c261fbc58504540`
- Host: macOS ARM64 (`aarch64-apple-darwin`)
- Toolchains: Rust `1.99.0`; Node `26.8.2` (also repeated TUI gates with Node
  `20.20.2`); TypeScript `5.8.3`; Python `3.14.3`
- Rust target inventory: `rustup` is unavailable, so only the native target
  could be built and executed locally.
- Default locale was `C.UTF-8`, which is not installed on this host; `locale -a`
  lists `C` and `en_US.UTF-8`. The first package smoke was retained with its
  raw locale failure, then repeated with both available locale settings.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| Project TUI typecheck | PASS | [`project-tui-typecheck.log`](logs/project-tui-typecheck.log) |
| Global TUI typecheck | PASS | [`global-tui-typecheck.log`](logs/global-tui-typecheck.log) |
| Project TUI tests, Node 26.8.2 | FAIL: one mounted-controller receipt rehydration assertion | [`project-tui-tests.log`](logs/project-tui-tests.log) |
| Project TUI tests, Node 20.20.2 | FAIL: same assertion | [`project-tui-tests-node20.log`](logs/project-tui-tests-node20.log) |
| Global TUI tests, Node 26.8.2 | FAIL: 10 of 91 | [`global-tui-tests.log`](logs/global-tui-tests.log) |
| Global TUI tests, Node 20.20.2 | FAIL: same 10 of 91 | [`global-tui-tests-node20.log`](logs/global-tui-tests-node20.log) |
| Baseline Project TUI tests, Node 20.20.2 | PASS: 99/99 | [`baseline-project-tui-tests-node20.log`](logs/baseline-project-tui-tests-node20.log) |
| Baseline Global TUI tests, Node 20.20.2 | PASS: 91/91 | [`baseline-global-tui-tests-node20.log`](logs/baseline-global-tui-tests-node20.log) |
| Dashboard Node preflight tests | PASS: 4 tests | [`node-preflight-tests.log`](logs/node-preflight-tests.log) |
| Release identity tests | PASS: 5 tests | [`release-identity-tests.log`](logs/release-identity-tests.log) |
| Release builder tests | PASS: 2 tests | [`release-builder-tests.log`](logs/release-builder-tests.log) |
| Full-suite validation contract tests | PASS: 14 tests | [`full-suite-contract-tests.log`](logs/full-suite-contract-tests.log) |
| Global TUI release identity tests | PASS: 4 tests | [`global-tui-identity-tests.log`](logs/global-tui-identity-tests.log) |
| `package-smoke.sh`, default `C.UTF-8` locale | FAIL: checksum helper cannot set locale | [`package-smoke.log`](logs/package-smoke.log) |
| `package-smoke.sh`, `en_US.UTF-8` locale | PARTIAL: package/install/hash/two-project checks pass; Global smoke's first work creation fails with a `work_node_v3` unique conflict | [`package-smoke-en_US.log`](logs/package-smoke-en_US.log) |
| `package-smoke.sh`, `C` locale | PARTIAL: same package/install/hash/two-project passes; same first-work-create conflict | [`package-smoke-C.log`](logs/package-smoke-C.log) |
| Global smoke create-path follow-up | FAIL reproduced in temporary state: two IDs conflict; CLI readbacks show no prior work | [`global-smoke-work-id-repro.log`](logs/global-smoke-work-id-repro.log), [`global-smoke-cli-isolation.log`](logs/global-smoke-cli-isolation.log) |
| Release workflow in-flight check | PASS: no runs found for `codex/v4-completion`; no dispatch made | [`release-workflow-runs.json`](logs/release-workflow-runs.json) |
| Native release archive build | PASS: `aarch64-apple-darwin`, version `0.2.1` | [`native-release-build.log`](logs/native-release-build.log) |
| Native target package install/launch smoke | PASS: archive install, version, temporary Global root, `global project add`, and `dashboard global --json` with unavailable Node | [`native-package-target-smoke.log`](logs/native-package-target-smoke.log) |

The package smoke passes the release-style checksum lookup, staged and
installed asset digest/build identity checks, installer checks, and its
two-project smoke under `LC_ALL=C LANG=C`. It then fails in
`scripts/validation/global/smoke.py` while creating the first project work item:
`claim_conflict / UNIQUE constraint failed: work_node_v3.project_id,
work_node_v3.work_id`. The same failure occurs with `en_US.UTF-8`.

The failure was reproduced on a fresh temporary project using both `code-task`
and a second work ID. Read-only `work list` was empty and `work show` returned
`not_found` after `init`, after session registration, and after `status`, and
again after each failed create. `status` remained at revision 2 with zero work.
`doctor` reported database open and integrity checks passing, `quick_check` as
`ok`, schema version 3, and work-model v3 enabled. Therefore the smoke's
`init`/session/status setup does not create a visible duplicate item. Source
review shows the task path calls `create_planned_work_v3`, inserts canonical
work, then performs one `work_node_v3` insert in the same transaction; the
conflict rolls the transaction back. The source of the uniqueness conflict is
not established by these readbacks. No production or smoke-script changes were
made.

The native archive SHA256 is
`8c89ae99a3b65b649fad53b4df1e00520e3a0f61de7da598f198cae78fc17ebf`.

## TUI failure details

### Project TUI

Both Node versions fail this assertion:

- Test: `mounted controller rehydrates a durable receipt after restart/navigation`
- Failure: the mounted controller does not rehydrate the durable receipt from
  the older test stub.
- First compiled frame: `apps/tui/dist/test.js:1413:1`; source assertion:
  `apps/tui/src/test.ts:1420`.
- Cause identified during triage: the stub at `apps/tui/src/test.ts:1410`
  supplies deprecated `readReceipt`, but hydration now calls
  `readReceiptsForAttempt`.

### Global TUI

Both Node versions fail the same 10 tests (81/91 pass). The first relevant
assertion frame is shown for each:

1. `selection styling stays within the focused work pane` —
   `apps/global-tui/tests/interaction.test.mjs:116:10`; expected the rendered
   row to contain `UNSCHEDULED`, received `CLASSIFICATION UNAVAILABLE`.
2. `All projects scope exposes portfolio work and a selected project retains stable ID after refresh` —
   `apps/global-tui/tests/model-view.test.mjs:27:124`; expected `/OVERDUE/`.
3. `overdue calculation is date based and archive route retains archived records` —
   `apps/global-tui/tests/model-view.test.mjs:36:89`; expected overdue `true`, got `false`.
4. `all record routes preserve a deep selection across 50+ rows` —
   `apps/global-tui/tests/model-view.test.mjs:70:113`; expected the rendered
   inbox to contain `Personal capture 59`.
5. `todo views filter Today, overdue, waiting, and all open independently` —
   `apps/global-tui/tests/model-view.test.mjs:81:30`; expected the `due-today`
   row to be present.
6. `Home search with no matches leaves rendered and selectable rows empty` —
   `apps/global-tui/tests/model-view.test.mjs:140:213`; expected old copy
   `Home · 0 actionable records`; current copy is
   `Home · 0 loaded records and project summaries`.
7. `waiting follow-up date stays distinct from obligation due date and unscheduled has its own filter` —
   `apps/global-tui/tests/model-view.test.mjs:151:208`; test reads `.id` from
   an undefined row.
8. `date-only obligations and RFC3339 timestamps use UTC calendar-day boundaries` —
   `apps/global-tui/tests/model-view.test.mjs:155:54`; expected `true`, got
   `false`.
9. `authoritative project attention supplies full-state action and milestone summaries` —
   `apps/global-tui/tests/model-view.test.mjs:172:111`; expected
   `off-page-action`, received `undefined` (the current shape uses `item_id`).
10. `responsive layouts preserve selected row, scope, freshness and bounded lines` —
    `apps/global-tui/tests/model-view.test.mjs:188:415`; expected `/fresh/` in
    the narrow rendering.

The failing fixture rows and interaction harness omit server-provided
`daily_classification`. That directly accounts for classification/unscheduled
and date-filter failures (1, 2, 3, 5, 7, and 8). It does not explain all ten:
deep inbox selection (4), changed Home copy (6), attention field naming (9),
and the narrow layout freshness assertion (10) are separate stale assumptions
or behavior mismatches. The transient Global snapshot annotates items in
`crates/application/src/global_daily_review.rs::annotate_items`. Baseline
results show these suite failures are regressions against the compared
`origin/main` source, rather than a Node-version-only failure.

## Commands run

The following commands were run on the combined source unless noted. The TUI
suite commands were repeated with Node 20.20.2 and at the detached baseline.

```sh
npm --prefix apps/tui run typecheck
npm --prefix apps/global-tui run typecheck
npm --prefix apps/tui test
npm --prefix apps/global-tui test
cargo test --locked -p boreal-cli dashboard_node -- --nocapture
python3 scripts/release/test_release_identity.py
python3 -m unittest scripts.release.test_build_release
python3 scripts/validation/test_run_full_suite.py
python3 scripts/validation/global-tui/test_identity.py
sh scripts/release/package-smoke.sh
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 sh scripts/release/package-smoke.sh
LC_ALL=C LANG=C sh scripts/release/package-smoke.sh
LC_ALL=C LANG=C PATH=/tmp/boreal-s02-node20/node_modules/.bin:/tmp/boreal-s02-t90-toolchain/node_modules/.bin:$PATH python3 scripts/release/build_release.py --skip-build --output-dir /tmp/boreal-s02-t90-native-release
LC_ALL=C LANG=C PATH=/tmp/boreal-s02-node20/node_modules/.bin:/tmp/boreal-s02-t90-toolchain/node_modules/.bin:$PATH sh scripts/release/package-target-smoke.sh /tmp/boreal-s02-t90-native-release/bwrk-v0.2.1-aarch64-apple-darwin.tar.gz aarch64-apple-darwin
gh run list --workflow release.yml --branch codex/v4-completion
```

The first package smoke's raw `C.UTF-8` checksum failure is retained in
`package-smoke.log`. Both available locale reruns get past the locale-dependent
checksum path and fail later at the same first-work-create conflict. The
release workflow query returned no runs; no workflow was dispatched while the
combined TUI gates were failing.

The Global smoke follow-up used only the installed release binary against a
temporary project. Its commands were:

```sh
bwrk global bootstrap --json
bwrk global project add --name Life --json
bwrk init <temporary-code-dir> --project smoke-code --actor global-smoke --yes --agents codex --json
bwrk work list smoke-code --db <temporary-project-db> --json
bwrk work show smoke-code code-task --db <temporary-project-db> --json
bwrk session start --project smoke-code --actor global-smoke --harness global-smoke --session global-smoke-session --db <temporary-project-db> --json
bwrk work list smoke-code --db <temporary-project-db> --json
bwrk work show smoke-code code-task --db <temporary-project-db> --json
bwrk status --json
bwrk work list smoke-code --db <temporary-project-db> --json
bwrk work show smoke-code code-task --db <temporary-project-db> --json
bwrk work create smoke-code code-task 'Write checkout flow' --kind task --actor global-smoke --session global-smoke-session --db <temporary-project-db> --expected-revision 2 --json
bwrk work list smoke-code --db <temporary-project-db> --json
bwrk work show smoke-code code-task --db <temporary-project-db> --json
bwrk status --json
bwrk doctor --json
bwrk work create smoke-code alternate-task 'Alternate smoke task' --kind task --actor global-smoke --session global-smoke-session --db <temporary-project-db> --expected-revision 2 --json
bwrk work list smoke-code --db <temporary-project-db> --json
bwrk work show smoke-code code-task --db <temporary-project-db> --json
bwrk work show smoke-code alternate-task --db <temporary-project-db> --json
```

Both creates failed with the same unique conflict. List/show remained
empty/not-found and `doctor` remained healthy. Exact arguments and envelopes
are in the two follow-up logs linked above.

`gh run list --workflow release.yml --branch codex/v4-completion` returned no
runs; the JSON readback is `[]`. No release workflow dispatch was made.

## Acceptance checklist and residual items

- [x] Release-layout checksum lookup and staged/installed manifest identity
      verified by the `C` and `en_US.UTF-8` package smoke runs.
- [x] Native macOS ARM64 archive builds and installs; package-target launch
      smoke exercises Global commands with Node unavailable.
- [x] Package smoke uses temporary project/Global data and passed the
      two-project portion without modifying project databases or removing the
      per-user Global root. The later first-work-create defect remains
      unresolved.
- [x] Declared candidate matrix remains macOS ARM64, macOS x86-64, and Linux
      x86-64; Linux ARM64 and Windows remain explicitly unsupported per the
      release documentation.
- [ ] Project TUI tests pass on the integrated source.
- [ ] Global TUI tests pass on the integrated source.
- [ ] Full `package-smoke.sh` completes, including its Global smoke.
- [ ] Cross-target install/launch matrix is observed from the GitHub release
      workflow. No run was dispatched because the TUI suites block acceptance.

Deferred: resolve the Project TUI receipt-service stub mismatch; reconcile the
10 Global TUI assertions against the server classification contract and current
view/fixture semantics; isolate and fix the Global work-create unique conflict;
then rerun the complete matrix. macOS x86-64 and Linux x86-64 execution remains
a CI-only qualification on this host. No task item was closed and no `bwrk`
plan mutation was used.
