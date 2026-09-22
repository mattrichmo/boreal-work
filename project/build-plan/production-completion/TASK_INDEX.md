# All 265 task cards

199 scoped contract/implementation/audit/validation/release tasks plus 66 explicit sprint gates. Every task starts unaccepted. Entry dependencies shown in sprint files are mandatory in addition to each leaf’s listed prerequisites.

## PF-S00 — Baseline, provenance, toolchain and evidence recovery

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S00-T01](sprints/PF-S00/tasks/PF-S00-T01.md) | Freeze the supplied snapshot and record evidence applicability | COORD / audit | Sprint entry |
| [PF-S00-T02](sprints/PF-S00/tasks/PF-S00-T02.md) | Establish a reproducible build and test environment | VALIDATION / validation | Sprint entry |
| [PF-S00-T03](sprints/PF-S00/tasks/PF-S00-T03.md) | Run and classify the untouched baseline validation suite | VALIDATION / validation | PF-S00-T01, PF-S00-T02 |
| [PF-S00-T04](sprints/PF-S00/tasks/PF-S00-T04.md) | Inventory public routes, verticals and source findings | CONTRACT / audit | PF-S00-T01 |
| [PF-S00-T05](sprints/PF-S00/tasks/PF-S00-T05.md) | Inventory legacy data, external inputs and platform ownership | MIGRATION / audit | PF-S00-T01 |
| [PF-S00-T06](sprints/PF-S00/tasks/PF-S00-T06.md) | Set up isolated dispatch, evidence and shared-file integration | COORD / coordination | PF-S00-T01, PF-S00-T04 |
| [PF-S00-T07](sprints/PF-S00/tasks/PF-S00-T07.md) | Produce the baseline-to-plan reconciliation and entry packet | COORD / coordination | PF-S00-T03, PF-S00-T04, PF-S00-T05, PF-S00-T06 |
| [PF-S00-T08](sprints/PF-S00/tasks/PF-S00-T08.md) | Restore read-only versioned workflow discovery for the final gate | PROTOCOL / remediation | PF-S00-T90 |
| [PF-S00-T90](sprints/PF-S00/tasks/PF-S00-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S00-T01, PF-S00-T02, PF-S00-T03, PF-S00-T04, PF-S00-T05, PF-S00-T06, PF-S00-T07 |
| [PF-S00-T91](sprints/PF-S00/tasks/PF-S00-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S00-T90, PF-S00-T08 |
| [PF-S00-T92](sprints/PF-S00/tasks/PF-S00-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S00-T91 |

## PF-S01 — Final product contracts and explicit owner decisions

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S01-T01](sprints/PF-S01/tasks/PF-S01-T01.md) | Freeze launch scope, authority boundaries and terminology | CONTRACT / contract | Sprint entry |
| [PF-S01-T02](sprints/PF-S01/tasks/PF-S01-T02.md) | Freeze identity, revisions, operation outcomes and actor threat model | CONTRACT / contract | PF-S01-T01 |
| [PF-S01-T03](sprints/PF-S01/tasks/PF-S01-T03.md) | Choose cycle-backed sprints and container acceptance | CONTRACT / contract | PF-S01-T01 |
| [PF-S01-T04](sprints/PF-S01/tasks/PF-S01-T04.md) | Resolve execution budget, sealed submissions and safe ownership release | CONTRACT / contract | PF-S01-T01, PF-S01-T02 |
| [PF-S01-T05](sprints/PF-S01/tasks/PF-S01-T05.md) | Freeze status precedence, integrity axes and permitted actions | CONTRACT / contract | PF-S01-T01, PF-S01-T02, PF-S01-T03, PF-S01-T04 |
| [PF-S01-T06](sprints/PF-S01/tasks/PF-S01-T06.md) | Freeze profiles, proof selection and independent review policy | CONTRACT / contract | PF-S01-T02, PF-S01-T04 |
| [PF-S01-T07](sprints/PF-S01/tasks/PF-S01-T07.md) | Freeze dependency, reopen and override truth-preservation rules | CONTRACT / contract | PF-S01-T02, PF-S01-T03, PF-S01-T05, PF-S01-T06 |
| [PF-S01-T08](sprints/PF-S01/tasks/PF-S01-T08.md) | Freeze protocol, external jobs and compatibility evolution | PROTOCOL / contract | PF-S01-T02, PF-S01-T05, PF-S01-T06, PF-S01-T07 |
| [PF-S01-T09](sprints/PF-S01/tasks/PF-S01-T09.md) | Set security, resource, support and release acceptance budgets | SECURITY / contract | PF-S01-T01, PF-S01-T02, PF-S01-T08 |
| [PF-S01-T10](sprints/PF-S01/tasks/PF-S01-T10.md) | Freeze source, curated memory and retained legacy parity contracts | CONTRACT / contract | PF-S01-T01, PF-S01-T02, PF-S01-T03, PF-S01-T06 |
| [PF-S01-T11](sprints/PF-S01/tasks/PF-S01-T11.md) | Integrate versioned contracts, conformance oracle and plan amendment | COORD / integration | PF-S01-T05, PF-S01-T06, PF-S01-T07, PF-S01-T08, PF-S01-T09, PF-S01-T10 |
| [PF-S01-T90](sprints/PF-S01/tasks/PF-S01-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S01-T01, PF-S01-T02, PF-S01-T03, PF-S01-T04, PF-S01-T05, PF-S01-T06, PF-S01-T07, PF-S01-T08, PF-S01-T09, PF-S01-T10, PF-S01-T11 |
| [PF-S01-T91](sprints/PF-S01/tasks/PF-S01-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S01-T90 |
| [PF-S01-T92](sprints/PF-S01/tasks/PF-S01-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S01-T91 |

## PF-S02 — Canonical persistence, revisions and migration foundations

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S02-T01](sprints/PF-S02/tasks/PF-S02-T01.md) | Implement ordered schema migration and invariant verification | STORE / implementation | Sprint entry |
| [PF-S02-T02](sprints/PF-S02/tasks/PF-S02-T02.md) | Create bounded store module seams for parallel implementation | STORE / implementation | PF-S02-T01 |
| [PF-S02-T03](sprints/PF-S02/tasks/PF-S02-T03.md) | Persist project, database, entity and proof revision identities | STORE / implementation | PF-S02-T02 |
| [PF-S02-T04](sprints/PF-S02/tasks/PF-S02-T04.md) | Persist immutable acceptance profiles and pinned requirements | STORE / implementation | PF-S02-T02, PF-S02-T03 |
| [PF-S02-T05](sprints/PF-S02/tasks/PF-S02-T05.md) | Persist submissions, reviews, accepted outcomes and exceptions | STORE / implementation | PF-S02-T02, PF-S02-T03, PF-S02-T04 |
| [PF-S02-T06](sprints/PF-S02/tasks/PF-S02-T06.md) | Persist durable recovery, resource ownership and external jobs | STORE / implementation | PF-S02-T02, PF-S02-T03 |
| [PF-S02-T07](sprints/PF-S02/tasks/PF-S02-T07.md) | Persist command registration, outcomes and audit atomically | STORE / implementation | PF-S02-T02, PF-S02-T03 |
| [PF-S02-T08](sprints/PF-S02/tasks/PF-S02-T08.md) | Implement corruption-tolerant canonical decoding and scope quarantine | STORE / implementation | PF-S02-T03, PF-S02-T04, PF-S02-T05, PF-S02-T06, PF-S02-T07 |
| [PF-S02-T09](sprints/PF-S02/tasks/PF-S02-T09.md) | Integrate storage invariants with fresh/upgrade/rollback tests | STORE / integration | PF-S02-T04, PF-S02-T05, PF-S02-T06, PF-S02-T07, PF-S02-T08 |
| [PF-S02-T90](sprints/PF-S02/tasks/PF-S02-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S02-T01, PF-S02-T02, PF-S02-T03, PF-S02-T04, PF-S02-T05, PF-S02-T06, PF-S02-T07, PF-S02-T08, PF-S02-T09 |
| [PF-S02-T91](sprints/PF-S02/tasks/PF-S02-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S02-T90 |
| [PF-S02-T92](sprints/PF-S02/tasks/PF-S02-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S02-T91 |

## PF-S03 — One deterministic domain decision and action model

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S03-T01](sprints/PF-S03/tasks/PF-S03-T01.md) | Introduce typed decision inputs and proof-relevant identities | DOMAIN / implementation | Sprint entry |
| [PF-S03-T02](sprints/PF-S03/tasks/PF-S03-T02.md) | Implement exhaustive status precedence and reason ordering | DOMAIN / implementation | PF-S03-T01 |
| [PF-S03-T03](sprints/PF-S03/tasks/PF-S03-T03.md) | Implement exact clock, schedule, retry and expiry predicates | DOMAIN / implementation | PF-S03-T01, PF-S03-T02 |
| [PF-S03-T04](sprints/PF-S03/tasks/PF-S03-T04.md) | Implement requirement, evidence and review interpretation | DOMAIN / implementation | PF-S03-T01 |
| [PF-S03-T05](sprints/PF-S03/tasks/PF-S03-T05.md) | Implement dependency satisfaction, graph and reopen impact rules | DOMAIN / implementation | PF-S03-T01, PF-S03-T04 |
| [PF-S03-T06](sprints/PF-S03/tasks/PF-S03-T06.md) | Implement explicit authorization and allowed-action decisions | DOMAIN / implementation | PF-S03-T01, PF-S03-T02, PF-S03-T03, PF-S03-T04, PF-S03-T05 |
| [PF-S03-T07](sprints/PF-S03/tasks/PF-S03-T07.md) | Implement container scope and cycle rollup primitives | DOMAIN / implementation | PF-S03-T01, PF-S03-T04, PF-S03-T05 |
| [PF-S03-T08](sprints/PF-S03/tasks/PF-S03-T08.md) | Add property, differential and exhaustive transition tests | VALIDATION / validation | PF-S03-T02, PF-S03-T03, PF-S03-T04, PF-S03-T05, PF-S03-T06, PF-S03-T07 |
| [PF-S03-T09](sprints/PF-S03/tasks/PF-S03-T09.md) | Integrate one public domain decision API and remove duplicate policy | DOMAIN / integration | PF-S03-T08 |
| [PF-S03-T90](sprints/PF-S03/tasks/PF-S03-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S03-T01, PF-S03-T02, PF-S03-T03, PF-S03-T04, PF-S03-T05, PF-S03-T06, PF-S03-T07, PF-S03-T08, PF-S03-T09 |
| [PF-S03-T91](sprints/PF-S03/tasks/PF-S03-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S03-T90 |
| [PF-S03-T92](sprints/PF-S03/tasks/PF-S03-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S03-T91 |

## PF-S04 — Authenticated actors and project/workspace isolation

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S04-T01](sprints/PF-S04/tasks/PF-S04-T01.md) | Implement explicit project initialization and workspace binding | APPLICATION / implementation | Sprint entry |
| [PF-S04-T02](sprints/PF-S04/tasks/PF-S04-T02.md) | Enforce resolved path, symlink and file-descriptor confinement | SECURITY / implementation | PF-S04-T01 |
| [PF-S04-T03](sprints/PF-S04/tasks/PF-S04-T03.md) | Implement credential-backed principals and safe bootstrap | APPLICATION / implementation | Sprint entry |
| [PF-S04-T04](sprints/PF-S04/tasks/PF-S04-T04.md) | Bind sessions, delegation and review identity to principals | APPLICATION / implementation | PF-S04-T03 |
| [PF-S04-T05](sprints/PF-S04/tasks/PF-S04-T05.md) | Implement role changes, credential revocation and authority audit | APPLICATION / implementation | PF-S04-T03, PF-S04-T04 |
| [PF-S04-T06](sprints/PF-S04/tasks/PF-S04-T06.md) | Protect service sockets, maintenance and local process authority | SERVICE / implementation | PF-S04-T01, PF-S04-T02, PF-S04-T03, PF-S04-T04 |
| [PF-S04-T07](sprints/PF-S04/tasks/PF-S04-T07.md) | Enforce project scope across artifacts, source, memory and errors | SECURITY / implementation | PF-S04-T01, PF-S04-T02, PF-S04-T03, PF-S04-T06 |
| [PF-S04-T08](sprints/PF-S04/tasks/PF-S04-T08.md) | Run independent isolation and authority penetration cases | VALIDATION / validation | PF-S04-T05, PF-S04-T06, PF-S04-T07 |
| [PF-S04-T90](sprints/PF-S04/tasks/PF-S04-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S04-T01, PF-S04-T02, PF-S04-T03, PF-S04-T04, PF-S04-T05, PF-S04-T06, PF-S04-T07, PF-S04-T08 |
| [PF-S04-T91](sprints/PF-S04/tasks/PF-S04-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S04-T90 |
| [PF-S04-T92](sprints/PF-S04/tasks/PF-S04-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S04-T91 |

## PF-S05 — Versioned service, durable operations and snapshot plumbing

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S05-T01](sprints/PF-S05/tasks/PF-S05-T01.md) | Implement version negotiation and typed command/query envelopes | PROTOCOL / implementation | Sprint entry |
| [PF-S05-T02](sprints/PF-S05/tasks/PF-S05-T02.md) | Implement one application command executor and transaction contract | APPLICATION / implementation | PF-S05-T01 |
| [PF-S05-T03](sprints/PF-S05/tasks/PF-S05-T03.md) | Implement request admission, idempotency and definitive readback | SERVICE / implementation | PF-S05-T01, PF-S05-T02 |
| [PF-S05-T04](sprints/PF-S05/tasks/PF-S05-T04.md) | Integrate production service host and single-writer queue | SERVICE / implementation | PF-S05-T01, PF-S05-T02, PF-S05-T03 |
| [PF-S05-T05](sprints/PF-S05/tasks/PF-S05-T05.md) | Assemble canonical reads and server-owned action descriptors | APPLICATION / implementation | PF-S05-T01, PF-S05-T02 |
| [PF-S05-T06](sprints/PF-S05/tasks/PF-S05-T06.md) | Implement revision-consistent pagination and subscription recovery | SERVICE / implementation | PF-S05-T01, PF-S05-T04, PF-S05-T05 |
| [PF-S05-T07](sprints/PF-S05/tasks/PF-S05-T07.md) | Implement durable external-job scheduling and readback hooks | SERVICE / implementation | PF-S05-T02, PF-S05-T03, PF-S05-T04 |
| [PF-S05-T08](sprints/PF-S05/tasks/PF-S05-T08.md) | Add genuine service harness and negative proof controls | VALIDATION / validation | PF-S05-T01, PF-S05-T03, PF-S05-T04, PF-S05-T05, PF-S05-T06, PF-S05-T07 |
| [PF-S05-T09](sprints/PF-S05/tasks/PF-S05-T09.md) | Integrate and test all service/direct/maintenance adapter boundaries | APPLICATION / integration | PF-S05-T08 |
| [PF-S05-T90](sprints/PF-S05/tasks/PF-S05-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S05-T01, PF-S05-T02, PF-S05-T03, PF-S05-T04, PF-S05-T05, PF-S05-T06, PF-S05-T07, PF-S05-T08, PF-S05-T09 |
| [PF-S05-T91](sprints/PF-S05/tasks/PF-S05-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S05-T90 |
| [PF-S05-T92](sprints/PF-S05/tasks/PF-S05-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S05-T91 |

## PF-S06 — Fenced multi-agent execution, leases and safe recovery

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S06-T01](sprints/PF-S06/tasks/PF-S06-T01.md) | Implement transactional claim and accepted execution context | APPLICATION / implementation | Sprint entry |
| [PF-S06-T02](sprints/PF-S06/tasks/PF-S06-T02.md) | Implement accept/start and session-bound runtime identity | APPLICATION / implementation | PF-S06-T01 |
| [PF-S06-T03](sprints/PF-S06/tasks/PF-S06-T03.md) | Implement worktree/resource reservation and safe adoption | APPLICATION / implementation | PF-S06-T01, PF-S06-T02 |
| [PF-S06-T04](sprints/PF-S06/tasks/PF-S06-T04.md) | Implement heartbeat and durable checkpoint semantics | APPLICATION / implementation | PF-S06-T02, PF-S06-T03 |
| [PF-S06-T05](sprints/PF-S06/tasks/PF-S06-T05.md) | Implement exact expiry and durable unresolved disposition | APPLICATION / implementation | PF-S06-T02, PF-S06-T03, PF-S06-T04 |
| [PF-S06-T06](sprints/PF-S06/tasks/PF-S06-T06.md) | Implement stop requests and confirmed assignment release | APPLICATION / implementation | PF-S06-T03, PF-S06-T05 |
| [PF-S06-T07](sprints/PF-S06/tasks/PF-S06-T07.md) | Implement failure classification, bounded retry and operator recovery | APPLICATION / implementation | PF-S06-T05, PF-S06-T06 |
| [PF-S06-T08](sprints/PF-S06/tasks/PF-S06-T08.md) | Reconcile live attempts, jobs and ownership after service restart | SERVICE / implementation | PF-S06-T04, PF-S06-T05, PF-S06-T06, PF-S06-T07 |
| [PF-S06-T09](sprints/PF-S06/tasks/PF-S06-T09.md) | Run execution races, deadline boundaries and physical-stop validation | VALIDATION / validation | PF-S06-T07, PF-S06-T08 |
| [PF-S06-T10](sprints/PF-S06/tasks/PF-S06-T10.md) | Integrate execution policy with status, actions and service routes | APPLICATION / integration | PF-S06-T09 |
| [PF-S06-T90](sprints/PF-S06/tasks/PF-S06-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S06-T01, PF-S06-T02, PF-S06-T03, PF-S06-T04, PF-S06-T05, PF-S06-T06, PF-S06-T07, PF-S06-T08, PF-S06-T09, PF-S06-T10 |
| [PF-S06-T91](sprints/PF-S06/tasks/PF-S06-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S06-T90 |
| [PF-S06-T92](sprints/PF-S06/tasks/PF-S06-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S06-T91 |

## PF-S07 — Profiles, genuine verification and immutable submissions

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S07-T01](sprints/PF-S07/tasks/PF-S07-T01.md) | Expose profile creation, pinning and requirement validation | APPLICATION / implementation | Sprint entry |
| [PF-S07-T02](sprints/PF-S07/tasks/PF-S07-T02.md) | Capture trustworthy source, configuration and execution input identity | SOURCE / implementation | PF-S07-T01 |
| [PF-S07-T03](sprints/PF-S07/tasks/PF-S07-T03.md) | Implement a bounded, attributable real verifier executor | APPLICATION / implementation | PF-S07-T01, PF-S07-T02 |
| [PF-S07-T04](sprints/PF-S07/tasks/PF-S07-T04.md) | Persist cryptographic artifacts and authenticated receipt provenance | APPLICATION / implementation | PF-S07-T02, PF-S07-T03 |
| [PF-S07-T05](sprints/PF-S07/tasks/PF-S07-T05.md) | Unify relevant-proof selection and invalidation across all reads/writes | APPLICATION / implementation | PF-S07-T01, PF-S07-T02, PF-S07-T04 |
| [PF-S07-T06](sprints/PF-S07/tasks/PF-S07-T06.md) | Implement immutable submission, finish intent and safe execution handoff | APPLICATION / implementation | PF-S07-T04, PF-S07-T05 |
| [PF-S07-T07](sprints/PF-S07/tasks/PF-S07-T07.md) | Implement checkpoint and closeout-summary proof without prose shortcuts | APPLICATION / implementation | PF-S07-T01, PF-S07-T04, PF-S07-T06 |
| [PF-S07-T08](sprints/PF-S07/tasks/PF-S07-T08.md) | Add adversarial verifier and proof-integrity regressions | VALIDATION / validation | PF-S07-T03, PF-S07-T04, PF-S07-T05, PF-S07-T06, PF-S07-T07 |
| [PF-S07-T09](sprints/PF-S07/tasks/PF-S07-T09.md) | Integrate proof/finish service routes and readback parity | APPLICATION / integration | PF-S07-T08 |
| [PF-S07-T90](sprints/PF-S07/tasks/PF-S07-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S07-T01, PF-S07-T02, PF-S07-T03, PF-S07-T04, PF-S07-T05, PF-S07-T06, PF-S07-T07, PF-S07-T08, PF-S07-T09 |
| [PF-S07-T91](sprints/PF-S07/tasks/PF-S07-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S07-T90 |
| [PF-S07-T92](sprints/PF-S07/tasks/PF-S07-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S07-T91 |

## PF-S08 — Independent review, closeout, overrides and lifecycle reconciliation

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S08-T01](sprints/PF-S08/tasks/PF-S08-T01.md) | Implement review requests, inspection and authenticated independence | APPLICATION / implementation | Sprint entry |
| [PF-S08-T02](sprints/PF-S08/tasks/PF-S08-T02.md) | Implement approve, reject, return and revoke decisions | APPLICATION / implementation | PF-S08-T01 |
| [PF-S08-T03](sprints/PF-S08/tasks/PF-S08-T03.md) | Implement atomic proof-gated close and resumable auto-finalization | APPLICATION / implementation | PF-S08-T02 |
| [PF-S08-T04](sprints/PF-S08/tasks/PF-S08-T04.md) | Implement typed gate exceptions and edge-specific waivers | APPLICATION / implementation | Sprint entry |
| [PF-S08-T05](sprints/PF-S08/tasks/PF-S08-T05.md) | Implement hold, pause, resume and dispatch-policy operations | APPLICATION / implementation | PF-S08-T04 |
| [PF-S08-T06](sprints/PF-S08/tasks/PF-S08-T06.md) | Implement work cancellation and dependent/resource disposition | APPLICATION / implementation | PF-S08-T03, PF-S08-T05 |
| [PF-S08-T07](sprints/PF-S08/tasks/PF-S08-T07.md) | Implement reopen, supersession and downstream impact reconciliation | APPLICATION / implementation | PF-S08-T03, PF-S08-T04, PF-S08-T06 |
| [PF-S08-T08](sprints/PF-S08/tasks/PF-S08-T08.md) | Implement exception expiry/revocation and acceptance impact readback | APPLICATION / implementation | PF-S08-T03, PF-S08-T04, PF-S08-T07 |
| [PF-S08-T09](sprints/PF-S08/tasks/PF-S08-T09.md) | Expose lifecycle, review and operator service operations | PROTOCOL / implementation | PF-S08-T02, PF-S08-T03, PF-S08-T04, PF-S08-T05, PF-S08-T06, PF-S08-T07, PF-S08-T08 |
| [PF-S08-T10](sprints/PF-S08/tasks/PF-S08-T10.md) | Run acceptance, override, reopen and unknown-outcome races | VALIDATION / validation | PF-S08-T09 |
| [PF-S08-T11](sprints/PF-S08/tasks/PF-S08-T11.md) | Integrate the complete lifecycle transition oracle | APPLICATION / integration | PF-S08-T10 |
| [PF-S08-T90](sprints/PF-S08/tasks/PF-S08-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S08-T01, PF-S08-T02, PF-S08-T03, PF-S08-T04, PF-S08-T05, PF-S08-T06, PF-S08-T07, PF-S08-T08, PF-S08-T09, PF-S08-T10, PF-S08-T11 |
| [PF-S08-T91](sprints/PF-S08/tasks/PF-S08-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S08-T90 |
| [PF-S08-T92](sprints/PF-S08/tasks/PF-S08-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S08-T91 |

## PF-S09 — Milestones, cycle-backed sprints and dependency planning

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S09-T01](sprints/PF-S09/tasks/PF-S09-T01.md) | Implement project-scoped milestone and task planning operations | APPLICATION / implementation | Sprint entry |
| [PF-S09-T02](sprints/PF-S09/tasks/PF-S09-T02.md) | Implement cycle identity, lifecycle and legacy sprint mapping | APPLICATION / implementation | PF-S09-T01 |
| [PF-S09-T03](sprints/PF-S09/tasks/PF-S09-T03.md) | Implement task assignments and atomic commitment changes | APPLICATION / implementation | PF-S09-T01, PF-S09-T02 |
| [PF-S09-T04](sprints/PF-S09/tasks/PF-S09-T04.md) | Implement typed dependency edits and transactional graph validation | APPLICATION / implementation | PF-S09-T01, PF-S09-T02 |
| [PF-S09-T05](sprints/PF-S09/tasks/PF-S09-T05.md) | Implement versioned planning profile, schedule and policy edits | APPLICATION / implementation | PF-S09-T01, PF-S09-T02, PF-S09-T03, PF-S09-T04 |
| [PF-S09-T06](sprints/PF-S09/tasks/PF-S09-T06.md) | Implement carry-over, cycle cancellation and scope reconciliation | APPLICATION / implementation | PF-S09-T03, PF-S09-T05, PF-S08-T92 |
| [PF-S09-T07](sprints/PF-S09/tasks/PF-S09-T07.md) | Implement scope-bound milestone and cycle closeout | APPLICATION / implementation | PF-S09-T06 |
| [PF-S09-T08](sprints/PF-S09/tasks/PF-S09-T08.md) | Expose planning application/service adapters and compatibility errors | PROTOCOL / implementation | PF-S09-T02, PF-S09-T03, PF-S09-T04, PF-S09-T05, PF-S09-T06, PF-S09-T07 |
| [PF-S09-T09](sprints/PF-S09/tasks/PF-S09-T09.md) | Validate parallel sprint planning and history-preserving disposition | VALIDATION / validation | PF-S09-T08 |
| [PF-S09-T90](sprints/PF-S09/tasks/PF-S09-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S09-T01, PF-S09-T02, PF-S09-T03, PF-S09-T04, PF-S09-T05, PF-S09-T06, PF-S09-T07, PF-S09-T08, PF-S09-T09 |
| [PF-S09-T91](sprints/PF-S09/tasks/PF-S09-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S09-T90 |
| [PF-S09-T92](sprints/PF-S09/tasks/PF-S09-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S09-T91 |

## PF-S10 — Exact projections, launch readiness and actionable queues

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S10-T01](sprints/PF-S10/tasks/PF-S10-T01.md) | Implement a revision-consistent canonical projection assembler | APPLICATION / implementation | Sprint entry |
| [PF-S10-T02](sprints/PF-S10/tasks/PF-S10-T02.md) | Implement bounded task queries and exact totals | APPLICATION / implementation | PF-S10-T01 |
| [PF-S10-T03](sprints/PF-S10/tasks/PF-S10-T03.md) | Implement deterministic milestone and cycle rollups | APPLICATION / implementation | PF-S10-T01, PF-S10-T02 |
| [PF-S10-T04](sprints/PF-S10/tasks/PF-S10-T04.md) | Implement planning validation and cycle launch readiness | APPLICATION / implementation | PF-S10-T01, PF-S10-T03 |
| [PF-S10-T05](sprints/PF-S10/tasks/PF-S10-T05.md) | Implement review, recovery and operator attention queues | APPLICATION / implementation | PF-S10-T01, PF-S10-T02, PF-S10-T03 |
| [PF-S10-T06](sprints/PF-S10/tasks/PF-S10-T06.md) | Implement corruption-tolerant projections and repair previews | APPLICATION / implementation | PF-S10-T01, PF-S10-T03, PF-S10-T04, PF-S10-T05 |
| [PF-S10-T07](sprints/PF-S10/tasks/PF-S10-T07.md) | Implement report snapshots and rebuildable projection behavior | APPLICATION / implementation | PF-S10-T02, PF-S10-T03, PF-S10-T04, PF-S10-T05, PF-S10-T06 |
| [PF-S10-T08](sprints/PF-S10/tasks/PF-S10-T08.md) | Measure query shape and concurrent read consistency | VALIDATION / validation | PF-S10-T02, PF-S10-T03, PF-S10-T06, PF-S10-T07 |
| [PF-S10-T09](sprints/PF-S10/tasks/PF-S10-T09.md) | Integrate planning/query/readiness service contracts | PROTOCOL / integration | PF-S10-T07, PF-S10-T08 |
| [PF-S10-T90](sprints/PF-S10/tasks/PF-S10-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S10-T01, PF-S10-T02, PF-S10-T03, PF-S10-T04, PF-S10-T05, PF-S10-T06, PF-S10-T07, PF-S10-T08, PF-S10-T09 |
| [PF-S10-T91](sprints/PF-S10/tasks/PF-S10-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S10-T90 |
| [PF-S10-T92](sprints/PF-S10/tasks/PF-S10-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S10-T91 |

## PF-S11 — Versioned sources, curated memory and recoverable handoff

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S11-T01](sprints/PF-S11/tasks/PF-S11-T01.md) | Complete supported source intake and immutable versioning | SOURCE / implementation | Sprint entry |
| [PF-S11-T02](sprints/PF-S11/tasks/PF-S11-T02.md) | Implement stable citation locators and content verification | SOURCE / implementation | PF-S11-T01 |
| [PF-S11-T03](sprints/PF-S11/tasks/PF-S11-T03.md) | Implement project-scoped search and rebuildable indexes | SOURCE / implementation | PF-S11-T01, PF-S11-T02 |
| [PF-S11-T04](sprints/PF-S11/tasks/PF-S11-T04.md) | Implement live notes, memory drafts and publication authority | MEMORY / implementation | PF-S11-T01, PF-S11-T02 |
| [PF-S11-T05](sprints/PF-S11/tasks/PF-S11-T05.md) | Implement recoverable Git publication and commit readback | MEMORY / implementation | PF-S11-T03, PF-S11-T04 |
| [PF-S11-T06](sprints/PF-S11/tasks/PF-S11-T06.md) | Implement reimport, fresh-clone reconciliation and doctor checks | MEMORY / implementation | PF-S11-T05 |
| [PF-S11-T07](sprints/PF-S11/tasks/PF-S11-T07.md) | Implement revision-bound handoff and bounded context bundles | APPLICATION / implementation | PF-S11-T02, PF-S11-T03, PF-S11-T04, PF-S11-T05, PF-S11-T06 |
| [PF-S11-T08](sprints/PF-S11/tasks/PF-S11-T08.md) | Implement artifact retention roots and safe garbage-collection planning | STORE / implementation | PF-S11-T01, PF-S11-T02, PF-S11-T05, PF-S11-T06 |
| [PF-S11-T09](sprints/PF-S11/tasks/PF-S11-T09.md) | Validate source-memory-handoff recovery through the real service | VALIDATION / validation | PF-S11-T07, PF-S11-T08 |
| [PF-S11-T90](sprints/PF-S11/tasks/PF-S11-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S11-T01, PF-S11-T02, PF-S11-T03, PF-S11-T04, PF-S11-T05, PF-S11-T06, PF-S11-T07, PF-S11-T08, PF-S11-T09 |
| [PF-S11-T91](sprints/PF-S11/tasks/PF-S11-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S11-T90 |
| [PF-S11-T92](sprints/PF-S11/tasks/PF-S11-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S11-T91 |

## PF-S12 — Legacy parity, backup/restore and explicit maintenance recovery

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S12-T01](sprints/PF-S12/tasks/PF-S12-T01.md) | Acquire and freeze representative legacy parity inputs | MIGRATION / audit | Sprint entry |
| [PF-S12-T02](sprints/PF-S12/tasks/PF-S12-T02.md) | Implement dry-run/export/import with complete disposition reports | MIGRATION / implementation | PF-S12-T01 |
| [PF-S12-T03](sprints/PF-S12/tasks/PF-S12-T03.md) | Migrate lifecycle, proof and review without converting prose into acceptance | MIGRATION / implementation | PF-S12-T02 |
| [PF-S12-T04](sprints/PF-S12/tasks/PF-S12-T04.md) | Migrate hierarchy, cycles, assignments and dependency history | MIGRATION / implementation | PF-S12-T02, PF-S12-T03 |
| [PF-S12-T05](sprints/PF-S12/tasks/PF-S12-T05.md) | Materialize legacy source/memory and interruption-safe import | MIGRATION / implementation | PF-S12-T03, PF-S12-T04 |
| [PF-S12-T06](sprints/PF-S12/tasks/PF-S12-T06.md) | Implement consistent online backup with a full project manifest | STORE / implementation | Sprint entry |
| [PF-S12-T07](sprints/PF-S12/tasks/PF-S12-T07.md) | Implement safe restore, restore epochs and service reconciliation | APPLICATION / implementation | PF-S12-T06 |
| [PF-S12-T08](sprints/PF-S12/tasks/PF-S12-T08.md) | Implement read-only doctor and explicit revision-bound repair | APPLICATION / implementation | PF-S12-T03, PF-S12-T04, PF-S12-T05, PF-S12-T07 |
| [PF-S12-T09](sprints/PF-S12/tasks/PF-S12-T09.md) | Expose migration/backup/restore/doctor service and maintenance routes | PROTOCOL / implementation | PF-S12-T05, PF-S12-T06, PF-S12-T07, PF-S12-T08 |
| [PF-S12-T10](sprints/PF-S12/tasks/PF-S12-T10.md) | Run real migration, backup/restore and repair acceptance | VALIDATION / validation | PF-S12-T09 |
| [PF-S12-T90](sprints/PF-S12/tasks/PF-S12-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S12-T01, PF-S12-T02, PF-S12-T03, PF-S12-T04, PF-S12-T05, PF-S12-T06, PF-S12-T07, PF-S12-T08, PF-S12-T09, PF-S12-T10 |
| [PF-S12-T91](sprints/PF-S12/tasks/PF-S12-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S12-T90 |
| [PF-S12-T92](sprints/PF-S12/tasks/PF-S12-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S12-T91 |

## PF-S13 — Complete human and machine CLI/service parity

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S13-T01](sprints/PF-S13/tasks/PF-S13-T01.md) | Reconcile the public command registry and compatibility aliases | CLI / implementation | Sprint entry |
| [PF-S13-T02](sprints/PF-S13/tasks/PF-S13-T02.md) | Implement project, identity and actor/session public commands | CLI / implementation | PF-S13-T01 |
| [PF-S13-T03](sprints/PF-S13/tasks/PF-S13-T03.md) | Implement milestone, sprint/cycle and work planning commands | CLI / implementation | PF-S13-T01, PF-S13-T02 |
| [PF-S13-T04](sprints/PF-S13/tasks/PF-S13-T04.md) | Implement work queues, attention, status and history commands | CLI / implementation | PF-S13-T01, PF-S13-T02 |
| [PF-S13-T05](sprints/PF-S13/tasks/PF-S13-T05.md) | Implement consolidated agent execution and finish/release commands | CLI / implementation | PF-S13-T01, PF-S13-T02 |
| [PF-S13-T06](sprints/PF-S13/tasks/PF-S13-T06.md) | Implement evidence, review and explicit operator commands | CLI / implementation | PF-S13-T01, PF-S13-T02 |
| [PF-S13-T07](sprints/PF-S13/tasks/PF-S13-T07.md) | Implement source, memory, handoff and maintenance commands | CLI / implementation | PF-S13-T01, PF-S13-T02 |
| [PF-S13-T08](sprints/PF-S13/tasks/PF-S13-T08.md) | Standardize machine envelopes, exit codes, help and operation readback | CLI / implementation | PF-S13-T03, PF-S13-T04, PF-S13-T05, PF-S13-T06, PF-S13-T07 |
| [PF-S13-T09](sprints/PF-S13/tasks/PF-S13-T09.md) | Run complete CLI-to-service parity and alias tests | VALIDATION / validation | PF-S13-T08 |
| [PF-S13-T10](sprints/PF-S13/tasks/PF-S13-T10.md) | Integrate public contract and consumer handoff | CLI / integration | PF-S13-T09 |
| [PF-S13-T90](sprints/PF-S13/tasks/PF-S13-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S13-T01, PF-S13-T02, PF-S13-T03, PF-S13-T04, PF-S13-T05, PF-S13-T06, PF-S13-T07, PF-S13-T08, PF-S13-T09, PF-S13-T10 |
| [PF-S13-T91](sprints/PF-S13/tasks/PF-S13-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S13-T90 |
| [PF-S13-T92](sprints/PF-S13/tasks/PF-S13-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S13-T91 |

## PF-S14 — Trusted workflows and no-goal multi-harness agent guidance

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S14-T01](sprints/PF-S14/tasks/PF-S14-T01.md) | Implement versioned workflow discovery and registry validation | WORKFLOW / implementation | Sprint entry |
| [PF-S14-T02](sprints/PF-S14/tasks/PF-S14-T02.md) | Compile bounded conditional guidance from canonical actions | WORKFLOW / implementation | PF-S14-T01 |
| [PF-S14-T03](sprints/PF-S14/tasks/PF-S14-T03.md) | Implement trusted structured argv and instruction/data separation | WORKFLOW / implementation | PF-S14-T01, PF-S14-T02 |
| [PF-S14-T04](sprints/PF-S14/tasks/PF-S14-T04.md) | Connect plan/claim/resume/checkpoint/evidence/finish workflows | WORKFLOW / implementation | PF-S14-T02, PF-S14-T03 |
| [PF-S14-T05](sprints/PF-S14/tasks/PF-S14-T05.md) | Connect independent review, operator recovery and failure workflows | WORKFLOW / implementation | PF-S14-T02, PF-S14-T03, PF-S14-T04 |
| [PF-S14-T06](sprints/PF-S14/tasks/PF-S14-T06.md) | Connect cited context, memory and handoff workflows | WORKFLOW / implementation | PF-S14-T02, PF-S14-T03, PF-S14-T04 |
| [PF-S14-T07](sprints/PF-S14/tasks/PF-S14-T07.md) | Validate unfamiliar-agent workflows across two actual harnesses | VALIDATION / validation | PF-S14-T04, PF-S14-T05, PF-S14-T06 |
| [PF-S14-T08](sprints/PF-S14/tasks/PF-S14-T08.md) | Validate workflow package identity and close parity gaps | WORKFLOW / integration | PF-S14-T07 |
| [PF-S14-T90](sprints/PF-S14/tasks/PF-S14-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S14-T01, PF-S14-T02, PF-S14-T03, PF-S14-T04, PF-S14-T05, PF-S14-T06, PF-S14-T07, PF-S14-T08 |
| [PF-S14-T91](sprints/PF-S14/tasks/PF-S14-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S14-T90 |
| [PF-S14-T92](sprints/PF-S14/tasks/PF-S14-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S14-T91 |

## PF-S15 — Production terminal workspace and recovery UX

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S15-T01](sprints/PF-S15/tasks/PF-S15-T01.md) | Replace client-derived action policy with service descriptors | TUI / implementation | Sprint entry |
| [PF-S15-T02](sprints/PF-S15/tasks/PF-S15-T02.md) | Implement project identity, connection state and pending operation safety | TUI / implementation | PF-S15-T01 |
| [PF-S15-T03](sprints/PF-S15/tasks/PF-S15-T03.md) | Implement overview, exact attention totals and stable navigation | TUI / implementation | PF-S15-T01, PF-S15-T02 |
| [PF-S15-T04](sprints/PF-S15/tasks/PF-S15-T04.md) | Implement milestone/cycle planning, readiness and scope views | TUI / implementation | PF-S15-T01, PF-S15-T03 |
| [PF-S15-T05](sprints/PF-S15/tasks/PF-S15-T05.md) | Implement work detail, proof history and independent review screens | TUI / implementation | PF-S15-T01, PF-S15-T03 |
| [PF-S15-T06](sprints/PF-S15/tasks/PF-S15-T06.md) | Implement safe forms, confirmations and terminal-content sanitization | TUI / implementation | PF-S15-T01, PF-S15-T02, PF-S15-T03 |
| [PF-S15-T07](sprints/PF-S15/tasks/PF-S15-T07.md) | Implement expiry, failure, corruption and operator recovery surfaces | TUI / implementation | PF-S15-T01, PF-S15-T02, PF-S15-T05, PF-S15-T06 |
| [PF-S15-T08](sprints/PF-S15/tasks/PF-S15-T08.md) | Implement memory/context/history and maintenance navigation | TUI / implementation | PF-S15-T01, PF-S15-T03, PF-S15-T05, PF-S15-T06 |
| [PF-S15-T09](sprints/PF-S15/tasks/PF-S15-T09.md) | Complete independent width/height breakpoints and accessible fallback | TUI / implementation | PF-S15-T03, PF-S15-T04, PF-S15-T05, PF-S15-T06, PF-S15-T07, PF-S15-T08 |
| [PF-S15-T10](sprints/PF-S15/tasks/PF-S15-T10.md) | Run mounted real-service terminal workflow and outage tests | VALIDATION / validation | PF-S15-T02, PF-S15-T04, PF-S15-T05, PF-S15-T06, PF-S15-T07, PF-S15-T08, PF-S15-T09 |
| [PF-S15-T11](sprints/PF-S15/tasks/PF-S15-T11.md) | Integrate UX language, client boundaries and installed asset contract | TUI / integration | PF-S15-T10 |
| [PF-S15-T90](sprints/PF-S15/tasks/PF-S15-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S15-T01, PF-S15-T02, PF-S15-T03, PF-S15-T04, PF-S15-T05, PF-S15-T06, PF-S15-T07, PF-S15-T08, PF-S15-T09, PF-S15-T10, PF-S15-T11 |
| [PF-S15-T91](sprints/PF-S15/tasks/PF-S15-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S15-T90 |
| [PF-S15-T92](sprints/PF-S15/tasks/PF-S15-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S15-T91 |

## PF-S16 — Integrated real-service product conformance

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S16-T01](sprints/PF-S16/tasks/PF-S16-T01.md) | Freeze the integrated scenario graph and evidence harness | VALIDATION / validation | Sprint entry |
| [PF-S16-T02](sprints/PF-S16/tasks/PF-S16-T02.md) | Prove project init to parallel plan to accepted closeout | VALIDATION / validation | PF-S16-T01 |
| [PF-S16-T03](sprints/PF-S16/tasks/PF-S16-T03.md) | Prove every status, secondary reason and action combination | VALIDATION / validation | PF-S16-T01 |
| [PF-S16-T04](sprints/PF-S16/tasks/PF-S16-T04.md) | Prove multi-agent planning/execution/acceptance race safety | VALIDATION / validation | PF-S16-T01 |
| [PF-S16-T05](sprints/PF-S16/tasks/PF-S16-T05.md) | Prove unknown outcomes and partial external-operation recovery | VALIDATION / validation | PF-S16-T01 |
| [PF-S16-T06](sprints/PF-S16/tasks/PF-S16-T06.md) | Prove isolation across every public and cached surface | VALIDATION / validation | PF-S16-T01 |
| [PF-S16-T07](sprints/PF-S16/tasks/PF-S16-T07.md) | Prove migration, corrupted-record recovery and full restore integration | VALIDATION / validation | PF-S16-T01 |
| [PF-S16-T08](sprints/PF-S16/tasks/PF-S16-T08.md) | Prove no-goal agent and mounted-terminal cross-surface workflows | VALIDATION / validation | PF-S16-T01, PF-S16-T02, PF-S16-T03, PF-S16-T05 |
| [PF-S16-T09](sprints/PF-S16/tasks/PF-S16-T09.md) | Reconcile all integration evidence and original acceptance obligations | VALIDATION / validation | PF-S16-T02, PF-S16-T03, PF-S16-T04, PF-S16-T05, PF-S16-T06, PF-S16-T07, PF-S16-T08 |
| [PF-S16-T90](sprints/PF-S16/tasks/PF-S16-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S16-T01, PF-S16-T02, PF-S16-T03, PF-S16-T04, PF-S16-T05, PF-S16-T06, PF-S16-T07, PF-S16-T08, PF-S16-T09 |
| [PF-S16-T91](sprints/PF-S16/tasks/PF-S16-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S16-T90 |
| [PF-S16-T92](sprints/PF-S16/tasks/PF-S16-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S16-T91 |

## PF-S17 — Adversarial security, fault tolerance, scale and soak

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S17-T01](sprints/PF-S17/tasks/PF-S17-T01.md) | Audit authority, project paths and untrusted input boundaries | SECURITY / validation | Sprint entry |
| [PF-S17-T02](sprints/PF-S17/tasks/PF-S17-T02.md) | Run process, disk, clock and service failure-boundary tests | VALIDATION / validation | Sprint entry |
| [PF-S17-T03](sprints/PF-S17/tasks/PF-S17-T03.md) | Measure real multi-agent load and identify bounded hot paths | VALIDATION / validation | Sprint entry |
| [PF-S17-T04](sprints/PF-S17/tasks/PF-S17-T04.md) | Optimize measured hot paths without duplicating policy | STORE / implementation | PF-S17-T03 |
| [PF-S17-T05](sprints/PF-S17/tasks/PF-S17-T05.md) | Run sustained soak, leak and recovery-convergence checks | VALIDATION / validation | PF-S17-T02, PF-S17-T04 |
| [PF-S17-T06](sprints/PF-S17/tasks/PF-S17-T06.md) | Audit dependencies, executor trust and release security policy | SECURITY / validation | PF-S17-T01 |
| [PF-S17-T07](sprints/PF-S17/tasks/PF-S17-T07.md) | Qualify compatibility, backup concurrency and restoration recovery | VALIDATION / validation | PF-S17-T02, PF-S17-T04 |
| [PF-S17-T08](sprints/PF-S17/tasks/PF-S17-T08.md) | Harden strict validation aggregation and evidence authenticity | VALIDATION / implementation | PF-S17-T01, PF-S17-T02, PF-S17-T05, PF-S17-T06, PF-S17-T07 |
| [PF-S17-T09](sprints/PF-S17/tasks/PF-S17-T09.md) | Rerun integrated hardening and resolve the release-blocker ledger | VALIDATION / validation | PF-S17-T04, PF-S17-T05, PF-S17-T06, PF-S17-T07, PF-S17-T08 |
| [PF-S17-T90](sprints/PF-S17/tasks/PF-S17-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S17-T01, PF-S17-T02, PF-S17-T03, PF-S17-T04, PF-S17-T05, PF-S17-T06, PF-S17-T07, PF-S17-T08, PF-S17-T09 |
| [PF-S17-T91](sprints/PF-S17/tasks/PF-S17-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S17-T90 |
| [PF-S17-T92](sprints/PF-S17/tasks/PF-S17-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S17-T91 |

## PF-S18 — Reproducible packaging, installer and recoverable upgrades

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S18-T01](sprints/PF-S18/tasks/PF-S18-T01.md) | Freeze package contents, provenance and supported runtime policy | RELEASE / implementation | Sprint entry |
| [PF-S18-T02](sprints/PF-S18/tasks/PF-S18-T02.md) | Implement clean deterministic release build and asset verification | RELEASE / implementation | PF-S18-T01 |
| [PF-S18-T03](sprints/PF-S18/tasks/PF-S18-T03.md) | Complete multi-screen installer workflow and responsive interaction | TUI / implementation | PF-S18-T01 |
| [PF-S18-T04](sprints/PF-S18/tasks/PF-S18-T04.md) | Implement safe archive verification and atomic prefix activation | RELEASE / implementation | PF-S18-T01, PF-S18-T02, PF-S18-T03 |
| [PF-S18-T05](sprints/PF-S18/tasks/PF-S18-T05.md) | Complete update/upgrade readback and active-service coordination | CLI / implementation | PF-S18-T04 |
| [PF-S18-T06](sprints/PF-S18/tasks/PF-S18-T06.md) | Implement artifact authentication, CI approvals and package metadata | RELEASE / implementation | PF-S18-T01, PF-S18-T02, PF-S18-T04 |
| [PF-S18-T07](sprints/PF-S18/tasks/PF-S18-T07.md) | Validate the real built package in a clean disposable prefix | VALIDATION / validation | PF-S18-T04, PF-S18-T05, PF-S18-T06 |
| [PF-S18-T08](sprints/PF-S18/tasks/PF-S18-T08.md) | Validate real macOS and Linux target packages | VALIDATION / validation | PF-S18-T07 |
| [PF-S18-T09](sprints/PF-S18/tasks/PF-S18-T09.md) | Harden source archive generation and required-plan/source retention | RELEASE / implementation | PF-S18-T02, PF-S18-T03 |
| [PF-S18-T10](sprints/PF-S18/tasks/PF-S18-T10.md) | Integrate distribution identity and upgrade evidence for qualification | RELEASE / integration | PF-S18-T07, PF-S18-T08, PF-S18-T09 |
| [PF-S18-T90](sprints/PF-S18/tasks/PF-S18-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S18-T01, PF-S18-T02, PF-S18-T03, PF-S18-T04, PF-S18-T05, PF-S18-T06, PF-S18-T07, PF-S18-T08, PF-S18-T09, PF-S18-T10 |
| [PF-S18-T91](sprints/PF-S18/tasks/PF-S18-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S18-T90 |
| [PF-S18-T92](sprints/PF-S18/tasks/PF-S18-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S18-T91 |

## PF-S19 — User onboarding, operator runbooks and support readiness

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S19-T01](sprints/PF-S19/tasks/PF-S19-T01.md) | Write and execute fresh-user onboarding and parallel planning guide | DOCS / implementation | Sprint entry |
| [PF-S19-T02](sprints/PF-S19/tasks/PF-S19-T02.md) | Document statuses, proof, independent review and explicit exceptions | DOCS / implementation | Sprint entry |
| [PF-S19-T03](sprints/PF-S19/tasks/PF-S19-T03.md) | Write incident, unknown-outcome and safe resource-recovery runbooks | DOCS / implementation | Sprint entry |
| [PF-S19-T04](sprints/PF-S19/tasks/PF-S19-T04.md) | Write migration, backup/restore and source-memory maintenance guides | DOCS / implementation | Sprint entry |
| [PF-S19-T05](sprints/PF-S19/tasks/PF-S19-T05.md) | Write install/update/rollback and support-platform documentation | DOCS / implementation | Sprint entry |
| [PF-S19-T06](sprints/PF-S19/tasks/PF-S19-T06.md) | Publish support diagnostics, privacy and known-limitations policy | DOCS / implementation | PF-S19-T02, PF-S19-T03, PF-S19-T04, PF-S19-T05 |
| [PF-S19-T07](sprints/PF-S19/tasks/PF-S19-T07.md) | Run documentation and unfamiliar-user usability acceptance | VALIDATION / validation | PF-S19-T01, PF-S19-T02, PF-S19-T03, PF-S19-T04, PF-S19-T05, PF-S19-T06 |
| [PF-S19-T90](sprints/PF-S19/tasks/PF-S19-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S19-T01, PF-S19-T02, PF-S19-T03, PF-S19-T04, PF-S19-T05, PF-S19-T06, PF-S19-T07 |
| [PF-S19-T91](sprints/PF-S19/tasks/PF-S19-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S19-T90 |
| [PF-S19-T92](sprints/PF-S19/tasks/PF-S19-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S19-T91 |

## PF-S20 — Exact-artifact release qualification and independent cutover

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S20-T01](sprints/PF-S20/tasks/PF-S20-T01.md) | Freeze the release candidate and complete evidence manifest | COORD / coordination | Sprint entry |
| [PF-S20-T02](sprints/PF-S20/tasks/PF-S20-T02.md) | Run full strict Rust, TypeScript, contract and harness gates | VALIDATION / validation | PF-S20-T01 |
| [PF-S20-T03](sprints/PF-S20/tasks/PF-S20-T03.md) | Build and authenticate final candidate artifacts from locked source | RELEASE / build | PF-S20-T02 |
| [PF-S20-T04](sprints/PF-S20/tasks/PF-S20-T04.md) | Qualify final installed artifacts on every supported native target | VALIDATION / validation | PF-S20-T03 |
| [PF-S20-T05](sprints/PF-S20/tasks/PF-S20-T05.md) | Reconcile full M02/final-form scope and rollback readiness | COORD / coordination | PF-S20-T02, PF-S20-T03, PF-S20-T04 |
| [PF-S20-T06](sprints/PF-S20/tasks/PF-S20-T06.md) | Perform final independent architecture and product acceptance audit | VALIDATION / review | PF-S20-T05 |
| [PF-S20-T07](sprints/PF-S20/tasks/PF-S20-T07.md) | Reconcile final audit findings and requalify affected artifacts | COORD / coordination | PF-S20-T06 |
| [PF-S20-T08](sprints/PF-S20/tasks/PF-S20-T08.md) | Record the authorized ship decision and publication conditions | COORD / decision | PF-S20-T07 |
| [PF-S20-T90](sprints/PF-S20/tasks/PF-S20-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S20-T01, PF-S20-T02, PF-S20-T03, PF-S20-T04, PF-S20-T05, PF-S20-T06, PF-S20-T07, PF-S20-T08 |
| [PF-S20-T91](sprints/PF-S20/tasks/PF-S20-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S20-T90 |
| [PF-S20-T92](sprints/PF-S20/tasks/PF-S20-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S20-T91 |

## PF-S21 — Authorized publication, clean-install verification and operational handover

| Task | Title | Lane/type | Direct leaf prerequisites |
| --- | --- | --- | --- |
| [PF-S21-T01](sprints/PF-S21/tasks/PF-S21-T01.md) | Reverify authorization, immutable artifacts and clean release source | RELEASE / validation | Sprint entry |
| [PF-S21-T02](sprints/PF-S21/tasks/PF-S21-T02.md) | Publish the approved release tag and immutable package assets | RELEASE / publication | PF-S21-T01 |
| [PF-S21-T03](sprints/PF-S21/tasks/PF-S21-T03.md) | Update distribution metadata and future-install instructions safely | RELEASE / publication | PF-S21-T02 |
| [PF-S21-T04](sprints/PF-S21/tasks/PF-S21-T04.md) | Verify clean installs and upgrades from the actual published channels | VALIDATION / validation | PF-S21-T02, PF-S21-T03 |
| [PF-S21-T05](sprints/PF-S21/tasks/PF-S21-T05.md) | Perform release incident drill and bounded stabilization verification | VALIDATION / validation | PF-S21-T04 |
| [PF-S21-T06](sprints/PF-S21/tasks/PF-S21-T06.md) | Finalize implementation report, evidence archive and product handover | COORD / coordination | PF-S21-T05 |
| [PF-S21-T90](sprints/PF-S21/tasks/PF-S21-T90.md) | Independent sprint review and finding classification | VALIDATION / review | PF-S21-T01, PF-S21-T02, PF-S21-T03, PF-S21-T04, PF-S21-T05, PF-S21-T06 |
| [PF-S21-T91](sprints/PF-S21/tasks/PF-S21-T91.md) | Reconcile sprint findings and integrate bounded corrections | COORD / reconciliation | PF-S21-T90 |
| [PF-S21-T92](sprints/PF-S21/tasks/PF-S21-T92.md) | Revalidate the integrated sprint and authorize successors | VALIDATION / revalidation | PF-S21-T91 |
