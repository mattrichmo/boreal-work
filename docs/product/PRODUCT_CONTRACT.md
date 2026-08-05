# Boreal Product Contract

This document defines what Boreal is, which technical jobs it must perform better than adjacent tools, and which guarantees every interface must preserve.

← [Documentation home](../index.md) · [Documentation index](../README.md) · [Core concepts](../concepts.md)

## Product definition

**Boreal is a deterministic project operating layer that preserves decisions, coordinates work, and requires evidence before closure across humans and coding agents.**

It is more than a sprint tracker. Tracking is one part of a continuous operating loop that also covers source capture, durable knowledge, dependency-aware planning, atomic ownership, evidence, verification, recovery, and handoff.

The product wedge is not “more task fields.” Boreal earns its place when a project can answer, from durable local records rather than chat reconstruction:

- What is true, and which source or decision supports it?
- What work is actually safe to start now?
- Who owns it, and where are they working?
- What would count as done?
- What concrete proof supports closure?
- What changed, and how can another actor resume?
- Is the project state current, internally consistent, and recoverable?

## Jobs Boreal must outperform

| Job | Required outcome | Measurable product invariant |
| --- | --- | --- |
| Resume work without replaying chat | A new session receives current work, blockers, decisions, evidence, and next actions | A context or handoff read is derived from current durable records and identifies stale state |
| Select safe work | Only dependency-valid work appears claimable | Readiness is derived, cycle-checked, and repairable rather than manually asserted |
| Coordinate concurrent actors | Two actors cannot silently own the same task or cross project boundaries | Claims are atomic; reservations expire; project, memory, branch, and worktree boundaries are explicit |
| Prove completion | “Done” means acceptance is supported by current evidence | Closure requires verification and checkpoint coverage; configured review and audit gates fail closed |
| Preserve rationale | Decisions remain traceable after the original conversation disappears | Claims and decisions retain source references and flow into relevant context |
| Recover from drift or interruption | Generated views, indexes, locks, and synchronization can be diagnosed and rebuilt | Canonical records remain distinguishable from projections; `sync` and `doctor` report deterministic repairs |
| Hand work to another human or agent | The next actor can continue without guessing what happened | Closeout records include outcome, evidence, verification, checkpoint, remaining risk, and next workflow |

These are the primary comparison dimensions for adjacent trackers, specification tools, agent orchestrators, and hosted project systems. Feature count alone is not success.

## Non-negotiable invariants

Every Boreal surface—CLI, MCP, daemon, console, TUI, CI integration, or extension—must preserve these rules:

1. **Canonical truth is explicit.** Durable records are not confused with caches, projections, summaries, or UI state.
2. **Readiness is derived.** Dependencies and terminal states determine claimability; interfaces do not invent their own ready queues.
3. **Ownership is atomic.** A claim either reserves work coherently or fails without creating a second owner.
4. **Closure is evidence-gated.** Evidence, verification, checkpoint coverage, and configured review or audit requirements remain distinct.
5. **Evidence provenance is visible.** Agent-reported, Boreal-witnessed, human-attested, and external-CI proof cannot be presented as equivalent when their trust differs.
6. **Project boundaries fail closed.** Workspace, memory, registry, Git, and path resolution cannot silently cross into another project.
7. **Mutations are auditable.** State changes produce typed records or events with actor and operation context.
8. **Interrupted work is recoverable.** Locks, partial synchronization, stale projections, and resumable operations have inspectable recovery paths.
9. **Human and machine contracts agree.** Human output may simplify presentation; JSON contracts retain exact IDs, statuses, gaps, and recovery actions.
10. **Profiles change exposure, not truth.** A simpler interface may hide optional detail but never suppress a required safety condition or weaken canonical semantics.

## Capability profiles

Profiles control defaults, installed adapters, visible commands, policy density, and dashboard detail. They do not create separate storage formats or lifecycle rules.

### Simple

For one operator or one coding agent working in a single repository.

Default capabilities:

- initialize or install a project;
- capture sources and decisions;
- create, order, claim, finish, and inspect work;
- record evidence and verification;
- produce a handoff;
- run sync and health diagnostics.

Safety boundary:

- verification and project isolation remain enabled;
- generated-state drift remains visible;
- advanced collaboration commands may be hidden, but their underlying records stay compatible.

Non-goals:

- multi-project portfolio management;
- custom policy packs;
- mandatory independent review;
- remote synchronization administration.

### Team

For several humans or agents collaborating across branches, worktrees, sessions, or machines.

Adds to Simple:

- atomic shared reservations and renewal;
- lane and worktree isolation;
- remote bootstrap, pull, push, offline rejoin, and per-record conflict handling;
- independent review, acceptance, and resumable merge workflows;
- global project status and cross-project dependency views;
- team-oriented dashboards and failure observability.

Safety boundary:

- conflicts remain record-addressable and recoverable;
- interrupted synchronization cannot discard a durable record silently;
- reviewer and implementer identity remain distinguishable.

Non-goals:

- silently merging conflicting decisions or evidence;
- replacing Git hosting or code review;
- granting one agent implicit authority over every project.

### Governed

For projects that require enforceable proof, policy, auditability, or regulated operating boundaries.

Adds to Team:

- required verification, checkpoint, review, and audit gates;
- evidence freshness and provenance policies;
- witnessed command execution and external-CI attestations;
- signed or integrity-checked exports, imports, and release artifacts;
- policy packs, extension capability declarations, and failure isolation;
- durable audit and exception records for forced paths.

Safety boundary:

- a profile cannot force a gate merely because evidence is inconvenient;
- bypasses require explicit reason, comment, actor, and applicable evidence;
- extensions receive declared capabilities rather than unrestricted runtime access.

Non-goals:

- making legal or compliance claims on the operator's behalf;
- selecting the project's license;
- treating an agent summary as independent verification.

## Product-wide defaults

- Local-first operation remains the default; hosted services may add transport or coordination without becoming the only source of truth.
- The CLI and its JSON envelopes are the canonical automation contract.
- Git-friendly records and explicit export/import remain available even when faster local indexes exist.
- Safe failure is preferred to silent inference when project identity, evidence provenance, dependency state, or mutation authority is ambiguous.
- Installation should begin with a useful minimal profile and allow Team or Governed capabilities to be enabled without migrating to a different product.

## Current boundaries

Boreal is distributed under the PolyForm Noncommercial License 1.0.0. The repository and release artifacts must preserve that license and must not imply commercial-use rights.

The current product does not include:

- recruiting an external beta cohort;
- measuring user retention, preference, or willingness to pay;
- adding hosted billing, accounts, or organization administration.

These boundaries do not relax the technical contracts above.

## Acceptance use

Future work should cite this contract when it changes commands, profiles, closeout, collaboration, synchronization, review, extensions, or interfaces. A change is product-compatible only when:

- it improves at least one named job;
- it preserves every applicable invariant;
- its profile exposure is explicit;
- its failure and recovery behavior is testable;
- it does not quietly absorb a deferred business or publication decision.
