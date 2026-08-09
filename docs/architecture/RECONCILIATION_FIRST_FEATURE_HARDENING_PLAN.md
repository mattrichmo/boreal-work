# Reconciliation-First Trusted Advancement

Status: implementation plan with core hardening slice implemented; full definition of done remains open
Date: 2026-08-05
Scope: Boreal runtime, CLI, MCP, console, TUI, daemon, storage, setup/upgrade, integrations, workflows, and generated artifacts

## Executive decision

Boreal should treat reconciliation as an enforceable advancement capability, not as prose attached to a review task.

The feature is **Reconciliation-First Trusted Advancement**:

```text
check or review
  -> record findings and affected scope
  -> resolve findings
  -> update the affected contract, code, data, or artifact
  -> revalidate the changed scope
  -> reconcile hashes, counts, generations, and evidence
  -> unlock the dependent work or advance the sprint
```

Every finding-producing operation—review, validation, audit, browser check, red-team check, source onboarding, setup, upgrade, data-quality check, cost check, or performance optimization—must produce a typed obligation. The obligation remains unresolved until its remediation is applied and the relevant validation is run again. Closing or verifying the producer alone must not unlock downstream work.

This document reconciles the parallel code, security, operator, and user reviews into one feature plan. It is intentionally implementation-oriented: each epic has an owner boundary, a failure model, a dependency chain, proof gates, and a required reconciliation record.

## Current state and important caveats

The planning/template change that prompted this review is necessary but incomplete. The feature-delivery workflow now expresses a review/update/revalidation/reconciliation chain, but runtime readiness, sprint activation, UI actions, storage recovery, and execution boundaries do not yet universally enforce that chain.

The current Boreal context was read in compatibility mode:

- `bwrk prime --json` reported `canonicalWritesAllowed: false`.
- Vault and search index checks were healthy, but ledger/toolchain checks were not healthy.
- Findings included `build_sha_mismatch`, `artifact_digest_mismatch`, and `agent_asset_digest_mismatch`.
- The working tree was already dirty with user-owned changes before this review.
- The specialist reviews were read-only and did not intentionally edit project files or canonical records.
- No claim below should be interpreted as proof of production impact without the validation gate specified alongside it. Several performance observations are code-path inferences because no production benchmarks were available.

The existing contracts remain authoritative starting points:

- [Closeout gate contract](./CLOSEOUT_GATE_CONTRACT.md)
- [Hardening status](./HARDENING_STATUS.md)
- [Full audit remediation contract](./FULL_AUDIT_REMEDIATION_CONTRACT.md)
- [Long-running task safety](./LONG_RUNNING_TASKS.md)
- [Release boundary audit](../security/RELEASE_BOUNDARY_AUDIT.md)
- [Feature delivery template](../../templates/feature-delivery.md)

## Implemented slice and remaining boundary

The first implementation slice is now present in the repository. It establishes the runtime and workflow seam needed for reconciliation-first advancement without claiming that every finding-producing subsystem has been migrated:

- typed work-item reconciliation obligations with stable IDs, required changes, subject scope, revalidation commands, inputs, unlock targets, and lifecycle transitions;
- effective readiness, dependency readiness, verification, direct close, container closeout, and sprint closeout gates that reject open obligations;
- a CLI `work reconcile` operation for explicit resolve → revalidate → reconcile or defer transitions;
- machine-validated template topology requiring finding producers to lead to an update/reconciliation node and downstream revalidation;
- shell-free, bounded declared-gate execution with sanitized environment variables, process-group cleanup, imported-run executable revalidation, and unsafe snapshot rejection;
- fail-closed transaction/event-log recovery and observable lock-heartbeat failure behavior;
- browser/TUI reconciliation status panels, stale/error read-only boundaries, and verified-but-unreconciled dependency blocking;
- bounded search, rollup, console fan-out, and daemon renewal paths, plus CI coverage for the new hardening suites.

This slice does not yet satisfy the full definition of done below. Exact executable digests/signatures, explicit tenant authorization and import rehoming, generation/hash comparison receipts, full MCP/operation-envelope migration, daemon supervisor fencing, and complete performance/cost baselines remain follow-up hardening work. The implementation is therefore a usable enforcement foundation, not a claim that all workflows are fully reconciled.

## The invariant

For every finding-producing operation `F`, Boreal must persist a reconciliation obligation `R` with:

| Field | Meaning |
| --- | --- |
| `findingId` | Stable identity of the finding or validation result. |
| `producerOperationId` | Operation that created the finding. |
| `subjectScope` | Project, work item, sprint, artifact, source, or installation affected. |
| `requiredChanges` | Typed list of code, contract, data, documentation, configuration, or generated-artifact changes. |
| `revalidationCommand` | The exact safe command or typed validation operation that must run again. |
| `reconciliationInputs` | Hashes, counts, generations, event head, provenance, or evidence required to compare before and after. |
| `status` | `open`, `remediation-in-progress`, `revalidation-failed`, `reconciled`, `deferred`, or `blocked`. |
| `resolvedBy` | Operation that applied the remediation. |
| `revalidatedBy` | Operation that reran the check. |
| `reconciledBy` | Operation that proved the expected state and artifact relationships. |
| `unlocks` | Explicit downstream work, sprint, parent, release, or installation transition. |

The effective readiness of a work item is the conjunction of ordinary dependencies and all required reconciliation obligations. A `verified` status is not sufficient when an obligation is open or when the verified artifact is stale relative to the obligation’s input generation.

## Feature contract

### Required behavior

1. A finding-producing operation creates an obligation before it returns success.
2. The obligation names the affected scope and the exact remediation/revalidation path.
3. Runtime readiness and sprint activation evaluate obligations from the canonical graph, not only display directives.
4. Any mutation that could advance work performs a preflight before writing the state-changing event.
5. A successful remediation changes the relevant generation and records the operation identity.
6. Revalidation proves the changed scope, not merely that a command exited zero.
7. Reconciliation compares expected and observed hashes/counts/references and records any mismatch as a new finding.
8. Only reconciled obligations may unlock dependent work.
9. UIs, CLI, MCP, and agent-facing envelopes expose the same status and next action.
10. Stale, mixed-generation, unsupported, or failed views are read-only and cannot launch an advancement mutation.

### Non-goals

- Making every read globally strongly consistent when an explicitly declared bounded-staleness view is safe.
- Automatically applying arbitrary remediation commands.
- Treating a successful process exit as proof that a contract or artifact is correct.
- Hiding deferred or accepted risk. A deferral is a typed, scoped decision with an owner, expiry, rationale, and follow-up gate.

## Consolidated priority order

### P0 — block unsafe advancement and unsafe execution

| Epic | Outcome | Primary risks addressed |
| --- | --- | --- |
| E0 Trusted advancement and reconciliation obligations | No review/validation finding can silently unlock dependent work. | Runtime gates, sprint activation, directive-only guidance, parent/child graph drift. |
| E1 Trusted execution and release provenance | Gate runners, updates, integrations, and unattended actions execute only declared, pinned, bounded capabilities. | Arbitrary executable selection, mutable source update, inherited secrets, unsafe installer replacement. |
| E2 Transactional state and storage recovery | Multi-record writes, setup, upgrades, imports, and derived artifacts fail closed or resume from a durable transaction. | Partial writes, stale recovery, malformed logs, unfenced locks, partial setup/upgrade. |
| E3 Scope, path, and tenant isolation | Every operation is bound to an authorized project/memory/source scope and safe real paths. | Sibling traversal, symlink aliasing, cross-project imports, global triage writes, raw-data retention. |
| E4 One versioned mutation contract | CLI, MCP, console, TUI, and workers share idempotency, fencing, error, and operation semantics. | Duplicate writes, cursor rewind/replay, partial worker fencing, raw JSON errors, envelope drift. |

### P1 — make the feature usable and operable

| Epic | Outcome | Primary risks addressed |
| --- | --- | --- |
| E5 Reconciliation-aware browser and TUI | Users can resolve, update, revalidate, reconcile, and advance without stale or destructive UI paths. | Wrong-route stale data, hidden warnings, raw JSON failures, drag-only actions, hardcoded defaults. |
| E6 Generation-aware read and derived-artifact pipeline | Fast reads remain equivalent to a clean full rebuild and declare mixed/stale state. | Full scans, global thundering herds, repeated graph work, stale rollups, redundant refreshes. |
| E7 Reliability, daemon, and observability | Long-running work has checkpoints, bounded waits, recovery, and useful operation telemetry. | Sequential daemon renewal, stale rollups, hidden partial failure, weak incident evidence. |
| E8 Setup, upgrade, docs, and integration adoption | Onboarding and upgrades are resumable, provenance-aware, discoverable, and fully reconciled. | Partial setup, false rollback claims, doc drift, ineffective integration status, command sprawl. |

### P2 — prove and preserve the system

| Epic | Outcome |
| --- | --- |
| E9 Adversarial, accessibility, and browser verification | Security and user-facing gates exercise real transitions, not only static shapes. |
| E10 Performance and cost budgets | p95, memory, I/O, subprocess, concurrency, payload, and cost limits fail CI or block advancement. |
| E11 Fixtures, migration, and release evidence | Every optimization and hardening change has deterministic fixtures, migration proof, and an auditable closeout. |

## Dependency graph and required sprint shape

Each epic must be planned as the following chain. A downstream implementation, release, or parent close must depend on the reconciliation node—not directly on the review or validation node.

```text
discovery / threat model / baseline
  -> implementation or remediation
  -> focused review and validation
  -> resolve findings and update contracts/artifacts
  -> revalidation on the changed scope
  -> reconciliation of state, hashes, counts, generations, and evidence
  -> integration / browser / red-team / performance gate
  -> release or sprint advancement
```

For a failed gate, create a new remediation obligation or keep the current one open. Do not edit a review result to make it appear reconciled. Every sprint closeout must include a machine-readable list of obligations, their statuses, unresolved findings, accepted deferrals, and evidence references.

## Epic details

### E0 — Trusted advancement and reconciliation obligations

#### Deliverables

- Add a canonical `ReconciliationObligation` record and lifecycle events.
- Add typed producer metadata to review, validation, audit, browser, red-team, data-quality, cost, and performance operations.
- Add `reconciliationOf`, `revalidates`, and `unlocks` edges to the canonical graph.
- Compute `effectiveReadiness` from dependencies plus open required obligations.
- Make `verifyWork`, `work.close`, sprint activation, parent close, and release promotion run the same preflight.
- Ensure `parentId` and graph edges cannot diverge silently; either derive one from the other or record an explicit exception.
- Add a closeout summary that names what was found, what changed, what was rerun, and what was reconciled.

#### Known implementation seams

- `packages/work-engine/src/work.ts:362-389` treats terminal status as sufficient before gate satisfaction.
- `packages/engine/src/runtime.ts:827-852` verifies work and emits an event without recomputing dependent readiness.
- `packages/engine/src/runtime.ts:2480-2510` recomputes readiness without all required external/reconciliation gates.
- `apps/cli/src/commands/sprint.ts:1765-1815` activates a sprint without a universal predecessor/reconciliation preflight.
- `apps/cli/src/commands/template.ts:244-340` validates template structure but not required reconciliation semantics.
- `apps/cli/src/commands.ts:7718-7733` attaches directives after mutation; advisory guidance cannot prevent an unsafe transition.

#### Proof gates

- A failed review creates an open obligation.
- Updating code or artifacts without rerunning validation leaves the obligation open.
- A passing revalidation with a stale generation leaves the obligation open.
- A matching revalidation plus hash/count/reference reconciliation changes the obligation to `reconciled`.
- Sprint activation and parent advancement fail with a typed blocker while any required obligation is open.
- A second attempt after reconciliation is idempotent and produces one advancement operation.

### E1 — Trusted execution and release provenance

#### Deliverables

- Replace basename executable allowlists with a capability registry containing exact executable identity, resolved path, digest or signed provenance, allowed arguments, working directory, environment policy, timeout, output limit, and network policy.
- Reject `node -e`, `--require`, arbitrary absolute script paths, PATH-controlled binaries, shell metacharacter paths, and undeclared subcommands unless an explicit reviewed capability allows them.
- Sanitize inherited environment variables and redact secrets from stdout/stderr before evidence persistence.
- Add bounded process timeout, output bytes, file descriptors, child-process count, and cancellation behavior.
- Require immutable source identity or signed release artifacts for update/install; record commit, dependency lock, artifact digest, and builder metadata.
- Stage new binaries and retain the previous version until a post-install probe and rollback marker are durable.
- Make unattended execution default to plan-only when scope, provenance, or capability identity is ambiguous.

#### Known implementation seams

- `packages/core/src/declared-gate-runner.ts:88` and `packages/engine/src/runs.ts:504-537` select approved executables by basename.
- `apps/cli/src/commands/update.ts:96-165,226-271` clones mutable source, installs/builds, and updates without signed/provenance verification.
- `install.sh:139-167,303` builds from remote source and replaces the installed bundle before verification.
- `apps/mcp/src/tools.ts:754`, `apps/cli/src/repo-binary-pin.ts:104`, `apps/cli/src/delegation.ts:124`, and `packages/core/src/process-runner.ts:63` permit repo/workspace-controlled process boundaries.
- `packages/evidence-engine/src/witnessed-evidence.ts:107,157` persists process excerpts that may contain secrets.

#### Proof gates

- Capability fixtures attempt every known argument/path bypass and fail closed.
- A malicious repository cannot select an undeclared executable or inject a secret into evidence.
- Update fault injection proves old-binary retention and resumable recovery at clone, dependency, build, install, and probe phases.
- Provenance metadata is reproducible from the installed artifact.
- Every unattended operation has a bounded wait and an operation ID.

### E2 — Transactional state and storage recovery

#### Deliverables

- Introduce a durable transaction envelope for multi-record mutations with prepare, commit, abort, recovery, and reconciliation states.
- Recover pending transactions before reads or fail closed with a typed `recovery-required` status.
- Add per-record and batch manifests containing hashes, counts, event head, and schema version.
- Fence file locks and treat heartbeat failure as a write refusal, not a suppressed warning.
- Reject malformed event-log tails explicitly; never silently ignore the final non-newline JSONL record.
- Persist projections and context packs as first-class sections or explicitly mark them derived and reconstructable.
- Make event IDs conflict-detecting rather than last-write-wins.
- Give ledger rotation and broader state mutation one transaction/fencing model.

#### Known implementation seams

- `packages/storage/src/object-store.ts:127` and `packages/storage/src/file-store.ts:69` do not recover pending transactions on read.
- `packages/storage/src/object-store.ts:334` can expose partial multi-record state.
- `packages/storage/src/event-log.ts:663` silently ignores malformed non-newline tails.
- `packages/storage/src/object-store.ts:75` does not persist all runtime-accepted derived sections.
- `packages/storage/src/file-lock.ts:293` suppresses heartbeat failures.
- `packages/storage/src/file-store.ts:145,269` mixes event sources and allows duplicate IDs to resolve last-write-wins.

#### Proof gates

- Kill the process at each prepare/commit boundary and reopen the store.
- Every read either sees the previous committed generation, the next committed generation, or a typed recovery-required state—never a partial mix.
- Full rebuild and recovered state have equal manifests, event heads, counts, and references.
- Lock heartbeat loss prevents further writes and identifies the owner/lease.

### E3 — Scope, path, and tenant isolation

#### Deliverables

- Introduce an explicit `ProjectScope`/`MemoryScope` on canonical records, storage ports, operation envelopes, and audit events.
- Resolve and compare real paths before accepting workspace, memory, registry, import, export, or object paths.
- Reject symlink aliases, ancestor/descendant overlap, and path rehoming without an explicit migration plan.
- Bind registry identity to canonical project identity and detect copied/reused IDs.
- Add import dry-run with source/destination identity, conflict policy, and authorization proof.
- Require actor authorization and consent for global triage writes into a target project.
- Define raw inbox erasure and derived-copy retention behavior; surface retained copies in the reconciliation record.

#### Known implementation seams

- `packages/core/src/records.ts:42-58`, `packages/storage/src/ports.ts:43-127`, and `packages/storage/src/memory-store.ts:41-60` lack canonical tenant/project scope.
- `apps/cli/src/context.ts:58-103,169-204` relies mainly on filesystem root selection.
- `apps/cli/src/project-setup.ts:970-1015`, `packages/core/src/schema-validation.ts:1895-1905`, and `apps/console/src/server.ts:209-233` use lexical sibling checks vulnerable to aliasing.
- `apps/cli/src/import-export.ts:61-68,264-277,1120-1141,1705-1728,2067-2110` uses bare IDs and lacks a full rehome policy.
- `packages/core/src/project-registry.ts:115-139,180-198` and `apps/cli/src/registry.ts:135-167,600-605` can preserve or retarget copied registry identity.
- `apps/cli/src/commands/memory.ts:145-249` can write global triage into another project without an explicit authorization boundary.

#### Proof gates

- Symlink, hard-link, case-folding, relative-path, and ancestor/descendant fixtures cannot cross scope.
- Imports with duplicate IDs, copied registry entries, or changed source identity fail closed or require explicit rehome approval.
- A global action produces an audit record naming actor, source scope, destination scope, and authorization.
- Raw and derived data deletion behavior is verified by a retention/erasure fixture.

### E4 — One versioned mutation contract

#### Deliverables

- Define a shared operation envelope for CLI, MCP, console, TUI, daemon, and worker calls.
- Include `operationId`, request fingerprint, actor, scope, expected generation, idempotency key, state outcome, event IDs, warnings, limits, and reconciliation obligations.
- Make cursor tokens opaque, scope-bound, monotonic, and invalidatable; reject rewind and unknown-cursor full replay.
- Require worker identity for checkpoint, wait, and transition operations; fence stale workers.
- Separate domain errors from JSON-RPC validation errors and preserve typed codes across surfaces.
- Make no-op versus changed outcomes explicit and stable.

#### Known implementation seams

- `packages/engine/src/runs.ts:108-116,118-181,197-264,342-370` only partially fences workers; cursor rewinds and idempotency fingerprints are incomplete.
- `packages/engine/src/runtime.ts:415-435` creates work without idempotency; `packages/work-engine/src/work.ts:233-274` can duplicate edges; `packages/evidence-engine/src/evidence.ts:60-79` repeats evidence records.
- `apps/cli/src/output.ts:101-153` can clear spill buffers and return empty previews.
- `apps/mcp/src/tools.ts:591-669` can ambiguously look up repeated session/command operations.
- `apps/mcp/src/server.ts:142-156` maps all domain errors to JSON-RPC `-32602`.
- CLI, MCP, and console envelopes are not one versioned contract.

#### Proof gates

- Repeat every mutation with the same idempotency key and request fingerprint; exactly one state change is observed.
- Repeat with a changed request fingerprint; the operation is rejected as a conflict.
- A stale worker cannot checkpoint, wait, transition, or emit evidence.
- Every UI and API surface renders the same error code, operation ID, and next reconciliation action.

### E5 — Reconciliation-aware browser and TUI

#### Deliverables

- Implement a shared route state machine: `loading`, `ready`, `stale`, `error`, `empty`, `unsupported`, and `uninitialized`.
- Clear prior payloads when route/project changes or refresh fails; stale/error data is read-only.
- Add visible resolve findings, update contract/artifact, revalidate, reconcile, and advance actions.
- Add detail drill-down from global/project/sprint/work/finding rows.
- Require visible confirmation for close/cancel/repair/setup mutations and preserve the originating page on failure.
- Add keyboard equivalents for drag actions, focus-visible styles, dialog focus management, and announced loading/error/stale states.
- Remove hardcoded sprint/search defaults; bind route state to the selected project, active sprint, and query.
- Split route loading and show partial failures with explicit subsystem warnings.

#### Known implementation seams

- `apps/console/src/app/app.tsx:78` and `apps/console/src/components/sprint/boards.tsx:67` render duplicate H1s and no skip link.
- `apps/console/src/components/global/global-dashboard.tsx:185,206,630` uses drag-only controls and a command dialog without complete focus management.
- `apps/console/src/app/live-data.ts:100,120` uses hardcoded defaults and broad loading.
- `apps/console/src/server.ts:309,382` returns raw JSON for browser mutation failures.
- `apps/console/src/app/styles.ts:146,243,391` lacks global focus and responsive dense-table strategy.
- `apps/console/src/browser-smoke.ts:134,141` and `apps/console/src/app/smoke-checks.ts:30` do not baseline screenshots or exercise reconciliation transitions.
- `apps/tui/src/shell.tsx:161,318` retains old body/envelope on refresh failure; unsupported routes can display prior content.
- `apps/tui/src/loaders.ts:229,295,336` hides onboarding warnings and exposes incomplete task actions.

#### Proof gates

- Browser and TUI route-transition tests prove no stale body appears under a different route/project.
- Refresh failure clears or marks all content read-only and disables advancement.
- A failed review can be resolved entirely through the user-facing sequence and cannot be closed early.
- Keyboard-only users can complete every action without drag-and-drop.
- Screenshot baselines and accessibility assertions cover loading, error, stale, empty, and reconciled states.

### E6 — Generation-aware read and derived-artifact pipeline

#### Deliverables

- Create one read session with canonical generation, event head, work map, graph adjacency, evidence/verification indexes, context packs, reservations, and scope.
- Add per-section generation and per-record digests at write time.
- Make normal search and bounded reads use cheap generation validation; reserve corpus-wide scans for explicit doctor/reconciliation mode.
- Rebuild impacted projections, rollups, search, and ledgers from one snapshot; skip writes when output hashes are unchanged.
- Bound global project concurrency and declare mixed-generation results.
- Replace full sorts for top-k/max rollups with single-pass or bounded selection.
- Batch reservation renewal and import/export operations.

#### Known implementation seams

- `apps/cli/src/search-cli.ts:134-178,271-377` performs corpus-wide freshness work and rebuilds.
- `packages/storage/src/object-index.ts:204-255` rewrites FTS rows across the full index.
- `apps/cli/src/rollup.ts:400-443,488-507,543-570` sorts complete arrays for bounded results.
- `apps/cli/src/commands/dashboard.ts:1373-1384` launches seven project operations; `apps/console/src/app/live-data.ts:2571-2606` launches six per project.
- `apps/daemon/src/runtime.ts:295-329,633-664` runs maintenance serially and renews reservations one-by-one.
- `apps/cli/src/import-export.ts:2067-2170` compares and writes incoming records with whole-dataset overhead.

#### Proof gates

- Warm search after unchanged generation does not hash/read the full corpus.
- A deliberately modified canonical record is detected by cheap metadata and identified by deep reconciliation.
- Incremental output has identical semantic manifests to a clean full rebuild.
- Global views remain bounded at 10, 50, and 100 projects and identify mixed snapshots.
- Rollup ordering and selection are identical to the current implementation.

### E7 — Reliability, daemon, and observability

#### Deliverables

- Add durable checkpoints and typed wait states for long-running operations.
- Record operation lifecycle, phase, heartbeat, scope, generation, retry count, and last safe checkpoint.
- Make stale worker/agent reconciliation explicit and safe to resume.
- Add daemon budgets for watch-cycle duration, lock hold time, renewal batch size, and retry/backoff.
- Expose partial failure without suppressing warnings; include exact recovery and follow-up revalidation commands.
- Add health signals for ledger, artifact, agent asset, search, projection, and rollup drift.

#### Proof gates

- Kill/restart daemon and workers at every checkpoint; no duplicate advancement or lost reservation occurs.
- An expired worker cannot mutate state.
- Daemon cycles stay within budget as reservation and project counts grow.
- Every partial failure produces a reconciliation obligation or an explicit safe deferral.

### E8 — Setup, upgrade, docs, and integration adoption

#### Deliverables

- Build transactional `plan`, `apply`, `resume`, and `rollback` phases for setup and upgrade.
- Add `bwrk preflight` or expand install status into an effective environment report: Node/pnpm/Corepack, workspace links, binaries, roots, locks, and exact repair commands.
- Reconcile generated command docs against the registry exactly, including descriptions, examples, behavior metadata, and schemas.
- Add an effective integration smoke test proving the active agent discovers installed skills, not only that files exist.
- Add a contributor clean-room guide with supported toolchain, tests, browser/Chromium requirements, generated artifacts, and read-only/mutating check rules.
- Replace hard-coded integration targets with an adapter manifest.

#### Known implementation seams

- `apps/cli/src/project-setup.ts:904-1015` performs setup writes sequentially.
- `apps/cli/src/commands/upgrade.ts:35`, `apps/cli/src/commands/update.ts:115-271`, and `install.sh:303` expose partial-failure and rollback gaps.
- `apps/cli/src/commands/meta.ts:111` generates runtime docs while `apps/cli/src/documentation-truth.ts:54` checks only partial equivalence.
- `apps/cli/src/commands/integrations.ts:51-106` validates files, not effective discovery.
- Integration target types and defaults are distributed across setup, commands, and workflow assets.

#### Proof gates

- Fault injection at every setup/upgrade phase leaves either the old committed state or an explicit resumable transaction.
- Immutable source identity, artifact digest, and previous-binary retention are proven.
- Generated docs and checked-in docs are byte-identical or the checked-in file is removed in favor of generation.
- Every supported agent runtime discovers the installed integration at the intended scope.

### E9 — Adversarial, accessibility, and browser verification

#### Deliverables

- Add red-team fixtures for command injection, path traversal, symlink aliasing, Host/Origin/CSRF misuse, scope confusion, replay, cursor rewind, stale worker, secret persistence, and update provenance.
- Add browser tests for route transitions, mutation refusals, stale data, project switching, confirmation, keyboard operation, and reconciliation.
- Add accessible semantic checks for headings, focus order, dialogs, tables, announcements, and responsive layouts.
- Require remediation/revalidation/reconciliation for every red-team or browser finding.

#### Gate rule

No red-team or browser verification report may be marked complete if its finding list is only attached to the sprint. Its findings must be resolved, the affected contract/artifact updated, the check rerun, and the resulting evidence reconciled.

### E10 — Performance and cost budgets

The following are proposed starting budgets; baseline them on representative CI hardware and revise only through a recorded decision:

| Surface | Initial budget | Required evidence |
| --- | --- | --- |
| Warm indexed search | p95 <= 250 ms at 10k work items, no full-corpus scan after unchanged generation. | Query trace, bytes read, index generation. |
| Ready/readiness query | p95 <= 500 ms at 10k work/30k edges. | Read-session reuse and adjacency-build count. |
| Global console | p95 first usable response <= 2 s at 50 projects. | Bounded concurrency and per-project operation count. |
| Console/TUI payload | <= 1 MiB default response, explicit truncation metadata above budget. | Envelope limits and user-visible warning. |
| Daemon watch | <= 50% of configured cadence under representative reservation load. | Phase timings, lock hold, retries. |
| Import/export | Peak RSS <= 2x input manifest size; no per-record process spawn. | Fixture size, memory, temp disk, hashes. |
| Gate execution | Timeout and output caps declared per capability. | Capability manifest and refusal evidence. |
| Unattended cost | Every model/tool call and retry has a budget and operation ID. | Cost ledger reconciled to operation events. |

Optimization acceptance requires:

1. baseline measurement;
2. implementation;
3. semantic equivalence to the previous/full-rebuild path;
4. artifact hash/count/reference reconciliation;
5. explicit unresolved findings or deferrals;
6. only then advancement.

### E11 — Fixtures, migration, and release evidence

#### Deliverables

- Add deterministic fixtures for 1k/10k/100k workspaces, graph-heavy work, long event logs, 10/50/100 project registries, partial transactions, malformed tails, symlink aliases, duplicated IDs, and stale workers.
- Add migration manifests and backward/forward compatibility tests for reconciliation obligations and operation envelopes.
- Add release evidence bundles containing source/artifact provenance, test results, browser screenshots, red-team outcomes, performance measurements, and unresolved-risk decisions.
- Add a closeout linter that rejects a plan whose final node depends directly on a finding-producing node without a reconciliation node.

## Security threat matrix

| Threat | Current exposure | Required control | Proof |
| --- | --- | --- | --- |
| Arbitrary executable or script selection | Basename allowlists and workspace-controlled paths. | Exact capability identity, argument policy, digest/provenance, sanitized env. | Bypass fixture suite. |
| Remote/forged console mutation | Non-loopback server and unauthenticated GET/HTML surfaces. | Loopback default, authenticated remote mode, CSRF/origin/Host validation, minimal read endpoints. | Host/Origin matrix and remote auth tests. |
| Update supply-chain compromise | Mutable clone/ref, install/build, replacement before verification. | Signed artifacts or immutable commit, digest verification, staged install, rollback. | Fault-injected release fixture. |
| Scope escape | Lexical path checks and weak project identity. | Realpath/no-follow checks, explicit scope on records and operations, authorization. | Symlink/alias/rehoming suite. |
| Secret persistence | Process excerpts can enter evidence. | Redaction, allowlisted output fields, secret scanner, bounded excerpts. | Secret-injection evidence fixture. |
| Replay/duplicate mutation | Partial idempotency and request identity. | Request fingerprint, expected generation, idempotency envelope, conflict refusal. | Replay and changed-fingerprint tests. |
| Worker takeover | Incomplete fencing of wait/checkpoint/transition. | Worker lease, epoch/fence token, phase ownership, stale refusal. | Kill/restart worker tests. |
| Unbounded input/resource exhaustion | MCP/JSON/config/payload sizes and process output are not universally bounded. | Schema byte/depth/array limits, process caps, payload truncation metadata. | Fuzz and limit tests. |
| Cross-project triage or import | Global writes and bare-ID imports. | Explicit destination authorization, dry-run, rehome policy, audit trail. | Cross-scope fixture. |

## Unified validation and reconciliation matrix

| Gate type | Check | Remediation/update | Revalidation | Reconciliation evidence | Advancement condition |
| --- | --- | --- | --- | --- | --- |
| Review/critique | Review code, design, or workflow. | Update implementation and contract. | Rerun focused review/tests. | Finding IDs, changed files, test result, generation. | All required findings reconciled. |
| Security/red-team | Attack fixture or boundary test. | Fix boundary and update threat model. | Rerun attack matrix. | Inputs, refusal, logs, redaction, provenance. | No open P0/P1 or approved expiring deferral. |
| Browser/accessibility | Exercise real route and action. | Fix UI/state/semantics. | Rerun route, keyboard, screen-reader-compatible assertions. | Screenshot/trace, route scope, operation ID. | No stale actionable state or blocked critical journey. |
| Performance/cost | Benchmark at fixture scale. | Optimize and update budget/contract. | Rerun baseline and optimized paths. | p95/RSS/I/O/subprocess/cost and equivalence manifest. | Budget met and full-rebuild semantics preserved. |
| Data/storage | Validate ledger, projections, indexes, and references. | Repair/rebuild/rewrite transactionally. | Reopen and rerun integrity check. | Counts, hashes, event head, schema, recovery record. | No mixed generation or unexplained drift. |
| Setup/upgrade | Fault-inject each phase. | Resume/rollback/stage changes. | Repeat clean-room and post-install probes. | Provenance, transaction marker, old/new manifests. | Committed state is known and recoverable. |
| Source onboarding | Validate source identity and dependencies. | Pin source, lock dependencies, fix environment. | Re-run preflight and package smoke. | Commit, lock digest, artifact digest, toolchain. | Effective binary/integration is discoverable. |
| Sprint closeout | Evaluate all obligations and downstream edges. | Resolve or explicitly defer each one. | Run final validation bundle. | Closeout summary and obligation ledger. | Only reconciliation node unlocks parent/release. |

## Required operation and UI states

The same state vocabulary should be used in records and views:

- `open`: finding exists and blocks required advancement.
- `remediation-in-progress`: an operation owns the next change; concurrent conflicting writes are refused.
- `revalidation-failed`: the change was applied but the check still fails; a new finding is attached.
- `reconciled`: expected remediation, revalidation, and artifact/state comparison all match.
- `deferred`: an authorized decision accepts the risk with owner, reason, expiry, and recheck.
- `blocked`: external dependency or scope issue prevents safe progress.
- `stale` / `mixed-generation`: read result cannot safely drive a mutation.
- `recovery-required`: storage or transaction state must be repaired before reads/writes continue.

The browser, TUI, CLI, and MCP response must show:

1. target scope;
2. observed generation/event head;
3. current state;
4. blocker or obligation IDs;
5. exact next action;
6. operation ID and retry/idempotency behavior;
7. whether the payload is partial, stale, truncated, or mixed.

## Release and risk policy

P0 findings block release and sprint advancement. P1 findings block the affected surface unless an explicit decision records scope, owner, expiry, compensating control, and revalidation date. P2 findings may be scheduled, but the plan still needs a reconciliation node and cannot be silently dropped.

Accepted deferral is not success. It is a terminal decision with an expiry-triggered follow-up obligation.

## Open decisions

1. Is the canonical active sprint derived from a projection, explicit selection, or status query?
2. Is remote console access supported, or should the server remain loopback-only?
3. Which update trust model is approved: signed release artifacts, immutable commit SHAs, or both?
4. Which external agent runtimes must prove effective skill discovery?
5. What are the production workspace/project size distributions and acceptable dashboard staleness window?
6. Are generated artifacts required to be byte-identical or semantically equivalent?
7. Which health/remediation actions are safe to execute from browser/TUI, and which must remain copy-only?
8. What is the retention and erasure policy for raw inbox data and derived evidence copies?
9. Should `verified` remain a user-visible status if it cannot unlock work until reconciliation is complete?

## Agent review corpus and summaries

All agents were asked to inspect a distinct perspective, remain read-only, cite file/line evidence, distinguish fact from inference, and return remediation plus validation/reconciliation gates. The summaries below preserve the independent conclusions; the epic mapping above is the reconciliation of those conclusions.

| # | Perspective | Completion | Main contribution |
| ---: | --- | --- | --- |
| 1 | Systems architecture | complete | Cross-cutting seams, capability registry, typed reconciliation contract. |
| 2 | Security threat model | complete | Execution, remote boundary, secrets, input/resource threats. |
| 3 | Multi-tenant/privacy | complete | Scope, path, registry identity, import, erasure boundaries. |
| 4 | CLI/API contracts | complete | Idempotency, worker/cursor fencing, envelope consistency. |
| 5 | Runtime/storage/ledger | complete | Recovery, event log, lock, projection, and manifest integrity. |
| 6 | Workflow/dependency | complete | Effective readiness and advancement gate weakness. |
| 7 | Accessibility/visual/browser | complete | Semantic, keyboard, focus, responsive, and visual verification gaps. |
| 8 | Frontend UX/operator | complete | Stale/error states, navigation, mutation safety, reconciliation journey. |
| 9 | Performance optimization | complete | Generations, full scans, fan-out, graph complexity, budgets. |
| 10 | Developer experience/onboarding | complete | Setup/upgrade transactions, provenance, docs, integrations, preflight. |
| 11 | Reliability/operations | complete | Daemon lifecycle, fencing, process cleanup, crash recovery. |
| 12 | Testing/CI/quality | complete | Coverage topology, portability, test confidence, fault injection. |
| 13 | Red-team/unattended execution | complete | Imported-run bypasses, replay, evidence authenticity, force/MCP risks. |

### 1. Systems architecture — agent `019fd414-ecb8-77d1-9386-281a5051517e`

The architecture review identified orchestration seam drift: `apps/cli/src/commands.ts` and `command-registry.ts` are very large, while runtime, storage, console, daemon, and MCP boundaries each encode overlapping policy. It recommended a trusted execution capability registry, typed reconciliation contracts (`checkEffect`, `reconciliationOf`, `revalidates`, `unlocks`), an atomic mutation envelope, secure update/remote boundaries, and storage fault-injection proof. It highlighted basename executable allowlists, unauthenticated console reads when bound remotely, update provenance, and stale daemon rollups as cross-cutting risks.

### 2. Security threat model — agent `019fd414-ec31-7641-8f66-a63fc1c763e3`

The threat model found arbitrary execution and supply-chain risk at gate runners, repo-binary pinning, delegation, MCP tools, and self-update paths. Shell-free invocation alone is not enough when basenames, `node -e`, `--require`, PATH resolution, or absolute workspace-controlled paths remain possible. It also identified console Host/Origin/CSRF concerns, unbounded MCP/config/payload input, symlink escapes in storage, archive path/size gaps, and secrets in witnessed evidence. Its central recommendation was a capability allowlist with exact paths/digests, sanitized environment, bounded output/time, provenance, and adversarial fixtures.

### 3. Multi-tenant/privacy — agent `019fd414-ed81-77d2-af7a-edb426fa481f`

The privacy review found that canonical records and storage ports do not carry explicit project/tenant scope; filesystem roots provide most isolation, while actor/session are not authorization. Lexical path checks can be bypassed with aliases. Imports use bare IDs without full source/destination identity or rehome policy, copied registry entries may reuse identity, and global memory triage can write into a target project without explicit consent. Raw inbox triage also does not automatically erase immutable raw/derived copies. It recommended explicit scope on records and operations, realpath/no-follow validation, import dry-run and authorization, registry identity checks, and documented erasure semantics.

### 4. CLI/API contracts — agent `019fd414-ed19-7822-aeeb-efa4a1ba7592`

The CLI/API review found partial worker fencing, cursor replay/rewind behavior, weak idempotency fingerprints, duplicate edge/evidence creation, and divergent CLI/MCP/console envelopes. It also found broad flags that may be accepted or ignored, no-op operations reported as changes, fragile spill previews, ambiguous MCP operation lookup, and domain errors collapsed into one JSON-RPC validation code. It recommended one versioned operation envelope with operation IDs, request fingerprints, expected generations, typed outcomes, scoped cursors, worker epochs, and shared error/reconciliation semantics.

### 5. Runtime/storage/ledger — agent `019fd414-ede1-7f81-b4f6-3cdc67ab6560`

The storage review observed a current ledger/toolchain mismatch and a difference between checked-in manifest counts and object directories; this is a repo-state observation requiring reconciliation, not proof of data loss. It found pending transactions are not recovered before reads, multi-record writes can be partially visible, malformed JSONL tails can be ignored, projections/context packs are not consistently persisted, index freshness trusts event head more than canonical fingerprints, heartbeat failures are suppressed, rotation is separately locked, and duplicate event IDs use last-write-wins. It recommended durable transaction manifests, fail-closed recovery, explicit malformed-tail handling, fenced locks, and full-rebuild equivalence tests.

### 6. Workflow/dependency — agent `019fd414-ee48-7133-ba1e-44304caf2278`

The workflow review found the core structural problem: `verified` can behave as a terminal unlock, sprint activation lacks a universal predecessor/reconciliation preflight, external blockers are inconsistent, graph representations diverge, direct close can bypass dependency checks, and directives are attached after mutation. It recommended canonical reconciliation edges and effective readiness, preflight before advancement events, and a mandatory review → resolve/update → revalidate → reconcile chain in every template and runtime path.

### 7. Accessibility/visual/browser — agent `019fd41e-55a2-7271-ab7c-ee75c06e3c1b`

The accessibility review found duplicate H1s, no skip link, incomplete focus styling, keyboard-inaccessible draggable controls, dense tables without responsive strategy, dialogs without complete focus management, and smoke tests without screenshot baselines. It recommended keyboard-equivalent actions, global focus-visible styles, dialog semantics, route-state assertions, baseline screenshots, and explicit stale/error/partial states. It also detected design-token drift between documentation, source styles, and the design-system dump.

### 8. Frontend UX/operator — agent `019fd41d-e4bf-7e32-b4fd-3fcd4c10d690`

The UX review found unsupported TUI routes can display prior route data, global console project links do not reliably select the requested project, browser mutation failures return raw JSON, Close can be immediate and visually under-confirmed, TUI refresh errors leave stale actions available, onboarding warnings are hidden, and sprint/search defaults are hardcoded. Work rows lack detail drill-down, validation is visible without a resolve/update/revalidate/reconcile journey, health remediation is copy-only, and broad console loading waits on unrelated sources. It recommended a shared UI state machine, safe mutation confirmation, real project/search/detail navigation, first-class reconciliation controls, and route-specific loading.

### 9. Performance optimization — agent `019fd41f-2fc7-7971-808d-303c2f5a6f22`

The performance review found full-corpus search freshness/rebuilds, repeated graph/readiness scans, redundant derived-artifact passes, global six-to-seven-operation-per-project fan-out, full sorts for bounded rollups, sequential daemon reservation renewal, and whole-dataset import/export overhead. It recommended a generation-aware shared read model, incremental index freshness, indexed graph adjacency, impacted-record artifact rebuilds, bounded concurrency, batch renewal/import, and numeric budgets at 1k/10k/100k records and 10/50/100 projects. Every optimization must prove semantic/full-rebuild equivalence and reconcile hashes/counts.

### 10. Developer experience/onboarding — agent `019fd422-c48d-7541-83c4-090af6ffedd0`

The developer-experience review found setup writes are not transactionally atomic, `upgrade` has transaction-shaped output without equivalent rollback, source installation lacks immutable provenance and bounded build controls, checked-in command docs are only partially reconciled with the registry, onboarding has overlapping command identities, integration status checks files rather than effective agent discovery, contributor guidance is distributed without a single preflight, and integration targets are hard-coded across several paths. It recommended transactional setup/upgrade plan/apply/resume/rollback, an environment preflight, exact generated-doc reconciliation, effective integration smoke tests, a clean-room contributor guide, and adapter-driven integration manifests.

### 11. Reliability and operations — agent `019fd41f-906d-76b2-9c6b-7e823a3b102e`

The SRE review found the daemon is one-shot rather than supervisor-safe, status files do not reliably represent a live lease, and multiple watch invocations can reconcile concurrently. Worker fencing is missing from checkpoint, wait, and transition paths; missing worker identity can bypass the existing assertion. Lock heartbeat failures are discarded, creating split-brain writer risk. Worker loops lack signal cleanup, output-limit handling can leave descendants alive, and read paths do not recover journals before exposing state. Updates can hang or partially replace installations while claiming rollback that is not implemented. Reservation renewal can keep dead-agent work reserved, non-timer deadlines are not reconciled, rollup freshness trusts TTL/mtime, and skipped lock-conflict work can exit zero. It recommended lifecycle leases, fencing epochs, tree-safe cancellation, fail-closed recovery, atomic staged deployment, deadline reconciliation, and explicit cycle/skip telemetry.

Key evidence included `apps/daemon/src/index.ts:26`, `apps/daemon/src/runtime.ts:295-329,633-664`, `packages/engine/src/runs.ts:50,108,197-264`, `packages/storage/src/file-lock.ts:281`, `apps/cli/src/commands/runs.ts:138`, `packages/core/src/process-runner.ts:100`, `packages/storage/src/transaction-journal.ts:69`, `packages/storage/src/event-log.ts:663`, and `install.sh:303`. Its proof gates require killing/restarting daemons and workers, stale-writer races, process-tree cleanup, crash recovery at each durable step, interrupted installs, and nonzero semantics for skipped/degraded cycles.

### 12. Testing, CI, and quality — agent `019fd420-261a-7043-b2b0-693d1f2310ea`

The testing review inventoried 73 runtime test files, about 651 declarations, 187 source files, and 170 registered CLI command definitions. It found portability CI runs only a small selected subset on macOS/Windows, browser smoke is manually invoked rather than clearly required in CI, and new integrations/upgrades lack successful-path tests. CLI action coverage does not match the command registry, and generic flag validation does not verify action-specific semantics. Most importantly, one bug-finding template still allows direct audit → fix → report progression, while documentation requires reconciliation and template tests do not enforce the invariant. Additional false-confidence sources include synthetic enforcement-gap tests, skipped UI source-alignment checks, browser cleanup that starts too late, fixed timing sleeps, and no objective coverage/flake/mutation budgets.

It recommended a registry-driven CLI contract matrix, layered cross-platform CI, template-topology enforcement, bounded update subprocesses, fault-injection tests, runtime-generated fixtures, real MCP/console adapters, readiness predicates instead of sleeps, and explicit command/changed-line/branch/flake quality gates. Evidence included `.github/workflows/technical-portability.yml:19,35`, `.github/workflows/npm-publish-dry-run.yml:24-26`, `apps/console/src/browser-smoke.ts:62,149`, `tests/runtime/global-board-dogfood.test.ts:218`, `tests/runtime/cli.test.ts:2873,2909`, `templates/work-structures/bug-finding-mission.yaml:78-80`, and `tests/runtime/work-template.test.ts:49`. Its reconciliation gate requires every finding-producing node to have a machine-validated reconciliation/revalidation path and requires runtime persistence/doctor/refresh proof after affected changes.

### 13. Red-team and unattended execution — agent `019fd421-2b8c-7181-9bd8-c051d4e294ab`

The red-team review found a critical imported-run bypass: imported durable runs validate only that an executable string is nonempty, are persisted directly, and can later be executed without revalidating the capability policy. That permits `sh`, `/tmp/backdoor`, or PATH-shadowed tools through import even if normal run creation rejects them. It also found optional process-group cleanup, raw environment inheritance, incomplete run ownership fencing, rewindable/unknown event cursors that can replay streams, execution before durable evidence intent, closeout based on stale dependency projections, imports without source identity or witness authenticity, caller-controlled force-gate identity, MCP mutation retries without client idempotency, symlink/TOCTOU reads, executable-looking display commands, and disagreement between witness output matching and closeout summary matching.

The review recommended immutable execution capabilities, a single isolated process supervisor, durable pre-execution intent and fenced run leases, mandatory graph/projection reconciliation before closeout, untrusted-by-default import quarantine with signed manifests and explicit rehome mode, monotonic cursors, authenticated force approval, no-follow file descriptors, and structured evidence attestations. Key evidence included `packages/core/src/schema-validation.ts:675,712`, `apps/cli/src/import-export.ts:2153`, `packages/engine/src/runs.ts:342-424`, `packages/core/src/process-runner.ts:63`, `packages/evidence-engine/src/witnessed-evidence.ts:73,76,184,205`, `packages/engine/src/runtime.ts:856,1995-2034`, and `apps/mcp/src/tools.ts:603-619`. Its proof gates require hostile imported commands, environment injection, stale-worker writes, cursor rewind, crash-after-execution, contradictory graph/projection states, spoofed force actors, MCP lookup failure after mutation, symlink races, and a machine-readable reconciliation receipt before advancement.

## Definition of done

This feature is complete only when all of the following are true:

- Every finding-producing workflow creates a typed reconciliation obligation.
- No required obligation can be bypassed by `verified`, direct close, sprint activation, parent close, release promotion, or UI action.
- Storage, setup, upgrade, import, and derived artifacts have transaction/recovery proof.
- Execution and update capabilities have exact identity, provenance, bounds, and secret-safety proof.
- Project and memory scope is explicit and symlink/rehoming/import fixtures pass.
- CLI, MCP, console, TUI, daemon, and worker mutations share versioned operation semantics.
- Browser/TUI journeys show and enforce resolve → update → revalidate → reconcile → advance.
- Incremental performance paths match clean rebuild semantics and meet recorded budgets.
- Red-team, accessibility, browser, fault-injection, performance, and cost checks have their findings reconciled.
- Generated docs, integration discovery, and contributor/clean-room preflight are verified.
- The final closeout record names all unresolved findings, accepted deferrals, evidence, artifact hashes, generations, and follow-up dates.

Until those conditions are met, the work should remain in a hardening/reconciliation sprint and must not be represented as fully validated.
