# R-LEGACYMAP — project/legacy-map/RECORD_MAPPING.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/legacy-map/RECORD_MAPPING.md:L1–L272`  
**File SHA-256:** `ac9d497f2901e9b67d60dbaae9ca23a64fd2417e6ea89b45ebc6bf852bd795ed`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Legacy record inventory and ambiguity dispositions; does not supply absent raw v1 data.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,272p' 'project/legacy-map/RECORD_MAPPING.md'
```

## Exact baseline excerpt

````text
    1 | # P0-04 legacy record and workflow mapping
    2 | 
    3 | Status: first-wave migration inventory, 2026-09-14. This is a read-only map of
    4 | the legacy TypeScript implementation and tests to the proposed v2 contracts. It
    5 | does not claim that v2 behavior is implemented, and it does not authorize a
    6 | live v1 import. The fixture IDs below are the review/revalidation inputs for
    7 | P0-05 through P0-07.
    8 | 
    9 | ## Scope and disposition vocabulary
   10 | 
   11 | The inspected legacy snapshot is the repository at this workspace's input
   12 | revision. Representative implementation sources include:
   13 | 
   14 | - `packages/core/src/records.ts`
   15 | - `packages/work-engine/src/work.ts`
   16 | - `packages/agent-runtime/src/reservations.ts`
   17 | - `packages/evidence-engine/src/evidence.ts`
   18 | - `packages/knowledge-engine/src/knowledge.ts`
   19 | - `packages/search/src/context-pack.ts`
   20 | - `apps/cli/src/commands/{agent,work,evidence,knowledge,memory,workflows}.ts`
   21 | - `apps/cli/src/command-registry.ts`
   22 | 
   23 | Focused behavioral evidence includes
   24 | `tests/runtime/{incremental-readiness,terminal-dependency-mutations,witnessed-evidence,agent-e2e,agent-renew-all,graph,orchestrator,git-worktree-lifecycle,workflow-docs,memory-store-immutability}.test.ts`.
   25 | 
   26 | Disposition meanings:
   27 | 
   28 | | Disposition | Migration meaning |
   29 | | --- | --- |
   30 | | `keep` | Preserve the user-visible capability and its normal intent; v2 may change storage behind the same behavior. |
   31 | | `rework` | Preserve the intent, but split or harden the representation/authorization before importing or exposing it. |
   32 | | `defer` | Do not promise it in the launch slice; preserve source/export compatibility and record an explicit owner/gate for later work. |
   33 | | `historical-only` | Retain for audit, provenance, or display, but do not treat it as current v2 authority or as proof of a new transition. |
   34 | | `unsupported` | No safe automatic mapping exists; retain the source record and route it to operator review rather than guessing. |
   35 | 
   36 | ## Migration invariants
   37 | 
   38 | 1. The v1 record is retained, or its canonical fields and source URI are
   39 |    retained in an import receipt. No failed evidence, expired reservation,
   40 |    prior attempt, superseded summary, or invalid closeout is deleted to make a
   41 |    v2 view look healthy.
   42 | 2. v2 derives display status and claimability from canonical lifecycle,
   43 |    dependency, blocker, policy, attempt, gate, and clock inputs. A copied v1
   44 |    status is an input and migration clue, never an authorization token.
   45 | 3. Unknown, malformed, dangling, contradictory, or ambiguous records import as
   46 |    `historical-only` or `unsupported` with an operator-review reason. They do
   47 |    not become `closed`, `complete`, `ready`, or passed evidence by inference.
   48 | 4. Legacy evidence without an attestation remains
   49 |    `legacy_unattested`. A v1 `outcome=passed`, command string, actor identity,
   50 |    Git commit, or summary sentence cannot be upgraded to
   51 |    `boreal_witnessed`/`external_attested`.
   52 | 5. A default v2 dependency edge is satisfied only by accepted `closed` work.
   53 |    Legacy edges that advanced on `verified` or `cancelled` are imported with
   54 |    their observed edge policy and a migration warning; they are not silently
   55 |    reinterpreted as successful v2 completion.
   56 | 6. A reservation whose `expiresAt <= import_clock` is expired for eligibility,
   57 |    even if its v1 row still says `active`. The old row is retained, the v2
   58 |    attempt is fenced/reviewable, and reassignment waits for the expiry-review
   59 |    policy.
   60 | 7. Raw intake remains immutable. Promotion to source, wiki, claim, decision,
   61 |    work, or published memory creates links; it does not replace or erase the
   62 |    raw source.
   63 | 8. Published memory and live work remain different authorities. A Git ref or
   64 |    memory page can provide provenance and context, but it cannot close live
   65 |    work or grant claimability.
   66 | 
   67 | ## Record mapping
   68 | 
   69 | ### Work status and lifecycle
   70 | 
   71 | | v1 record/behavior | Observed source | v2 target | Disposition | Import rule and risk |
   72 | | --- | --- | --- | --- | --- |
   73 | | `draft` | `WorkStatus` in `packages/core/src/records.ts`; `createWorkItem` | lifecycle `draft`, derived display `draft` | `keep` | Preserve acceptance, parent, dependencies, source refs, gates, and history. Do not publish merely because prerequisites are closed. |
   74 | | `ready` | stored status plus `deriveReadinessStatus` in `packages/work-engine/src/work.ts` | lifecycle `open`; derive `queued`, `ready`, or `blocked` | `rework` | Re-evaluate graph, holds, policy, current attempt, and clock. Stored readiness may be stale and must not authorize a claim. |
   75 | | `blocked` with an open prerequisite | readiness projection and `incremental-readiness.test.ts` | `queued` with `prerequisite_open(<id>)` | `rework` | Split normal sequencing from intervention. Risk: v1 clients may have filtered all of these as incidents. |
   76 | | `blocked` with reconciliation or integrity work | work/reconciliation logic and enforcement gaps | `blocked` with typed reason codes | `keep` | Preserve the obligation and source finding; do not clear it during import. |
   77 | | `reserved` | legacy enum; reservation engine | current attempt phase `claimed` plus lease/fence | `rework` | Only reconstruct when owner, work ID, reservation ID, and timestamps are coherent. A reservation is not proof of productive execution. |
   78 | | `in_progress` | `reserveWork` sets work status to `in_progress` | open work with a current attempt candidate; accepted/running only if independently proven | `rework` | V1 reservation does not prove runtime acceptance or productivity. Preserve reservation and Git handoff; otherwise import as `claimed`/review. |
   79 | | `needs_verification` | evidence/verification transitions | `needs_verification` with typed open gate gaps | `keep` | Retain all evidence; prose or an unscoped pass does not satisfy a v2 gate. |
   80 | | `verified` | `verifySubject` and work status transition | open work with passed verification; derive review/closeout gaps, not terminal by default | `rework` | Passed verification alone does not prove every gate or make v2 `complete`. Keep evidence and flag any legacy successor released on verification; do not create a v2 close event. |
   81 | | `closed` | work close/finish paths | terminal `closed` with final summary/outcome | `rework` | Import as current closed only when final outcome, summary, gate provenance, and subject identity are valid. Otherwise preserve as historical close evidence and require review. |
   82 | | `cancelled` | `work cancel`; terminal dependency tests | terminal `cancelled` with reason and dependency disposition | `keep` | Preserve cancellation reason and dirty-path notes. It is not v2 success and does not satisfy a default dependency without an explicit waiver/replacement policy. |
   83 | | `parentId`, work kind, acceptance, labels, Git binding | `WorkItem` in `records.ts` and work CLI | v2 work/lifecycle plus hierarchy and source refs | `keep` | Validate dangling/self/cyclic parents and preserve unsupported kinds as review records. Parent rollups remain derived. |
   84 | 
   85 | ### Dependency graph and readiness
   86 | 
   87 | | v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
   88 | | --- | --- | --- | --- | --- |
   89 | | Directed blocking edge | `GraphEdge`; `dep add/remove/tree/cycles`; `graph.test.ts` | canonical typed dependency edge with revisioned satisfaction policy | `keep` | Import direction and endpoint types exactly; detect missing endpoints and cycles. `dependencyIds` is a projection, not a second authority. |
   90 | | `dependencyIds` on work | `WorkItem` plus readiness recomputation | derived IDs/read model from canonical edges | `rework` | Compare the stored projection with graph truth. Mismatch becomes a migration finding, not an automatic edge mutation. |
   91 | | Terminal prerequisite accepted on `closed`, `verified`, or `cancelled` | `TERMINAL_DEPENDENCY_MUTATION_STATUSES`; `terminal-dependency-mutations.test.ts`; parity matrix | default edge satisfied on accepted `closed`; explicit legacy edge policy for exceptions | `rework` | This is a high-risk semantic change. Preserve observed release history and require an edge-policy fixture for every exception. |
   92 | | Closing A readies B but leaves C behind B queued/blocked | `incremental-readiness.test.ts` | atomic dependent recomputation with `queued`/`ready` derivation | `keep` | Import graph and recompute transitively without treating all descendants as ready. |
   93 | | Dependency cycle | graph engine cycle checks | rejected v2 import edge or `blocked` operator-review finding | `rework` | Never break a cycle by deleting an edge. Record the exact cycle and source IDs. |
   94 | | `work ready` versus `work next --ready` | CLI work command and CLI parity contract | explicit publish/readiness operation versus read-only eligible queue | `keep` | Preserve distinction. A list result cannot mark work ready. |
   95 | | `work block` compatibility path | CLI registry and work command | canonical `blocks` dependency-edge mutation | `keep` | Do not reinterpret it as an unrelated hard hold; preserve edge direction and reject invalid terminal/cyclic mutation. |
   96 | 
   97 | ### Reservations, attempts, ownership, and Git
   98 | 
   99 | | v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
  100 | | --- | --- | --- | --- | --- |
  101 | | `AgentReservation { workId, agentId, status, reservedAt, expiresAt, purpose }` | `packages/agent-runtime/src/reservations.ts`; `records.ts` | one current fenced attempt plus immutable attempt history | `rework` | Preserve row identity and timestamps. Generate a v2 fence only at a validated import boundary; never merge two active rows into one silently. |
  102 | | Active reservation conflict | `reserveWork` and claim runtime | one-winner transactional claim, typed conflict, revision | `keep` | A second harness cannot take ownership. Preserve conflicting operation evidence. |
  103 | | Force reservation of non-ready work with `--force --reason` | `reserveWork` | authorized operator-only override, never automatic eligibility | `rework` | Require actor authority, reason code, audit event, and explicit policy. Do not import force as ordinary `ready`. |
  104 | | Release | `releaseReservation`, `work release`, `agent finish --release` | fenced attempt release; rederive open work status | `keep` | Release is not done. Preserve evidence and attempt history; do not set v2 `closed`. |
  105 | | TTL renewal | `renewReservation`, `work renew`, `agent renew --all`; `agent-renew-all.test.ts` | renewable lease distinct from hard attempt budget | `rework` | Map `--ttl` to lease deadline only. Expired renewal is rejected; daemon observation does not renew. Freeze v2 hard-budget grammar separately. |
  106 | | `expiresAt <= now` but row remains `active` until tick/repair | status model; renew-all expiry test | immediate derived expiry plus `expired_review`; terminal attempt `expired` after fenced stop/review | `rework` | This stale window is a known loss/race risk. Import with the authoritative import clock and retain the stale row. |
  107 | | `agent start` resumes an owned active reservation before pulling work | agent command and parity scenarios | resume current attempt, otherwise atomic pull/claim | `keep` | Match actor/session/harness identity. A conflicting current session is not auto-adopted. |
  108 | | No-goal start / no ready work | `agent-e2e.test.ts`; agent command | bounded idle response with counts, reasons, and one trusted next action | `keep` | Do not invent a goal or fail. Preserve `no_ready_work` as compatibility data while v2 exposes conditional reasons. |
  109 | | Git branch/worktree handoff on claim | `git-worktree-lifecycle.test.ts`; reservation `git` fields | attempt workspace ownership and source snapshot | `keep` | Import branch/base/worktree metadata as provenance. A missing or reused path is review-required before reassignment. |
  110 | | Orchestration assignment/run state | `packages/core/src/orchestration.ts`, `packages/engine/src/orchestrator.ts`, `orchestrator.test.ts` | bounded v2 dispatch/attempt events; no model-mediated authority | `defer` | Preserve run/assignment exports and pause/resume/cancel history. Launch does not promise drop-in automatic orchestration. |
  111 | 
  112 | ### Evidence, verification, gates, and summaries
  113 | 
  114 | | v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
  115 | | --- | --- | --- | --- | --- |
  116 | | Evidence record: subject, kind, summary, outcome, command, URI, observed time | `EvidenceRecord`; `recordEvidence` | structured receipt linked to task/attempt/source snapshot | `keep` | Preserve all fields and source URI. Missing attestation derives to `legacy_unattested`. |
  117 | | Self-reported evidence | `recordEvidence` default attestation | `self_reported` receipt | `keep` | Do not upgrade based on actor kind or command text. |
  118 | | Boreal-witnessed command evidence | `recordWitnessedEvidence`; `witnessed-evidence.test.ts` | witnessed receipt with command/output/Git/tool/artifact provenance | `keep` | Preserve hashes, byte counts, truncation, timeout/cancel, expected observable, environment, and artifact refs. |
  119 | | Failed, timed-out, truncated evidence | witnessed evidence test | retained non-passing receipt and typed gate gap | `keep` | Never discard or reinterpret as passed. This is a required negative fixture. |
  120 | | External attestation | evidence trust fields and CLI flags | external receipt with issuer/result URI and verified status | `rework` | Import verification status exactly; unverified external evidence cannot satisfy a trusted gate. |
  121 | | `work verify --evidence ... --verdict passed` | `verifySubject`; terminal dependency helper | subject-, outcome-, trust-, freshness-, and snapshot-matched verification | `keep` | Preserve verification record, including failed verdicts. Reject wrong subject or no passed evidence. |
  122 | | Required closeout gates: verification/checkpoint/review/audit | `RequiredCloseoutGate` in `records.ts`; closeout tests/contracts | typed v2 gates and open/satisfied/forced result | `keep` | Map satisfaction links; forced gates remain explicit with actor/reason and never become ordinary proof. |
  123 | | `agent finish --close` | agent CLI/runtime; workflow docs | one fenced evidence → verify → summary → close/release operation | `keep` | Preserve consolidated normal path and idempotent operation result. v2 may add durable close intent, which is not a v1 record. |
  124 | | `agent finish --release` | agent CLI/runtime | finish/release without completion | `keep` | Recompute eligibility and retain receipts/attempt. |
  125 | | Direct `work close` | work CLI/runtime and closeout contracts | audited lower-level recovery under the same Rust finish/gate authority | `rework` | Keep the spelling, but do not expose a second normal bypass path; require current proof, attempt policy, role, and reason where applicable. |
  126 | | Forced close and manual summary backfill | work CLI and summary CLI | explicit migration/operator repair only | `defer` | Preserve historical reasons and source records; do not treat a forced legacy summary as ordinary proof. |
  127 | | Agent summary: subject, outcome, body, completed work, evidence, verification, commits, dirty paths, child summaries | `AgentSummaryRecord`; summary CLI and workflow tests | current final summary plus superseded/legacy-backfill history | `rework` | Import valid summaries as historical/current candidates only after subject and gate checks. Invalid summaries remain visible but cannot close work. |
  128 | | Summary outcome `completed`, `partial`, `deferred`, `duplicate`, `cancelled`, `blocked`, `no_change` | `records.ts` | typed final outcome with close policy | `keep` | Preserve outcome and force reason. Do not collapse `partial`, `blocked`, or `no_change` to success. |
  129 | 
  130 | ### Raw sources, source-backed memory, claims, decisions, and context
  131 | 
  132 | | v1 record/behavior | Observed source/test | v2 target | Disposition | Import rule and risk |
  133 | | --- | --- | --- | --- | --- |
  134 | | `capture` / `raw add` immutable intake | `apps/cli/src/commands/capture.ts`, `memory.ts`, `vault.ts`; `agent-e2e.test.ts` | immutable raw-source intake with provenance and processing state | `keep` | Preserve raw body/path, URI, tags, timestamps, and original ID. Keep queued/linked/routed/kept/dropped state as intake history, not current work status. |
  135 | | `raw list/show` with bounded preview | memory CLI and E2E fixture | bounded raw retrieval with original source and preview metadata | `keep` | Preserve content hash and preview availability. Missing body/path is operator review, not empty content. |
  136 | | `raw triage` promotion/disposition | memory CLI and raw triage result | explicit promotion links to source/work/wiki/knowledge or disposition | `keep` | Promotion creates links and audit events; original raw record remains immutable. |
  137 | | Knowledge source `{kind,title,uri,summary}` | `KnowledgeSource`; `knowledge.ts`; `source add/list/show` | durable source identity/version linked to published memory and work | `keep` | Preserve URI and summary; deduplicate only with explicit content/identity evidence. |
  138 | | Wiki pages with source refs | `memory.ts` and `agent-e2e.test.ts` | Git-published curated memory entry with source/provenance manifest | `rework` | Import page text and refs, but publication/reconciliation status is separate from live work. Broken refs become review findings. |
  139 | | Claims and review statuses | `ClaimRecord`; `claim create/list/show/review` | retained knowledge claim, with adjudication scope explicit | `defer` | Preserve records and links for later claim workflow; do not make deferred adjudication a launch authority. |
  140 | | Decisions and supersession | `DecisionRecord`; `decision create/list/show/supersede` | versioned decision record with causal/source links | `keep` | Import accepted/proposed/rejected/superseded state and preserve earlier decision versions. Superseded is not deleted. |
  141 | | Context pack | `buildContextPack`; `context show/rebuild/search` | bounded derived context pack from current work/evidence/source/memory | `rework` | Rebuild from canonical imported records. Never treat a stale projection as authority or as executable instruction. |
  142 | | Search index/query | search CLI and sync | rebuildable derived index | `defer` | Rebuild after canonical import; stale index is a health condition, not lost source truth. |
  143 | | Git memory branch/ref/commit | setup/registry/sync and evidence Git provenance | explicit source-version/publication manifest and Git ref | `keep` | Preserve ref, commit, mode, remote, dirty state, and content hash. A Git commit alone is not operational evidence unless the gate says so. |
  144 | | Global inbox/project registry/dashboard | dashboard/global/registry commands and raw aging logic | launch single-project service; portable export of global references | `defer` | Do not import global rollups as project truth. Preserve registry/export data for later cross-project migration. |
  145 | 
  146 | ## CLI, guide, and workflow mapping
  147 | 
  148 | The v2 command contract keeps the spelling of the core paths, but the
  149 | application owns all transitions. The table below groups the complete kept
  150 | contract from `project/CLI_COMMANDS.md`; each row has one or more fixture IDs in
  151 | the manifest. Grouping is only documentation shorthand: each listed command
  152 | path still needs a successful and rejected JSON example before parity is
  153 | declared.
  154 | 
  155 | | v1 command paths | v2 disposition | Mapping / user-visible rule | Fixtures |
  156 | | --- | --- | --- | --- |
  157 | | `commands`; `help [path]`/`--help`; `prime`; `status` compatibility alias | `keep` | Same registry-driven discovery. `status` remains the v1 prime alias, not an active-health query. | `CLI-01`, `CLI-02` |
  158 | | `agent guide`; `next`; `agent status`; `agent start [work-ref]`; `agent finish <work-ref>`; `session start/end` | `keep` | Preserve the no-goal loop, resume-first behavior, contextual handoff, bounded status, and composite finish/release. | `GUIDE-01`, `GUIDE-02`, `GUIDE-03`, `CLI-03` |
  159 | | `work create/edit/show/list/rollup/next/ready/parallel/review-candidates/recent-closed` | `keep` | Preserve hierarchy, bounded lists, raw-ready versus eligible-next distinction, rollups, and review candidates. | `CLI-04`, `CLI-05` |
  160 | | `dep add/remove/tree/cycles`; `work block`; `sprint list/show/launch/current/status/activate/board/report/metrics/close` | `keep` | Preserve graph inspection/mutation and sprint planning/closeout; v2 derives status from one snapshot. | `CLI-06`, `DEP-01`, `SPRINT-01` |
  161 | | `work claim`; `work reserve`; `work renew`; `agent renew`; `reservation list` | `rework` | Keep names and intent, but claim/reserve become one fenced attempt model; `--ttl` is lease-only and force is operator-only. | `CLAIM-01`, `CLAIM-02`, `EXP-01`, `EXP-02` |
  162 | | `evidence run`; `evidence add`; `work verify`; `work release`; `work close`; `work reconcile`; `work cancel/reopen/split` | `keep` / `rework` for direct close | Preserve evidence/verification/recovery and terminal history. Direct close remains an audited lower-level path under the same gate authority; normal agents use `agent finish`. | `EVID-01`, `EVID-02`, `FIN-01`, `FIN-02` |
  163 | | `summary compose/create/show/list/render`; `gate closeout` | `keep` / `defer` for backfill as normal work | Preserve typed summaries, gate inspection, and superseded history; backfill remains migration tooling. | `SUM-01`, `GATE-01` |
  164 | | `raw add/list/show/triage`; `capture`; `source add/list/show`; `wiki create/list/show` | `keep` | Preserve immutable intake, bounded retrieval, promotion links, source identity, and cited wiki/memory. | `RAW-01`, `RAW-02`, `MEM-01` |
  165 | | `claim create/list/show/review`; `decision create/list/show/supersede` | `keep` for records; `defer` for broad claim adjudication | Preserve source/evidence links and decision supersession. Do not make deferred claim adjudication a launch close authority. | `MEM-02`, `MEM-03` |
  166 | | `context show/search/rebuild`; `search query/index`; `sync status/refresh`; `dashboard` | `keep` for bounded read/rebuild behavior; `defer` for cross-project/global views | Derived views are rebuildable and revision-bound. They never mutate canonical state just by being read. | `CTX-01`, `SYNC-01` |
  167 | | `init`; `setup`; `workflows list/show`; `directives list/show`; `doctor`/`doctor skills` | `keep` | Preserve safe initialization, trusted checked-in workflow/directive discovery, and read-only health by default. | `SETUP-01`, `GUIDE-04`, `HEALTH-01` |
  168 | | `orchestrate start/list/show/tick/progress/nudge/pause/resume/cancel/fail` | `defer` | Preserve export visibility and manual recovery history; launch dispatch is deterministic and attempt-based, not drop-in model orchestration. | `ORCH-01` |
  169 | | `template list/show/validate/run/capture` | `defer` | Inventory in-use templates and retain provenance; broad custom authoring/capture is outside launch. | `TPL-01` |
  170 | | `global ...`; `dashboard global`; registry/link/unlink; global inbox | `defer` | Keep portable references/exports; do not create a second cross-project authority in v2. | `GLOBAL-01` |
  171 | | export/import/snapshot/ledger/storage/operation/lock/compact/merge/duplicate/admin update/install surfaces | `historical-only` for source records and `defer` for compatible tooling | Preserve recovery snapshots, operation results, and audit references. Only implement launch-safe import/export needed for rollback; never delete source state because a command is deferred. | `ADMIN-01`, `ROLLBACK-01` |
  172 | | Any legacy path with no valid v2 subject, source, owner, timestamp, or schema | `unsupported` | Retain raw payload and import finding; require operator classification. | `AMB-01` |
  173 | 
  174 | ## Guide and workflow parity
  175 | 
  176 | | Legacy behavior | v2 mapping | Disposition | Required proof |
  177 | | --- | --- | --- | --- |
  178 | | `agent guide` returns start/finish/repair loop and required evidence | Versioned trusted directive bundle and bounded `next_step` object | `keep` | `GUIDE-01` verifies no untrusted work text becomes executable argv. |
  179 | | `next` selects one safe revision-bound action or reports idle | Same Rust evaluator as queue, show, TUI, and claim | `keep` | `GUIDE-02` covers no goal, current attempt, queued dependency, hard block, paused, operator-only, and idle. |
  180 | | Workflow files define allowed commands, finish criteria, and next workflow | Versioned workflow refs/registry owned by v2 application | `rework` | `GUIDE-04` rejects missing/unknown refs and checks exact argv/cwd/runner. |
  181 | | `agent start` → work → evidence → finish → release/next | One current fenced attempt and one normal composite finish path | `keep` | `CLI-03` and `FIN-01` verify resume, close, release, and repeated operation ID. |
  182 | | Directive acknowledgements and repair guidance | Typed acknowledgement/evidence links, not free-form completion | `rework` | `GUIDE-03` preserves unresolved obligations and operator-required recovery. |
  183 | 
  184 | ## Migration ambiguities and loss risks
  185 | 
  186 | These are unresolved until P0-05 review and P0-06 reconciliation. They are
  187 | deliberately not resolved by this inventory.
  188 | 
  189 | | ID | Ambiguity / loss risk | Safe default pending decision | Owner/gate |
  190 | | --- | --- | --- | --- |
  191 | | `AMB-01` | v1 `blocked` does not always say whether the cause is an open prerequisite, reconciliation, policy, or corruption. | Import as open with `migration_reason_unknown`; display operator review, never ready. | P0-05/P0-06 |
  192 | | `AMB-02` | A v1 `verified` prerequisite may already have released successors. | Preserve the historical release event and edge policy; do not retroactively close or requeue successors without a graph review. | P0-01/P0-06 |
  193 | | `AMB-03` | A v1 `cancelled` prerequisite may have been treated as terminal satisfaction. | Keep cancellation terminal for that work, but block dependent migration until replacement/waiver is explicit. | P0-01/P0-03 |
  194 | | `AMB-04` | Active reservation with an old/absent `expiresAt` may represent a live process, stale state, or manual repair. | Fence/review before reassignment; never auto-steal a shared worktree. | P0-02/P0-05 |
  195 | | `AMB-05` | Multiple active reservations or duplicate operation records may result from legacy retries. | Import all rows as history; choose one current attempt only with identity and revision evidence. | P0-05 |
  196 | | `AMB-06` | v1 `closed` may lack a valid final summary, current source revision, or gate provenance. | Historical close only; current v2 close requires revalidation or an explicit legacy-backfill force reason. | P0-01/P0-03 |
  197 | | `AMB-07` | Evidence may contain a passing sentence/command but no attestation, output digest, or subject snapshot. | `legacy_unattested`; it can explain history but cannot satisfy a witnessed gate. | P0-03 |
  198 | | `AMB-08` | Raw/source/wiki identifiers and paths can move across memory layouts or Git branches. | Preserve original URI/ID and add a versioned import mapping; broken links stay reviewable. | P0-04/P4-04 |
  199 | | `AMB-09` | Context packs and search indexes are projections whose generation revision may be older than imported canonical records. | Rebuild after import; mark stale projections rather than importing them as facts. | P0-07/P3-09 |
  200 | | `AMB-10` | Legacy orchestration assignments and Git worktrees can outlive the importing process. | Historical assignment only until process/worktree ownership is checked; no automatic redispatch. | P0-05/P5-02 |
  201 | | `AMB-11` | Global registry records can describe projects outside the v2 checkout. | Preserve export/reference only; do not import external projects into the single-project store. | P5-08 |
  202 | | `AMB-12` | Legacy schema/version or malformed JSON may not identify a safe parser. | Retain raw bytes and import failure receipt; classify `unsupported`. | P0-04/P0-07 |
  203 | 
  204 | ## Fixture manifest
  205 | 
  206 | Fixture files are planned under the P0 contract fixture set; this manifest is
  207 | the inventory and expected assertion list, not a claim that those fixtures
  208 | already exist. Each fixture must use a pinned read-only v1 snapshot or a
  209 | synthetic record explicitly labeled as synthetic. No fixture may run `bwrk` or
  210 | write the live legacy `.boreal` state.
  211 | 
  212 | | ID | Fixture input | Required assertions |
  213 | | --- | --- | --- |
  214 | | `STATUS-01` | One v1 item in each stored status | Exact status-to-lifecycle mapping; stale `ready`; `verified` not silently closed; `cancelled` reason retained. |
  215 | | `STATUS-02` | `blocked` item with open dependency versus reconciliation obligation | First derives `queued`; second remains `blocked`; all reason IDs retained. |
  216 | | `DEP-01` | A→B→C graph; close A | B becomes eligible/ready; C remains queued; edge IDs and direction unchanged. |
  217 | | `DEP-02` | Verified/cancelled prerequisite and successor | Historical edge satisfaction is flagged; default v2 successor does not become closed/ready without policy. |
  218 | | `DEP-03` | Dangling endpoint and cycle | Import is review/blocked with exact IDs; no edge deletion or guessed repair. |
  219 | | `CLAIM-01` | Two harnesses claim one ready task | Exactly one current fenced attempt; loser gets typed conflict and winning revision. |
  220 | | `CLAIM-02` | Agent start with owned active reservation, then no-goal start with none | First resumes; second returns bounded pull/idle guidance without inventing a task. |
  221 | | `EXP-01` | Active reservation with `expiresAt` before/equal import clock | Derived expiry and `expired_review`; renewal rejected; old row retained. |
  222 | | `EXP-02` | Expiry racing finish/release/renew and shared worktree | Only current fence can win; stale writes fail; no reassignment before safe stop/review. |
  223 | | `EVID-01` | Failed, passed, timed-out, truncated, legacy-unattested, witnessed, and external evidence | All retained; trust level preserved; only subject-matched valid passed evidence can verify. |
  224 | | `EVID-02` | Wrong subject, wrong revision, wrong Git head, and prose-only evidence | Verification/gate remains unsatisfied with exact typed gap and rerun guidance. |
  225 | | `FIN-01` | Current attempt with valid evidence/gates; `finish --close` repeated by operation ID | One final summary/close event, ownership released, dependent recomputed, replay returns original result. |
  226 | | `FIN-02` | Missing gate and `finish --release` | Close returns `not_closed` with gaps; release preserves evidence/history and never means done. |
  227 | | `SUM-01` | Valid, forced, partial, blocked, duplicate, and missing-subject summaries | Valid links retained; forced reason visible; invalid/missing summaries historical-only. |
  228 | | `RAW-01` | Raw add/capture, show, triage to source/wiki/work | Raw immutable; promotion links and audit event created; original body/provenance retrievable. |
  229 | | `RAW-02` | Queued, linked, routed, kept-global, dropped, aging raw rows | Processing state is not work status; disposition and aging guidance preserved. |
  230 | | `MEM-01` | Source and cited wiki page with Git ref | Source URI/hash and page source refs survive; publication revision is explicit. |
  231 | | `MEM-02` | Claim statuses and source/evidence/wiki links | Links preserved; deferred adjudication does not become close authority. |
  232 | | `MEM-03` | Decision supersession chain | Earlier decisions remain inspectable; latest relation is explicit; no destructive replacement. |
  233 | | `CTX-01` | Stale context pack/search index after canonical import | Rebuildable projection marked stale; canonical records remain authoritative. |
  234 | | `GUIDE-01` | No-goal, active-attempt, queued, blocked, paused, operator-only, and idle reads | One bounded trusted next action, exact argv/cwd/runner, typed required inputs, operator flag. |
  235 | | `GUIDE-02` | `prime → guide/next → start → finish → next` | End-to-end no-goal journey is resumable and revision-bound. |
  236 | | `GUIDE-03` | Missing evidence, stale fence, unknown outcome, and repair obligation | Guidance fails closed and names one safe recovery workflow/action. |
  237 | | `GUIDE-04` | Workflow/directive list/show and unknown reference | Registry and help agree; unknown refs are routing errors, not best-effort prose. |
  238 | | `CLI-01` | Command registry/help for every kept spelling | Same registry drives help, validation, aliases, JSON schema, and examples. |
  239 | | `CLI-02` | `--json`, `--brief`, repeated flags, mutually exclusive flags, invalid input | Versioned envelope, bounded list arrays, typed errors, no partial mutation on rejection. |
  240 | | `CLI-03` | Start/finish/session/agent status | Same application use case as API/TUI; current attempt and operation/revision visible. |
  241 | | `CLI-04` | Work create/edit/show/list/rollup/next/ready | Parent/dependency/gate/source fields survive; read-only next never publishes. |
  242 | | `CLI-05` | Work review/recent/parallel and sprint board/report/metrics | Bounded current views; no history dump or client-side status recomputation. |
  243 | | `CLI-06` | Dependency and sprint commands | Direction/cycle/readiness checks and explicit activation/closeout gates. |
  244 | | `SPRINT-01` | Launch/activate/board/close with outstanding children | Container rollup requires accepted closeouts/gates; child status is not hand-waved. |
  245 | | `GATE-01` | Verification/checkpoint/review/audit gate closeout | Open/satisfied/forced statuses and evidence links are returned; force requires authority/reason. |
  246 | | `MEM-04` | Raw/source/wiki/claim/decision/context/search command matrix | Each kept path has success and rejected examples, side effects, source/use-case mapping. |
  247 | | `SETUP-01` | Init/setup/workflow/directive/doctor commands | Safe idempotence, checked-in trusted assets, read-only doctor default, explicit repair. |
  248 | | `ORCH-01` | Legacy orchestration run/assignment/pause/resume/cancel export | Historical visibility preserved; no launch claim of drop-in model dispatch. |
  249 | | `TPL-01` | In-use legacy templates | Template identity/version/provenance captured; unsupported authoring is deferred. |
  250 | | `GLOBAL-01` | Registry/global/dashboard references | External projects remain references/export only; no second project authority. |
  251 | | `ADMIN-01` | Operation/ledger/snapshot/export/import/storage/lock records | Failed/unknown outcomes and recovery snapshots retained; destructive admin paths are not launch parity. |
  252 | | `ROLLBACK-01` | Import failure or non-reversible migration | Source snapshot remains available; rollback URI/hash and reason recorded before cutover. |
  253 | | `AMB-01` | Malformed/unknown schema, dangling refs, duplicate IDs, missing timestamps | Raw payload retained; `unsupported`/operator-review finding; zero guessed success. |
  254 | 
  255 | ## P0-05 review questions and handoff
  256 | 
  257 | The independent reviewer should specifically answer:
  258 | 
  259 | 1. Does every v1 status and dependency edge have a deterministic mapping, with
  260 |    `verified`/`cancelled` exceptions visible rather than silently normalized?
  261 | 2. Can an expired active reservation, duplicate active reservation, or shared
  262 |    worktree ever be reassigned without a fenced stop/review record?
  263 | 3. Are legacy evidence and summaries prevented from satisfying stronger v2
  264 |    trust/gate requirements merely because their text says “passed” or “done”?
  265 | 4. Does every kept CLI path have both success and rejection coverage and one
  266 |    application use case, including aliases and no-goal guide/next behavior?
  267 | 5. Are raw sources, Git refs, publication revisions, failed receipts, and
  268 |    unsupported records recoverable after an interrupted import?
  269 | 
  270 | Open P0-04 questions are `AMB-01` through `AMB-12`; this artifact does not
  271 | freeze the contested policy choices owned by P0-01. The next task is P0-05
  272 | independent review, followed by P0-06 reconciliation and P0-07 revalidation.
````
