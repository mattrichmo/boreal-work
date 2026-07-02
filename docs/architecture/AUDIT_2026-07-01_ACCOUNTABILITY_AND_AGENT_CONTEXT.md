# Audit: Accountability & Agent Context (2026-07-01)

Read-only investigation of the four mechanisms raised by the dabble-employee-app consumer-side audit
(`security_audit/DOMAIN_AUDIT_2026-07-01_process_templates_and_coverage.md` in that repo), plus the owner's
asks: lineage chaining ("what brought this work here"), richer briefs on task/sprint/phase/epic, and fit with
the agent-directive system. No tracker state or behavior was modified.

All citations are to this repo at commit `b9d66049`.

---

## Summary of verdicts

| # | Consumer claim | Verdict |
|---|---|---|
| 1 | "No done-gate enforcement; WOs close on self-assessment" | **Partially folklore.** Closure is mechanically gated (verification + evidence + agent summary + closeout gates, all default-on). But every gate validates record *shape*, not *truth* — the executing agent self-declares `--outcome passed`. A declared command gate is feasible and the hook point already exists. |
| 2 | "Description is the only spec channel; evidence attachments mutate state and hide spec" | **Confirmed and worse than reported.** The status flip is intentional, but the bigger defect is that the executor-facing views (`work show`, claim/handoff bundle) drop `description`, `acceptanceCriteria`, `sourceRefs`, and `parentId` entirely. |
| 3 | "Stale list/search" | **Not where the consumer thinks.** `work list` is always fresh (store re-reads disk per read). `search` fails **closed** when stale — it errors rather than returning stale results. The real staleness lives in context packs and the fail-closed search UX pushing agents to re-derive scope instead of rebuilding. |
| 4 | "Can the dependency graph hard-block execution?" | **Yes, today.** `blocked` is derived from open dependencies, claim only serves derived-`ready` work, and direct reserve of non-ready work requires `--force --reason`. The paired-WO pattern works now with `bwrk work block`. |

Owner asks:

| Ask | Verdict |
|---|---|
| Chain items back through links to see provenance | **Data model supports it, product surface doesn't.** `relates_to`/`references`/`depends_on` edge kinds exist but no CLI command creates them; `parentId` is only ever set by `work split`; no command renders a lineage chain. |
| More than `description` as a brief; better task/sprint/phase/epic briefs | **Confirmed gap.** Spec surface is one string + a string list. There is no `epic` or `phase` work kind (`WorkKind = issue \| task \| sprint \| milestone`) even though other subsystems already name `phase`/`project`. |

---

## Mechanism 1 — Done-gate enforcement

### What the close path actually validates today

The close path is far from "self-assessment only." With default policy
(`packages/core/src/policies.ts:10-17` — all four safety policies default **true**), `bwrk work close` /
`agent finish --close` enforces, in order:

1. **Reservation ownership** — reserved work cannot be directly closed by a non-owner
   (`packages/engine/src/runtime.ts:656-673`); `finishReservedWork` requires the acting agent to own a
   non-expired reservation (`runtime.ts:1119-1144`).
2. **Agent summary** — a `final` or `forced` closeout summary matching the work subject is required
   (`requireAgentSummaryForClose`, `runtime.ts:1190-1212`), and every evidence/verification/summary ID the
   summary references must exist (`runtime.ts:1214-1260`).
3. **Required closeout gates** — declared at filing (`--required-gate verification|checkpoint|review|audit[:scope]`,
   `apps/cli/src/commands.ts:10978-10989`), evaluated at close (`applyRequiredCloseoutGatePolicy`,
   `runtime.ts:1266-1337`). A `verification` gate needs a passed verification pointing at passed/observed
   evidence on the right subject (`runtime.ts:1401-1435`); a `checkpoint` gate needs a summary with commit SHAs
   or a whitelisted dirty-path reason code (`runtime.ts:1438-1459`, codes at `runtime.ts:185-195`); gates can be
   scoped to `direct_children`/`descendants` (`runtime.ts:1485-1496`). Forcing a gate requires a typed reason
   code + comment + actor (`records.ts:92-100`, validated `runtime.ts:1520-1522`).
4. **Container closure** — sprints/milestones cannot close while any dependency-descendant is unresolved
   (`runtime.ts:1274-1287`).
5. **Passing verification** — `closeWork` throws without one (`packages/work-engine/src/work.ts:293-296`), a
   verification requires evidence (`packages/evidence-engine/src/evidence.ts:78-80`), and a `passed` verdict
   requires at least one `passed` evidence record (`evidence.ts:105-109`).

### The actual hole

Every one of those checks validates **record shape**. The truth inputs are self-asserted by the executing
agent:

- Evidence `--outcome passed` is a flag the agent types (`apps/cli/src/command-registry.ts:1199-1203`).
- Evidence `--command` is a **string that is recorded, never executed** — `recordEvidence` redacts secrets and
  stores it (`evidence.ts:44-73`); no CLI code path runs it (no process execution anywhere in `apps/cli/src`
  outside install/git plumbing).
- Verification `--verdict passed` is likewise typed by the same agent that produced the evidence.

So the consumer's observed failure mode is exactly right in spirit: a design-brief-shaped WO closes when the
agent *says* `passed`, and nothing distinguishes "pasted real command output" from "typed a plausible summary."

### Intentional vs. accidental

Intentional as far as it goes — the docs state the contract is evidence-gated closure, not evidence-verified
closure (`docs/concepts.md` "work cannot close on assertion" means *record* assertion). The gap between
"evidence record exists" and "evidence is true" is an unstated limitation, not a bug.

### Recommendation: mechanical declared gate — feasible and cheap

The hook point already exists: `applyRequiredCloseoutGatePolicy` runs inside both close paths
(`runtime.ts:680-687` and `runtime.ts:772-781`) and already throws typed `gateGaps`. Two implementation tiers:

- **Tier 1 (match-only, no execution):** extend `RequiredCloseoutGate` with optional
  `declaredCommand: string` and `expectedObservable: string` (a substring/regex the evidence summary or an
  attached artifact must contain). `evidenceGateSatisfaction`/`verificationGateSatisfaction` additionally require
  a satisfying evidence record whose `command` equals `declaredCommand` and whose summary matches
  `expectedObservable`. This forces the filer's gate to be echoed at close time and makes "invented" closes
  detectably non-conforming. Schema change is additive (gates are already versioned records with a JSON schema
  at `schemas/records/work-item.schema.json`).
- **Tier 2 (execute-at-close):** `@boreal/core` already ships `runBoundedProcess`
  (`packages/core/src/process-runner.ts`, used by the SQLite cache at
  `packages/storage/src/sqlite-cache.ts:394-418` with timeout and output caps). A `gate.kind = "command"` could
  execute `declaredCommand` at closeout, auto-record the output as evidence, and pass/fail on exit code +
  `expectedObservable` match. This is the only tier that closes the honesty gap completely, at the cost of
  making close side-effectful (sandboxing, cwd, and non-determinism concerns — should be policy-gated
  per-workspace, not default).

Recommendation: implement Tier 1 mechanically (it is a filing-time contract the runtime can check for free),
offer Tier 2 behind a `RuntimePolicy` flag. Do **not** leave this as filing convention — the whole consumer
finding is that convention-shaped WOs drift.

---

## Mechanism 2 — Spec channels: description vs. evidence vs. source

### The reported gotcha is real and intentional

`attachEvidenceToWork` unconditionally moves any non-closed work to `needs_verification`
(`packages/work-engine/src/work.ts:251-266`). This is deliberate proof-of-completion semantics: evidence means
"something happened that bears on doneness," and the status machine routes it toward verification. Evidence is
also effectively immutable for agents — the only removal path is the admin/repair command
`bwrk ledger delete evidence <id>` with tombstone (`apps/cli/src/commands.ts:7598-7609`,
`apps/cli/src/import-export.ts:416`), which is not part of the agent loop. So the consumer folklore
("attaching spec detail as evidence hides it and mutates workflow state") is accurate, and the behavior is
**intentional**: evidence is not a spec channel and should never be used as one.

### The intended contract (now written against code, not folklore)

| Channel | Field(s) | Mutates status? | Reaches executor? |
|---|---|---|---|
| Spec / problem statement | `description` (`records.ts:122`), `acceptanceCriteria` (`records.ts:125`) — editable via `work edit --description/--acceptance` (`commands.ts:4633-4645`) | No | **Only partially — see defect below** |
| Provenance pointers | `meta.sourceRefs` via `--source <uri>` at create (`commands.ts:10974-10976`, normalized `work.ts:173-187`) | No | Indirectly (relevance tokens for context pack, `context-pack.ts:175-194`) |
| Durable knowledge | knowledge sources / claims / decisions (`runtime.ts:851-907`) | No | Top-5 accepted claims/decisions ranked into the context pack (`context-pack.ts:40-66`) |
| Proof of completion | evidence + verification | **Yes** (`ready → needs_verification`) | Yes (counts + summaries) |

So there **is** a second durable spec channel (`--source` + knowledge records) — the filing convention should
be: problem detail in `description`/`acceptanceCriteria`, upstream context as knowledge sources referenced via
`--source`, never evidence.

### The defect the consumer couldn't see: the spec doesn't reach the executor either

`WorkItemView` — the payload returned by `work show`, `work claim`, `agent start`, and the handoff bundle —
**omits `description`, `acceptanceCriteria`, `sourceRefs`, and `parentId`**
(`packages/ui-model/src/work-view.ts:3-20`, `107-138`). The spec reaches the executing agent only as
`contextSummary`, a single flattened sentence from the context pack
(`packages/search/src/context-pack.ts:87-90`: `` `${kind} "${title}" (${id}) is ${status}. ${description} Criteria: …` ``),
and only when a pack exists. The full record is retrievable, but nothing in the agent guide
(`commands.ts:11114-11183`) or workflows tells an agent to fetch the raw record instead of the view.

This is the strongest internal explanation for "description-shaped WOs drift": the executor is handed a title,
status, labels, and a one-line summary — for a design-brief WO that is nowhere near enough, so the agent
re-derives scope.

**Assessment:** accidental. The view was clearly designed for dashboards (counts, blockers, reservation) and
was reused as the agent handoff payload.

**Recommendation:** add `description`, `acceptanceCriteria`, `sourceRefs`, `parentId`, and `closedReason` to
`WorkItemView` (or add a `spec` sub-object), and document the channel contract above in `docs/concepts.md`.
This is a small, additive change with outsized effect on executor fidelity.

---

## Mechanism 3 — Stale list/search

### Where staleness does *not* come from

- **`work list` / `work next` / `claim`:** `FileBorealStore.read` constructs a fresh in-memory store from
  `state.json` on every read (`packages/storage/src/file-store.ts:48-51`); writes are serialized under a
  cross-process file lock (`file-store.ts:53-70`). There is no read cache. CLI list results cannot be stale
  relative to committed state.
- **Claim/handoff:** `buildHandoffBundle` rebuilds all projections *and* the search index before returning
  (`commands.ts:11015-11037`), so a freshly claimed agent gets current context.
- **SQLite cache:** a read-only mirror rebuilt by `sync refresh`, hash-checked for staleness
  (`packages/storage/src/sqlite-cache.ts:156-225`); nothing in the agent loop reads it as truth.

### Where it does come from

1. **Search index is a persisted artifact that goes stale on every mutation** — and the runtime **fails
   closed**: `runSearch` throws `"Search index is stale; run bwrk search index"` rather than serving stale
   results (`apps/cli/src/search-cli.ts:117-138`). That is the right integrity call, but from an executing
   agent's seat the effect is "search doesn't work"; an agent that hits the error mid-task and doesn't run the
   rebuild will fall back to memory — which is exactly when it invents scope. The consumer-side symptom
   ("stale search caused agents to miss sibling WOs") is most plausibly this failure mode, or an older/other
   surface, since stale results are never actually returned by this code.
2. **Context packs and projections are genuinely stale-capable.** `getContextPack` serves whatever is persisted
   with no freshness check (`runtime.ts:941-950`); packs are rebuilt only by `context rebuild`, `doctor --fix`,
   claim-time handoff, and `finishReservedWork` (`runtime.ts:799`, `refreshWorkContext` at
   `runtime.ts:1731-1744`). Evidence added via plain `evidence add`, or sibling closes, do not refresh other
   items' packs. An agent using `context show` between rebuilds reads outdated facts silently.

### Recommendation

- Cheap consistency fix: after any state-mutating command, refresh the affected subject's pack inline
  (`refreshWorkContext` already exists and is called from `finishReservedWork`; extend to `evidence add`,
  `work verify`, `work close`, `work edit`). Cost is one pack build per mutation.
- For search: auto-rebuild on stale instead of erroring (`runSearch` already knows the expected hash; rebuild
  is `writeSearchIndex(context)`, already lock-guarded). Keep `--no-rebuild` for callers who want the fail-closed
  behavior. This is strictly better than a `--fresh` escape hatch: the default becomes fresh.
- Stamp `generatedAt` prominently in `context show` output so consumers can detect drift.

---

## Mechanism 4 — Dependency hard-blocking (lower priority verify)

Confirmed the graph is enforcement, not decoration:

- `deriveReadinessStatus` returns `blocked` while any dependency is not closed/cancelled/verified
  (`packages/work-engine/src/work.ts:310-325`).
- `claimNextWork` and `listReadyWork` only serve items whose *derived* status is `ready`
  (`runtime.ts:435-471`) — they re-derive against live graph edges, so even a stale stored status can't leak a
  blocked item into the claim pool.
- Direct `work reserve` of non-`ready` work throws unless `--force` **and** `--reason` are given, and the
  force is recorded in the event log (`packages/agent-runtime/src/reservations.ts:64-76`,
  `runtime.ts:527-532`).
- Closing recomputes readiness workspace-wide, unblocking dependents (`runtime.ts:705`,
  `recomputeAllReadiness` at `runtime.ts:1693-1716`).

**The consumer's paired-WO pattern works today with no changes:**
`bwrk work block <contract-wo> <db-wo>` keeps the contract WO `blocked` (invisible to claim, unreservable
without an audited force) until the DB WO closes. This should be documented as the filing convention for
paired WOs; the only gap is discoverability, not capability.

---

## Owner asks

### A. Lineage — "chain items back to see what brought them here"

Current state:

- The edge model supports it: `EdgeKind` includes `relates_to`, `references`, `depends_on`, `supports`
  (`packages/core/src/records.ts:190-198`). But the **only edge kind any CLI command creates is `blocks`**
  (`work block`, `work split`). There is no `bwrk work link <from> <to> --kind relates_to`.
- `parentId` exists on `WorkItem` (`records.ts:127`) but is settable **only** via `work split`
  (`commands.ts:4607-4626`); `work create` never passes it (`commands.ts:4386-4396`). There is no `--parent`
  flag, no epic→task attach.
- No surface renders a chain. `work show` exposes `dependencyIds`/`blockedBy` only (`work-view.ts:107-138`);
  `sprint show` renders a dependency-scoped tree, but there is no "provenance" walk (work ← split-from ← source
  ← decision) even though every hop exists in the data (`sourceRefs`, `parentId`, `blocks` edges, knowledge
  edges).

Recommendation (proposal only): add `work create --parent <ref>`, a `work link` command over the existing edge
kinds, and a `work lineage <ref>` read command that walks `parentId` + inbound/outbound edges + `sourceRefs`
and emits an ordered chain ("created by split from X, sourced from raw/Y, unblocked by Z closing on <date>").
All the records and the graph engine already exist; this is a projection, not a schema change.

### B. Richer briefs for task/sprint/phase/epic

Current state:

- The entire spec surface of any work item is `title` + `description: string` + `acceptanceCriteria: string[]`
  (`records.ts:118-135`). Sprints and milestones are just work items with a different `kind` — a sprint's
  "brief" is the same single string a task gets.
- **There is no `epic` and no `phase` work kind** (`WorkKind = "issue" | "task" | "sprint" | "milestone"`,
  `records.ts:57`) — even though `CloseoutGateSubjectType` (`records.ts:73`) and `AgentSummarySubjectType`
  (`records.ts:148`) already include `phase` and `project`, and the directive subject type includes `phase`
  (`docs/architecture/AGENT_DIRECTIVES.md` Core Schema). The vocabulary the rest of the system speaks is wider
  than what work items can be. This mismatch will keep producing filing folklore.

Recommendation (proposal only):

1. Extend `WorkKind` with `epic` and `phase` (additive; `closeoutGateSubjectTypeForWorkKind` at
   `work.ts:153-158` and `isContainerWork` at `runtime.ts:1572-1574` need matching arms so they get container
   close semantics).
2. Add a structured brief to container kinds — minimally `objective`, `constraints[]`, `outOfScope[]`,
   `doneDefinition` — or, cheaper, a conventional `brief` knowledge source auto-linked via `sourceRefs` at
   create time so it flows into context packs with zero schema change. Given the directive system's safety
   boundary explicitly forbids work descriptions from becoming instruction text
   (`AGENT_DIRECTIVES.md` "Non-Goals"), structured *data* fields are the right shape: directives can carry
   them as typed `data`, quoted, without violating that boundary.
3. Make child items inherit a pointer to the container brief in their handoff bundle (the lineage walk from
   ask A gives this for free).

### C. Fit with the agent-directive approach

The directive system (`packages/core/src/agent-directives.ts`, `docs/architecture/AGENT_DIRECTIVES.md`) is the
right delivery vehicle for every recommendation above:

- Declared done-gates (Mechanism 1) can surface as a `blocking` directive on `work show`/`agent start` — "this
  WO closes only with evidence from `<declaredCommand>` matching `<expectedObservable>`" — so executors see the
  gate at pickup, not at close-rejection time. Gate satisfaction records already support `directiveIds`/
  `acknowledgementIds` (`records.ts:82-90`), so the plumbing anticipates this.
- The spec-channel contract (Mechanism 2) can ship as an informational directive on `work create`/`evidence add`
  ("spec belongs in description/sources; evidence flips status").
- Stale-context warnings (Mechanism 3) already have a directive fixture (`doctor-recovery` snapshot,
  `commands.ts:2013-2031`) — extend to `context show` when `generatedAt` predates the subject's `updatedAt`.

The one caution: directives must not become the spec channel themselves. The safety boundary is correct —
briefs are data, directives are procedure.

---

## Prioritized recommendations

| P | Change | Type | Mechanism |
|---|---|---|---|
| 1 | Add `description`/`acceptanceCriteria`/`sourceRefs`/`parentId` to `WorkItemView` | small, additive | 2 |
| 2 | Tier-1 declared gate (`declaredCommand` + `expectedObservable` matched at closeout) | moderate, additive schema | 1 |
| 3 | Auto-rebuild stale search index in `runSearch`; refresh subject context pack on every mutation | small | 3 |
| 4 | Document paired-WO convention (`work block`) + spec-channel contract in `docs/concepts.md` | docs only | 2, 4 |
| 5 | `work lineage` command + `work link` + `work create --parent` | moderate | ask A |
| 6 | `epic`/`phase` work kinds + structured container brief | larger, needs owner decision on shape | ask B |
| 7 | Tier-2 execute-at-close gate behind a policy flag | larger, security-sensitive | 1 |

Owner decision requested on: #2 vs. leaving gates as convention (recommendation: mechanical), #6 field shape
(structured fields vs. brief-as-knowledge-source), and whether #7 is wanted at all.
