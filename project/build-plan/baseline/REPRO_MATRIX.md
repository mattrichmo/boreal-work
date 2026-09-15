# P0-02 reproduction matrix

Status: `unmeasured` legacy baseline; current v2 implementation checks do not
promote any row to `reproduced` or make this a v1 benchmark.

Owner: S00 baseline analyst. Input evidence is the portable audit in
[`project/AUDIT_BASELINE.md`](../../AUDIT_BASELINE.md), the S00/P0-02 packet,
and the v2 scaffold snapshot present on 2026-09-14. This document separates
what the transcript shows from what implementation inspection might later
explain. A transcript pattern is not a reproduced defect, and a code
hypothesis is not a finding.

## Scope and safety boundary

- This artifact owns only the P0-02 baseline plan and evidence record.
- No `bwrk` command was run. No v1 `.boreal` state, live lock, failed receipt,
  or legacy checkout was modified.
- No toolchain was installed, updated, or pinned by this pass.
- The source snapshot is a working-tree snapshot, not a commit: the v2 files
  inspected are currently untracked in the containing repository. The audit
  source itself is identified by SHA-256
  `5c0a72f955e8f6542a90a77f278ca2f19c079f4fa3e27c608af2ab8d1d176609`.
- Procedures below are planned safe reproductions. They must run against a
  disposable copy or synthetic fixture, with the original project and any
  live locks mounted read-only or left untouched. A procedure is not evidence
  until its command, tool identity, fixture digest, output, and exit status
  are recorded.

## Evidence labels

| Label | Meaning | Allowed conclusion |
| --- | --- | --- |
| `observed` | Directly visible in the supplied transcript audit. | The pattern occurred in the source evidence; frequency and cause may still be unknown. |
| `reproduced` | Repeated on a pinned disposable fixture with captured measurements. | The stated behavior occurred under the recorded profile only. |
| `hypothesis` | A code/runtime explanation suggested by inspection or correlation. | Investigation target only; never a root-cause claim. |
| `unmeasured` | Not available without an unapproved, unsafe, or currently absent fixture/tool. | Do not substitute a count, estimate, or timing. |

## Reproduction matrix

| Concern | Observed transcript facts | Code/runtime hypotheses (unproven) | Safe reproduction procedure | Needed metrics and evidence | Current status / unavailable measurements |
| --- | --- | --- | --- | --- | --- |
| Lock contention and ownership | `lock inspect` appeared 38 times. TUI ownership appeared during contention. Process age did not prove one continuous lock hold. Live locks were not force-broken. | A long-held or repeatedly reacquired lock may serialize reads and writes; TUI polling may increase acquisition pressure; ownership reporting may describe a process rather than a lease/fence. | Create a disposable fixture with one writer and 1, 3, 10, 30, then 50 readers/writers. Start each harness with a unique actor/operation ID. Record lock state before/after each operation. Stop only the disposable processes; never remove a lock file or kill a live legacy owner. Repeat TUI-off and TUI-on with the same workload and validation profile. | Tool/runtime digest; fixture digest; process and actor IDs; lock wait, hold, queue depth, acquisition/release timestamps; retries; timeout reason; changed-state flag; operation/result IDs; TUI mode; exit code. | `observed`; not `reproduced`. Lock wait/hold distributions, total TUI hold time, contention rate, and race outcome are `unmeasured`. |
| Status/read payloads | `work show` 199, `reservation list` 107, `orchestrate tick` 82, `orchestrate show` 78, `work list` 36. These five read families were 458 visible sites (67.7%); adding ticks was 540 (79.8%). Some payloads were roughly 190–306 KB. A routine three-agent target of 2–8 KiB is proposed, not measured. | Broad projections, repeated context expansion, or serialization of historical state may explain oversized responses and polling cost. The transcript does not identify a single endpoint or field as the cause. | Seed a synthetic fixture with the same logical work, reservations, agents, evidence, and history counts for each run. Capture one cold and one warm invocation per read family, then repeat at agent counts 1/3/10/30/50. Save raw bytes before terminal formatting and a redacted decoded payload. Do not query or rewrite the user's legacy project. | Startup and command wall time; response bytes; compressed/uncompressed bytes if applicable; item counts; field counts; projection/serialization time; retries; cache state; source/config digest; validation profile. | `observed`; not `reproduced`. Per-command wall time, exact payload boundaries, field attribution, and token/egress cost are `unmeasured`. |
| Expiry and reaper behavior | The audit calls out stale expiry and reports that blocked/released work was selected again. Expired reservations/attempts were not established as a clean terminal outcome. | Expiry may be evaluated inconsistently across reservation, assignment, session, and dispatch projections; a reaper may release one projection without atomically updating all dependent state. | Use a disposable fixture and a virtual or controlled clock if the legacy tool supports it. Create one active attempt, one near-expiry attempt, one expired attempt, and one already released item. Advance time in fixed increments; run the documented reaper/inspection path only in the fixture. Compare state before/after replay and repeat the same tick to test idempotency. | Clock source and offset; lease/attempt timestamps; reaper start/end; selected/released IDs; state transition sequence; replay result; changed-state flag; lock wait/hold; stale/duplicate selection count; exit/error code. | `observed` pattern only; not `reproduced`. A safe pinned clock, exact expiry rules, reaper timing, and duplicate-selection count are `unmeasured`. |
| Lifecycle drift | Work, reservation, assignment, and agent-session state disagreed. Blocked/released work was selected again. Orphaned work was not falsely closed. | Multiple mutable status authorities or non-transactional projection updates may permit state divergence; dispatch may read a stale projection or treat release as eligibility. | Build a disposable four-object fixture linking work, reservation, assignment, and session. Execute only a fixed transition script: claim, start, heartbeat, release/expire, re-read, and close attempt. After every operation, capture all four projections and an append-only event/receipt if available. Run the script twice to test idempotency and once with an injected interruption between writes, if the fixture supports fault injection. | Per-operation input/result IDs; revision or sequence; all status values; eligibility decision; dependency IDs; changed-state flag; write ordering; rollback/recovery result; timestamps; duplicate-selection count. | `observed`; not `reproduced`. Exact divergence sequence, transaction boundary, and interruption behavior are `unmeasured`. |
| Evidence matching and gate wording | Closeout required repeated syntax discovery, stale evidence repair, and wording-dependent observable matching was suspected. The exact predicate was not proven. Failed evidence was retained. | A literal text predicate, unstable evidence identity, or mismatch between displayed and canonical evidence may make semantically valid proof fail. | On a disposable fixture, define equivalent evidence in three forms: exact expected wording, semantically equivalent wording, and stale/incorrect wording. Submit each through the supported evidence path; preserve every failed receipt. Re-run after a no-op read and after a new revision to distinguish matching from staleness. Do not edit historical evidence in place. | Evidence ID/version; submitted text/hash; expected predicate/version; match result; gate state before/after; receipt identity; stale/conflict reason; retries; bytes and timings. | `observed` suspicion only; not `reproduced`. Predicate, normalization, false-negative rate, and repair cost are `unmeasured`. |
| Repair and health/prune paths | Health prune/repair exposed historical causal/summary problems without a clean supported terminal outcome. Real dependency edges were corrected after inspecting the critical path. | Repair may be partial, non-idempotent, or unable to reconcile causal history and summary projections in one transaction; prune may remove context needed to explain a conflict. | Clone a synthetic fixture with deliberate divergence, missing summary, stale reservation, and a valid dependency edge. Run inspection first, snapshot all files, then invoke the documented repair path once. Compare repaired output to a separately generated expected fixture. Re-run repair to test idempotency. Never run repair/prune against the user's current project or a live lock. | Pre/post file tree and hashes; repair classification; records changed/retained; causal links; summary links; dependency edges; lock behavior; exit/error code; second-run diff; backup/rollback evidence. | `observed`; not `reproduced`. Safe repair command, expected terminal state, changed-record count, rollback behavior, and idempotency are `unmeasured`. |
| No-goal guide/next and finish churn | There were 239 agent-wait entries, including 238 empty wait messages. A closeout episode used 94 shell blocks and 42 visible CLI calls. Frequent status polling and nudges substituted for runtime liveness/event notification. | No-goal or idle guidance may lack a stable terminal response; finish may repeatedly discover syntax, stale evidence, or missing context and cause polling churn. | Use a disposable project with no eligible goal, then with an active attempt, a dependency-blocked item, and a finish-ready item. Invoke guide/next and finish through the supported interface exactly once per state; record output and whether state changed. Repeat only to test idempotency, not to force success. Keep the scripted caller bounded and do not poll a live project. | Call count; command start/end; response bytes; guidance state; action/ref; changed-state flag; operation/result IDs; retries; wait duration; finish predicate; error code; context payload size. | `observed`; not `reproduced`. Exact call graph, time per call, no-goal terminal semantics, and avoidable polling/token cost are `unmeasured`. |
| Compatibility and dirty-worktree validity | Pinned CLI/runtime libraries and compatibility digests drifted mid-run. Shared dirty worktrees invalidated previously passing test evidence. High unit-test counts did not prove a mounted usable feature. | Results may not be comparable when executable, dependency lock, configuration, or source tree changes between runs; unit tests may not exercise the mounted command path. | Before any future run, record executable/version digest, dependency lock hash, config hash, fixture hash, Git/working-tree status, and validation profile. Refuse to compare runs with changed identity. Separate unit checks from mounted end-to-end command checks. Do not modify the current checkout to obtain a clean state. | Toolchain/executable/runtime digests; lockfile hash; source/config/fixture hash; dirty-path manifest; test count; mounted command result; profile ID; start/end time. | `observed`; no comparable legacy run is available in this pass. Exact drift interval and invalidated result set are `unmeasured`. |

## Safe fixture and measurement contract

The first executable baseline should use a fixture manifest with:

1. a content digest and provenance (`synthetic`, `redacted export`, or
   `pinned legacy copy`);
2. explicit work, parent, dependency, reservation, assignment, session,
   evidence, gate, and history records;
3. a fixed actor/harness matrix (1/3/10/30/50) and TUI mode;
4. a virtual-clock or recorded-clock declaration;
5. tool, executable, dependency, configuration, and source digests; and
6. append-only command receipts containing start/end, exit status, operation
   and result identity, changed-state flag, retry count, bytes, lock timings,
   and relevant lifecycle timestamps.

Each run should have this shape, regardless of the eventual runner:

```text
fixture-manifest.json
run-metadata.json
commands.ndjson
payloads/<operation-id>.bin
states/<operation-id>.json
summary.md
```

A run is accepted as `reproduced` only when the same fixture and validation
profile produce the same stated behavior at least twice, or when a race is
captured with both participating receipts and an independently inspectable
final state. One transcript anecdote, one oversized payload, or one failed
retry is insufficient.

## Current unavailable measurements

The supplied audit does not contain the following measurements, and this pass
did not manufacture them:

- exact per-command wall time, startup time, lock wait, lock hold, or
  projection/serialization time;
- response bytes by command, field, or agent count beyond the reported
  approximate 190–306 KB examples;
- total TUI lock-hold time or TUI-on/TUI-off comparison;
- exact worker activity, silent-period cause, retry count, or avoidable token
  spend;
- exact evidence predicate, false-negative rate, or stale-receipt rate;
- expiry/reaper clock behavior, duplicate-selection rate, or repair
  idempotency/rollback behavior;
- a safely pinned v1 executable, dependency set, configuration, or disposable
  legacy fixture;
- any v2 lifecycle, lock, protocol, or performance result.

These are measurement gaps, not zeroes. They remain open until a future run
records the fixture, source/tool identity, commands, outputs, and limitations.

## Historical cargo scaffold 0-test baseline (preserved)

This is a source-documented scaffold baseline, not a test run performed while
creating this artifact. The README records that on 2026-09-14,
`cargo test --workspace` from the repository root exited 0 and all four existing
crates reported zero tests. The workspace manifest names these crates:

| Package | Workspace role | Tests reported by documented run |
| --- | --- | ---: |
| `boreal-domain` | domain library | 0 |
| `boreal-store` | store library | 0 |
| `boreal-application` | application library | 0 |
| `boreal-cli` | CLI binary | 0 |
| **Total** | **four-crate workspace** | **0** |

Recorded result: exit `0`; test count `0`; implementation/lifecycle coverage
`unproven`. No cargo command was rerun for this artifact, so timing, compiler
identity, dependency resolution, target-cache state, and fresh-checkout
reproducibility are `unmeasured`. This baseline must not be cited as proof of
working status, locking, expiry, evidence, repair, guidance, or finish
behavior.

## Current v2 implementation evidence (not a P0-02 reproduction)

The current v2 source set has content digest
`c9e0c93944b5662412acec8d8bd7ddf3d72adaf2511b19d599f2a3e00a709e49` over
Rust/TypeScript/JSON source files under `crates/` and `apps/`; the contract
fixture digest is
`62854a3381f8d8de7ba96836242afe9f5b75dfbc2f9e3747dc187c161c0bad36` over
`project/spec/`. It is based
on containing-repository commit
`0e614ccc9e71d577a0ceb3dedfbfecdcc63cbdb8`, with the v2 package untracked;
this is a working-tree identity, not an immutable source revision.

The following checks were measured on this current source set:

| Check | Result | Evidence boundary |
| --- | --- | --- |
| `cargo test --workspace` | PASS; all workspace test binaries completed with zero failures | v2 implementation behavior only; not legacy parity or performance |
| `bash scripts/standalone-check.sh` | PASS in a temporary copy | Contract fixtures, `cargo fmt --check`, locked offline Rust tests, clippy, TUI typecheck, and TUI mounted tests |

The passing v2 tests cover lifecycle/status/deadline/fence, dependency and
gate rules, structured evidence and close intent, protocol/CLI/service
boundaries, source/memory/migration behavior, and TUI mounted checks. They do
not reproduce any v1 row above. Every row remains `observed`, `hypothesis`, or
`unmeasured` until a pinned v1 run records the required fixture, tool identity,
commands, receipts, timings/bytes, and final state.

## Handoff limits and next evidence

P0-02 can report only the observed audit counts, the documented scaffold
result, and this safe reproduction plan at the current snapshot. The next
baseline pass should attach a pinned fixture manifest and receipts to each
row, classify each row as `reproduced` or `not reproduced`, and report any
finding to the independent P0-05 review. No P1 implementation or performance
claim should depend on an `unmeasured` value.

## Current remaining blockers and next actions

1. **Pinned v1 identity is absent.** Obtain the approved disposable v1
   executable, dependency/configuration identity, and fixture digest; do not
   touch live locks or legacy state.
2. **Legacy measurements are absent.** Run the fixed workload matrix with
   lock wait/hold, startup, bytes, retries, lifecycle timestamps, and
   TUI-on/off results; classify each row only from captured receipts.
3. **Immutable v2 checkpoint is absent.** The repo integrator must checkpoint
   the current v2 package, then rerun the current checks against that revision
   before treating this evidence as portable release evidence. This task does
   not edit code or perform that checkpoint.
