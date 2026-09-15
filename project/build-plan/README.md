# Boreal v2 build-out plan

Status: proposed execution plan, 2026-09-14. Planning depth: **granular**.
This product spans concurrent storage, guided agent workflows, conditional
status, agent lifecycle, source ingestion, Git-published memory, a local
service, CLI, TUI, migration, and a release
boundary. Those concerns need separate design, implementation, review,
reconciliation, and revalidation passes.

This is the detailed leaf/dependency and vertical-ownership reference for the
top-level [master milestone plan](../../MASTER_PLAN.md) and its
[sprint files](../../milestones/M01-v2-product/README.md). The master controls
dispatch; this task index owns IDs/prerequisites/acceptance. If they differ,
stop and reconcile before assigning agents. This is a file-based plan for the self-contained v2 repository. The legacy
`bwrk` workspace currently reports a toolchain build/digest mismatch and
`canonicalWritesAllowed: false`; no legacy work records were created or edited
for this plan. The IDs below are **plan IDs**, not existing `bwrk` work IDs.

## Objective

Deliver an independent Boreal v2 that lets many agents from different
harnesses discover, claim, execute, validate, and finish milestone/sprint/task
work while humans monitor the same consistent state. An agent with no
bespoke goal prompt can ask Boreal what to do next and receive contextual,
trusted, conditional guidance until completion or an explicit blocker. The
same application
also ingests project sources and publishes cited, durable project memory in
Git. Every transition is auditable and recoverable without making ordinary
reads contend for a canonical writer lock.

## Scope and non-goals

The v2 launch scope is Rust domain/store/application/runtime/service/CLI,
SQLite operational state, a versioned agent-guidance/directive compiler,
conditional status and claim workflows, structured evidence, source engine,
Git memory bank,
TypeScript TUI, legacy-data importer, packaging, and measured concurrency
validation. A harness-neutral pull/claim path is required; automatic dispatch
may be enabled only after it shares the same atomic claim operation.

The legacy web console, global manager, full MCP surface, broad user-authored
workflow template system, Obsidian integration, cross-project search, and remote
multi-host service are excluded from v2 launch. They are captured in
[DEFERRED_VERTICALS.md](DEFERRED_VERTICALS.md), with an adapter boundary so
they can be added without changing the core lifecycle.

## Assumptions and decisions

- Agents are initially on one host; other hosts require a network service.
- One current fenced attempt per task and one current execution per session.
- SQLite is canonical for live work, attempts, operational memory, and audit.
- Git is provisionally canonical for *published curated* project memory.
- The TypeScript TUI consumes a versioned Rust service API.
- The Rust service coordinates active runs; domain correctness is enforced in
  shared Rust application/store code and transactions.
- The versioned trusted directive registry and `guide`/`next` loop are core
  product behavior; arbitrary work prose cannot become executable authority.

The open policy questions and their implementation impact are in
[`../DECISIONS.md`](../DECISIONS.md). Phase P0 records choices before persisted
formats or publication code are written.

## How to use this packet

1. Read the [master plan](../../MASTER_PLAN.md), assigned sprint file, and
   [project architecture packet](../README.md).
2. Choose one leaf from [TASK_INDEX.md](TASK_INDEX.md) whose prerequisites have
   passed their revalidation gate.
3. Read that leaf's vertical handoff in [`verticals/`](verticals/).
4. Send the filled [root agent handoff](../../AGENT_HANDOFF.md), using
   [AGENT_HANDOFF_TEMPLATE.md](AGENT_HANDOFF_TEMPLATE.md) for leaf-specific
   fields, owned paths, prerequisites, and evidence.
5. Deliver changed files, test evidence, migration impact, and remaining
   limitations to the integration owner. The integration owner runs the
   phase gate in [REVIEW_GATES.md](REVIEW_GATES.md).

The [first-wave dispatch sheet](FIRST_WAVE.md) provides directly assignable
P0 scopes and the independent review/reconciliation/revalidation sequence.

Task IDs express dependency, not file ownership or work containment. The
hierarchy is one v2 milestone containing P0–P5 phases; each phase contains
its leaf tasks. Dependency edges in [TASK_INDEX.md](TASK_INDEX.md) are
prerequisites, never a substitute for parent containment if this plan is
later instantiated as Boreal work records.

## Stage map

```text
P0 contracts and baseline
  -> review -> reconcile -> revalidate
P1 work/domain/store
  -> review -> reconcile -> revalidate
P2 attempt/runtime/protocol/CLI/guidance
  -> review -> reconcile -> revalidate
P3 evidence/source/memory
  -> review -> reconcile -> revalidate
P4 TUI/migration/packaging
  -> review -> reconcile -> revalidate
P5 load/fault/security/integration
  -> independent review -> reconcile -> revalidate -> cutover decision
```

Within a phase, disjoint verticals may proceed in parallel. The next phase
depends on the prior **revalidation** task, not directly on a finding-producing
review or test. A review with no findings still records an explicit no-change
disposition. A deferred finding names owner, follow-up work, and the gate it
does or does not block.

## Agent lanes and integration sequence

| Lane | Primary leaf ownership | Implementation write boundary |
| --- | --- | --- |
| 00 contracts/baseline | P0-01–P0-04 | `project/spec/`, `project/legacy-map/`, baseline fixtures; P0-05–P0-07 are independent gate work. |
| 01 domain/store | P1-01–P1-06 | `crates/domain/`, `crates/store/`, P1 application work; integrate shared migrations sequentially. |
| 02 attempts/evidence/runtime | P2-01, P2-02, P2-05 | `crates/application/` lifecycle/runtime; `crates/service/src/runtime/` only after service interface agreement. |
| 05 protocol/service/CLI | P2-03, P2-04, P2-06 | `crates/protocol/`, `crates/cli/`, service transport/queue/read pool/subscriptions; owns service crate wiring. |
| 11 agent guidance | P2-10–P2-12 | `crates/application/src/guidance/` and agreed protocol/CLI guidance modules; consumes lifecycle, receipts, and conditional status, never duplicates them. |
| 03 source | P3-01, P3-02, P3-05 | Source modules and retrieval; supplies citation and integrity hooks to memory lane. |
| 04 memory | P3-03, P3-04, P3-06 | Memory modules, Git publisher, doctor; supplies published projection to source retrieval. |
| 06 TUI | P4-01–P4-03 | `apps/tui/` and mounted UI fixtures only. |
| 12 canonical workflows | P4-10, P4-11 | Versioned core route/context/plan/claim/finish/review/audit/handoff/health/memory assets and parity fixtures; no second state machine. |
| 07 migration | P0-04, P4-04 | Export/import and explicit unsupported-data reporting. |
| 09 packaging | P4-05, P4-06, P5-08 | Distribution, upgrade/rollback, operator docs, standalone extraction. |
| 08 quality / 10 security | Phase review/reconciliation/revalidation; P5-01–P5-07 | Independent tests and findings; implementation owners fix their own modules. |

P0 contract, legacy-map, and baseline agents can run in parallel on disjoint
files, then an independent reviewer closes P0-05–P0-07. After P1-09, the
attempt lane may start P2-01 while the service lane starts P2-03; P2-04
follows both, P2-05 follows P2-01/P2-03, and P2-06 follows P2-04/P2-05.
The guidance lane starts P2-10 after receipt and liveness contracts, then
P2-11 integrates the CLI loop; P2-12 proves no-goal parity before P2 review.
After P2-09, source intake and TS client work can overlap; memory publication
waits for source versions. P4 migration and canonical workflow assets wait
for P3-09; P4-05 then packages the versioned assets. The integration
owner alone coordinates shared manifests, schema, and protocol fixtures.

## Definition of done

V2 is launch-ready when an unfamiliar agent can start without a bespoke goal,
receive current task context and one trusted next action, and follow the
conditional claim/evidence/verify/finish or release loop from a fresh
install. The end-to-end route/context/plan, task, review/audit, handoff,
health, source, and memory workflows pass; competing claimers yield one
current attempt; stale attempts cannot write; TUI readers remain available
during worker mutations; source
and Git publication failures recover without losing provenance; migration
reports unsupported records; the same workload is benchmarked against the
legacy baseline; and every P0/P1 audit concern has a verified disposition in
[AUDIT_TRACEABILITY.md](AUDIT_TRACEABILITY.md).

The final integration evidence names the source snapshot, schema/protocol
versions, toolchain, test profile, TUI-on/TUI-off benchmark, failed/accepted
deferrals, and the exact artifacts being released. The v2 folder must build
and run after being copied outside the legacy repository.

## Next action

Start with the three disjoint [first-wave assignments](FIRST_WAVE.md): policy
and fixtures, legacy mapping, and baseline. Then review and revalidate those contracts before
the first storage implementation task begins. Do not instantiate this plan
into the unhealthy legacy `bwrk` workspace.
