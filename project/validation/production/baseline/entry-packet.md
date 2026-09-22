# PF-S00-T07 — baseline-to-plan entry packet

Status: worker-produced, coordinator acceptance pending  
Plan: `PF-production-completion-2026-09-21`, version `1`  
Input source: `working-tree-aggregate:3a3a4cab27b63d117e80234ce739bd7680823c22a40520696740280c525173b0`; HEAD `784a41b3802c29a76721c55eef2e9493283396c2`; dirty  
Immutable supplied archive: `scratch/reference-zips/boreal-v2-reference-20260921T195305840Z.zip`, SHA-256 `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Purpose and decision boundary

This packet reconciles the accepted S00 baseline artifacts into an entry point for the production-completion plan. It is not a product acceptance record, a release authorization, or an adoption decision. The candidate source remains dirty and the imported historical M02 report remains partial/unaccepted.

The authoritative plan remains `plan.json`; the coordinator ledger remains `execution/STATE.json`. The generated `obligations-map.json` preserves all 48 M02 IDs and maps them to future coverage without marking any obligation complete.

## Accepted baseline inputs consumed

- PF-S00-T01: archive/source inventory and provenance; archive manifest and current-tree differences are preserved.
- PF-S00-T02: toolchain/environment inventory; tools are present, but the recorded SQLite runtime is below the documented release floor and the task intentionally skipped product builds/tests.
- PF-S00-T03: 23-command baseline classification: 16 pass, 7 fail, 0 unavailable, 0 timeout. Failures remain open; fixture/static passes are not service acceptance.
- PF-S00-T04: public capability inventory and F01–F22/ARCH-01–ARCH-05 findings.
- PF-S00-T05: v1 source/data inventory and external-input register. Legacy materials are present with completeness limits; Linux, macOS x86_64, model-operated harnesses, independent reviewer capacity, and release authority remain missing/restricted.
- PF-S00-T06: dispatch/evidence contract. Whole-file write boundaries, serialized shared stewards, preserved failed attempts, and separate review/reconciliation/revalidation gates are now defined.

The prerequisite handoffs are evidence artifacts, not authorization to skip PF-S00-T90 → PF-S00-T91 → PF-S00-T92.

## Current capability and evidence classification

| Layer | Observed | Not proven by this packet |
| --- | --- | --- |
| Source/archive | Supplied archive integrity and current dirty-tree provenance are recorded. | The dirty checkout is not the exact historical archive; no source identity is a release identity. |
| Rust/toolchain | Cargo/rustc/rustfmt are discoverable; selected baseline build/fmt checks passed. | Workspace acceptance, strict Clippy, full lifecycle races, and native package proof. |
| TypeScript/TUI | Structural/typecheck and some fixture layers are recorded in T03. | Real service route parity, genuine PTY coverage in this environment, or complete workflow UX. |
| Protocol/contract | Contract fixture validator passed. | Public route parity, schema migration safety, and authoritative server action policy. |
| Legacy/migration | v1 source, JSONL ledgers, schemas, workflows, and tests are inventoried. | Completeness, status/proof preservation, backup/restore, and a migration disposition report. |
| Release | Release/update source and workflow declarations are inventoried. | Exact artifact identity, signing, disposable-prefix installation, supported-platform smoke, or publication. |

## Contract decisions that must remain explicit

The following recommendations are proposals in the supplied final-form review, not silently adopted behavior:

- D22/D27: decide whether execution lease ownership ends at safe submission or remains bound through human review; encode lease, submission, review, and recovery as distinct durable concepts.
- Cycle model: decide whether the cycle-backed model in `project/spec/WORK_MODEL_V2.md` replaces the provisional fixed-tree planning strategy; do not create two writable sprint authorities.
- Gate stages: persist immutable required-gate declarations separately from observations and decisions; deleting an observation must not delete a requirement.
- Review semantics: preserve rejected review as intervention/reconciliation, not as missing proof or ordinary awaiting review.
- Expiry: retain a durable recovery obligation after lease expiry/current-attempt cleanup.
- Status contract: keep availability, integrity, and product status distinct; make reason precedence/versioning and action descriptors server-authoritative.
- Protocol/version: decide the versioned DTO/action-descriptor contract before exposing cycle/review/force/waiver/public workflow routes.
- Identity/security: define authenticated principal/session ownership, project-path binding, database instance/restore epoch, and the threat model for agents with filesystem access.

No proposal above authorizes a source change in S00.

## Baseline finding disposition map

The source findings inventory is authoritative for exact anchors and evidence class. The table below ensures every baseline finding has a bounded downstream owner; the owners remain open work, not completion claims.

| ID | Severity | Classification | Target owner(s) | Finding |
| --- | --- | --- | --- | --- |
| `F01` | critical | confirmed-by-source | PF-S02-T01/PF-S02-T06 | Gate/status projection is source-sensitive and historical candidate fixes were not freshly compiled or accepted. |
| `F02` | high | confirmed-by-source | PF-S01-T01/PF-S01-T02/PF-S01-T06 | Reason precedence and secondary reasons require acceptance beyond the source candidate. |
| `F03` | high | confirmed-by-source | PF-S01-T01/PF-S03-T03 | Namespaced gate-kind matching remains a contract concern; no fresh Rust proof. |
| `F04` | high | confirmed-by-source | PF-S04-T02/PF-S05-T03 | Guidance/status source uses durable context paths, but authenticated identity/session authorization is incomplete. |
| `F05` | high | confirmed-by-source | PF-S01-T04/PF-S02-T01 | Canonical unix-ms parsing exists in source, but compatibility and timer behavior are not accepted. |
| `F06` | critical | confirmed-by-source | PF-S05-T02 | Malformed prerequisite/corruption propagation remains a source and validation gap. |
| `F07` | critical | confirmed-by-source | PF-S02-T04 | Hold resolution route exists, but exact principal/project/replay and force/waiver boundaries are not accepted. |
| `F08` | high | no-longer-applicable | PF-S18-T01/PF-S20-T04 | The retained source-archive .cjs omission was repaired in the historical candidate, but packaging/release acceptance remains separate. |
| `F09` | high | no-longer-applicable | PF-S00-T90/PF-S00-T92 | The specific fixture-version mismatch was reconciled; independent contract acceptance is still absent. |
| `F10` | critical | confirmed-by-source | PF-S02-T01/PF-S02-T02/PF-S03-T02/PF-S07-T01 | Profiles/gates and closeout records exist, but authoritative independent profile declarations remain unresolved. |
| `F11` | critical | confirmed-by-source | PF-S02-T02/PF-S02-T06 | Finish/close/release/reopen transaction-wide canonical re-evaluation is not established. |
| `F12` | critical | confirmed-by-source | PF-S01-T04/PF-S02-T02/PF-S06-T04 | Expiry history/disposition before reclaim remains an unresolved lifecycle boundary. |
| `F13` | critical | confirmed-by-source | PF-S00-T01/PF-S12-T03 | Current v2 registry is not a complete v1 runtime/command inventory or import provenance. |
| `F14` | high | confirmed-by-source | PF-S01-T01/PF-S01-T03/PF-S01-T04 | Not-before/due/overdue scheduling and complete safe-next semantics remain incomplete. |
| `F15` | high | confirmed-by-source | PF-S01-T05/PF-S03-T05/PF-S10-T04 | Container status is represented, but exact descendant rollups/readiness are not accepted. |
| `F16` | critical | confirmed-by-source | PF-S02-T04/PF-S02-T05/PF-S08-T04/PF-S13-T04 | Independent review decisions and gate-force/dependency-waiver public routes are unavailable. |
| `F17` | high | confirmed-by-source | PF-S05-T02/PF-S10-T02 | Malformed-row tolerance, transitive corruption diagnostics and pagination/count reconciliation remain unresolved. |
| `F18` | high | confirmed-by-source | PF-S02-T06/PF-S05-T05/PF-S17-T04 | Canonical claim snapshot/write transaction performance has no current queue-wait versus hold-time evidence. |
| `F19` | high | confirmed-by-source | PF-S00-T02/PF-S04-T02/PF-S12-T03 | Canonical clocks and registered actors are required by current paths; compatibility/import signoff is open. |
| `F20` | high | confirmed-by-source | PF-S05-T06/PF-S08-T02/PF-S16-T02 | Operation readback/recovery structures exist, but rejected and unknown outcomes are not real-service proven. |
| `F21` | critical | unresolved | PF-S00-T90/PF-S00-T92/PF-S16-T01 | The historical candidate had no Rust execution/reviewer/service proof; current tools are recorded available but this task did not run them. |
| `F22` | critical | confirmed-by-source | PF-S09/PF-S12/PF-S13/PF-S14/PF-S15/PF-S16/PF-S20 | Planning/cycle/sprint/workflow/queue parity, migration, isolation, and release gates remain incomplete. |
| `ARCH-01` | critical | confirmed-by-source | PF-S01-T03/PF-S09-T01/PF-S11-T03/PF-S13-T09 | Internal cycle/intake groundwork and handlers coexist with public registry gaps; source/spec capability drift must be resolved before exposing routes. |
| `ARCH-02` | high | confirmed-by-source | PF-S05-T03/PF-S11-T03/PF-S11-T09/PF-S13-T09 | Source routes are direct-only while protocol/service route parity and source-to-memory publication are absent. |
| `ARCH-03` | high | confirmed-by-source | PF-S05-T06/PF-S08-T02/PF-S12-T06/PF-S16-T02 | Recovery/doctor and runtime recovery types exist, but operator recovery, durable operation outcomes, and restart/readback are not validated end to end. |
| `ARCH-04` | high | confirmed-by-source | PF-S15-T01/PF-S15-T04/PF-S16-T02 | TUI exposes mounted lifecycle actions and service-shaped calls, but fixture/controller tests do not prove real service route parity or complete planning/review/recovery UX. |
| `ARCH-05` | critical | confirmed-by-source | PF-S18-T05/PF-S20-T04/PF-S21-T03 | Update/upgrade source implementations exist, but installer identity, atomic upgrade/rollback, supported platforms, schema-safe rollback, and publication are not production-proven. |

## Missing inputs and explicit blockers

| Input | Current classification | Required disposition |
| --- | --- | --- |
| `EXT-LEGACY` | Available with completeness limits | PF-S12 must produce a machine-readable import/parity disposition and preserve raw IDs, failed history, provenance, and ambiguity. |
| `EXT-MACOS` | Missing full architecture coverage | PF-S18/PF-S20 must run the required native targets; a workflow label is not a local pass. |
| `EXT-LINUX` | Missing | Obtain a real supported Linux executor or record a release block. |
| `EXT-HARNESSES` | Missing | PF-S14 must obtain two attributable model-operated harness sessions; scripted fixtures do not satisfy this input. |
| `EXT-INDEPENDENT-REVIEW` | Missing | Assign a reviewer independent of implementation for T90/T92; coordinator self-review is not sufficient. |
| `EXT-RELEASE-AUTHORITY` | Missing/restricted | Obtain explicit release-owner, signing, and publication authority before PF-S20/PF-S21. |

## M02 obligation preservation

`project/validation/production/baseline/obligations-map.json` contains all 48 original IDs, titles, and proposed coverage links from `reference/M02_CROSSWALK.md`. Every entry is `historical_state: unaccepted_historical_obligation` and `current_state: mapped_not_accepted`; no historical M02 status was rewritten.

The map must be adopted and independently revalidated in PF-S01. A mapped target is not permission to skip its dependencies or to claim the original task complete.

## Repair and implementation routing

The existing S00 findings are routed by the source inventory. The order is intentional:

1. PF-S01 freezes contracts, authority, cycle policy, revision meanings, and gate stages.
2. PF-S02–PF-S08 implement and verify status, authorization, lifecycle, evidence, review, exceptions, and recovery.
3. PF-S09–PF-S12 implement planning, cycle assignment, rollups, migration, memory, and restore.
4. PF-S13–PF-S16 complete public parity, guidance, TUI, isolation, and real-service behavior.
5. PF-S17–PF-S21 run fault/performance/packaging/release/publication gates.

Must-have correctness, isolation, authority, proof, and recovery findings are not waived by this packet. Optional deferrals require explicit owner/reviewer disposition in the relevant sprint gate.

## Entry questions for independent review

PF-S00-T90 must verify:

- the source identity and archive discrepancy are exact and preserved;
- all 48 M02 IDs remain mapped and unaccepted;
- every finding/missing input has a target owner or explicit blocker;
- no fixture/static result is presented as genuine service/native/release proof;
- the proposed D22/D27/cycle/protocol changes are visible and not silently active;
- the dispatch/evidence controls are sufficient for disjoint workers and preserved failure history.

## Next safe action

Coordinator records this packet and artifact evidence under a fresh attempt, then dispatches PF-S00-T90 only after confirming an independent reviewer identity and the exact combined-tree identity. PF-S00-T91 reconciles findings; PF-S00-T92 reruns the required checks and alone can unlock PF-S01.

