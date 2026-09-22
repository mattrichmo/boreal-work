# Source context catalog

All locations refer to the supplied fresh ZIP, not a claim of compiled or runtime-correct behavior. Full exact excerpts and hashes are included so a subagent can load the relevant context without prior chat. Read current upstream code at dispatch, because line numbers can move.

| Reference | Baseline path/range | Purpose |
| --- | --- | --- |
| [R-AGENTS](context/R-AGENTS.md) | `AGENTS.md:L1–L39` | Non-negotiable crate direction, client authority, failed-history retention and file-based dispatch instructions. |
| [R-MASTER](context/R-MASTER.md) | `MASTER_PLAN.md:L1–L132` | Existing M01/M02 authority, prior gates, current-wave limitations and approved launch scope. |
| [R-M02](context/R-M02.md) | `project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md:L1–L950` | All original M02 obligations, IDs, dependencies and named acceptance gates; do not erase historical status. |
| [R-REPORT](context/R-REPORT.md) | `IMPLEMENTATION_REPORT.md:L1–L406` | Partial/unaccepted candidate report, authored but unrun Rust tests and exact known omissions. |
| [R-REVIEW](context/R-REVIEW.md) | `project/validation/m02/REVIEW.md:L1–L79` | F01-F22 candidate findings and limitations; independently reproduce rather than treating proposed fixes as accepted. |
| [R-EVIDENCE](context/R-EVIDENCE.md) | `project/validation/m02/evidence/run-01/checks.json:L1–L263` | Historical command outcomes tied to an earlier candidate; not fresh-tree proof. |
| [R-STRATEGY](context/R-STRATEGY.md) | `project/validation/m02/SPRINT_STRATEGY.md:L1–L46` | Bounded compatibility strategy and independent-review failure; proposed architecture requires an explicit amendment. |
| [R-GATES](context/R-GATES.md) | `project/build-plan/REVIEW_GATES.md:L1–L73` | Separate independent review, findings reconciliation and exact-tree revalidation. |
| [R-DECISIONS](context/R-DECISIONS.md) | `project/DECISIONS.md:L1–L71` | D01-D29 approved constraints; D22/D27 must not be silently changed by the sealed-submission recommendation. |
| [R-DEFERRALS](context/R-DEFERRALS.md) | `project/build-plan/DEFERRED_VERTICALS.md:L1–L24` | Approved local-launch non-goals; core no-goal guidance and memory are not deferred. |
| [R-PRODUCT](context/R-PRODUCT.md) | `project/PRODUCT.md:L1–L86` | User outcomes and work/execution memory distinctions. |
| [R-ARCH](context/R-ARCH.md) | `project/ARCHITECTURE.md:L1–L111` | Application, domain, service, store, projections, source and Git-memory boundaries. |
| [R-STATUS](context/R-STATUS.md) | `project/STATUS_MODEL.md:L1–L307` | Current normative status meanings, precedence, gates, timers and actor-specific eligibility. |
| [R-TRANSITIONS](context/R-TRANSITIONS.md) | `project/spec/transition-table.md:L1–L218` | Legal and illegal transitions, versioned canonical-state mutations and conformance vectors. |
| [R-CONCURRENCY](context/R-CONCURRENCY.md) | `project/STATE_AND_CONCURRENCY.md:L1–L91` | Snapshot revisions, transactional ownership, bounded writers, readback and retained history. |
| [R-LIFECYCLE](context/R-LIFECYCLE.md) | `project/AGENT_LIFECYCLE.md:L1–L141` | Harness-neutral claim/accept/start/checkpoint/evidence/finish/release and expiry recovery. |
| [R-INTERFACES](context/R-INTERFACES.md) | `project/INTERFACES.md:L1–L152` | Operation, snapshot and application-adapter contract vocabulary. |
| [R-PROFILES](context/R-PROFILES.md) | `project/spec/acceptance-profiles.json:L1–L60` | Versioned gate/profile definitions; reconcile summary/audit semantics, not names alone. |
| [R-WORKMODEL](context/R-WORKMODEL.md) | `project/spec/WORK_MODEL_V2.md:L1–L1444` | Proposed work-model/3 separation of decomposition, scheduling, assignments, proof context and container acceptance. |
| [R-SCENARIOS](context/R-SCENARIOS.md) | `project/spec/WORK_MODEL_SCENARIOS.md:L1–L580` | Planning, dependency, scope, schedule and carry-over scenarios that must survive public adapters. |
| [R-SCHEMA2](context/R-SCHEMA2.md) | `project/spec/schema-v2.sql:L1–L463` | Existing canonical tables, keys, constraints and migration baseline. |
| [R-SCHEMA3](context/R-SCHEMA3.md) | `project/spec/schema-v3.sql:L1–L606` | Additive v3 tables are groundwork, not evidence of a complete cycle-backed application. |
| [R-PROTOCOL](context/R-PROTOCOL.md) | `project/spec/protocol/protocol-manifest.json:L1–L80` | Protocol version/identity negotiation and fixture compatibility authority. |
| [R-ERRORS](context/R-ERRORS.md) | `project/spec/protocol/error-registry.json:L1–L70` | Typed application errors versus transport and unknown outcomes. |
| [R-CLI](context/R-CLI.md) | `project/CLI_COMMANDS.md:L1–L282` | Public command vocabulary, aliases and retained agent/work/sprint semantics. |
| [R-GUIDANCE](context/R-GUIDANCE.md) | `project/AGENT_GUIDANCE.md:L1–L305` | Trusted guide/next, conditional directives, no-goal behavior, safe argv and bounded context. |
| [R-PARITY](context/R-PARITY.md) | `project/WORKFLOW_PARITY.md:L1–L262` | Known retained/reworked/deferred v1 command and workflow meanings. |
| [R-LEGACYMAP](context/R-LEGACYMAP.md) | `project/legacy-map/RECORD_MAPPING.md:L1–L272` | Legacy record inventory and ambiguity dispositions; does not supply absent raw v1 data. |
| [R-MIGRATIONDOC](context/R-MIGRATIONDOC.md) | `docs/MIGRATION.md:L1–L142` | Current import/export behavior and stated provenance/compatibility limits. |
| [R-SOURCE-DOC](context/R-SOURCE-DOC.md) | `project/SOURCE_ENGINE.md:L1–L76` | Versioned source intake, parsing, citation, filtering, retrieval and index authority. |
| [R-MEMORY-DOC](context/R-MEMORY-DOC.md) | `project/MEMORY_BANK.md:L1–L105` | Curated Git memory, live drafts, publication jobs, reconciliation and citations. |
| [R-BUILD](context/R-BUILD.md) | `docs/BUILD.md:L1–L35` | Repository-supported build prerequisites and commands; verify availability on actual executor. |
| [R-RELEASE-DOC](context/R-RELEASE-DOC.md) | `docs/RELEASE.md:L1–L54` | Clean-source package, installed-binary identity and supported-platform release workflow. |
| [R-PACKAGING](context/R-PACKAGING.md) | `docs/PACKAGING.md:L1–L125` | Expected binary/TUI/share layout, package manifest and installer behavior. |
| [R-INSTALL](context/R-INSTALL.md) | `docs/INSTALL.md:L1–L115` | Public install/update commands and installer interaction; verify rather than assume current production availability. |
| [R-PERF](context/R-PERF.md) | `docs/RELEASE_PERFORMANCE.md:L1–L148` | Existing backup/runtime/benchmark scaffolding and explicit native failure/scale gaps. Runtime floor is a repository policy to reverify at release. |
| [R-SECURITYDOC](context/R-SECURITYDOC.md) | `docs/SECURITY.md:L1–L75` | Existing bounded security probes and what their historical passes do not establish. |
| [R-EVIDENCE-DOC](context/R-EVIDENCE-DOC.md) | `docs/EVIDENCE_RUNNER.md:L1–L38` | Current policy-declared evidence runner, source binding and remaining cryptographic/resource hardening. |
| [R-EVIDENCE-GAPS](context/R-EVIDENCE-GAPS.md) | `docs/EVIDENCE_EXECUTOR_TEST_GAPS.md:L1–L34` | Known evidence executor regression coverage and unsupported proof boundaries. |
| [R-DOMAIN](context/R-DOMAIN.md) | `crates/domain/src/lib.rs:L1–L280` | Existing domain identity, lifecycle, actor and gate types; inspect referenced implementations and focused tests. |
| [R-EVALUATOR](context/R-EVALUATOR.md) | `crates/domain/src/status_evaluator.rs:L1–L327` | Extracted pure status decision: preserve source predicates and all reasons; complete action contract without adapters rederiving it. |
| [R-DOMAIN-V3](context/R-DOMAIN-V3.md) | `crates/domain/src/work_model_v3.rs:L1–L300` | Additive work-model types and validators; distinguish available contracts from wired application capabilities. |
| [R-DOMAIN-TEST](context/R-DOMAIN-TEST.md) | `crates/domain/tests/m02_status.rs:L1–L500` | Authored candidate status regressions; existing coverage is not a pass on the fresh source. |
| [R-STORE-IDENTITY](context/R-STORE-IDENTITY.md) | `crates/store/src/lib.rs:L1390–L1505` | Existing project initialization/actor preparation; audit transactional bootstrap and privilege identity. |
| [R-PROFILE-GAP](context/R-PROFILE-GAP.md) | `crates/store/src/lib.rs:L1936–L2015` | ensure_actor accepts caller identity/role inputs; create_work stores an empty profile definition and placeholder-derived digest. |
| [R-SNAPSHOT-GAP](context/R-SNAPSHOT-GAP.md) | `crates/store/src/lib.rs:L3003–L3100` | Shared project snapshot eagerly preloads relations and reconstructs profile requirements from gate diagnostics. |
| [R-CLAIM](context/R-CLAIM.md) | `crates/store/src/lib.rs:L3160–L3305` | Canonical claim snapshot/evaluator under the write transaction; candidate must be proven under races and fresh source. |
| [R-REVIEW-GAP](context/R-REVIEW-GAP.md) | `crates/store/src/lib.rs:L3585–L3655` | Review projection distinguishes only accepted from not-accepted and can turn rejection into missing proof. |
| [R-MUTATION](context/R-MUTATION.md) | `crates/store/src/lib.rs:L3690–L3830` | Attempt mutation checks; inspect revision/fence interpretation and legal action-specific policy inside the transaction. |
| [R-EXPIRY-GAP](context/R-EXPIRY-GAP.md) | `crates/store/src/lib.rs:L4110–L4210` | Attempt termination/current-pointer and reservation updates; durable unresolved recovery must outlive current ownership. |
| [R-CLOSE](context/R-CLOSE.md) | `crates/store/src/lib.rs:L5760–L5905` | Accepted closeout writes must bind exact requirements, context, authority, intent and resulting operation/audit outcome. |
| [R-RECEIPT-SELECT](context/R-RECEIPT-SELECT.md) | `crates/store/src/lib.rs:L6600–L6705` | Boolean review lookup and receipt selection by subject; reconcile all evidence-selection helpers. |
| [R-STORE-STATUS](context/R-STORE-STATUS.md) | `crates/store/src/status_evaluation.rs:L1–L240` | Store-side snapshot conversion and domain status handoff; one source of decoded canonical facts. |
| [R-STORE-V3](context/R-STORE-V3.md) | `crates/store/src/work_model_v3.rs:L1–L260` | Existing cycle/assignment persistence entry points and compatibility scaffolding; read corresponding tests before extending. |
| [R-STORE-TEST](context/R-STORE-TEST.md) | `crates/store/tests/m02_claim.rs:L1–L391` | Candidate claim/authority regressions, not fresh observed evidence. |
| [R-BACKUP-TEST](context/R-BACKUP-TEST.md) | `crates/store/tests/runtime_backup.rs:L1–L116` | Existing linked-runtime and backup scaffolding; extend to real interrupted multi-process restore semantics. |
| [R-SCHEMA-TEST](context/R-SCHEMA-TEST.md) | `crates/store/tests/schema_v3.rs:L1–L802` | Existing additive v3 migration tests and failure rollback examples. |
| [R-APP-LIB](context/R-APP-LIB.md) | `crates/application/src/lib.rs:L1–L280` | Application entry points, shared types and allowed adapter direction; shared module root needs a single writer. |
| [R-APP-STATUS](context/R-APP-STATUS.md) | `crates/application/src/status.rs:L1–L679` | Revisioned read projection, actor context and diagnostics; no separate timer/status policy. |
| [R-APP-RUNTIME](context/R-APP-RUNTIME.md) | `crates/application/src/runtime.rs:L1–L260` | Execution lifecycle use cases and recovery coordination above the store. |
| [R-APP-SESSION](context/R-APP-SESSION.md) | `crates/application/src/session.rs:L1–L199` | Actor/session registration and binding; authenticate principal rather than trusting role/ID text. |
| [R-APP-OP](context/R-APP-OP.md) | `crates/application/src/operation_identity.rs:L1–L162` | Operation identity and replay binding; retain command, actor, subject and request digest semantics. |
| [R-APP-EVIDENCE](context/R-APP-EVIDENCE.md) | `crates/application/src/evidence.rs:L640–L790` | Acceptance matching selects latest matching gate before complete context validation; unify with store subject filtering. |
| [R-APP-EVIDENCE-STORE](context/R-APP-EVIDENCE-STORE.md) | `crates/application/src/evidence_store.rs:L1–L260` | Evidence persistence, close-intent and receipt-to-store interfaces; no synthesized proof. |
| [R-APP-PLANNING](context/R-APP-PLANNING.md) | `crates/application/src/planning_v3.rs:L1–L300` | Additive planning adapters and missing full public lifecycle; preserve identity rather than duplicate sprint/cycle authority. |
| [R-APP-HIERARCHY](context/R-APP-HIERARCHY.md) | `crates/application/src/hierarchy.rs:L1–L1143` | Fixed-tree facade and current parent validation; define explicit cycle compatibility migration. |
| [R-APP-GUIDANCE](context/R-APP-GUIDANCE.md) | `crates/application/src/guidance.rs:L1–L260` | Trusted guidance composition; consume domain action descriptors, never make a second policy engine. |
| [R-APP-WORKFLOWS](context/R-APP-WORKFLOWS.md) | `crates/application/src/workflow_assets.rs:L1–L240` | Workflow asset resolution, versioning and command validation boundary. |
| [R-APP-KNOWLEDGE](context/R-APP-KNOWLEDGE.md) | `crates/application/src/knowledge.rs:L1–L260` | Application source/memory intake and query routes; preserve project scoping and transactional provenance. |
| [R-PROTOCOL-CODE](context/R-PROTOCOL-CODE.md) | `crates/protocol/src/models.rs:L1–L300` | Wire DTO definitions; field additions, action descriptors and typed diagnostics require compatibility tests. |
| [R-PROTOCOL-TEST](context/R-PROTOCOL-TEST.md) | `crates/protocol/tests/m02_status_wire.rs:L1–L23` | Primary reason optional compatibility test; broader status/action contract remains to be proven. |
| [R-PROJECT-PATH](context/R-PROJECT-PATH.md) | `crates/cli/src/dashboard.rs:L65–L225` | Database/root selection performs lexical and canonical checks in separate steps; close symlink/traversal and foreign-instance gaps. |
| [R-BOOTSTRAP](context/R-BOOTSTRAP.md) | `crates/cli/src/service.rs:L1305–L1375` | Public initialization accepts actor/role inputs; reinitialization must not be an enrollment or privilege escalation route. |
| [R-COMMAND-REGISTRY](context/R-COMMAND-REGISTRY.md) | `crates/cli/src/command_registry.rs:L1–L260` | Authoritative public capability/command registry; one owner integrates registration and schema identity edits. |
| [R-CLI-SERVICE](context/R-CLI-SERVICE.md) | `crates/cli/src/service.rs:L1–L260` | CLI/service composition and request mapping; audit direct/offline adapters as well as socket routes. |
| [R-CLI-MAIN](context/R-CLI-MAIN.md) | `crates/cli/src/main.rs:L1–L260` | Public parser and machine/human output entry point; locate existing routes before creating new ones. |
| [R-UPDATE](context/R-UPDATE.md) | `crates/cli/src/update.rs:L1–L79` | Update/upgrade implementations exist; installer invocation and reported identity need supported-platform validation. |
| [R-SERVICE-HOST](context/R-SERVICE-HOST.md) | `crates/service/src/host.rs:L1–L260` | Production service host, writer boundary and response lifecycle. |
| [R-SERVICE-TRANSPORT](context/R-SERVICE-TRANSPORT.md) | `crates/service/src/transport.rs:L1–L280` | Framing, local sockets, limits and interruption behavior; do not substitute fixture-controller success. |
| [R-SERVICE-ELECTION](context/R-SERVICE-ELECTION.md) | `crates/service/src/election.rs:L1–L333` | Single service election and lock ownership; never force-break a live lock. |
| [R-SERVICE-RECOVERY](context/R-SERVICE-RECOVERY.md) | `crates/service/src/recovery.rs:L1–L663` | Restart/uncertain-operation recovery and durable state reconciliation. |
| [R-SERVICE-NOTIFY](context/R-SERVICE-NOTIFY.md) | `crates/service/src/notifications.rs:L1–L289` | Post-commit notifications and cursor gap handling; notifications cannot be acceptance authority. |
| [R-SERVICE-QUEUE](context/R-SERVICE-QUEUE.md) | `crates/service/src/priority_queue.rs:L1–L276` | Priority/write queue fairness and bounded execution; measure queue wait separately from transaction hold. |
| [R-SOURCE-CODE](context/R-SOURCE-CODE.md) | `crates/source/src/lib.rs:L1–L300` | Versioned source intake/index implementations; inspect referenced retrieval and parser tests for supported kinds. |
| [R-MEMORY-CODE](context/R-MEMORY-CODE.md) | `crates/memory/src/lib.rs:L1–L300` | Git publisher/reimport primitives; preserve pending/failed jobs and human edits. |
| [R-MIGRATION-CODE](context/R-MIGRATION-CODE.md) | `crates/migration/src/lib.rs:L2000–L2110` | Legacy lifecycle conversion can map done/complete/archived to Closed; do not equate vocabulary with accepted outcomes. |
| [R-MIGRATION-V3](context/R-MIGRATION-V3.md) | `crates/migration/src/work_model_v3.rs:L1–L260` | Cycle/work-model migration groundwork, raw legacy IDs and compatibility mappings. |
| [R-TUI-CLIENT](context/R-TUI-CLIENT.md) | `apps/tui/src/client.ts:L1320–L1440` | Client actionAvailability and next-action helpers independently interpret status/gates; replace authority with service action descriptors. |
| [R-TUI-CONTROLLER](context/R-TUI-CONTROLLER.md) | `apps/tui/src/full-screen.ts:L1–L300` | Mounted controller, input state, stale revisions, confirmations and request cancellation. |
| [R-TUI-DASHBOARD](context/R-TUI-DASHBOARD.md) | `apps/tui/src/ui/dashboard.ts:L1–L240` | Responsive dashboard rendering and identity/navigation density. |
| [R-TUI-LAYOUT](context/R-TUI-LAYOUT.md) | `apps/tui/src/ui/layout.ts:L1–L50` | Existing width/height breakpoints and adaptive layout; retain usable short editor terminals. |
| [R-TUI-TRANSPORT](context/R-TUI-TRANSPORT.md) | `apps/tui/src/node-transport.ts:L1–L209` | Service connection, pending request and reconnect handling; prevent cross-project late responses. |
| [R-TUI-INPUT](context/R-TUI-INPUT.md) | `apps/tui/src/ui/input.ts:L1–L38` | UTF-8/paste/form editing and focus semantics that confirmations must preserve. |
| [R-TUI-TEST](context/R-TUI-TEST.md) | `apps/tui/tests/m02-contract.test.mjs:L1–L63` | Existing presentation compatibility tests, not genuine lifecycle evidence. |
| [R-TUI-PACKAGE](context/R-TUI-PACKAGE.md) | `apps/tui/package.json:L1–L20` | Actual npm commands and declared Node range; validate supported runtime policy at release, not by assumption. |
| [R-WORKFLOWS](context/R-WORKFLOWS.md) | `project/spec/workflows/manifest.json:L1–L13` | Core workflow identities and versioned package registry; scripts must match implemented commands. |
| [R-GUIDANCE-REGISTRY](context/R-GUIDANCE-REGISTRY.md) | `project/spec/guidance/directive-registry.json:L1–L140` | Trusted conditional directives, command paths and policy outputs. |
| [R-VALIDATOR](context/R-VALIDATOR.md) | `scripts/validation/m02/run_candidate.py:L1–L82` | Existing exact build/test commands and explicit fake-service versus real-service scope labels. |
| [R-FULL-SUITE](context/R-FULL-SUITE.md) | `scripts/validation/run_full_suite.py:L1–L280` | Existing orchestrator; inspect failure handling, selected slices, source identity and retained evidence before extending. |
| [R-STATUS-BENCH](context/R-STATUS-BENCH.md) | `scripts/validation/status/README.md:L1–L26` | Existing service-backed status workload assumptions and benchmark interpretation. |
| [R-CONCURRENCY-HARNESS](context/R-CONCURRENCY-HARNESS.md) | `scripts/validation/concurrency/README.md:L1–L64` | Existing native concurrency scenarios and limitations; distinguish production host from synthetic generator. |
| [R-FAULT-HARNESS](context/R-FAULT-HARNESS.md) | `scripts/validation/fault/README.md:L1–L34` | Existing clock/reorder/fault harness and genuine-service boundary requirements. |
| [R-SOAK](context/R-SOAK.md) | `scripts/validation/soak/README.md:L1–L10` | Long-run mixed workload design, retained observations and resource limits. |
| [R-TUI-SMOKE](context/R-TUI-SMOKE.md) | `scripts/validation/tui/README.md:L1–L32` | Mounted PTY service evidence and known gaps; fixture rendering is supplementary only. |
| [R-RELEASE-BUILDER](context/R-RELEASE-BUILDER.md) | `scripts/release/build_release.py:L1–L260` | Artifact construction, identity verification and build-versus-skip semantics. |
| [R-RELEASE-ID](context/R-RELEASE-ID.md) | `scripts/release/release_identity.py:L1–L260` | Binary/TUI/protocol/schema/workflow/toolchain manifest identity. |
| [R-INSTALLER](context/R-INSTALLER.md) | `scripts/build-installer.mjs:L1–L31` | Canonical wizard bundle and embedded installer identity; generated-file writer must be serialized. |
| [R-ARCHIVER](context/R-ARCHIVER.md) | `create-zips.mjs:L1–L250` | Source selector, required paths and provenance manifest; source archives are not production binaries. |
| [R-ARCHIVE-TEST](context/R-ARCHIVE-TEST.md) | `scripts/validation/m02/source_archive_test.py:L1–L103` | Archive regression and clean extraction exercises; keep source/package acceptance distinct. |
| [R-CI](context/R-CI.md) | `.github/workflows/ci.yml:L1–L83` | Current CI commands, compiler pin and strict aggregate behavior; verify runner availability at execution rather than assuming the historical labels remain supported. |
| [R-RELEASE-CI](context/R-RELEASE-CI.md) | `.github/workflows/release.yml:L1–L121` | Current macOS/Linux target matrix, preflight/build/publish ordering and Homebrew publication; publishing needs explicit authority and exact artifact identity. |
| [R-GUIDANCE-VERTICAL](context/R-GUIDANCE-VERTICAL.md) | `project/build-plan/verticals/11-agent-guidance.md:L1–L106` | Core no-goal, two-harness, bounded-context and trusted-argv acceptance; this capability is not an optional workflow pack. |
| [R-SKILL-MANIFEST](context/R-SKILL-MANIFEST.md) | `skills/manifest.json:L1–L23` | Packaged supported harness workflow identities; preserve command registry and skill version agreement. |
