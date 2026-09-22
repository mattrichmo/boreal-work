# R-REVIEW — project/validation/m02/REVIEW.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/validation/m02/REVIEW.md:L1–L79`  
**File SHA-256:** `c69c1ce9da5171eb0327423689ddfed6ab77d995969588241b9d03cf9e792471`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

F01-F22 candidate findings and limitations; independently reproduce rather than treating proposed fixes as accepted.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,79p' 'project/validation/m02/REVIEW.md'
```

## Exact baseline excerpt

````text
    1 | # M02 author review, reconciliation and rejected acceptance
    2 | 
    3 | **Coordinator disposition: do not ship. Independent review: not performed.**
    4 | 
    5 | Review base: local snapshot `7731b05`; implementation candidates through
    6 | `e33d65f`. The full supplied request and plan are in `REQUEST.md`. This is an
    7 | author's source review, not a fabricated second reviewer, sprint acceptance,
    8 | independent audit or complete conformance result. No M02 checkbox is closed.
    9 | 
   10 | ## Gate and dispatch limitations
   11 | 
   12 | No parallel code subagent or independent validator was available. All edits
   13 | were serial, with a single writer to the evaluator, store, protocol encoder,
   14 | fixtures and packaging. The exact S00-T07 independent contract gate was not
   15 | satisfied. Downstream changes in this archive are **unaccepted remediation
   16 | candidates**, not a claim that the S01–S06 dependencies passed. This is a
   17 | limitation/deviation from the requested execution model, not an approved
   18 | waiver or an alternative definition of done. No task was declared complete
   19 | from compilation or a scoped test; Rust compilation was not possible.
   20 | 
   21 | The initial contract reconciliation itself failed when a changed
   22 | `fixture_version` disagreed with the manifest. The failed log is retained.
   23 | `fixture_version` was restored to `p0-03.v2`; an independent candidate revision
   24 | field now carries the M02 label. The subsequent structural validator passed.
   25 | This resolves that mismatch only, not the independent S00 review gate.
   26 | 
   27 | ## Finding ledger
   28 | 
   29 | | ID | Severity | Finding and evidence | Disposition / required owner |
   30 | | --- | --- | --- | --- |
   31 | | F01 | critical | Original raw claim SQL omitted active holds, so it could diverge from displayed status. | Candidate: shared evaluator called from canonical snapshot under `BEGIN IMMEDIATE`; 10 store regressions authored, unrun. L2/L3, S02-T01/T06. |
   32 | | F02 | high | Open prerequisite outranked an explicit pause; returning early hid secondary facts. | Candidate evaluator collects reasons before precedence selection; primary reason separate, remainder sorted/deduplicated. L1, S01-T01/T02/T06; Rust unrun. |
   33 | | F03 | high | Literal gate ID `review` did not match stored `WORK:review`. | Candidate compares gate kind; namespaced-review/failed-review regressions authored, unrun. L1/L3, S01-T01/S03-T03. |
   34 | | F04 | high | Read callers could provide an agent/default role independently of the actor row. | Candidate store-backed reads and claims resolve durable role in the snapshot transaction. This is not complete authenticated identity/session authorization. L3/L4, S01-T03; Rust unrun. |
   35 | | F05 | high | Lexical timestamp comparison could treat `unix-ms:9` and `unix-ms:100` incorrectly. | Canonical numeric parser/claim checks added, timer repair removed from read adapter; raw candidate enumeration remains only a hint. L1/L2, S01-T04/S02-T01; Rust unrun. |
   36 | | F06 | critical | Dropping an unreadable prerequisite could make its dependent appear eligible. | Candidate adds an explicit hard diagnostic reason to dependent; invalid clocks/direct parents quarantined. L2/L3, S05-T02; Rust unrun, broader corruption gaps below. |
   37 | | F07 | critical | Existing hold resolution did not independently require an operator and exact work/project match. | Candidate role/project checks and replay actor/command binding added; denied/foreign/readback tests authored, unrun. L2/L3, S02-T04; NOT gate force/waiver implementation. |
   38 | | F08 | high | Source ZIP filter excluded `.cjs`, removing both installer source files and breaking tests. | Recovered body/bundle from the supplied `install.sh`; byte identity, 98 Node tests, 15 premium and 13 responsive fixtures pass. Root ZIP selector and required paths repaired; clean extraction verified. Packaging source fix only, not release acceptance. |
   39 | | F09 | high | Candidate acceptance fixture version drift. | Initial rejection retained; structural contract validator passes after version reconciliation. No independent contract acceptance claimed. |
   40 | | F10 | critical | Stored acceptance profiles are reconstructed from existing gate rows; `definition_json` does not independently describe required per-work gates. Deleting a required gate can remove both the actual gate and the apparent declaration. | **OPEN.** Pure evaluator missing-gate checks cannot solve this store gap. Persist authoritative versioned declarations and validate configuration before any claim/close. L1/L2/L3, S03-T02 and S02-T01/T02. |
   41 | | F11 | critical | Finish, close, release and reopen do not all re-evaluate canonical status/holds/role/gates/review/close intent inside their write transaction. | **OPEN.** No assertion that all mutation bypasses are fixed. Complete S02-T02, then race/unknown-outcome acceptance S02-T06. |
   42 | | F12 | critical | Expiry mutation can clear the current attempt without a durable unresolved expiry-disposition input on the work item. The legacy replacement-claim test still allows another attempt after expiry. | **OPEN.** Retain failed/expired history and add an explicit durable disposition obligation before reclaim. L1/L2/L3, S01-T04/S02-T02. Only canonical timestamps were updated in that legacy fixture; its incompatible M02 expectation was not secretly relabeled as acceptance. |
   43 | | F13 | critical | Full v1 runtime/command inventory and import provenance are absent; legacy-map links are historical references. | **OPEN.** L0/migration steward, S00-T01/S05-T03. Supplied v2 registry inventory does not prove v1 parity. |
   44 | | F14 | high | Not-before, due/overdue scheduling and complete safe next-action semantics are absent. | **OPEN.** L1/L3, S01-T01/T03/T04. Timers in this candidate cover retry/current lease/hard budget only. |
   45 | | F15 | high | Containers now have a provisional nonclaimable `queued/container_planning` label, not exact descendant rollups. | **OPEN.** This avoids a false hard-block label but does not meet S01-T05/S03-T05. Counts, critical blockers, review/gate gaps, overdue totals and launch/close readiness remain. |
   46 | | F16 | critical | Named gate-force/edge-waiver operations and public independent review decisions are incomplete. | **OPEN.** L3/L4, S02-T04/T05 and S04-T04. No boolean force, direct status write or synthetic passing proof was introduced. |
   47 | | F17 | high | Global gate/attempt prefetch can still fail an entire snapshot on some malformed rows; corrupt ancestors are not transitively propagated; diagnostic pagination/counts are not fully reconciled. | **OPEN.** L2/L3/L6, S05-T02 and S03-T05. A malformed direct prerequisite/clock test is not full corruption tolerance. |
   48 | | F18 | high | Canonical claim currently assembles the entire project snapshot while holding the write transaction. | **OPEN performance validation.** Measure queue wait separately from lock hold. Optimize a canonical subgraph only after equivalence tests; do not restore a second SQL policy. L2/L7, S02-T06/S05-T05. |
   49 | | F19 | high | New claims require canonical `unix-ms:<unsigned decimal>` clocks and real registered actors for store-backed status reads. Old ad-hoc timestamps are rejected, not silently converted. | **OPEN compatibility/migration signoff.** No stored history is rewritten. Verify old adapters and document explicit import dispositions before production cutover. L0/L2/L4, S00-T02/S05-T03. |
   50 | | F20 | high | Denied raw claims roll back without recording a durable operation outcome, as in baseline. Registration/session work performed by a higher adapter may have its own effects. | **OPEN.** Full typed rejected-operation/unknown-outcome audit and no-unintended-mutation semantics remain S02-T01/T02/T06, not proven by raw store tests. |
   51 | | F21 | critical | No Rust compiler/rustfmt, independent reviewer or genuine service operator was available. | **OPEN.** Seven Cargo commands could not start (127). No Rust test, build, formatter, real-service receipt or release result is certified. L7 and coordinator. |
   52 | | F22 | critical | Complete planning/cycle/sprint/workflow/queue parity, migration, real project isolation and all release gates are unfinished. | **OPEN.** Task-by-task owners/dependencies in `TASKS.json`. Source recovery and fake-release PTY fixtures cannot close S03–S06. |
   53 | 
   54 | ## Revalidation actually run
   55 | 
   56 | `evidence/run-01/checks.json` records 19 commands: 12 passed; seven Cargo
   57 | commands were blocked before execution. The runner deliberately exits 1.
   58 | Successful commands cover structural contract fixtures, TypeScript checking,
   59 | core TUI plus 98 Node tests, generated-installer identity, shell/JavaScript
   60 | syntax, 15 premium fixtures, 13 responsive real-PTY fixtures, and the actual
   61 | source ZIP generator followed by isolated TUI rebuild/tests. No ignored Rust
   62 | failure is counted as a pass. The fixture validators explicitly use fake
   63 | controllers/releases, not a fabricated claim of genuine service evidence.
   64 | 
   65 | Prior failed baseline TUI and candidate contract logs are preserved under
   66 | `evidence/`. The initial source-archive exercise used a preliminary report to
   67 | prove inclusion; the final delivery archive is generated after the complete
   68 | report is written. Source integrity verification does not imply release
   69 | binary byte identity or supported-platform acceptance.
   70 | 
   71 | ## Next safe action
   72 | 
   73 | First resolve S00 contract/v1 evidence gaps and obtain independent S00-T07
   74 | review. Validate the unaccepted source candidates in a Rust-capable isolated
   75 | checkout: run the recorded locked tests and formatting check, reconcile all
   76 | compiler/test failures and F10/F11/F12 before accepting claim/lifecycle work.
   77 | Then use the exact S01/S02/S03 revalidation dependencies in `REQUEST.md`.
   78 | Do not install this candidate as a production replacement, publish a release,
   79 | claim a v3 adapter, or merge it as a completed M02 milestone.
````
