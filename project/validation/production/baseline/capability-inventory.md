# PF-S00-T04 capability inventory

Status: worker-produced, unaccepted. This is a source inventory and drift report, not a production, parity, release, or acceptance claim.

## Evidence subject

The prerequisite T01 handoff freezes archive `sha256:09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`, but records that the current checkout is dirty and differs in eight manifest paths. This inventory therefore treats current source inspection as the subject and historical M02 evidence as historical only. Current HEAD at inspection was `784a41b3802c29a76721c55eef2e9493283396c2`; the T01 aggregate was `7051bb14d9bdb283235b65e45e78bea9b485318998847173e79dbfc409ed7ea8` before this task's files.

The bounded current check was:

```text
python3 project/spec/validate_contracts.py
exit 0
PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed
```

This validates fixtures and contract structure only. It does not validate a built Rust service, a public route over transport, a genuine lifecycle receipt, a TUI against the real service, installation, upgrade, publication, or release.

## Authority and version surface

| Surface | Current source anchor | Observation | Disposition |
|---|---|---|---|
| CLI registry | `crates/cli/src/command_registry.rs:1-35,486-500` | `boreal.cli.registry.v1`; executable commands are deliberately narrower than the aspirational catalog and unavailable routes are typed gaps. | Declared and wired in CLI; runtime validation not established. |
| Protocol envelope | `crates/protocol/src/lib.rs:31-32,342-365,433-465` | `PROTOCOL_VERSION` and `SCHEMA_VERSION` are `schema::ENVELOPE`; request/response envelope validation rejects mismatched schema. | Declared DTO/validator; transport workflow unvalidated. |
| Negotiation | `crates/protocol/src/lib.rs:487-540` | Hello advertises schema versions and independent capabilities, then intersects them. | Persistence/application support varies by capability; no production negotiation proof. |
| Status | `crates/application/src/status.rs:16`; `crates/protocol/src/models.rs:46-71` | `boreal.work-status/2` and versioned status DTO with revision, pagination, diagnostics, and next transition. | Application projection exists; full lifecycle correctness remains open. |
| Guidance | `crates/cli/src/main.rs:3560-3630` | `agent_guide`/`agent_next` include `directives.v1`, registry path, workflow refs, schema versions, and selection keys. | Trusted reference is declared and CLI-wired; unfamiliar-agent workflow is not production-proven. |
| Work model | `crates/domain`, `crates/store`, `crates/application`; `project/spec/WORK_MODEL_V2.md:1-80` | Current persisted facade is milestone/sprint/task; work-model/3, cycle/1, recurrence/1, intake/1 are proposed/additive groundwork, not enabled public parity. | Preserve contradiction; downstream PF-S01/PF-S09/PF-S11/PF-S14. |

## Available public registry routes

The registry contains 49 available entries (counted from `COMMANDS`), each marked `direct: true`. Entries with `service: true` have a declared service-compatible adapter in the registry; `service: false` are direct-only or locally managed. Availability here means registered with a real adapter, not validated workflow completion.

| Family | Registered routes | Current boundary |
|---|---|---|
| Discovery/setup | `commands`, `help`, `version`, `init`, `setup`, `install` | Registry/help/version and setup adapters exist. `setup`/`install` are aliases; setup scaffolding and agent-target installation need fresh workflow validation. |
| Update | `update`, `upgrade --machine` | `upgrade` is the compatibility alias for `update`; `crates/cli/src/update.rs:1-79` invokes packaged installer or emits Homebrew/missing-updater errors. Existing source only; not production-proven on installed supported targets. |
| Status/UI launch | `status`, `prime`, `dashboard`, `view` | `prime` aliases status; `view` aliases dashboard. Dashboard is direct managed launcher; full real-service TUI acceptance remains open. |
| Work planning | `work list`, `work show`, `work create`, `work edit` | DTOs/store/application routes exist. Current grammar still exposes `milestone|sprint|task`; schema-3 cycle semantics are not the public current contract. |
| Dependencies | `dep add`, `dep remove`, `dep tree`, `dep cycles` | Application/store groundwork and CLI adapters exist; corruption, isolation, and race validation remain open. |
| Attempt lifecycle | `work claim`, `work accept`, `work heartbeat`, `work renew`, `work release`, `work finish` | Fenced attempt DTOs and adapters exist; F10-F12/F18-F20 remain unaccepted lifecycle/recovery gaps. |
| Agent loop | `agent status`, `agent guide`, `agent resume`, `agent start`, `agent heartbeat`, `agent renew`, `agent release`, `agent finish`, `next`, `agent next` | Trusted directive references are emitted by CLI. Complete no-goal, cross-harness, stale/unknown operation and close/release proof are not production-proven. |
| Evidence/session/recovery | `evidence add`, `evidence run`, `session start`, `session show`, `session end`, `operation show`, `doctor` | Evidence, sessions and readback have DTO/application groundwork. Genuine verifier receipts and unknown-outcome recovery require real service acceptance. `doctor` explicitly remains read-only at the CLI adapter (`crates/cli/src/main.rs:2302-2322`). |
| Operator controls | `work hold add`, `work hold resolve`, `work dispatch set` | Operator mutation adapters exist. Exact principal/project binding, force/waiver, and durable recovery semantics remain open. |
| Source | `source add`, `source show`, `source list`, `source verify` | Source capture/catalog/version/verification code exists and is direct-only (`command_registry.rs:450-485`; `main.rs:2006-2286`). No source-to-memory publication/search workflow is public. |

## Aliases and route gaps

Confirmed aliases are `setup`/`install` → setup, `upgrade --machine` → update, `prime` → status, `view` → dashboard, and `next`/`agent next` → guided next. The registry comments explicitly prohibit presenting aspirational routes as available.

Typed unavailable families include `cycle board/report/create/activate`, `sprint create/activate/board/report`, `intake note/discovery/question/revisit/list/show/bucket/capture/promote/disposition`, `summary compose/create/show/list/render`, `review list/show/decide`, `memory`, and `migration`. The registry's gap text is itself useful discovery, but a gap entry is not a route or fallback to direct SQLite.

There is source/spec drift: `crates/cli/src/main.rs` contains v3/intake/cycle handler functions and `crates/application/src/hierarchy.rs` contains hierarchy capability groundwork, while the registry continues to classify the corresponding public families unavailable. Treat this as groundwork, not a contradiction to be hidden and not permission to expose routes.

## DTO → persistence → application → route → workflow matrix

| Vertical | Declared DTO/type | Persistence groundwork | Wired application operation | Public route | Validated workflow |
|---|---|---|---|---|---|
| Project/setup | protocol/project and setup payloads; setup schemas in `crates/cli/src/setup.rs` | SQLite project identity/schema and setup files | CLI setup/init adapters | `init`, `setup`, `install` | Contract fixtures only; no fresh service/install workflow. |
| Work/decomposition | work DTOs in `crates/protocol/src/models.rs`; work kinds in domain | work rows, parents, revisions | create/edit/list/show application/store paths | work family | Source and fixture evidence; no accepted end-to-end workflow. |
| Dependencies | dependency DTOs and graph DTOs | dependency rows/cycle checks | add/remove/tree/cycles | dep family | Contract validator cases only; corruption/isolation races open. |
| Status | `StatusDto`, `StatusDiagnosticDto`, `NextActionDto` | snapshot/revision/status reads | status evaluator/application projection | `status`, `prime`, agent status | Structural fixtures; no genuine service proof. |
| Attempts | `AttemptDto`, fences/phases | current attempt, history, lease/deadline | lifecycle adapter and transaction paths | work lifecycle + agent lifecycle | Authored historical tests; M02 Rust run was blocked/unaccepted. |
| Evidence/acceptance | receipt, gate, profile, summary DTOs | receipts/reviews/summaries/gate rows | evidence store and finish/close code | evidence add/run, finish | Contract fixtures; genuine verifier/reviewer/closeout absent. |
| Guidance | guide/next DTOs and provenance context | session/actor/attempt records | `guide_for_work`, `next_from_guide`, directive checker | guide/next/resume/start | Trusted refs declared; no unfamiliar-agent real-service proof. |
| Source | source version/spec types | immutable source catalog and digests | source capture/show/list/verify | source family | Source unit/contract groundwork; no full citation/search/publication. |
| Memory | knowledge/application types and `crates/memory` groundwork | memory tables/Git publication design | no complete public adapter | unavailable `memory` gap | Not validated; PF-S11 owner. |
| Review/closeout | review/summary types/store records | review/summary rows | partial finish-close integration | unavailable review/summary family | Not validated; PF-S08/PF-S13 owners. |
| Cycles/intake | v3 hierarchy/intake types and handler groundwork | additive schema/model groundwork | partial internal handler functions | unavailable cycle/intake family | Not validated; PF-S01/PF-S09/PF-S11/PF-S14 owners. |
| Update/release | machine update DTO/result | packaged installer expectation | `update::run` | update/upgrade | Source only; PF-S18/PF-S20. |

## Vertical and downstream map

| Gap | Downstream owner(s) |
|---|---|
| Authority, schema/capability negotiation, work-model/3 and cycle policy | PF-S01, PF-S02, PF-S03, PF-S05, PF-S09 |
| Authentication, principal/session identity, project isolation | PF-S04, PF-S05, PF-S12, PF-S16 |
| Durable operations, snapshots, transaction boundaries, recovery/readback | PF-S05, PF-S06, PF-S08, PF-S10 |
| Profiles and authoritative gate declarations | PF-S07, PF-S08, PF-S10 |
| Public review/summary/force/waiver routes | PF-S08, PF-S13 |
| Source versions, citations, indexing and curated memory publication | PF-S11 |
| v1 inventory/import/migration/backup/restore | PF-S12, with PF-S00-T04 evidence feeding it |
| Complete CLI/service/alias parity | PF-S13, PF-S16 |
| Trusted workflows and no-goal guidance | PF-S14 |
| Complete TUI planning/execution/review/recovery | PF-S15, PF-S16 |
| Fault, security, performance, soak and release proof | PF-S17-PF-S21 |

## Drift and limits

The current registry accurately prevents many unavailable routes from being mistaken for supported commands, but it is not a v1 inventory, a service-route inventory, or a workflow acceptance matrix. The M02 command inventory and review remain historical/candidate evidence. TUI tests use mounted controllers and fixtures; they establish client behavior only. The current source has toolchain binaries present according to the T02 lock, but no Rust/service command was run for this task, so availability is not certification.

No acceptance or release claim is made. Independent review PF-S00-T90, reconciliation PF-S00-T91, and revalidation PF-S00-T92 remain required.
