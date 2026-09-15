# P0-04 legacy record and workflow mapping

Status: first-wave migration inventory, 2026-09-14. This is a read-only map of
the legacy TypeScript implementation and tests to the proposed v2 contracts. It
does not claim that v2 behavior is implemented, and it does not authorize a
live v1 import. The fixture IDs below are the review/revalidation inputs for
P0-05 through P0-07.

## Scope and disposition vocabulary

The inspected legacy snapshot is the repository at this workspace's input
revision. Representative implementation sources include:

- `packages/core/src/records.ts`
- `packages/work-engine/src/work.ts`
- `packages/agent-runtime/src/reservations.ts`
- `packages/evidence-engine/src/evidence.ts`
- `packages/knowledge-engine/src/knowledge.ts`
- `packages/search/src/context-pack.ts`
- `apps/cli/src/commands/{agent,work,evidence,knowledge,memory,workflows}.ts`
- `apps/cli/src/command-registry.ts`

Focused behavioral evidence includes
`tests/runtime/{incremental-readiness,terminal-dependency-mutations,witnessed-evidence,agent-e2e,agent-renew-all,graph,orchestrator,git-worktree-lifecycle,workflow-docs,memory-store-immutability}.test.ts`.

Disposition meanings:

| Disposition | Migration meaning |
| --- | --- |
| `keep` | Preserve the user-visible capability and its normal intent; v2 may change storage behind the same behavior. |
| `rework` | Preserve the intent, but split or harden the representation/authorization before importing or exposing it. |
| `defer` | Do not promise it in the launch slice; preserve source/export compatibility and record an explicit owner/gate for later work. |
| `historical-only` | Retain for audit, provenance, or display, but do not treat it as current v2 authority or as proof of a new transition. |
| `unsupported` | No safe automatic mapping exists; retain the source record and route it to operator review rather than guessing. |

## Migration invariants

1. The v1 record is retained, or its canonical fields and source URI are
   retained in an import receipt. No failed evidence, expired reservation,
   prior attempt, superseded summary, or invalid closeout is deleted to make a
   v2 view look healthy.
2. v2 derives display status and claimability from canonical lifecycle,
   dependency, blocker, policy, attempt, gate, and clock inputs. A copied v1
   status is an input and migration clue, never an authorization token.
3. Unknown, malformed, dangling, contradictory, or ambiguous records import as
   `historical-only` or `unsupported` with an operator-review reason. They do
   not become `closed`, `complete`, `ready`, or passed evidence by inference.
4. Legacy evidence without an attestation remains
   `legacy_unattested`. A v1 `outcome=passed`, command string, actor identity,
   Git commit, or summary sentence cannot be upgraded to
   `boreal_witnessed`/`external_attested`.
5. A default v2 dependency edge is satisfied only by accepted `closed` work.
   Legacy edges that advanced on `verified` or `cancelled` are imported with
   their observed edge policy and a migration warning; they are not silently
   reinterpreted as successful v2 completion.
6. A reservation whose `expiresAt <= import_clock` is expired for eligibility,
   even if its v1 row still says `active`. The old row is retained, the v2
   attempt is fenced/reviewable, and reassignment waits for the expiry-review
   policy.
7. Raw intake remains immutable. Promotion to source, wiki, claim, decision,
   work, or published memory creates links; it does not replace or erase the
   raw source.
8. Published memory and live work remain different authorities. A Git ref or
   memory page can provide provenance and context, but it cannot close live
   work or grant claimability.

## Record mapping

### Work status and lifecycle

| v1 record/behavior | Observed source | v2 target | Disposition | Import rule and risk |
| --- | --- | --- | --- | --- |
| `draft` | `WorkStatus` in `packages/core/src/records.ts`; `createWorkItem` | lifecycle `draft`, derived display `draft` | `keep` | Preserve acceptance, parent, dependencies, source refs, gates, and history. Do not publish merely because prerequisites are closed. |
| `ready` | stored status plus `deriveReadinessStatus` in `packages/work-engine/src/work.ts` | lifecycle `open`; derive `queued`, `ready`, or `blocked` | `rework` | Re-evaluate graph, holds, policy, current attempt, and clock. Stored readiness may be stale and must not authorize a claim. |
| `blocked` with an open prerequisite | readiness projection and `incremental-readiness.test.ts` | `queued` with `prerequisite_open(<id>)` | `rework` | Split normal sequencing from intervention. Risk: v1 clients may have filtered all of these as incidents. |
| `blocked` with reconciliation or integrity work | work/reconciliation logic and enforcement gaps | `blocked` with typed reason codes | `keep` | Preserve the obligation and source finding; do not clear it during import. |
| `reserved` | legacy enum; reservation engine | current attempt phase `claimed` plus lease/fence | `rework` | Only reconstruct when owner, work ID, reservation ID, and timestamps are coherent. A reservation is not proof of productive execution. |
| `in_progress` | `reserveWork` sets work status to `in_progress` | open work with a current attempt candidate; accepted/running only if independently proven | `rework` | V1 reservation does not prove runtime acceptance or productivity. Preserve reservation and Git handoff; otherwise import as `claimed`/review. |
| `needs_verification` | evidence/verification transitions | `needs_verification` with typed open gate gaps | `keep` | Retain all evidence; prose or an unscoped pass does not satisfy a v2 gate. |
| `verified` | `verifySubject` and work status transition | open work with passed verification; derive review/closeout gaps, not terminal by default | `rework` | Passed verification alone does not prove every gate or make v2 `complete`. Keep evidence and flag any legacy successor released on verification; do not create a v2 close event. |
| `closed` | work close/finish paths | terminal `closed` with final summary/outcome | `rework` | Import as current closed only when final outcome, summary, gate provenance, and subject identity are valid. Otherwise preserve as historical close evidence and require review. |
| `cancelled` | `work cancel`; terminal dependency tests | terminal `cancelled` with reason and dependency disposition | `keep` | Preserve cancellation reason and dirty-path notes. It is not v2 success and does not satisfy a default dependency without an explicit waiver/replacement policy. |
| `parentId`, work kind, acceptance, labels, Git binding | `WorkItem` in `records.ts` and work CLI | v2 work/lifecycle plus hierarchy and source refs | `keep` | Validate dangling/self/cyclic parents and preserve unsupported kinds as review records. Parent rollups remain derived. |

### Dependency graph and readiness

| v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
| --- | --- | --- | --- | --- |
| Directed blocking edge | `GraphEdge`; `dep add/remove/tree/cycles`; `graph.test.ts` | canonical typed dependency edge with revisioned satisfaction policy | `keep` | Import direction and endpoint types exactly; detect missing endpoints and cycles. `dependencyIds` is a projection, not a second authority. |
| `dependencyIds` on work | `WorkItem` plus readiness recomputation | derived IDs/read model from canonical edges | `rework` | Compare the stored projection with graph truth. Mismatch becomes a migration finding, not an automatic edge mutation. |
| Terminal prerequisite accepted on `closed`, `verified`, or `cancelled` | `TERMINAL_DEPENDENCY_MUTATION_STATUSES`; `terminal-dependency-mutations.test.ts`; parity matrix | default edge satisfied on accepted `closed`; explicit legacy edge policy for exceptions | `rework` | This is a high-risk semantic change. Preserve observed release history and require an edge-policy fixture for every exception. |
| Closing A readies B but leaves C behind B queued/blocked | `incremental-readiness.test.ts` | atomic dependent recomputation with `queued`/`ready` derivation | `keep` | Import graph and recompute transitively without treating all descendants as ready. |
| Dependency cycle | graph engine cycle checks | rejected v2 import edge or `blocked` operator-review finding | `rework` | Never break a cycle by deleting an edge. Record the exact cycle and source IDs. |
| `work ready` versus `work next --ready` | CLI work command and CLI parity contract | explicit publish/readiness operation versus read-only eligible queue | `keep` | Preserve distinction. A list result cannot mark work ready. |
| `work block` compatibility path | CLI registry and work command | canonical `blocks` dependency-edge mutation | `keep` | Do not reinterpret it as an unrelated hard hold; preserve edge direction and reject invalid terminal/cyclic mutation. |

### Reservations, attempts, ownership, and Git

| v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
| --- | --- | --- | --- | --- |
| `AgentReservation { workId, agentId, status, reservedAt, expiresAt, purpose }` | `packages/agent-runtime/src/reservations.ts`; `records.ts` | one current fenced attempt plus immutable attempt history | `rework` | Preserve row identity and timestamps. Generate a v2 fence only at a validated import boundary; never merge two active rows into one silently. |
| Active reservation conflict | `reserveWork` and claim runtime | one-winner transactional claim, typed conflict, revision | `keep` | A second harness cannot take ownership. Preserve conflicting operation evidence. |
| Force reservation of non-ready work with `--force --reason` | `reserveWork` | authorized operator-only override, never automatic eligibility | `rework` | Require actor authority, reason code, audit event, and explicit policy. Do not import force as ordinary `ready`. |
| Release | `releaseReservation`, `work release`, `agent finish --release` | fenced attempt release; rederive open work status | `keep` | Release is not done. Preserve evidence and attempt history; do not set v2 `closed`. |
| TTL renewal | `renewReservation`, `work renew`, `agent renew --all`; `agent-renew-all.test.ts` | renewable lease distinct from hard attempt budget | `rework` | Map `--ttl` to lease deadline only. Expired renewal is rejected; daemon observation does not renew. Freeze v2 hard-budget grammar separately. |
| `expiresAt <= now` but row remains `active` until tick/repair | status model; renew-all expiry test | immediate derived expiry plus `expired_review`; terminal attempt `expired` after fenced stop/review | `rework` | This stale window is a known loss/race risk. Import with the authoritative import clock and retain the stale row. |
| `agent start` resumes an owned active reservation before pulling work | agent command and parity scenarios | resume current attempt, otherwise atomic pull/claim | `keep` | Match actor/session/harness identity. A conflicting current session is not auto-adopted. |
| No-goal start / no ready work | `agent-e2e.test.ts`; agent command | bounded idle response with counts, reasons, and one trusted next action | `keep` | Do not invent a goal or fail. Preserve `no_ready_work` as compatibility data while v2 exposes conditional reasons. |
| Git branch/worktree handoff on claim | `git-worktree-lifecycle.test.ts`; reservation `git` fields | attempt workspace ownership and source snapshot | `keep` | Import branch/base/worktree metadata as provenance. A missing or reused path is review-required before reassignment. |
| Orchestration assignment/run state | `packages/core/src/orchestration.ts`, `packages/engine/src/orchestrator.ts`, `orchestrator.test.ts` | bounded v2 dispatch/attempt events; no model-mediated authority | `defer` | Preserve run/assignment exports and pause/resume/cancel history. Launch does not promise drop-in automatic orchestration. |

### Evidence, verification, gates, and summaries

| v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
| --- | --- | --- | --- | --- |
| Evidence record: subject, kind, summary, outcome, command, URI, observed time | `EvidenceRecord`; `recordEvidence` | structured receipt linked to task/attempt/source snapshot | `keep` | Preserve all fields and source URI. Missing attestation derives to `legacy_unattested`. |
| Self-reported evidence | `recordEvidence` default attestation | `self_reported` receipt | `keep` | Do not upgrade based on actor kind or command text. |
| Boreal-witnessed command evidence | `recordWitnessedEvidence`; `witnessed-evidence.test.ts` | witnessed receipt with command/output/Git/tool/artifact provenance | `keep` | Preserve hashes, byte counts, truncation, timeout/cancel, expected observable, environment, and artifact refs. |
| Failed, timed-out, truncated evidence | witnessed evidence test | retained non-passing receipt and typed gate gap | `keep` | Never discard or reinterpret as passed. This is a required negative fixture. |
| External attestation | evidence trust fields and CLI flags | external receipt with issuer/result URI and verified status | `rework` | Import verification status exactly; unverified external evidence cannot satisfy a trusted gate. |
| `work verify --evidence ... --verdict passed` | `verifySubject`; terminal dependency helper | subject-, outcome-, trust-, freshness-, and snapshot-matched verification | `keep` | Preserve verification record, including failed verdicts. Reject wrong subject or no passed evidence. |
| Required closeout gates: verification/checkpoint/review/audit | `RequiredCloseoutGate` in `records.ts`; closeout tests/contracts | typed v2 gates and open/satisfied/forced result | `keep` | Map satisfaction links; forced gates remain explicit with actor/reason and never become ordinary proof. |
| `agent finish --close` | agent CLI/runtime; workflow docs | one fenced evidence → verify → summary → close/release operation | `keep` | Preserve consolidated normal path and idempotent operation result. v2 may add durable close intent, which is not a v1 record. |
| `agent finish --release` | agent CLI/runtime | finish/release without completion | `keep` | Recompute eligibility and retain receipts/attempt. |
| Direct `work close` | work CLI/runtime and closeout contracts | audited lower-level recovery under the same Rust finish/gate authority | `rework` | Keep the spelling, but do not expose a second normal bypass path; require current proof, attempt policy, role, and reason where applicable. |
| Forced close and manual summary backfill | work CLI and summary CLI | explicit migration/operator repair only | `defer` | Preserve historical reasons and source records; do not treat a forced legacy summary as ordinary proof. |
| Agent summary: subject, outcome, body, completed work, evidence, verification, commits, dirty paths, child summaries | `AgentSummaryRecord`; summary CLI and workflow tests | current final summary plus superseded/legacy-backfill history | `rework` | Import valid summaries as historical/current candidates only after subject and gate checks. Invalid summaries remain visible but cannot close work. |
| Summary outcome `completed`, `partial`, `deferred`, `duplicate`, `cancelled`, `blocked`, `no_change` | `records.ts` | typed final outcome with close policy | `keep` | Preserve outcome and force reason. Do not collapse `partial`, `blocked`, or `no_change` to success. |

### Raw sources, source-backed memory, claims, decisions, and context

| v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
| --- | --- | --- | --- | --- |
| `capture` / `raw add` immutable intake | `apps/cli/src/commands/capture.ts`, `memory.ts`, `vault.ts`; `agent-e2e.test.ts` | immutable raw-source intake with provenance and processing state | `keep` | Preserve raw body/path, URI, tags, timestamps, and original ID. Keep queued/linked/routed/kept/dropped state as intake history, not current work status. |
| `raw list/show` with bounded preview | memory CLI and E2E fixture | bounded raw retrieval with original source and preview metadata | `keep` | Preserve content hash and preview availability. Missing body/path is operator review, not empty content. |
| `raw triage` promotion/disposition | memory CLI and raw triage result | explicit promotion links to source/work/wiki/knowledge or disposition | `keep` | Promotion creates links and audit events; original raw record remains immutable. |
| Knowledge source `{kind,title,uri,summary}` | `KnowledgeSource`; `knowledge.ts`; `source add/list/show` | durable source identity/version linked to published memory and work | `keep` | Preserve URI and summary; deduplicate only with explicit content/identity evidence. |
| Wiki pages with source refs | `memory.ts` and `agent-e2e.test.ts` | Git-published curated memory entry with source/provenance manifest | `rework` | Import page text and refs, but publication/reconciliation status is separate from live work. Broken refs become review findings. |
| Claims and review statuses | `ClaimRecord`; `claim create/list/show/review` | retained knowledge claim, with adjudication scope explicit | `defer` | Preserve records and links for later claim workflow; do not make deferred adjudication a launch authority. |
| Decisions and supersession | `DecisionRecord`; `decision create/list/show/supersede` | versioned decision record with causal/source links | `keep` | Import accepted/proposed/rejected/superseded state and preserve earlier decision versions. Superseded is not deleted. |
| Context pack | `buildContextPack`; `context show/rebuild/search` | bounded derived context pack from current work/evidence/source/memory | `rework` | Rebuild from canonical imported records. Never treat a stale projection as authority or as executable instruction. |
| Search index/query | search CLI and sync | rebuildable derived index | `defer` | Rebuild after canonical import; stale index is a health condition, not lost source truth. |
| Git memory branch/ref/commit | setup/registry/sync and evidence Git provenance | explicit source-version/publication manifest and Git ref | `keep` | Preserve ref, commit, mode, remote, dirty state, and content hash. A Git commit alone is not operational evidence unless the gate says so. |
| Global inbox/project registry/dashboard | dashboard/global/registry commands and raw aging logic | launch single-project service; portable export of global references | `defer` | Do not import global rollups as project truth. Preserve registry/export data for later cross-project migration. |

## CLI, guide, and workflow mapping

The v2 command contract keeps the spelling of the core paths, but the
application owns all transitions. The table below groups the complete kept
contract from `project/CLI_COMMANDS.md`; each row has one or more fixture IDs in
the manifest. Grouping is only documentation shorthand: each listed command
path still needs a successful and rejected JSON example before parity is
declared.

| v1 command paths | v2 disposition | Mapping / user-visible rule | Fixtures |
| --- | --- | --- | --- |
| `commands`; `help [path]`/`--help`; `prime`; `status` compatibility alias | `keep` | Same registry-driven discovery. `status` remains the v1 prime alias, not an active-health query. | `CLI-01`, `CLI-02` |
| `agent guide`; `next`; `agent status`; `agent start [work-ref]`; `agent finish <work-ref>`; `session start/end` | `keep` | Preserve the no-goal loop, resume-first behavior, contextual handoff, bounded status, and composite finish/release. | `GUIDE-01`, `GUIDE-02`, `GUIDE-03`, `CLI-03` |
| `work create/edit/show/list/rollup/next/ready/parallel/review-candidates/recent-closed` | `keep` | Preserve hierarchy, bounded lists, raw-ready versus eligible-next distinction, rollups, and review candidates. | `CLI-04`, `CLI-05` |
| `dep add/remove/tree/cycles`; `work block`; `sprint list/show/launch/current/status/activate/board/report/metrics/close` | `keep` | Preserve graph inspection/mutation and sprint planning/closeout; v2 derives status from one snapshot. | `CLI-06`, `DEP-01`, `SPRINT-01` |
| `work claim`; `work reserve`; `work renew`; `agent renew`; `reservation list` | `rework` | Keep names and intent, but claim/reserve become one fenced attempt model; `--ttl` is lease-only and force is operator-only. | `CLAIM-01`, `CLAIM-02`, `EXP-01`, `EXP-02` |
| `evidence run`; `evidence add`; `work verify`; `work release`; `work close`; `work reconcile`; `work cancel/reopen/split` | `keep` / `rework` for direct close | Preserve evidence/verification/recovery and terminal history. Direct close remains an audited lower-level path under the same gate authority; normal agents use `agent finish`. | `EVID-01`, `EVID-02`, `FIN-01`, `FIN-02` |
| `summary compose/create/show/list/render`; `gate closeout` | `keep` / `defer` for backfill as normal work | Preserve typed summaries, gate inspection, and superseded history; backfill remains migration tooling. | `SUM-01`, `GATE-01` |
| `raw add/list/show/triage`; `capture`; `source add/list/show`; `wiki create/list/show` | `keep` | Preserve immutable intake, bounded retrieval, promotion links, source identity, and cited wiki/memory. | `RAW-01`, `RAW-02`, `MEM-01` |
| `claim create/list/show/review`; `decision create/list/show/supersede` | `keep` for records; `defer` for broad claim adjudication | Preserve source/evidence links and decision supersession. Do not make deferred claim adjudication a launch close authority. | `MEM-02`, `MEM-03` |
| `context show/search/rebuild`; `search query/index`; `sync status/refresh`; `dashboard` | `keep` for bounded read/rebuild behavior; `defer` for cross-project/global views | Derived views are rebuildable and revision-bound. They never mutate canonical state just by being read. | `CTX-01`, `SYNC-01` |
| `init`; `setup`; `workflows list/show`; `directives list/show`; `doctor`/`doctor skills` | `keep` | Preserve safe initialization, trusted checked-in workflow/directive discovery, and read-only health by default. | `SETUP-01`, `GUIDE-04`, `HEALTH-01` |
| `orchestrate start/list/show/tick/progress/nudge/pause/resume/cancel/fail` | `defer` | Preserve export visibility and manual recovery history; launch dispatch is deterministic and attempt-based, not drop-in model orchestration. | `ORCH-01` |
| `template list/show/validate/run/capture` | `defer` | Inventory in-use templates and retain provenance; broad custom authoring/capture is outside launch. | `TPL-01` |
| `global ...`; `dashboard global`; registry/link/unlink; global inbox | `defer` | Keep portable references/exports; do not create a second cross-project authority in v2. | `GLOBAL-01` |
| export/import/snapshot/ledger/storage/operation/lock/compact/merge/duplicate/admin update/install surfaces | `historical-only` for source records and `defer` for compatible tooling | Preserve recovery snapshots, operation results, and audit references. Only implement launch-safe import/export needed for rollback; never delete source state because a command is deferred. | `ADMIN-01`, `ROLLBACK-01` |
| Any legacy path with no valid v2 subject, source, owner, timestamp, or schema | `unsupported` | Retain raw payload and import finding; require operator classification. | `AMB-01` |

## Guide and workflow parity

| Legacy behavior | v2 mapping | Disposition | Required proof |
| --- | --- | --- | --- |
| `agent guide` returns start/finish/repair loop and required evidence | Versioned trusted directive bundle and bounded `next_step` object | `keep` | `GUIDE-01` verifies no untrusted work text becomes executable argv. |
| `next` selects one safe revision-bound action or reports idle | Same Rust evaluator as queue, show, TUI, and claim | `keep` | `GUIDE-02` covers no goal, current attempt, queued dependency, hard block, paused, operator-only, and idle. |
| Workflow files define allowed commands, finish criteria, and next workflow | Versioned workflow refs/registry owned by v2 application | `rework` | `GUIDE-04` rejects missing/unknown refs and checks exact argv/cwd/runner. |
| `agent start` → work → evidence → finish → release/next | One current fenced attempt and one normal composite finish path | `keep` | `CLI-03` and `FIN-01` verify resume, close, release, and repeated operation ID. |
| Directive acknowledgements and repair guidance | Typed acknowledgement/evidence links, not free-form completion | `rework` | `GUIDE-03` preserves unresolved obligations and operator-required recovery. |

## Migration ambiguities and loss risks

These are unresolved until P0-05 review and P0-06 reconciliation. They are
deliberately not resolved by this inventory.

| ID | Ambiguity / loss risk | Safe default pending decision | Owner/gate |
| --- | --- | --- | --- |
| `AMB-01` | v1 `blocked` does not always say whether the cause is an open prerequisite, reconciliation, policy, or corruption. | Import as open with `migration_reason_unknown`; display operator review, never ready. | P0-05/P0-06 |
| `AMB-02` | A v1 `verified` prerequisite may already have released successors. | Preserve the historical release event and edge policy; do not retroactively close or requeue successors without a graph review. | P0-01/P0-06 |
| `AMB-03` | A v1 `cancelled` prerequisite may have been treated as terminal satisfaction. | Keep cancellation terminal for that work, but block dependent migration until replacement/waiver is explicit. | P0-01/P0-03 |
| `AMB-04` | Active reservation with an old/absent `expiresAt` may represent a live process, stale state, or manual repair. | Fence/review before reassignment; never auto-steal a shared worktree. | P0-02/P0-05 |
| `AMB-05` | Multiple active reservations or duplicate operation records may result from legacy retries. | Import all rows as history; choose one current attempt only with identity and revision evidence. | P0-05 |
| `AMB-06` | v1 `closed` may lack a valid final summary, current source revision, or gate provenance. | Historical close only; current v2 close requires revalidation or an explicit legacy-backfill force reason. | P0-01/P0-03 |
| `AMB-07` | Evidence may contain a passing sentence/command but no attestation, output digest, or subject snapshot. | `legacy_unattested`; it can explain history but cannot satisfy a witnessed gate. | P0-03 |
| `AMB-08` | Raw/source/wiki identifiers and paths can move across memory layouts or Git branches. | Preserve original URI/ID and add a versioned import mapping; broken links stay reviewable. | P0-04/P4-04 |
| `AMB-09` | Context packs and search indexes are projections whose generation revision may be older than imported canonical records. | Rebuild after import; mark stale projections rather than importing them as facts. | P0-07/P3-09 |
| `AMB-10` | Legacy orchestration assignments and Git worktrees can outlive the importing process. | Historical assignment only until process/worktree ownership is checked; no automatic redispatch. | P0-05/P5-02 |
| `AMB-11` | Global registry records can describe projects outside the v2 checkout. | Preserve export/reference only; do not import external projects into the single-project store. | P5-08 |
| `AMB-12` | Legacy schema/version or malformed JSON may not identify a safe parser. | Retain raw bytes and import failure receipt; classify `unsupported`. | P0-04/P0-07 |

## Fixture manifest

Fixture files are planned under the P0 contract fixture set; this manifest is
the inventory and expected assertion list, not a claim that those fixtures
already exist. Each fixture must use a pinned read-only v1 snapshot or a
synthetic record explicitly labeled as synthetic. No fixture may run `bwrk` or
write the live legacy `.boreal` state.

| ID | Fixture input | Required assertions |
| --- | --- | --- |
| `STATUS-01` | One v1 item in each stored status | Exact status-to-lifecycle mapping; stale `ready`; `verified` not silently closed; `cancelled` reason retained. |
| `STATUS-02` | `blocked` item with open dependency versus reconciliation obligation | First derives `queued`; second remains `blocked`; all reason IDs retained. |
| `DEP-01` | A→B→C graph; close A | B becomes eligible/ready; C remains queued; edge IDs and direction unchanged. |
| `DEP-02` | Verified/cancelled prerequisite and successor | Historical edge satisfaction is flagged; default v2 successor does not become closed/ready without policy. |
| `DEP-03` | Dangling endpoint and cycle | Import is review/blocked with exact IDs; no edge deletion or guessed repair. |
| `CLAIM-01` | Two harnesses claim one ready task | Exactly one current fenced attempt; loser gets typed conflict and winning revision. |
| `CLAIM-02` | Agent start with owned active reservation, then no-goal start with none | First resumes; second returns bounded pull/idle guidance without inventing a task. |
| `EXP-01` | Active reservation with `expiresAt` before/equal import clock | Derived expiry and `expired_review`; renewal rejected; old row retained. |
| `EXP-02` | Expiry racing finish/release/renew and shared worktree | Only current fence can win; stale writes fail; no reassignment before safe stop/review. |
| `EVID-01` | Failed, passed, timed-out, truncated, legacy-unattested, witnessed, and external evidence | All retained; trust level preserved; only subject-matched valid passed evidence can verify. |
| `EVID-02` | Wrong subject, wrong revision, wrong Git head, and prose-only evidence | Verification/gate remains unsatisfied with exact typed gap and rerun guidance. |
| `FIN-01` | Current attempt with valid evidence/gates; `finish --close` repeated by operation ID | One final summary/close event, ownership released, dependent recomputed, replay returns original result. |
| `FIN-02` | Missing gate and `finish --release` | Close returns `not_closed` with gaps; release preserves evidence/history and never means done. |
| `SUM-01` | Valid, forced, partial, blocked, duplicate, and missing-subject summaries | Valid links retained; forced reason visible; invalid/missing summaries historical-only. |
| `RAW-01` | Raw add/capture, show, triage to source/wiki/work | Raw immutable; promotion links and audit event created; original body/provenance retrievable. |
| `RAW-02` | Queued, linked, routed, kept-global, dropped, aging raw rows | Processing state is not work status; disposition and aging guidance preserved. |
| `MEM-01` | Source and cited wiki page with Git ref | Source URI/hash and page source refs survive; publication revision is explicit. |
| `MEM-02` | Claim statuses and source/evidence/wiki links | Links preserved; deferred adjudication does not become close authority. |
| `MEM-03` | Decision supersession chain | Earlier decisions remain inspectable; latest relation is explicit; no destructive replacement. |
| `CTX-01` | Stale context pack/search index after canonical import | Rebuildable projection marked stale; canonical records remain authoritative. |
| `GUIDE-01` | No-goal, active-attempt, queued, blocked, paused, operator-only, and idle reads | One bounded trusted next action, exact argv/cwd/runner, typed required inputs, operator flag. |
| `GUIDE-02` | `prime → guide/next → start → finish → next` | End-to-end no-goal journey is resumable and revision-bound. |
| `GUIDE-03` | Missing evidence, stale fence, unknown outcome, and repair obligation | Guidance fails closed and names one safe recovery workflow/action. |
| `GUIDE-04` | Workflow/directive list/show and unknown reference | Registry and help agree; unknown refs are routing errors, not best-effort prose. |
| `CLI-01` | Command registry/help for every kept spelling | Same registry drives help, validation, aliases, JSON schema, and examples. |
| `CLI-02` | `--json`, `--brief`, repeated flags, mutually exclusive flags, invalid input | Versioned envelope, bounded list arrays, typed errors, no partial mutation on rejection. |
| `CLI-03` | Start/finish/session/agent status | Same application use case as API/TUI; current attempt and operation/revision visible. |
| `CLI-04` | Work create/edit/show/list/rollup/next/ready | Parent/dependency/gate/source fields survive; read-only next never publishes. |
| `CLI-05` | Work review/recent/parallel and sprint board/report/metrics | Bounded current views; no history dump or client-side status recomputation. |
| `CLI-06` | Dependency and sprint commands | Direction/cycle/readiness checks and explicit activation/closeout gates. |
| `SPRINT-01` | Launch/activate/board/close with outstanding children | Container rollup requires accepted closeouts/gates; child status is not hand-waved. |
| `GATE-01` | Verification/checkpoint/review/audit gate closeout | Open/satisfied/forced statuses and evidence links are returned; force requires authority/reason. |
| `MEM-04` | Raw/source/wiki/claim/decision/context/search command matrix | Each kept path has success and rejected examples, side effects, source/use-case mapping. |
| `SETUP-01` | Init/setup/workflow/directive/doctor commands | Safe idempotence, checked-in trusted assets, read-only doctor default, explicit repair. |
| `ORCH-01` | Legacy orchestration run/assignment/pause/resume/cancel export | Historical visibility preserved; no launch claim of drop-in model dispatch. |
| `TPL-01` | In-use legacy templates | Template identity/version/provenance captured; unsupported authoring is deferred. |
| `GLOBAL-01` | Registry/global/dashboard references | External projects remain references/export only; no second project authority. |
| `ADMIN-01` | Operation/ledger/snapshot/export/import/storage/lock records | Failed/unknown outcomes and recovery snapshots retained; destructive admin paths are not launch parity. |
| `ROLLBACK-01` | Import failure or non-reversible migration | Source snapshot remains available; rollback URI/hash and reason recorded before cutover. |
| `AMB-01` | Malformed/unknown schema, dangling refs, duplicate IDs, missing timestamps | Raw payload retained; `unsupported`/operator-review finding; zero guessed success. |

## P0-05 review questions and handoff

The independent reviewer should specifically answer:

1. Does every v1 status and dependency edge have a deterministic mapping, with
   `verified`/`cancelled` exceptions visible rather than silently normalized?
2. Can an expired active reservation, duplicate active reservation, or shared
   worktree ever be reassigned without a fenced stop/review record?
3. Are legacy evidence and summaries prevented from satisfying stronger v2
   trust/gate requirements merely because their text says “passed” or “done”?
4. Does every kept CLI path have both success and rejection coverage and one
   application use case, including aliases and no-goal guide/next behavior?
5. Are raw sources, Git refs, publication revisions, failed receipts, and
   unsupported records recoverable after an interrupted import?

Open P0-04 questions are `AMB-01` through `AMB-12`; this artifact does not
freeze the contested policy choices owned by P0-01. The next task is P0-05
independent review, followed by P0-06 reconciliation and P0-07 revalidation.
