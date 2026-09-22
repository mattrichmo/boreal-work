# R-REPORT — IMPLEMENTATION_REPORT.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `IMPLEMENTATION_REPORT.md:L1–L406`  
**File SHA-256:** `e37e53570737e46686060d8f5c483d6ff34ed137d76b85e2f7ca735e54280aa7`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Partial/unaccepted candidate report, authored but unrun Rust tests and exact known omissions.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,406p' 'IMPLEMENTATION_REPORT.md'
```

## Exact baseline excerpt

````text
    1 | # IMPLEMENTATION REPORT — M02 source candidate
    2 | 
    3 | Date: 2026-09-21. Source: `boreal-v2-reference-20260921T175404486Z.zip`.
    4 | 
    5 | ## 1. Decision and delivered scope
    6 | 
    7 | **Do not ship. This is a partial source implementation, not a completed M02
    8 | release. Completed M02 task IDs: none (0 of 48 accepted).**
    9 | 
   10 | Actual Rust, TypeScript, tests, contract and packaging changes are included in
   11 | the existing repository. They are not merely recommendations or a patch-only
   12 | response. The strongest implemented candidates address deterministic status
   13 | precedence/all-reasons preservation, canonical transactional claim checks,
   14 | durable actor-role lookup, namespaced review gates, diagnostic display and a
   15 | source-archive omission that prevented the supplied installer tests from
   16 | running. The complete original M02 plan and this request are preserved.
   17 | 
   18 | **Rust code and its 28 newly authored Rust tests are uncompiled and unrun.**
   19 | Cargo/rustc/rustfmt were unavailable; toolchain downloads did not succeed.
   20 | No independent reviewer, parallel code subagent or genuine service operator
   21 | was available. The S00-T07 independent gate did not pass. Downstream edits are
   22 | unaccepted remediation candidates, not accepted S01–S06 sprint advancement.
   23 | This explicitly falls short of the requested dependency-gated execution model.
   24 | There are no approved deferrals and no invented independent review receipts.
   25 | 
   26 | The available TypeScript, terminal, installer-source and source-archive checks
   27 | pass. None of those substitute for Rust tests, real-service lifecycle,
   28 | migration parity or release smoke tests. The full task ledger below gives
   29 | exact outstanding work rather than claiming broad completion from test counts.
   30 | 
   31 | The returned archive is made by the repository's **root `create-zips.mjs`**.
   32 | It is a complete selected text-source snapshot, not a production installer.
   33 | It contains the recovered wizard sources, complete text TUI tree, changed
   34 | Rust code/tests, original plan, task ledger, failed/successful evidence and
   35 | this report. It intentionally excludes `.git`, target/dist/node_modules,
   36 | fonts/binary assets and live project databases. **It does not contain a newly
   37 | rebuilt Rust executable or published release payload.**
   38 | 
   39 | ## 2. Actual implementation changes
   40 | 
   41 | ### Deterministic decision and read path
   42 | 
   43 | The old inline evaluator is replaced by `crates/domain/src/status_evaluator.rs`.
   44 | It collects applicable canonical facts before selecting a primary status.
   45 | Terminal state takes precedence; expiry/hard intervention precedes draft and
   46 | active attempt; idle pause/retry precede ordinary open prerequisites. All
   47 | secondary reasons are retained, sorted by stable code and deduplicated;
   48 | `primary_reason` remains explicit and first in `reason_codes`. Failed,
   49 | released and cancelled historical attempts no longer lend their expired
   50 | clocks to an idle task. Active lease/hard-budget and retry timers are owned by
   51 | the domain decision instead of being repaired by the application projection.
   52 | 
   53 | Required review classification uses `GateKind::Review`, not a literal gate
   54 | ID, so `TASK:review` is classified as review. A failed required review is
   55 | hard intervention; failed technical proof remains a verification gap. Pure
   56 | inputs with missing/mistyped/duplicate required gate definitions fail closed.
   57 | However, the **store still cannot independently reconstruct a deleted required
   58 | gate declaration**, because baseline profile definitions are incomplete. That
   59 | critical gap is not concealed by the pure-domain missing-gate tests.
   60 | 
   61 | Store-backed status and claim now look up the actor's durable role. Claim
   62 | eligibility is not derived from a client-supplied role. This does not complete
   63 | authentication, actor-session authorization or every public adapter. Containers
   64 | have a provisional, nonclaimable `queued/container_planning` label instead of
   65 | `blocked/non_executable_container`; **this is not a child rollup** and does not
   66 | satisfy S01-T05 or S03-T05.
   67 | 
   68 | ### Write transaction and damaged-record handling
   69 | 
   70 | Raw claim re-reads canonical work/dependencies/holds/gates/attempt/actor inside
   71 | `BEGIN IMMEDIATE` and calls the same domain evaluator as the status projection.
   72 | It retains operation replay, expected revision, session checks, fenced attempt
   73 | and reservation writes and the existing audit event. A hold, disallowed role,
   74 | pause, retry, current attempt or open prerequisite cannot be bypassed merely
   75 | by the old SQL candidate filter in this implementation. This claim is based
   76 | on source changes; the authored Rust transaction tests have **not run**.
   77 | 
   78 | Claim timestamps are parsed as unsigned canonical milliseconds rather than
   79 | compared lexicographically. Lease and hard deadlines must be later than claim
   80 | time. The candidate-list query is an optimization hint, not authorization;
   81 | final claim evaluates policy again. Reads/claims share attempt-clock decoding.
   82 | Corrupt clocks/direct parent relationships and missing or unreadable
   83 | prerequisites produce diagnostics; an orphan prerequisite is an explicit hard
   84 | reason on its dependent rather than a dropped readiness constraint.
   85 | 
   86 | Existing hold resolution now requires a stored operator role and the exact
   87 | work/project match; replay also binds actor and command. This is limited
   88 | hardening of **existing hold resolution**, not implementation of typed gate
   89 | force or edge-level dependency waiver. Failed claim transactions still roll
   90 | back without a durable rejected-operation outcome, and full finish/close/
   91 | release/reopen enforcement and expiry disposition remain outstanding.
   92 | 
   93 | ### Protocol, terminal UI and source packaging
   94 | 
   95 | The shared CLI/service status encoder emits optional `primary_reason` and the
   96 | protocol DTO remains able to decode older responses without it. The TUI
   97 | preserves primary/secondary reasons and rejects contradictory primary fields
   98 | instead of silently repairing service data. A diagnostic for an existing work
   99 | item is merged onto that item, preventing duplicate selectable IDs and keeping
  100 | actions disabled for the damaged row. This remains service-backed client code,
  101 | not SQLite access or another lifecycle evaluator.
  102 | 
  103 | The uploaded ZIP omitted `apps/tui/installer/wizard.cjs` and
  104 | `wizard-body.cjs`: the root source selector did not allow `.cjs`. Both were
  105 | recovered from the supplied `install.sh` embedded payload. Generated/source/
  106 | embedded installer byte identity passes. The selector now retains `.cjs`,
  107 | includes this report, and requires both wizard files plus the report. A new
  108 | archive regression invokes the real generator, checks the full TUI text tree
  109 | byte-for-byte and tests it from an isolated extraction.
  110 | 
  111 | ## 3. Validation and retained failures
  112 | 
  113 | `project/validation/m02/evidence/run-01/checks.json` records **19 commands:
  114 | 12 passed, seven blocked because Cargo could not start**. The candidate runner
  115 | returned **exit 1**, intentionally. It is not a successful M02/release gate.
  116 | 
  117 | | Check | Observed result |
  118 | | --- | --- |
  119 | | TypeScript typecheck | Passed. |
  120 | | Core TUI suite and Node tests | Passed; **98 Node tests**, including five added M02 presentation/compatibility regressions. |
  121 | | Premium/installer fixture validator | **15 passed**; real PTYs/local fake release/controller fixtures, not a rebuilt production binary. |
  122 | | Responsive PTY validator | **13 passed**; includes short editor panels, live resize, cancellation and small wizard surfaces. Uses fake service fixtures. |
  123 | | New reason-detail dimensions | 80×24, 100×32, 144×40 and 44×12 exercised in Node tests. Existing PTY tests include smaller editor splits. |
  124 | | Installer generated/embedded identity | Passed; recovered canonical sources agree with the original embedded payload. |
  125 | | Contract validator | Passed structurally: 8 envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal vectors, 19 clock/dependency cases, 52 mappings, SQLite schema parsed. **Not full M02 conformance.** |
  126 | | Source archive/extracted checkout | Passed: real root generator, required files/full TUI bytes, archive CRC and safe/excluded paths; isolated TUI rebuild/tests, installer check and contract validator. |
  127 | | Rust formatter, four focused Rust suites, full locked workspace and CLI build | All seven invocations blocked before execution, exit 127. **No Rust compile, format or test pass is claimed.** |
  128 | | Real Rust-service lifecycle with genuine receipts | Not run. |
  129 | | Production-prefix installation, macOS/BSD-tar/signing/ABI and supported Linux release smoke | Not run. Fake-release presentation fixtures are not counted as these gates. |
  130 | 
  131 | The 28 new Rust tests comprise 15 domain, 10 store, two application and one
  132 | protocol test. Existing hierarchy/timestamp/registered-actor fixtures were
  133 | updated separately. No genuine receipt or successful production installation
  134 | was fabricated to satisfy an acceptance check.
  135 | 
  136 | ### Commands and results
  137 | 
  138 | Every captured command below has its stdout/stderr, result and scope in
  139 | `project/validation/m02/evidence/run-01/`.
  140 | 
  141 | | Command | Result / exit | Scope |
  142 | | --- | --- | --- |
  143 | | `git diff --check` | passed / 0 | source hygiene only |
  144 | | `python3 project/spec/validate_contracts.py` | passed / 0 | structural existing contract/SQLite fixtures; not full M02 |
  145 | | `cargo fmt --all -- --check` | blocked tool unavailable / 127 | Rust formatting; requires installed rustfmt |
  146 | | `cargo test --locked -p boreal-domain --test m02_status` | blocked tool unavailable / 127 | authored M02 evaluator tests |
  147 | | `cargo test --locked -p boreal-store --test m02_claim` | blocked tool unavailable / 127 | authored canonical claim/race tests |
  148 | | `cargo test --locked -p boreal-application --test m02_status_authority` | blocked tool unavailable / 127 | authored durable actor/status tests |
  149 | | `cargo test --locked -p boreal-protocol --test m02_status_wire` | blocked tool unavailable / 127 | authored additive DTO tests |
  150 | | `cargo test --locked --workspace` | blocked tool unavailable / 127 | full locked workspace tests |
  151 | | `cargo build --locked -p boreal-cli` | blocked tool unavailable / 127 | CLI build, not release packaging |
  152 | | `npm --prefix apps/tui run typecheck` | passed / 0 | TypeScript compiler |
  153 | | `npm --prefix apps/tui test` | passed / 0 | core suite + Node unit/presentation fixtures |
  154 | | `node scripts/build-installer.mjs --check` | passed / 0 | generated wizard and embedded installer byte identity |
  155 | | `sh -n install.sh` | passed / 0 | shell parser only |
  156 | | `node --check create-zips.mjs` | passed / 0 | JavaScript parser only |
  157 | | `node --check apps/tui/installer/wizard.cjs` | passed / 0 | JavaScript parser only |
  158 | | `node --check apps/tui/installer/wizard-body.cjs` | passed / 0 | JavaScript parser only |
  159 | | `python3 scripts/validation/premium/validate_premium.py -v` | passed / 0 | real PTYs and local fake release/controller fixtures, NOT Rust E2E |
  160 | | `python3 scripts/validation/premium/validate_responsive.py -v` | passed / 0 | real PTYs and fake service fixtures, NOT Rust E2E |
  161 | | `python3 scripts/validation/m02/source_archive_test.py --exercise` | passed / 0 | real root ZIP generator + isolated TUI rebuild; NOT release binary |
  162 | 
  163 | Earlier evidence is retained rather than overwritten:
  164 | `evidence/baseline-tui.md` records the original missing-installer failure;
  165 | `evidence/contracts-candidate.md` records the rejected fixture-version edit.
  166 | `contracts-reconciled.md` records the corrected version check;
  167 | `recovered-tui.md`, `m02-tui-first.md` and `m02-tui-reconciled.md` record the
  168 | 93 → 97 → 98 test progression. The earliest archive exercise used a preliminary
  169 | report solely to prove inclusion. The delivered archive is generated after
  170 | this complete report is written. Source/installer checks are not release proof.
  171 | 
  172 | Reproduce source checks in an isolated checkout with:
  173 | 
  174 | ```sh
  175 | python3 scripts/validation/m02/run_candidate.py --output /tmp/boreal-m02-evidence
  176 | ```
  177 | 
  178 | That command must remain nonzero until missing/failed checks are resolved.
  179 | Even an eventual zero would not replace the independent sprint, genuine
  180 | service, migration and supported-platform release gates in the supplied plan.
  181 | 
  182 | Generate the source artifact with:
  183 | 
  184 | ```sh
  185 | node create-zips.mjs --output-dir /tmp/boreal-m02-source
  186 | python3 scripts/validation/m02/source_archive_test.py --exercise
  187 | ```
  188 | 
  189 | ## 4. Schema, protocol and migration impact
  190 | 
  191 | **Schema:** no SQL schema or schema-version changes, no new migrations,
  192 | no `Cargo.lock` changes and no rewriting of stored lifecycle or historical
  193 | receipts/reviews/attempts. v2 tables remain authoritative. Opt-in v3
  194 | contracts/low-level groundwork remain present and explicitly incomplete.
  195 | No cycle-backed public adapter or persisted override table is claimed.
  196 | 
  197 | **Protocol:** `boreal.work-status/2` and existing DTO version labels are
  198 | retained. `primary_reason` is additive/optional for decoding; the encoder
  199 | emits it. `reason_codes[0]` must agree with it when present. Reason vocabulary
  200 | adds gate-open/failed/missing/invalid, rejected-review, role-denied,
  201 | attempt-subject-mismatch and provisional container-planning diagnostics.
  202 | The intended precedence change is behavioral and needs independent contract
  203 | and full adapter compatibility review; an optional field alone does not prove
  204 | all wire compatibility.
  205 | 
  206 | **Acceptance contract:** focused/1 and reviewed/1 use `summary`, matching
  207 | existing Rust constructors; `audit` is not silently substituted for summary
  208 | proof. Audit events remain a distinct requirement. The manifest-compatible
  209 | fixture version stays `p0-03.v2`, with a separate candidate revision marker.
  210 | Unknown/custom profile versions and independently persisted required gate
  211 | configuration still need implementation/validation.
  212 | 
  213 | **Clock/actor compatibility:** new raw claims require `unix-ms:<unsigned
  214 | decimal>` times; legacy RFC3339/`tN` strings are rejected, not guessed or
  215 | rewritten. Read projections now require a registered actor row. Actual old
  216 | adapters/importers need compatibility tests and explicit migration disposition
  217 | before production use. Timestamp edits are test input changes, not a database
  218 | migration or authorization to erase history.
  219 | 
  220 | **Sprint strategy:** the bounded fixed hierarchy is a documented candidate
  221 | with explicit persistence/compatibility/migration/rollback limits and a proposed
  222 | 2026-10-05 follow-up planning checkpoint, not an automation or release promise.
  223 | S03 cycle/rollup/readiness outcomes remain open; the decision does not waive
  224 | M02 or claim v3 support. Existing v3 data must never be dropped on rollback.
  225 | 
  226 | **Packaging:** `.cjs` selection is repaired. Future source archives retain the
  227 | wizard sources and the entire text TUI tree. A real future installer still
  228 | requires a fresh Rust binary, TUI distribution, release payload, prefix smoke
  229 | and platform gates; none were published here. No `bwrk upgrade` route is claimed.
  230 | 
  231 | ## 5. Completed, incomplete and deferred task IDs
  232 | 
  233 | **Completed / accepted: none. Approved deferrals: none.** Candidate means
  234 | source work or evidence exists, not that the task's named acceptance passed.
  235 | Blocked/not-started rows are not silently waived. Owners, original dependency
  236 | text and per-task evidence are also in `project/validation/m02/TASKS.json`.
  237 | 
  238 | | Task ID | State | Exact remaining work / reason |
  239 | | --- | --- | --- |
  240 | | S00-T01 | candidate — **not complete** | Registry inventory and dispositions exist, but the actual v1 runtime/archive was not supplied. Historical legacy-map references are not independently reverified. |
  241 | | S00-T02 | candidate — **not complete** | Precedence/primary-reason contract updated; full predicates, next actions, complete reason vocabulary and positive/negative schedule fixtures still require review. |
  242 | | S00-T03 | candidate — **not complete** | Typed override/transition policy recorded, not complete executable legal/illegal coverage or independently frozen authority. |
  243 | | S00-T04 | candidate — **not complete** | summary vocabulary and numeric version reconciled; full per-work profile persistence, public adapters and required-gate integrity are not complete. |
  244 | | S00-T05 | candidate — **not complete** | Bounded hierarchy decision candidate names persistence/compatibility/migration/rollback; no independent approval, complete rollups or public cycle adapter. |
  245 | | S00-T06 | candidate — **not complete** | Fixture inventory has explicit missing cases. Full positive and negative conformance for every normative status/transition is not present. |
  246 | | S00-T07 | blocked — **not complete** | No independent validator or reviewer was available. Critical findings remain unresolved. Author review is not independent contract acceptance. |
  247 | | S01-T01 | candidate — **not complete** | Pure evaluator rewrite and 15 new domain tests authored but not compiled/run. Gate declarations, full schedule inputs and safe next-action coverage remain incomplete. |
  248 | | S01-T02 | candidate — **not complete** | Paused/retry/dependency/hold precedence rewritten with combined-condition tests; real direct/service/CLI/TUI parity at one revision is not run. |
  249 | | S01-T03 | candidate — **not complete** | Store-backed reads/claims look up durable actor role. Complete authenticated actor/session/project/dispatch propagation is not certified; Rust tests unavailable. |
  250 | | S01-T04 | candidate — **not complete** | Retry/lease/hard-budget timing centralized and numeric claim clocks checked. Not-before, product due/overdue and durable post-expiry disposition are not wired. |
  251 | | S01-T05 | candidate — **not complete** | Containers receive provisional nonclaimable queued/container_planning only. No child/sprint/gate/overdue/closeout rollup implementation; not a completed planning projection. |
  252 | | S01-T06 | candidate — **not complete** | Permutation, terminal, history and closed-only tests authored; not run. Full property/conformance oracle and all domain inputs remain incomplete. |
  253 | | S01-T07 | blocked — **not complete** | No independent status reviewer; S01-T01 through T06 not accepted. |
  254 | | S02-T01 | candidate — **not complete** | Claim now evaluates canonical snapshot and durable role under BEGIN IMMEDIATE. Raw-claim tests are unrun; missing stored gate declarations, denied operation outcomes and every public surface still need acceptance. |
  255 | | S02-T02 | not started — **not complete** | Finish/close/release/reopen still require shared evaluator enforcement, owner/role/revision/fence/gate/review/close-intent checks and durable expiry disposition. |
  256 | | S02-T03 | not started — **not complete** | Existing dependency/schema guards retained, not completed typed-endpoint/terminal/waiver policies or new compatibility-strategy fixtures. |
  257 | | S02-T04 | candidate — **not complete** | Existing hold resolution made operator/project scoped with tighter replay identity. Named gate force and edge-specific waiver records/authorization/expiry/evidence/readback are NOT implemented. |
  258 | | S02-T05 | not started — **not complete** | No new public review open/show/approve/reject/return operations or complete source/config/policy/fence-bound review workflow. |
  259 | | S02-T06 | candidate — **not complete** | One raw SQLite concurrent-claim test plus replay/stale/role/hold regressions authored but unrun. Full hold/dependency/review/override races and crash/unknown-outcome matrix not implemented. |
  260 | | S02-T07 | blocked — **not complete** | Enforcement and status gates not accepted; no independent validator. |
  261 | | S03-T01 | not started — **not complete** | Create/edit/archive/reopen hierarchy use cases and complete sample-tree acceptance not implemented beyond baseline. |
  262 | | S03-T02 | not started — **not complete** | Per-work profile/version/custom gate selection and independent persisted declarations need implementation. Existing definition_json is not complete authoritative gate configuration. |
  263 | | S03-T03 | not started — **not complete** | Namespaced review-status classification is corrected in a domain candidate only. Genuine receipt/review/close-intent paths for every configured profile remain unvalidated/incomplete. |
  264 | | S03-T04 | not started — **not complete** | No complete cycle lifecycle/assignment/carry-over/compatibility migration adapter. Bounded hierarchy decision is not a waiver of this gate. |
  265 | | S03-T05 | not started — **not complete** | No exact descendant rollups, critical blockers, percentage/readiness or corrupt-child/reassignment/pagination conformance. |
  266 | | S03-T06 | not started — **not complete** | No complete planning validation and trusted sprint activation/readiness route. |
  267 | | S03-T07 | blocked — **not complete** | Planning, fresh/upgrade/cross-project fixtures and S02 review gate remain open. |
  268 | | S04-T01 | not started — **not complete** | Versioned workflow list/show discovery and all current command-reference validation are not restored. |
  269 | | S04-T02 | not started — **not complete** | No new complete sprint create/launch/current/status/board/report/close route family; planning prerequisites open. |
  270 | | S04-T03 | not started — **not complete** | Existing status encoder gains primary_reason, but complete work list/show/next/ready/parallel/review-candidate queue parity is not implemented. |
  271 | | S04-T04 | not started — **not complete** | No public typed force/waiver/review/pause/resume/hold route family with full audited authority and readback. |
  272 | | S04-T05 | not started — **not complete** | Full guided plan/claim/checkpoint/evidence/review/finish/release/handoff loop remains incomplete, and discovery/public operations are still prerequisites. |
  273 | | S04-T06 | candidate — **not complete** | TUI primary reasons, integrity diagnostics and no-duplicate diagnostic rows tested; existing responsive surface preserved. No complete rollups/cycle/operator UI or genuine Rust-service acceptance. |
  274 | | S04-T07 | blocked — **not complete** | Public parity and independent review are not complete; passing presentation fixtures cannot satisfy this gate. |
  275 | | S05-T01 | not started — **not complete** | Baseline project discovery preserved; required full two-project CLI/service/TUI/memory isolation validation was not performed. |
  276 | | S05-T02 | candidate — **not complete** | Malformed clocks, invalid direct parents and orphan prerequisite diagnostics added; affected TUI rows disabled. Invalid gate/attempt prefetch, transitive ancestors and exact diagnostic pagination remain incomplete. |
  277 | | S05-T03 | not started — **not complete** | No complete v1 dry-run/export/import disposition implementation; actual v1 archive and complete cycle/profile/review mapping still required. |
  278 | | S05-T04 | blocked — **not complete** | No rebuilt Rust binary/toolchain, independent service operator or complete public lifecycle. No genuine-service receipt/E2E run was performed. |
  279 | | S05-T05 | not started — **not complete** | Full multi-agent/failure/service-restart/reader-during-write fixture and queue-wait/transaction-hold measurement not run. |
  280 | | S05-T06 | candidate — **not complete** | Candidate contracts, parity, limits and remaining-task documentation supplied; not final user/operator documentation for a finished product. |
  281 | | S05-T07 | blocked — **not complete** | Isolation, migration, genuine service and concurrent gates are not accepted; independent review absent. |
  282 | | S06-T01 | candidate — **not complete** | Available source/TypeScript/presentation/installer checks pass; seven Cargo invocations could not start. S05 prerequisite not passed; no Rust formatting/workspace/build certification. |
  283 | | S06-T02 | candidate — **not complete** | Source ZIP now retains recovered CJS wizard and full text TUI tree. No rebuilt Rust binary, production release archive or tested M02 installer payload. |
  284 | | S06-T03 | not started — **not complete** | Local fake-release installer fixture passes, but no actual newly rebuilt binary was installed/smoke-tested in a disposable prefix. |
  285 | | S06-T04 | not started — **not complete** | No actual macOS/BSD-tar/signing/ABI release validation; Linux presentation tests are not supported-target release smoke tests. |
  286 | | S06-T05 | blocked — **not complete** | Independent final auditor absent and critical gates open. Coordinator decision is do not ship, not an independent cutover approval. |
  287 | | S06-T06 | not started — **not complete** | No ship approval, release branch/tag/artifact publishing or installer-source cutover. Commits are local only; no upgrade command is claimed. |
  288 | 
  289 | ## 6. Local commit-by-commit mini log
  290 | 
  291 | The uploaded source had no usable upstream Git history. `7731b05` is a locally
  292 | created baseline, not a claim about the user's upstream revision. Commits were
  293 | local only; no remote branch, tag, artifact or installer source was published.
  294 | 
  295 | ```text
  296 | 7731b05 chore: preserve supplied Boreal v2 reference snapshot
  297 | 0b5b22d docs(m02): record contract reconciliation and bounded sprint strategy
  298 | 3fd95f5 docs(m02): reconcile acceptance fixture compatibility after validation
  299 | 10cf699 fix(status): centralize decisions and transactional claim eligibility
  300 | 28a974c fix(tui): preserve primary reasons and quarantine diagnostic rows
  301 | e33d65f fix(packaging): retain installer sources and verify source ZIPs
  302 | ```
  303 | 
  304 | Final delivery-metadata commit: `docs(m02): record partial implementation
  305 | evidence and release blockers`. It contains this report, task/fixture ledgers,
  306 | author review, source fingerprints and retained evidence. Its hash is supplied
  307 | in the delivery response rather than self-embedded in its own contents.
  308 | The source ZIP generator intentionally excludes `.git`; this mini log is
  309 | retained for the receiving repository's reconciliation.
  310 | 
  311 | ## 7. Changed-file appendix
  312 | 
  313 | The following 67 paths changed or were added relative to local
  314 | baseline `7731b05`. No path is omitted behind a directory-only summary.
  315 | `REFERENCE_INDEX.md` is additionally regenerated by the root ZIP script in
  316 | the delivered archive; it is an archive index, not a new implementation file.
  317 | 
  318 | | Changed path | What changed |
  319 | | --- | --- |
  320 | | `IMPLEMENTATION_REPORT.md` | Delivery scope, all 48 task dispositions, local mini log, changed-file appendix, tests, schema/protocol/migration impact and next safe action. |
  321 | | `apps/tui/installer/wizard-body.cjs` | Recovered canonical wizard source from the original embedded install.sh payload; not a new fabricated installer implementation. |
  322 | | `apps/tui/installer/wizard.cjs` | Recovered standalone wizard bundle; generated/embedded byte identity verified. |
  323 | | `apps/tui/src/client.ts` | Decode optional primary reason, reject contradictory primary ordering, merge diagnostics onto their work row and avoid duplicate selectable IDs. |
  324 | | `apps/tui/src/ui/dashboard.ts` | Show primary reason explicitly and retain remaining server reasons without a client-side evaluator. |
  325 | | `apps/tui/tests/m02-contract.test.mjs` | Five added tests: additive primary field, old response compatibility, contradictory primary rejection, responsive reason detail, single diagnostic row with disabled actions. |
  326 | | `crates/application/src/status.rs` | Use durable actor read snapshot and shared store clock decoding; remove adapter-side timer repair so domain owns next-change time. |
  327 | | `crates/application/tests/boundary_remediation.rs` | Use the registered actor for status reads instead of an invented status-reader identity. |
  328 | | `crates/application/tests/m02_status_authority.rs` | Two authored, unrun tests for durable role authority and store-backed combined pause/dependency/timer reasons. |
  329 | | `crates/application/tests/p2_guided_flow.rs` | Explicitly register the status-reader actor in the fixture; no bypass of durable role lookup. |
  330 | | `crates/cli/src/main.rs` | Emit primary_reason using the existing shared status JSON encoder; no local transition policy. |
  331 | | `crates/domain/src/lib.rs` | Export the single evaluator module and add primary_reason plus typed reason variants; remove the old inline evaluator. |
  332 | | `crates/domain/src/status_evaluator.rs` | Pure primary precedence/reason collection, role-specific claimability, required-gate checks, namespaced review-kind classification and retry/attempt timers. |
  333 | | `crates/domain/tests/hierarchy_semantics.rs` | Document/test provisional nonclaimable container planning label; does not certify actual descendant rollups. |
  334 | | `crates/domain/tests/m02_status.rs` | 15 authored, unrun tests for combined reasons, precedence, clocks, history, review kind, terminal behavior, roles and close-only dependencies. |
  335 | | `crates/protocol/src/models.rs` | Backward-readable optional primary_reason StatusDto field; no major protocol version bump. |
  336 | | `crates/protocol/tests/m02_status_wire.rs` | One authored, unrun old/new DTO round-trip compatibility test. |
  337 | | `crates/store/src/lib.rs` | Factor canonical status snapshot for reads/write transactions; replace claim eligibility SQL with domain decision; canonical claim clocks; durable operator/project hold-resolution checks; candidate query remains a hint. |
  338 | | `crates/store/src/status_evaluation.rs` | Shared attempt/retry clock decoding, stored actor lookup, transactional domain decision assembly and bounded record-integrity diagnostics. |
  339 | | `crates/store/tests/m02_claim.rs` | 10 authored, unrun store regressions: hold/role/pause, numeric retry, bad clocks, replay, orphan dependencies, malformed clock, scoped hold resolution, stale/foreign claims and concurrent claim. |
  340 | | `crates/store/tests/store_contracts.rs` | Change only selected raw-claim fixture inputs to canonical numeric timestamps; retained expiry/reclaim behavior is explicitly still an M02 gap. |
  341 | | `create-zips.mjs` | Retain .cjs, include root implementation report and require report plus both installer CJS files in the real source archive. |
  342 | | `project/STATUS_MODEL.md` | Mark reconciliation/precedence target and clarify historical narrative versus current candidate contract. |
  343 | | `project/WORKFLOW_PARITY.md` | Point to the explicit M02 parity inventory and state limits of available v1 evidence. |
  344 | | `project/spec/acceptance-profiles.json` | Canonical summary gate vocabulary and version 1; retain manifest-compatible fixture_version and separate M02 candidate revision; document gate identity/history rules. |
  345 | | `project/spec/protocol/compatibility.md` | Document additive primary_reason compatibility and unchanged version/schema limits. |
  346 | | `project/spec/transition-table.md` | M02 precedence, separate primary reason and explicit target override authority/audit/revision policy; not a claim all routes exist. |
  347 | | `project/validation/m02/COMMAND_INVENTORY.json` | Source inventory of every known route/gap in the supplied v2 CLI registry; not an independently verified v1 inventory. |
  348 | | `project/validation/m02/ENVIRONMENT.md` | Input hashes, local baseline provenance, actual tools, missing Rust/independent review and platform limitations. |
  349 | | `project/validation/m02/FIXTURE_MATRIX.json` | Status/transition fixture inventory with missing positive/negative cases and unrun Rust coverage explicitly identified. |
  350 | | `project/validation/m02/HANDOFF.md` | Serial exclusive write boundaries, per-task candidate handoffs, tests/risks and next safe review state. |
  351 | | `project/validation/m02/PARITY.md` | Preserve/rework/replace/defer/historical-only mapping, owners, migration impacts and missing v1 evidence. |
  352 | | `project/validation/m02/REQUEST.md` | Verbatim preservation of supplied implementation request and complete M02 plan. |
  353 | | `project/validation/m02/REVIEW.md` | Author-only review, findings with severity/owners, reconciliation evidence, unaccepted dependency gates and do-not-ship decision. |
  354 | | `project/validation/m02/SOURCE_FINGERPRINT.json` | SHA-256 manifest for changed production/contract/tool sources through candidate commit e33d65f. |
  355 | | `project/validation/m02/SPRINT_STRATEGY.md` | Bounded hierarchy strategy candidate, persistence/public compatibility, migration/rollback and dated follow-up proposal; v3 adapter not claimed. |
  356 | | `project/validation/m02/TASKS.json` | Machine-readable 48-task owner/dependency/state/evidence/remaining-work ledger; accepted_complete is false for every task. |
  357 | | `project/validation/m02/evidence/baseline-tui.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  358 | | `project/validation/m02/evidence/contracts-candidate.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  359 | | `project/validation/m02/evidence/contracts-reconciled.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  360 | | `project/validation/m02/evidence/final-source-extraction.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  361 | | `project/validation/m02/evidence/installer-recovery-check.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  362 | | `project/validation/m02/evidence/m02-tui-first.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  363 | | `project/validation/m02/evidence/m02-tui-reconciled.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  364 | | `project/validation/m02/evidence/recovered-tui.md` | Retained earlier execution output and exit code, including baseline/candidate failures and later reconciliation; never substituted for release evidence. |
  365 | | `project/validation/m02/evidence/run-01/checks.json` | Machine-readable result for all 19 commands: 12 passed, seven tool-unavailable; runner fails closed with release decision do not ship. |
  366 | | `project/validation/m02/evidence/run-01/contracts.md` | Retained command output: structural existing contract/SQLite fixtures; not full M02; passed, exit 0. |
  367 | | `project/validation/m02/evidence/run-01/diff-whitespace.md` | Retained command output: source hygiene only; passed, exit 0. |
  368 | | `project/validation/m02/evidence/run-01/installer-identity.md` | Retained command output: generated wizard and embedded installer byte identity; passed, exit 0. |
  369 | | `project/validation/m02/evidence/run-01/premium.md` | Retained command output: real PTYs and local fake release/controller fixtures, NOT Rust E2E; passed, exit 0. |
  370 | | `project/validation/m02/evidence/run-01/responsive.md` | Retained command output: real PTYs and fake service fixtures, NOT Rust E2E; passed, exit 0. |
  371 | | `project/validation/m02/evidence/run-01/rust-application.md` | Retained command output: authored durable actor/status tests; blocked_tool_unavailable, exit 127. |
  372 | | `project/validation/m02/evidence/run-01/rust-cli-build.md` | Retained command output: CLI build, not release packaging; blocked_tool_unavailable, exit 127. |
  373 | | `project/validation/m02/evidence/run-01/rust-domain.md` | Retained command output: authored M02 evaluator tests; blocked_tool_unavailable, exit 127. |
  374 | | `project/validation/m02/evidence/run-01/rust-format.md` | Retained command output: Rust formatting; requires installed rustfmt; blocked_tool_unavailable, exit 127. |
  375 | | `project/validation/m02/evidence/run-01/rust-protocol.md` | Retained command output: authored additive DTO tests; blocked_tool_unavailable, exit 127. |
  376 | | `project/validation/m02/evidence/run-01/rust-store.md` | Retained command output: authored canonical claim/race tests; blocked_tool_unavailable, exit 127. |
  377 | | `project/validation/m02/evidence/run-01/rust-workspace.md` | Retained command output: full locked workspace tests; blocked_tool_unavailable, exit 127. |
  378 | | `project/validation/m02/evidence/run-01/shell-syntax.md` | Retained command output: shell parser only; passed, exit 0. |
  379 | | `project/validation/m02/evidence/run-01/source-archive.md` | Retained command output: real root ZIP generator + isolated TUI rebuild; NOT release binary; passed, exit 0. |
  380 | | `project/validation/m02/evidence/run-01/tui-tests.md` | Retained command output: core suite + Node unit/presentation fixtures; passed, exit 0. |
  381 | | `project/validation/m02/evidence/run-01/tui-typecheck.md` | Retained command output: TypeScript compiler; passed, exit 0. |
  382 | | `project/validation/m02/evidence/run-01/wizard-body-js-syntax.md` | Retained command output: JavaScript parser only; passed, exit 0. |
  383 | | `project/validation/m02/evidence/run-01/wizard-js-syntax.md` | Retained command output: JavaScript parser only; passed, exit 0. |
  384 | | `project/validation/m02/evidence/run-01/zip-js-syntax.md` | Retained command output: JavaScript parser only; passed, exit 0. |
  385 | | `scripts/validation/m02/run_candidate.py` | Reproducible 19-command check runner; retains Markdown/JSON evidence and exits nonzero on failed or unavailable checks. |
  386 | | `scripts/validation/m02/source_archive_test.py` | Use root generator or inspect a provided archive; verify required/full TUI bytes, exclusions/CRC/path safety and optionally exercise an isolated source extraction. |
  387 | 
  388 | ## 8. Critical limitations and next safe action
  389 | 
  390 | The detailed severity/owner ledger is `project/validation/m02/REVIEW.md`.
  391 | The most important unresolved correctness gaps are independently persisted
  392 | required-gate declarations, finish/close/release/reopen enforcement, durable
  393 | expiry disposition, complete authentication/session authority, typed gate
  394 | force/edge waiver and independent review routes. Product schedule inputs,
  395 | actual container rollups, sprint/cycle readiness, public workflow/queue parity,
  396 | v1 import, broader corruption handling and exact diagnostic pagination remain.
  397 | Canonical claim currently reads the full project while holding the write
  398 | transaction; queue wait and lock-hold performance have not been measured.
  399 | 
  400 | **Next safe action:** keep this on an isolated review branch, resolve the S00
  401 | contract/v1 evidence gaps and obtain independent S00-T07 review; then run the
  402 | recorded locked Rust tests/formatting in a Rust-capable checkout and reconcile
  403 | compiler, behavioral and critical findings before accepting the source
  404 | candidates. Continue only through the exact S01/S02/S03 revalidation gates.
  405 | Do not deploy, publish or mark M02 complete on the strength of this source ZIP
  406 | or the passing presentation fixtures.
````
