# IMPLEMENTATION REPORT — M02 source candidate

Date: 2026-09-21. Source: `boreal-v2-reference-20260921T175404486Z.zip`.

## 1. Decision and delivered scope

**Do not ship. This is a partial source implementation, not a completed M02
release. Completed M02 task IDs: none (0 of 48 accepted).**

Actual Rust, TypeScript, tests, contract and packaging changes are included in
the existing repository. They are not merely recommendations or a patch-only
response. The strongest implemented candidates address deterministic status
precedence/all-reasons preservation, canonical transactional claim checks,
durable actor-role lookup, namespaced review gates, diagnostic display and a
source-archive omission that prevented the supplied installer tests from
running. The complete original M02 plan and this request are preserved.

**Rust code and its 28 newly authored Rust tests are uncompiled and unrun.**
Cargo/rustc/rustfmt were unavailable; toolchain downloads did not succeed.
No independent reviewer, parallel code subagent or genuine service operator
was available. The S00-T07 independent gate did not pass. Downstream edits are
unaccepted remediation candidates, not accepted S01–S06 sprint advancement.
This explicitly falls short of the requested dependency-gated execution model.
There are no approved deferrals and no invented independent review receipts.

The available TypeScript, terminal, installer-source and source-archive checks
pass. None of those substitute for Rust tests, real-service lifecycle,
migration parity or release smoke tests. The full task ledger below gives
exact outstanding work rather than claiming broad completion from test counts.

The returned archive is made by the repository's **root `create-zips.mjs`**.
It is a complete selected text-source snapshot, not a production installer.
It contains the recovered wizard sources, complete text TUI tree, changed
Rust code/tests, original plan, task ledger, failed/successful evidence and
this report. It intentionally excludes `.git`, target/dist/node_modules,
fonts/binary assets and live project databases. **It does not contain a newly
rebuilt Rust executable or published release payload.**

## 2. Actual implementation changes

### Deterministic decision and read path

The old inline evaluator is replaced by `crates/domain/src/status_evaluator.rs`.
It collects applicable canonical facts before selecting a primary status.
Terminal state takes precedence; expiry/hard intervention precedes draft and
active attempt; idle pause/retry precede ordinary open prerequisites. All
secondary reasons are retained, sorted by stable code and deduplicated;
`primary_reason` remains explicit and first in `reason_codes`. Failed,
released and cancelled historical attempts no longer lend their expired
clocks to an idle task. Active lease/hard-budget and retry timers are owned by
the domain decision instead of being repaired by the application projection.

Required review classification uses `GateKind::Review`, not a literal gate
ID, so `TASK:review` is classified as review. A failed required review is
hard intervention; failed technical proof remains a verification gap. Pure
inputs with missing/mistyped/duplicate required gate definitions fail closed.
However, the **store still cannot independently reconstruct a deleted required
gate declaration**, because baseline profile definitions are incomplete. That
critical gap is not concealed by the pure-domain missing-gate tests.

Store-backed status and claim now look up the actor's durable role. Claim
eligibility is not derived from a client-supplied role. This does not complete
authentication, actor-session authorization or every public adapter. Containers
have a provisional, nonclaimable `queued/container_planning` label instead of
`blocked/non_executable_container`; **this is not a child rollup** and does not
satisfy S01-T05 or S03-T05.

### Write transaction and damaged-record handling

Raw claim re-reads canonical work/dependencies/holds/gates/attempt/actor inside
`BEGIN IMMEDIATE` and calls the same domain evaluator as the status projection.
It retains operation replay, expected revision, session checks, fenced attempt
and reservation writes and the existing audit event. A hold, disallowed role,
pause, retry, current attempt or open prerequisite cannot be bypassed merely
by the old SQL candidate filter in this implementation. This claim is based
on source changes; the authored Rust transaction tests have **not run**.

Claim timestamps are parsed as unsigned canonical milliseconds rather than
compared lexicographically. Lease and hard deadlines must be later than claim
time. The candidate-list query is an optimization hint, not authorization;
final claim evaluates policy again. Reads/claims share attempt-clock decoding.
Corrupt clocks/direct parent relationships and missing or unreadable
prerequisites produce diagnostics; an orphan prerequisite is an explicit hard
reason on its dependent rather than a dropped readiness constraint.

Existing hold resolution now requires a stored operator role and the exact
work/project match; replay also binds actor and command. This is limited
hardening of **existing hold resolution**, not implementation of typed gate
force or edge-level dependency waiver. Failed claim transactions still roll
back without a durable rejected-operation outcome, and full finish/close/
release/reopen enforcement and expiry disposition remain outstanding.

### Protocol, terminal UI and source packaging

The shared CLI/service status encoder emits optional `primary_reason` and the
protocol DTO remains able to decode older responses without it. The TUI
preserves primary/secondary reasons and rejects contradictory primary fields
instead of silently repairing service data. A diagnostic for an existing work
item is merged onto that item, preventing duplicate selectable IDs and keeping
actions disabled for the damaged row. This remains service-backed client code,
not SQLite access or another lifecycle evaluator.

The uploaded ZIP omitted `apps/tui/installer/wizard.cjs` and
`wizard-body.cjs`: the root source selector did not allow `.cjs`. Both were
recovered from the supplied `install.sh` embedded payload. Generated/source/
embedded installer byte identity passes. The selector now retains `.cjs`,
includes this report, and requires both wizard files plus the report. A new
archive regression invokes the real generator, checks the full TUI text tree
byte-for-byte and tests it from an isolated extraction.

## 3. Validation and retained failures

`project/validation/m02/evidence/run-01/checks.json` records **19 commands:
12 passed, seven blocked because Cargo could not start**. The candidate runner
returned **exit 1**, intentionally. It is not a successful M02/release gate.

| Check | Observed result |
| --- | --- |
| TypeScript typecheck | Passed. |
| Core TUI suite and Node tests | Passed; **98 Node tests**, including five added M02 presentation/compatibility regressions. |
| Premium/installer fixture validator | **15 passed**; real PTYs/local fake release/controller fixtures, not a rebuilt production binary. |
| Responsive PTY validator | **13 passed**; includes short editor panels, live resize, cancellation and small wizard surfaces. Uses fake service fixtures. |
| New reason-detail dimensions | 80×24, 100×32, 144×40 and 44×12 exercised in Node tests. Existing PTY tests include smaller editor splits. |
| Installer generated/embedded identity | Passed; recovered canonical sources agree with the original embedded payload. |
| Contract validator | Passed structurally: 8 envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal vectors, 19 clock/dependency cases, 52 mappings, SQLite schema parsed. **Not full M02 conformance.** |
| Source archive/extracted checkout | Passed: real root generator, required files/full TUI bytes, archive CRC and safe/excluded paths; isolated TUI rebuild/tests, installer check and contract validator. |
| Rust formatter, four focused Rust suites, full locked workspace and CLI build | All seven invocations blocked before execution, exit 127. **No Rust compile, format or test pass is claimed.** |
| Real Rust-service lifecycle with genuine receipts | Not run. |
| Production-prefix installation, macOS/BSD-tar/signing/ABI and supported Linux release smoke | Not run. Fake-release presentation fixtures are not counted as these gates. |

The 28 new Rust tests comprise 15 domain, 10 store, two application and one
protocol test. Existing hierarchy/timestamp/registered-actor fixtures were
updated separately. No genuine receipt or successful production installation
was fabricated to satisfy an acceptance check.

### Commands and results

Every captured command below has its stdout/stderr, result and scope in
`project/validation/m02/evidence/run-01/`.

| Command | Result / exit | Scope |
| --- | --- | --- |
| `git diff --check` | passed / 0 | source hygiene only |
| `python3 project/spec/validate_contracts.py` | passed / 0 | structural existing contract/SQLite fixtures; not full M02 |
| `cargo fmt --all -- --check` | blocked tool unavailable / 127 | Rust formatting; requires installed rustfmt |
| `cargo test --locked -p boreal-domain --test m02_status` | blocked tool unavailable / 127 | authored M02 evaluator tests |
| `cargo test --locked -p boreal-store --test m02_claim` | blocked tool unavailable / 127 | authored canonical claim/race tests |
| `cargo test --locked -p boreal-application --test m02_status_authority` | blocked tool unavailable / 127 | authored durable actor/status tests |
| `cargo test --locked -p boreal-protocol --test m02_status_wire` | blocked tool unavailable / 127 | authored additive DTO tests |
| `cargo test --locked --workspace` | blocked tool unavailable / 127 | full locked workspace tests |
| `cargo build --locked -p boreal-cli` | blocked tool unavailable / 127 | CLI build, not release packaging |
| `npm --prefix apps/tui run typecheck` | passed / 0 | TypeScript compiler |
| `npm --prefix apps/tui test` | passed / 0 | core suite + Node unit/presentation fixtures |
| `node scripts/build-installer.mjs --check` | passed / 0 | generated wizard and embedded installer byte identity |
| `sh -n install.sh` | passed / 0 | shell parser only |
| `node --check create-zips.mjs` | passed / 0 | JavaScript parser only |
| `node --check apps/tui/installer/wizard.cjs` | passed / 0 | JavaScript parser only |
| `node --check apps/tui/installer/wizard-body.cjs` | passed / 0 | JavaScript parser only |
| `python3 scripts/validation/premium/validate_premium.py -v` | passed / 0 | real PTYs and local fake release/controller fixtures, NOT Rust E2E |
| `python3 scripts/validation/premium/validate_responsive.py -v` | passed / 0 | real PTYs and fake service fixtures, NOT Rust E2E |
| `python3 scripts/validation/m02/source_archive_test.py --exercise` | passed / 0 | real root ZIP generator + isolated TUI rebuild; NOT release binary |

Earlier evidence is retained rather than overwritten:
`evidence/baseline-tui.md` records the original missing-installer failure;
`evidence/contracts-candidate.md` records the rejected fixture-version edit.
`contracts-reconciled.md` records the corrected version check;
`recovered-tui.md`, `m02-tui-first.md` and `m02-tui-reconciled.md` record the
93 → 97 → 98 test progression. The earliest archive exercise used a preliminary
report solely to prove inclusion. The delivered archive is generated after
this complete report is written. Source/installer checks are not release proof.

Reproduce source checks in an isolated checkout with:

```sh
python3 scripts/validation/m02/run_candidate.py --output /tmp/boreal-m02-evidence
```

That command must remain nonzero until missing/failed checks are resolved.
Even an eventual zero would not replace the independent sprint, genuine
service, migration and supported-platform release gates in the supplied plan.

Generate the source artifact with:

```sh
node create-zips.mjs --output-dir /tmp/boreal-m02-source
python3 scripts/validation/m02/source_archive_test.py --exercise
```

## 4. Schema, protocol and migration impact

**Schema:** no SQL schema or schema-version changes, no new migrations,
no `Cargo.lock` changes and no rewriting of stored lifecycle or historical
receipts/reviews/attempts. v2 tables remain authoritative. Opt-in v3
contracts/low-level groundwork remain present and explicitly incomplete.
No cycle-backed public adapter or persisted override table is claimed.

**Protocol:** `boreal.work-status/2` and existing DTO version labels are
retained. `primary_reason` is additive/optional for decoding; the encoder
emits it. `reason_codes[0]` must agree with it when present. Reason vocabulary
adds gate-open/failed/missing/invalid, rejected-review, role-denied,
attempt-subject-mismatch and provisional container-planning diagnostics.
The intended precedence change is behavioral and needs independent contract
and full adapter compatibility review; an optional field alone does not prove
all wire compatibility.

**Acceptance contract:** focused/1 and reviewed/1 use `summary`, matching
existing Rust constructors; `audit` is not silently substituted for summary
proof. Audit events remain a distinct requirement. The manifest-compatible
fixture version stays `p0-03.v2`, with a separate candidate revision marker.
Unknown/custom profile versions and independently persisted required gate
configuration still need implementation/validation.

**Clock/actor compatibility:** new raw claims require `unix-ms:<unsigned
decimal>` times; legacy RFC3339/`tN` strings are rejected, not guessed or
rewritten. Read projections now require a registered actor row. Actual old
adapters/importers need compatibility tests and explicit migration disposition
before production use. Timestamp edits are test input changes, not a database
migration or authorization to erase history.

**Sprint strategy:** the bounded fixed hierarchy is a documented candidate
with explicit persistence/compatibility/migration/rollback limits and a proposed
2026-10-05 follow-up planning checkpoint, not an automation or release promise.
S03 cycle/rollup/readiness outcomes remain open; the decision does not waive
M02 or claim v3 support. Existing v3 data must never be dropped on rollback.

**Packaging:** `.cjs` selection is repaired. Future source archives retain the
wizard sources and the entire text TUI tree. A real future installer still
requires a fresh Rust binary, TUI distribution, release payload, prefix smoke
and platform gates; none were published here. No `bwrk upgrade` route is claimed.

## 5. Completed, incomplete and deferred task IDs

**Completed / accepted: none. Approved deferrals: none.** Candidate means
source work or evidence exists, not that the task's named acceptance passed.
Blocked/not-started rows are not silently waived. Owners, original dependency
text and per-task evidence are also in `project/validation/m02/TASKS.json`.

| Task ID | State | Exact remaining work / reason |
| --- | --- | --- |
| S00-T01 | candidate — **not complete** | Registry inventory and dispositions exist, but the actual v1 runtime/archive was not supplied. Historical legacy-map references are not independently reverified. |
| S00-T02 | candidate — **not complete** | Precedence/primary-reason contract updated; full predicates, next actions, complete reason vocabulary and positive/negative schedule fixtures still require review. |
| S00-T03 | candidate — **not complete** | Typed override/transition policy recorded, not complete executable legal/illegal coverage or independently frozen authority. |
| S00-T04 | candidate — **not complete** | summary vocabulary and numeric version reconciled; full per-work profile persistence, public adapters and required-gate integrity are not complete. |
| S00-T05 | candidate — **not complete** | Bounded hierarchy decision candidate names persistence/compatibility/migration/rollback; no independent approval, complete rollups or public cycle adapter. |
| S00-T06 | candidate — **not complete** | Fixture inventory has explicit missing cases. Full positive and negative conformance for every normative status/transition is not present. |
| S00-T07 | blocked — **not complete** | No independent validator or reviewer was available. Critical findings remain unresolved. Author review is not independent contract acceptance. |
| S01-T01 | candidate — **not complete** | Pure evaluator rewrite and 15 new domain tests authored but not compiled/run. Gate declarations, full schedule inputs and safe next-action coverage remain incomplete. |
| S01-T02 | candidate — **not complete** | Paused/retry/dependency/hold precedence rewritten with combined-condition tests; real direct/service/CLI/TUI parity at one revision is not run. |
| S01-T03 | candidate — **not complete** | Store-backed reads/claims look up durable actor role. Complete authenticated actor/session/project/dispatch propagation is not certified; Rust tests unavailable. |
| S01-T04 | candidate — **not complete** | Retry/lease/hard-budget timing centralized and numeric claim clocks checked. Not-before, product due/overdue and durable post-expiry disposition are not wired. |
| S01-T05 | candidate — **not complete** | Containers receive provisional nonclaimable queued/container_planning only. No child/sprint/gate/overdue/closeout rollup implementation; not a completed planning projection. |
| S01-T06 | candidate — **not complete** | Permutation, terminal, history and closed-only tests authored; not run. Full property/conformance oracle and all domain inputs remain incomplete. |
| S01-T07 | blocked — **not complete** | No independent status reviewer; S01-T01 through T06 not accepted. |
| S02-T01 | candidate — **not complete** | Claim now evaluates canonical snapshot and durable role under BEGIN IMMEDIATE. Raw-claim tests are unrun; missing stored gate declarations, denied operation outcomes and every public surface still need acceptance. |
| S02-T02 | not started — **not complete** | Finish/close/release/reopen still require shared evaluator enforcement, owner/role/revision/fence/gate/review/close-intent checks and durable expiry disposition. |
| S02-T03 | not started — **not complete** | Existing dependency/schema guards retained, not completed typed-endpoint/terminal/waiver policies or new compatibility-strategy fixtures. |
| S02-T04 | candidate — **not complete** | Existing hold resolution made operator/project scoped with tighter replay identity. Named gate force and edge-specific waiver records/authorization/expiry/evidence/readback are NOT implemented. |
| S02-T05 | not started — **not complete** | No new public review open/show/approve/reject/return operations or complete source/config/policy/fence-bound review workflow. |
| S02-T06 | candidate — **not complete** | One raw SQLite concurrent-claim test plus replay/stale/role/hold regressions authored but unrun. Full hold/dependency/review/override races and crash/unknown-outcome matrix not implemented. |
| S02-T07 | blocked — **not complete** | Enforcement and status gates not accepted; no independent validator. |
| S03-T01 | not started — **not complete** | Create/edit/archive/reopen hierarchy use cases and complete sample-tree acceptance not implemented beyond baseline. |
| S03-T02 | not started — **not complete** | Per-work profile/version/custom gate selection and independent persisted declarations need implementation. Existing definition_json is not complete authoritative gate configuration. |
| S03-T03 | not started — **not complete** | Namespaced review-status classification is corrected in a domain candidate only. Genuine receipt/review/close-intent paths for every configured profile remain unvalidated/incomplete. |
| S03-T04 | not started — **not complete** | No complete cycle lifecycle/assignment/carry-over/compatibility migration adapter. Bounded hierarchy decision is not a waiver of this gate. |
| S03-T05 | not started — **not complete** | No exact descendant rollups, critical blockers, percentage/readiness or corrupt-child/reassignment/pagination conformance. |
| S03-T06 | not started — **not complete** | No complete planning validation and trusted sprint activation/readiness route. |
| S03-T07 | blocked — **not complete** | Planning, fresh/upgrade/cross-project fixtures and S02 review gate remain open. |
| S04-T01 | not started — **not complete** | Versioned workflow list/show discovery and all current command-reference validation are not restored. |
| S04-T02 | not started — **not complete** | No new complete sprint create/launch/current/status/board/report/close route family; planning prerequisites open. |
| S04-T03 | not started — **not complete** | Existing status encoder gains primary_reason, but complete work list/show/next/ready/parallel/review-candidate queue parity is not implemented. |
| S04-T04 | not started — **not complete** | No public typed force/waiver/review/pause/resume/hold route family with full audited authority and readback. |
| S04-T05 | not started — **not complete** | Full guided plan/claim/checkpoint/evidence/review/finish/release/handoff loop remains incomplete, and discovery/public operations are still prerequisites. |
| S04-T06 | candidate — **not complete** | TUI primary reasons, integrity diagnostics and no-duplicate diagnostic rows tested; existing responsive surface preserved. No complete rollups/cycle/operator UI or genuine Rust-service acceptance. |
| S04-T07 | blocked — **not complete** | Public parity and independent review are not complete; passing presentation fixtures cannot satisfy this gate. |
| S05-T01 | not started — **not complete** | Baseline project discovery preserved; required full two-project CLI/service/TUI/memory isolation validation was not performed. |
| S05-T02 | candidate — **not complete** | Malformed clocks, invalid direct parents and orphan prerequisite diagnostics added; affected TUI rows disabled. Invalid gate/attempt prefetch, transitive ancestors and exact diagnostic pagination remain incomplete. |
| S05-T03 | not started — **not complete** | No complete v1 dry-run/export/import disposition implementation; actual v1 archive and complete cycle/profile/review mapping still required. |
| S05-T04 | blocked — **not complete** | No rebuilt Rust binary/toolchain, independent service operator or complete public lifecycle. No genuine-service receipt/E2E run was performed. |
| S05-T05 | not started — **not complete** | Full multi-agent/failure/service-restart/reader-during-write fixture and queue-wait/transaction-hold measurement not run. |
| S05-T06 | candidate — **not complete** | Candidate contracts, parity, limits and remaining-task documentation supplied; not final user/operator documentation for a finished product. |
| S05-T07 | blocked — **not complete** | Isolation, migration, genuine service and concurrent gates are not accepted; independent review absent. |
| S06-T01 | candidate — **not complete** | Available source/TypeScript/presentation/installer checks pass; seven Cargo invocations could not start. S05 prerequisite not passed; no Rust formatting/workspace/build certification. |
| S06-T02 | candidate — **not complete** | Source ZIP now retains recovered CJS wizard and full text TUI tree. No rebuilt Rust binary, production release archive or tested M02 installer payload. |
| S06-T03 | not started — **not complete** | Local fake-release installer fixture passes, but no actual newly rebuilt binary was installed/smoke-tested in a disposable prefix. |
| S06-T04 | not started — **not complete** | No actual macOS/BSD-tar/signing/ABI release validation; Linux presentation tests are not supported-target release smoke tests. |
| S06-T05 | blocked — **not complete** | Independent final auditor absent and critical gates open. Coordinator decision is do not ship, not an independent cutover approval. |
| S06-T06 | not started — **not complete** | No ship approval, release branch/tag/artifact publishing or installer-source cutover. Commits are local only; no upgrade command is claimed. |

## 6. Local commit-by-commit mini log

The uploaded source had no usable upstream Git history. `7731b05` is a locally
created baseline, not a claim about the user's upstream revision. Commits were
local only; no remote branch, tag, artifact or installer source was published.

```text
7731b05 chore: preserve supplied Boreal v2 reference snapshot
0b5b22d docs(m02): record contract reconciliation and bounded sprint strategy
3fd95f5 docs(m02): reconcile acceptance fixture compatibility after validation
10cf699 fix(status): centralize decisions and transactional claim eligibility
28a974c fix(tui): preserve primary reasons and quarantine diagnostic rows
e33d65f fix(packaging): retain installer sources and verify source ZIPs
```

Final delivery-metadata commit: `docs(m02): record partial implementation
evidence and release blockers`. It contains this report, task/fixture ledgers,
author review, source fingerprints and retained evidence. Its hash is supplied
in the delivery response rather than self-embedded in its own contents.
The source ZIP generator intentionally excludes `.git`; this mini log is
retained for the receiving repository's reconciliation.

## 7. Changed-file appendix

The following 67 paths changed or were added relative to local
baseline `7731b05`. No path is omitted behind a directory-only summary.
`REFERENCE_INDEX.md` is additionally regenerated by the root ZIP script in
the delivered archive; it is an archive index, not a new implementation file.

| Changed path | What changed |
| --- | --- |
| `IMPLEMENTATION_REPORT.md` | Delivery scope, all 48 task dispositions, local mini log, changed-file appendix, tests, schema/protocol/migration impact and next safe action. |
| `apps/tui/installer/wizard-body.cjs` | Recovered canonical wizard source from the original embedded install.sh payload; not a new fabricated installer implementation. |
| `apps/tui/installer/wizard.cjs` | Recovered standalone wizard bundle; generated/embedded byte identity verified. |
| `apps/tui/src/client.ts` | Decode optional primary reason, reject contradictory primary ordering, merge diagnostics onto their work row and avoid duplicate selectable IDs. |
| `apps/tui/src/ui/dashboard.ts` | Show primary reason explicitly and retain remaining server reasons without a client-side evaluator. |
| `apps/tui/tests/m02-contract.test.mjs` | Five added tests: additive primary field, old response compatibility, contradictory primary rejection, responsive reason detail, single diagnostic row with disabled actions. |
| `crates/application/src/status.rs` | Use durable actor read snapshot and shared store clock decoding; remove adapter-side timer repair so domain owns next-change time. |
| `crates/application/tests/boundary_remediation.rs` | Use the registered actor for status reads instead of an invented status-reader identity. |
| `crates/application/tests/m02_status_authority.rs` | Two authored, unrun tests for durable role authority and store-backed combined pause/dependency/timer reasons. |
| `crates/application/tests/p2_guided_flow.rs` | Explicitly register the status-reader actor in the fixture; no bypass of durable role lookup. |
| `crates/cli/src/main.rs` | Emit primary_reason using the existing shared status JSON encoder; no local transition policy. |
| `crates/domain/src/lib.rs` | Export the single evaluator module and add primary_reason plus typed reason variants; remove the old inline evaluator. |
| `crates/domain/src/status_evaluator.rs` | Pure primary precedence/reason collection, role-specific claimability, required-gate checks, namespaced review-kind classification and retry/attempt timers. |
| `crates/domain/tests/hierarchy_semantics.rs` | Document/test provisional nonclaimable container planning label; does not certify actual descendant rollups. |
| `crates/domain/tests/m02_status.rs` | 15 authored, unrun tests for combined reasons, precedence, clocks, history, review kind, terminal behavior, roles and close-only dependencies. |
| `crates/protocol/src/models.rs` | Backward-readable optional primary_reason StatusDto field; no major protocol version bump. |
| `crates/protocol/tests/m02_status_wire.rs` | One authored, unrun old/new DTO round-trip compatibility test. |
| `crates/store/src/lib.rs` | Factor canonical status snapshot for reads/write transactions; replace claim eligibility SQL with domain decision; canonical claim clocks; durable operator/project hold-resolution checks; candidate query remains a hint. |
| `crates/store/src/status_evaluation.rs` | Shared attempt/retry clock decoding, stored actor lookup, transactional domain decision assembly and bounded record-integrity diagnostics. |
| `crates/store/tests/m02_claim.rs` | 10 authored, unrun store regressions: hold/role/pause, numeric retry, bad clocks, replay, orphan dependencies, malformed clock, scoped hold resolution, stale/foreign claims and concurrent claim. |
| `crates/store/tests/store_contracts.rs` | Change only selected raw-claim fixture inputs to canonical numeric timestamps; retained expiry/reclaim behavior is explicitly still an M02 gap. |
| `create-zips.mjs` | Retain .cjs, include root implementation report and require report plus both installer CJS files in the real source archive. |
| `project/STATUS_MODEL.md` | Mark reconciliation/precedence target and clarify historical narrative versus current candidate contract. |
| `project/WORKFLOW_PARITY.md` | Point to the explicit M02 parity inventory and state limits of available v1 evidence. |
| `project/spec/acceptance-profiles.json` | Canonical summary gate vocabulary and version 1; retain manifest-compatible fixture_version and separate M02 candidate revision; document gate identity/history rules. |
| `project/spec/protocol/compatibility.md` | Document additive primary_reason compatibility and unchanged version/schema limits. |
| `project/spec/transition-table.md` | M02 precedence, separate primary reason and explicit target override authority/audit/revision policy; not a claim all routes exist. |
| `project/validation/m02/COMMAND_INVENTORY.json` | Source inventory of every known route/gap in the supplied v2 CLI registry; not an independently verified v1 inventory. |
| `project/validation/m02/ENVIRONMENT.md` | Input hashes, local baseline provenance, actual tools, missing Rust/independent review and platform limitations. |
| `project/validation/m02/FIXTURE_MATRIX.json` | Status/transition fixture inventory with missing positive/negative cases and unrun Rust coverage explicitly identified. |
| `project/validation/m02/HANDOFF.md` | Serial exclusive write boundaries, per-task candidate handoffs, tests/risks and next safe review state. |
| `project/validation/m02/PARITY.md` | Preserve/rework/replace/defer/historical-only mapping, owners, migration impacts and missing v1 evidence. |
| `project/validation/m02/REQUEST.md` | Verbatim preservation of supplied implementation request and complete M02 plan. |
| `project/validation/m02/REVIEW.md` | Author-only review, findings with severity/owners, reconciliation evidence, unaccepted dependency gates and do-not-ship decision. |
| `project/validation/m02/SOURCE_FINGERPRINT.json` | SHA-256 manifest for changed production/contract/tool sources through candidate commit e33d65f. |
| `project/validation/m02/SPRINT_STRATEGY.md` | Bounded hierarchy strategy candidate, persistence/public compatibility, migration/rollback and dated follow-up proposal; v3 adapter not claimed. |
| `project/validation/m02/TASKS.json` | Machine-readable 48-task owner/dependency/state/evidence/remaining-work ledger; accepted_complete is false for every task. |
| `project/validation/m02/evidence/baseline-tui.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/contracts-candidate.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/contracts-reconciled.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/final-source-extraction.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/installer-recovery-check.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/m02-tui-first.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/m02-tui-reconciled.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/recovered-tui.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
| `project/validation/m02/evidence/run-01/checks.json` | Machine-readable result for all 19 commands: 12 passed, seven tool-unavailable; runner fails closed with release decision do not ship. |
| `project/validation/m02/evidence/run-01/contracts.md` | Retained command output: structural existing contract/SQLite fixtures; not full M02; passed, exit 0. |
| `project/validation/m02/evidence/run-01/diff-whitespace.md` | Retained command output: source hygiene only; passed, exit 0. |
| `project/validation/m02/evidence/run-01/installer-identity.md` | Retained command output: generated wizard and embedded installer byte identity; passed, exit 0. |
| `project/validation/m02/evidence/run-01/premium.md` | Retained command output: real PTYs and local fake release/controller fixtures, NOT Rust E2E; passed, exit 0. |
| `project/validation/m02/evidence/run-01/responsive.md` | Retained command output: real PTYs and fake service fixtures, NOT Rust E2E; passed, exit 0. |
| `project/validation/m02/evidence/run-01/rust-application.md` | Retained command output: authored durable actor/status tests; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/rust-cli-build.md` | Retained command output: CLI build, not release packaging; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/rust-domain.md` | Retained command output: authored M02 evaluator tests; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/rust-format.md` | Retained command output: Rust formatting; requires installed rustfmt; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/rust-protocol.md` | Retained command output: authored additive DTO tests; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/rust-store.md` | Retained command output: authored canonical claim/race tests; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/rust-workspace.md` | Retained command output: full locked workspace tests; blocked_tool_unavailable, exit 127. |
| `project/validation/m02/evidence/run-01/shell-syntax.md` | Retained command output: shell parser only; passed, exit 0. |
| `project/validation/m02/evidence/run-01/source-archive.md` | Retained command output: real root ZIP generator + isolated TUI rebuild; NOT release binary; passed, exit 0. |
| `project/validation/m02/evidence/run-01/tui-tests.md` | Retained command output: core suite + Node unit/presentation fixtures; passed, exit 0. |
| `project/validation/m02/evidence/run-01/tui-typecheck.md` | Retained command output: TypeScript compiler; passed, exit 0. |
| `project/validation/m02/evidence/run-01/wizard-body-js-syntax.md` | Retained command output: JavaScript parser only; passed, exit 0. |
| `project/validation/m02/evidence/run-01/wizard-js-syntax.md` | Retained command output: JavaScript parser only; passed, exit 0. |
| `project/validation/m02/evidence/run-01/zip-js-syntax.md` | Retained command output: JavaScript parser only; passed, exit 0. |
| `scripts/validation/m02/run_candidate.py` | Reproducible 19-command check runner; retains Markdown/JSON evidence and exits nonzero on failed or unavailable checks. |
| `scripts/validation/m02/source_archive_test.py` | Use root generator or inspect a provided archive; verify required/full TUI bytes, exclusions/CRC/path safety and optionally exercise an isolated source extraction. |

## 8. Critical limitations and next safe action

The detailed severity/owner ledger is `project/validation/m02/REVIEW.md`.
The most important unresolved correctness gaps are independently persisted
required-gate declarations, finish/close/release/reopen enforcement, durable
expiry disposition, complete authentication/session authority, typed gate
force/edge waiver and independent review routes. Product schedule inputs,
actual container rollups, sprint/cycle readiness, public workflow/queue parity,
v1 import, broader corruption handling and exact diagnostic pagination remain.
Canonical claim currently reads the full project while holding the write
transaction; queue wait and lock-hold performance have not been measured.

**Next safe action:** keep this on an isolated review branch, resolve the S00
contract/v1 evidence gaps and obtain independent S00-T07 review; then run the
recorded locked Rust tests/formatting in a Rust-capable checkout and reconcile
compiler, behavioral and critical findings before accepting the source
candidates. Continue only through the exact S01/S02/S03 revalidation gates.
Do not deploy, publish or mark M02 complete on the strength of this source ZIP
or the passing presentation fixtures.
