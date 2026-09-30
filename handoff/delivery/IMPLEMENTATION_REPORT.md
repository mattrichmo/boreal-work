# Boreal v2 — implementation overlay report

## Delivery status

**Substantial source implementation across all eight sprint areas; not a completed or production-verified release.**
There are both validation blockers and remaining integration gaps, listed task by task below.
Do not infer that all 48 tasks are complete from the successful TypeScript, SQLite or packaging checks.

This overlay changes **79 repository files: 58 replacements and 21 additions**. It also
contains four delivery files and the two archive metadata files, for **85 ZIP entries**.
Generated `dist/`, dependencies, `.git`, `target/`, project memory and unchanged source
are intentionally not included. The changed generated installer bundle is included because
it is a tracked release input regenerated through the existing build path.

## Exact source identity

- Sole baseline: `boreal-v2-reference-20260923T192943842Z.zip`.
- SHA-256: `6be4b35f0b20cbddd3c4eded6b7a5194a7f2c961b3f6eb124312d1341aedef04`.
- Export branch: `codex/apply-responsive-terminal-overlay`.
- Export source commit: `abf87bb528b55632499bb246c10aeb902680a582`; **dirty worktree snapshot**.
- This commit identifies the supplied baseline, not these implementation changes.
- No original `.git` directory or original implementation commits were available.
  A synthetic local baseline was used only for diffs. No synthetic commit IDs are
  presented as repository history or needed to apply this overlay.

The input hash, CRC and all 1,778 listed baseline manifest entries were checked.
ARCHIVE_MANIFEST.json, REFERENCE_INDEX.md and the required project instructions were read.
The active eight-sprint handoff was used; the older 22-sprint files are unchanged.
An early runtime restart lost an unarchived worktree. The delivered changes are the
ones subsequently reconstructed/implemented on disk against this exact baseline,
not a claim of byte-identical recovery of anything from the older failed passes.

## What changed operationally

The previous uncalled submission/accepted-outcome helpers now have lifecycle callers.
Finish seals a candidate; review binds its exact submission and authority root; close
writes an accepted outcome transactionally. Failed evidence, dependency edges, old
reviews and submissions remain history. Reopen/waiver/exception changes do not mint
passing receipts. New credentials, explicit project selection, canonical facts/actions,
cycle history, durable memory review/publication, read-only outage handling and release
staging are integrated into the existing architecture, not a replacement backend.

## Task-by-task accounting

“Delivered” describes source present in this ZIP, **not** a declaration of verified task
completion. A missing compiler prevents Rust verification; it does not explain away the
separately identified incomplete implementation work.


### Sprint 1

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S1-T01 | Canonical profile registration verifies canonical content digests and refuses rewrites. An additive database guard now also protects unused legacy {} profiles. Existing pinned-requirement tables remain independent of observation rows. | SQLite profile update/delete rejection passed. Rust profile/pin readers and legacy-profile disposition are not executed. |
| S1-T02 | Sealed submissions, exact-submission review events, accepted outcomes, typed gate exceptions, and edge-specific waivers have real completion/lifecycle writers. | SQL statements prepare. Full Rust finish/review/close/exception paths are uncompiled and unexecuted. |
| S1-T03 | Submission retains resource/recovery obligations; existing jobs and recovery stores remain authoritative. External job transitions and maintenance terminal-state guards were tightened. | Full expiry/restart/restore/resource reconciliation combinations remain unverified; not every recovery worker path was changed. |
| S1-T04 | Completion, work creation, dependency/cycle changes and memory admission bind their payload, caller/session, operation ID and revision inside the committing transaction with operation/audit history. | The entire pre-existing command inventory has not been proven to use one transaction/action path. This is a remaining integration audit, not a passed check. |
| S1-T05 | Canonical fact readers preserve damaged dependency facts and work-scoped diagnostics; status projects diagnostic rows without discarding healthy rows. | Narrowest-scope behavior for every damaged parent/profile/artifact/clock and cycle row is not established. Some planning decoders can still fail a broader read. |
| S1-T06 | Registered ordered completion migrations v2–v6; kept baseline v1 unchanged. Added immutable principals, completion dispositions, planning/memory history, and typed checkpoint audit migration. | DDL and 59 query preparations passed; populated audit migration retains exact rows. Rust migration runner and representative populated-database upgrade matrix are not run. |

### Sprint 2

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S2-T01 | Expanded typed proof/authority inputs, delegation-root identities, explicit request-session facts, submitted-result identity and accepted-outcome dependency facts. | Rust type checking and proof-identity fixture compatibility remain blocked by the missing compiler. |
| S2-T02 | Retained the canonical precedence evaluator, distinguishing failed/rejected review, proof missing, expiry recovery and accepted closeout. Failed results may be sealed without being accepted. | No claim of exhaustive precedence/reason-order coverage. The full cross-product of closed/expired/blocked/paused/retry/scheduling inputs has not been executed. |
| S2-T03 | All 30 work action decisions and five project-planning descriptors are produced by server policy with targets/revisions/confirmation/denials; creation validates an explicit authenticated session under lock. | Existing legacy mutation entry points and descriptor-to-mutation parity still need a Rust integration audit. Not all server actions have new TUI controls. |
| S2-T04 | Reopen/retry create a new proof generation and impact/invalidation records. Exceptions retain failed receipts and waivers retain original dependency facts and edges. | Container/milestone replacement, closeout and all rollup predicates are not completely unified with the new accepted-outcome path. |
| S2-T05 | Store status now assembles canonical facts under a consistent read, uses the caller-supplied validated session, and maintains exact physical row offsets/diagnostic counts. | Broad corruption fixtures and large-project query performance are unverified in Rust. |
| S2-T06 | One application serializer carries full canonical facts and all action descriptors through CLI/service JSON, with whole-row byte-bounded pagination and typed protocol additions. | Actual Rust service/CLI wire round trips are not run; transport compatibility is a known integration risk. |

### Sprint 3

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S3-T01 | Initialization persists project-local metadata; normal directory resolution requires explicit nearest local metadata rather than a global-project fallback. | The installed CLI initialization path is not exercised without a Rust binary. |
| S3-T02 | Canonical workspace/database/source/memory/socket/operation path checks reject .. and symlink escapes and foreign project bindings. Database instance IDs are randomized. | Platform-specific ownership and symlink race behavior, nested worktrees and restore confinement need runtime verification. |
| S3-T03 | Added durable project principals, salted project-bound key digests, owner-only local key files, bootstrap, delegated authority roots, roles, session bindings and revocation records. | Authentication/delegation/revocation integration is not compiled. Existing projects with only historical OS-user actor rows require explicit credential migration; no automatic privilege promotion was added. |
| S3-T04 | Direct and service routes use the same project-local credential context; request-scoped actor/session authority is no longer an OS-user label. | All maintenance and legacy direct commands are not certified against this boundary; old sessionless canonical API callers now fail closed. |
| S3-T05 | TUI transport and controller bind project/connection identity, reject foreign snapshots, track observed revision high-water marks, and revoke cached mutation authority on outage or unknown outcome. | TUI flow/outage/high-water tests pass. A real two-service/socket cross-project test remains not run. |
| S3-T06 | Added scripts/release/two-project-smoke.py and integrated it into disposable-prefix package smoke, using the absolute installed binary and genuine project initialization. | Script syntax/help pass. Execution is blocked by unavailable Rust build/install artifacts; the script does not claim a full proof/review lifecycle smoke. |

### Sprint 4

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S4-T01 | Canonical execution writers recheck shared server policy. Added a revision-bound progress checkpoint with a real typed audit event; checkpointing does not mint a passing gate receipt. | Existing heartbeat/expiry/release adapters remain in use. Full transition and stale-fence execution checks are not run. |
| S4-T02 | Submission seals immutable proof separately from current execution and retains ended-attempt proof plus recovery/resource obligations. Review targets the sealed candidate, not an execution lease. | Submission/review/resource restart behavior is uncompiled and not exercised. |
| S4-T03 | Acceptance and evidence-store reads bind source, configuration, profile, attempt/fence and exact submission context; review independence uses the submitter authority root. | All verifier subprocess paths and post-submission evidence attachment paths remain unverified; no successful receipt was fabricated. |
| S4-T04 | Finish preparation is shared in WorkApplication; create-close-intent seals the exact immutable receipt set and summary, and close writes accepted outcome in its transaction. | End-to-end incomplete-proof/failed-proof/review/close behavior requires Rust compilation and execution. |
| S4-T05 | Added approve/reject/return/revoke and typed exception/waiver commands, routed through common completion DTO/application/store policy with explicit confirmation/reason/revisions. | Revoke-exception invalidation is conservative at work scope. Review approval after a terminal submission and all gate variants are unverified. |
| S4-T06 | Added canonical reopen/cancel/retry/publish with immutable transition/impact records; retained baseline release/expiry operation readback and TUI original-operation readback. | Owner-versus-operator expiry recovery and resource unknown-outcome reconciliation need integration verification. |
| S4-T07 | Direct/service finish and new completion routes share application policy. TUI missing-permission and stale-permission fallbacks now fail closed. | Not a claim that every pre-existing lifecycle/planning/maintenance mutation was consolidated; remaining legacy API callers need review. |

### Sprint 5

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S5-T01 | Milestone/task containment is separated from cycle membership and mirrored from canonical work into the existing v3 projection; root tasks and milestones are supported. | All container execution-mode edits and milestone closeout dispositions are not implemented end-to-end. |
| S5-T02 | Added concurrent cycle creation/lifecycle, assignments/commitment events, linked carry-over, and explicit legacy-sprint mappings; historical sprint work rows remain intact. | Legacy alternate assignment APIs and reopen effects on already-completed assignments still need integration review. |
| S5-T03 | Canonical dependency edits retain event history, detect cycles transactionally and mirror one writable graph. Prerequisites use accepted closed outcomes, not historical completion. | Existing imported closed prerequisites intentionally stay unsatisfied without legitimate accepted outcomes. All cycle-detection concurrency cases are untested. |
| S5-T04 | Cycle start/close/cancel and carry-over use existing typed calendar/cycle policy, unresolved commitment counts and accepted-outcome closeout. | Full milestone planning-profile readiness, container replacement and waiver/cancellation disposition workflows remain incomplete; this is code integration work, not only testing. |
| S5-T05 | Added frozen cycle boards, revision-consistent status counts/diagnostics and whole-row byte-bounded pagination. | All milestone/container rollups, extreme-cardinality bounded-query behavior and broader planning corruption isolation are not proven. |
| S5-T06 | Damaged rows remain red even when selected; diagnostic rows disable mutations while healthy rows remain readable/selectable. | Typecheck and Node tests pass. A live service-backed corrupted-SQLite rendering run is not performed. |
| S5-T07 | Added canonical-state/diagnostic attention groups for review, expiry, failed execution and intervention/corruption. | TUI projection checks pass; full server-driven queue coverage and large-project totals are unverified. |

### Sprint 6

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S6-T01 | Registered and routed completion, principal/credential, cycle and seven memory operations; preserved aliases and existing source/history/maintenance routes. | Existing unsupported registry gaps, including broader review listing/show and some maintenance workflows, were not falsely declared implemented. |
| S6-T02 | New mutation adapters route through application/store server policy; project creation/work creation UI cannot authorize from local status labels. | Every legacy mutating route has not been exhaustively reconciled with descriptors. This remains a concrete integration audit. |
| S6-T03 | Embedded workflow assets are digest-verified and marked trusted; external parsed packages remain untrusted. Guidance uses canonical action decisions and structured context. Ten assets now reference current registry commands. | Workflow package validation plus six mutation self-tests pass. Executing every recipe against the Rust CLI remains blocked. |
| S6-T04 | Credential-aware TUI transport, project identity fencing, observed revision high-water marks, pending operation/readback handling and outage read-only mode are implemented. | TUI flow and 98 Node tests pass; all new review/cycle/memory operations do not yet have bespoke full-screen controls. |
| S6-T05 | Preserved existing responsive terminal/input behaviors and added focused outage/permission/revision regressions without removing server-policy checks. | All 98 existing Node tests plus flow checks pass. No claim of exhaustive terminal emulator/platform coverage. |
| S6-T06 | Ordinary corruption/outage notices now describe actionable user-facing conditions; raw fact/action details remain available for diagnostics. | A complete copy/terminology sweep across all screens was not completed; some existing advanced/internal vocabulary remains. |

### Sprint 7

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S7-T01 | Added durable cited memory drafts and independent-root review; source content/citation validation remains in the existing knowledge application. Durable reads no longer require an online source cache. | Complete project search/handoff surface and all source-intake operation/recovery scenarios are not newly completed. Rust knowledge paths are unexecuted. |
| S7-T02 | Memory publication admission freezes review/manifest identity and external job state before Git effects. Readback attributes real Git commits; reconciliation advances SQLite without repeating publication. | Crash/failure injection and genuine filesystem/Git publication/restart tests are not run. Unknown is retained rather than guessed as success. |
| S7-T03 | v1 historical complete/done/closed/archived records import as nonaccepted draft work with provenance notes, not accepted closeout. | Full v1 import disposition and legacy fixture execution remain unverified; no prose was turned into acceptance. |
| S7-T04 | Retained existing online backup/restore implementation, tightened legal maintenance state transitions, made doctor read-only/unchanged, and aligned service/direct integrity diagnostics. | Full restore-epoch/service reconciliation and revision-bound repair/resume command integration remain incomplete. Backup/restore execution is not run. |
| S7-T05 | Added machine-readable memory draft/review/publish/show/search/readback/reconcile and durable job readback; preserved existing migration/backup/restore routes. | Not every requested maintenance/handoff route is newly implemented; real installed command/readback testing remains blocked. |

### Sprint 8

| Task | Delivered changes | Remaining work / evidence limitation |
|---|---|---|
| S8-T01 | Regenerated standalone and embedded installer through npm run build:installer; installer source-byte verification passes. | Verified build-path result, not an installed release. |
| S8-T02 | Release staging copies the full apps/tui tree plus complete dist/ui into the existing lib/boreal/tui runtime, keeps Node ESM metadata and expands release asset hashes. | 42 TUI authored/build files and all eight UI modules were staged and byte-compared. bin/bwrk was not built or installed. |
| S8-T03 | Installer now validates the absolute published binary version and byte-compares installed binary/TUI assets before clearing rollback state; full apps tree participates in rollback. | Existing upgrade durable-job code was preserved rather than newly certified. Actual update/upgrade/readback is not executed. |
| S8-T04 | Added and connected a disposable installed-prefix/two-project isolation smoke path using real manifest hashes and absolute binary commands. | Not run: no Rust toolchain/binary. Full actual install, dashboard, execution/proof/review and two-project lifecycle verification remain blocked. |
| S8-T05 | Changed-only overlay, task accounting, explicit inventory, ordered nonfabricated change log, dual compatible manifests, CRC/hash/preflight/replay checks. | Delivery checks are recorded separately below; no publication or production-readiness claim. |

## Focused checks: exact commands and outcomes

Commands were run from the implementation root unless an absolute path is shown.
Ad-hoc SQLite/staging scripts below were execution-session diagnostics, not a new
repository testing framework. Their scope is stated explicitly; they are not Rust tests.

| Command | Final outcome | Scope |
|---|---|---|
| `npm --prefix apps/tui run typecheck` | PASS, exit 0 | TypeScript source compatibility. |
| `npm --prefix apps/tui test` | PASS, exit 0 | Mounted workflow/protocol/terminal flow assertions, including added outage/high-water/project-permission regressions; all 98 Node tests pass, none skipped. |
| `npm --prefix apps/tui run build:installer` | PASS, exit 0 | Existing TypeScript and installer generation path. |
| `npm --prefix apps/tui run verify:installer` | PASS, exit 0 | Standalone and embedded installer match generated sources. |
| `python project/spec/workflows/validator.py` | PASS, exit 0 | 10 assets, 59 recipe command shapes, 106 executable CLI registry shapes; package v1.1.0. |
| `python project/spec/workflows/validator.py --self-test` | PASS, exit 0 | Six focused malformed/unsafe package fixture checks. |
| `python /mnt/data/check_bwrk_sql.py` | PASS, exit 0 | Production plus completion v1–v6 plus existing jobs/recovery/maintenance DDL; 346 schema objects; FK check clean; 59 new store SQL statements EXPLAIN-prepared. |
| `python /mnt/data/check_bwrk_final_behaviors.py` | PASS, exit 0 | Populated v6 audit migration preserves all old audit column values; immutable audit/profile mutation rejection; checkpoint audit+operation rollback; all 42 TUI staging files and eight UI modules byte-compared, ESM metadata present. |
| `sh -n install.sh scripts/release/package-smoke.sh` | PASS, exit 0 | Shell syntax only. |
| `python -m py_compile scripts/release/build_release.py scripts/release/two-project-smoke.py project/spec/workflows/validator.py` | PASS, exit 0 | Python syntax only. |
| `python scripts/release/two-project-smoke.py --help` | PASS, exit 0 | CLI parser only, not a smoke execution. |
| `git diff --check` | PASS, exit 0 | Whitespace check against synthetic exact-input baseline; not original Git provenance. |
| `rustc --version` | BLOCKED, exit 127 | `rustc` not found. |
| `cargo fmt --all -- --check` | BLOCKED, exit 127 | `cargo`/Rust formatter not found. |
| `cargo check --workspace --locked --offline` | BLOCKED, exit 127 | No Rust compiler/build execution. |
| `cargo test --workspace --locked --offline` | BLOCKED, exit 127 | No Rust test execution. |
| `sh scripts/release/package-smoke.sh` | NOT RUN | Requires real Rust release build; no installed binary was substituted. |
| Installed prefix/two-project/update/backup/restore tests | NOT RUN | No Rust release binary. The TUI staging check is not an installation. |

Toolchain recovery was attempted: the container could not resolve `static.rust-lang.org`,
and a standalone toolchain download attempt also failed. No installed compiler or Rust
pass is claimed. No publication, release upload, purchase, or external account mutation occurred.

### Failures discovered and corrected during implementation

TUI fixtures initially lacked explicit server actions; these fixtures were updated rather
than restoring local authorization. A later stale-read test exposed loss of the structured
stale-revision notice, which was fixed. Workflow negative fixtures initially used the old
contract instead of the live registry; they now copy the actual registry and still test the
intended rejection. SQL checks found the checkpoint audit vocabulary missing and an unused
`{}` acceptance profile still mutable; additive v6 fixes both without changing v1 hashes or
historical rows. A Rust ownership-type mismatch was corrected by inspection, but no Rust
compiler confirmed the resulting source. These are introduced/integration issues, not
claims of pre-existing failing Rust tests.

## Known risks and remaining blockers

1. **Uncompiled Rust is a release blocker.** New APIs, public DTO/fact fields, principal
   authentication, schema integration and older fixtures may contain type or behavioral
   incompatibilities. No formatting/build/test pass is claimed. Sessionless canonical API
   callers now intentionally fail closed; all callers/fixtures need compiler-backed review.
2. **Planning/rollup completion is not finished.** Full container/milestone readiness,
   replacement/disposition closeout, already-completed assignment reopen effects and every
   alternate legacy planning mutation are not unified or verified. Corrupt cycle/assignment
   rows may still fail a broader planning read than intended.
3. **Policy coverage is not certified.** Every legacy CLI/service mutation has not been
   proven to use the same action descriptor contract. Every precedence/reason combination,
   evidence-after-seal path and owner/operator recovery path has not been exercised.
4. **Maintenance remains incomplete.** Read-only doctor and state guards are delivered;
   complete revision-bound repair/resume routes, restore-epoch service reconciliation and
   real backup/restore/upgrade restart behavior are not completed/verified.
5. **Identity migration needs an explicit operator path.** Historical OS-user credentials
   are not silently promoted. Existing databases lacking the new local credential/principal
   binding can fail closed until an authorized migration/bootstrap is provided. Filesystem
   ownership and path race behavior require platform-specific review.
6. **Genuine Git and lifecycle recovery are untested.** Memory now records admission and
   reconciliation state, but crash injection around Git publication and full submission /
   review / accepted closeout with leases/resources has not run. Unknown outcomes remain
   unknown rather than being fabricated as success.
7. **UI breadth is not finished.** Existing responsive interactions are preserved and tested;
   not every new cycle/review/memory action has a bespoke full-screen UI. Some existing
   internal/advanced terminology remains. Source search and revision-bound handoff coverage
   are not newly certified complete.
8. **Existing history can correctly remain unsatisfied.** Imported/legacy closed work is not
   automatically accepted proof. Stricter accepted-outcome prerequisites can keep such work
   queued until a legitimate reviewed closeout or authorized edge-specific waiver exists.

These are actual remaining limitations, not items marked complete because another suite passed.

## Merge and preflight

Apply the complete overlay as one integration unit; do not cherry-pick isolated schema,
domain, store or transport replacements. Unchanged baseline source and historical evidence
are intentionally absent from the ZIP and must remain in the destination checkout.

```sh
python3 scripts/apply_overlay.py /path/to/boreal-v2-implementation-overlay.zip \
  --target /path/to/boreal-v2 --check \
  --base /path/to/boreal-v2-reference-20260923T192943842Z.zip

python3 scripts/apply_overlay.py /path/to/boreal-v2-implementation-overlay.zip \
  --target /path/to/boreal-v2 --apply \
  --base /path/to/boreal-v2-reference-20260923T192943842Z.zip \
  --backup /path/to/a-new-separate-backup-directory
```

Do not use an older ZIP as the base and do not delete absent paths. Both manifest deletions
lists are empty. A destination changed after the supplied snapshot should report conflicts,
not be forced over. No original Git commit IDs are required; MINI_GIT_LOG.md gives the
ordered logical changes without invented commit history.

### Metadata and hashes

Exactly one top-level directory: `boreal-v2/`. `handoff/delivery/OVERLAY_MANIFEST.json`
hashes all source payloads, the report/log/inventory, and the archive index. Root
`ARCHIVE_MANIFEST.json` is additionally required by the existing merger and hashes that
nested manifest and the apply allowlist. Self-hashes are impossible; the two exclusions
are explicitly documented instead of using fake checksums.

`REFERENCE_INDEX.md` and the root manifest are **archive metadata**, not automatically
replaced repository files under the baseline merger. The input index is absent from the
baseline payload allowlist, so treating a changed index as a source replacement creates
a false three-way conflict. The compatible root allowlist omits it; its exact bytes are
still verified by the nested manifest. All 79 repository changes plus four handoff files
are in the apply allowlist. The destination's baseline metadata remains intact. The TSV
also lists the two included archive metadata paths and marks their archive-only purpose.

The final packaging run verifies ZIP CRC, every SHA/byte-size entry, no duplicate paths,
one top-level directory, changed/new-only repository payloads, preflight with the exact
baseline, and an actual disposable replay with a separate backup. Packaging validation
is not an application correctness or release-readiness certificate.

