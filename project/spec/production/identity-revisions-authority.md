# Boreal identity, revision, operation, and authority contract

**Contract status:** proposed PF-S01-T02 artifact; subject to PF-S01 review,
reconciliation, and revalidation.

## Identity layers

Every request carries enough context to prove what namespace, snapshot,
principal, and execution authority it is using. These identities are related
but never interchangeable.

| Identity | Meaning | Lifetime / invalidation |
| --- | --- | --- |
| `project_id` | Stable project namespace and policy boundary | Persists across moves/restores only through an explicit rebind/restore outcome. |
| workspace binding | Canonical project root and allowed worktree/resource boundary | A moved or cloned root needs explicit rebind/new identity; symlink and `..` escapes are rejected after canonical resolution. |
| database instance / restore epoch | One canonical operational database lineage | Changes on restore/replacement; stale clients and operations cannot cross the epoch. |
| service instance | The elected local service process serving a project | Changes on restart; restart alone does not grant or rewrite persisted ownership. |
| authenticated principal | Credential-backed actor identity | Role changes, revocation, and delegation are durable/audited; a request's actor string is not proof of identity. |
| actor role | `agent`, `reviewer`, `operator`, or `publisher` capability class | Resolved from authenticated enrollment/delegation at authorization time; caller-supplied role is advisory input only. |
| session | One bounded harness execution context for a principal/project | Must be registered and current for execution; one current execution per session. |
| delegation | Explicit, scoped authority granted by an authorized principal | Bound to project, action/scope, target, revision, expiry, and audit identity; never inferred from a session name. |
| attempt/fence | One execution ownership episode and its monotonic write fence | Claim creates it; replacement/expiry/release fences the old writer. |
| operation ID | Idempotency/readback identity for one request payload | One project/epoch-scoped immutable request digest; reuse with changed input is a conflict. |

Project display name, title, actor label, session label, database path, and
service socket path are not portable authority identities. The application
must validate project scope before returning data or performing a mutation.

## Revision vocabulary

Revision checks answer different questions and must not be collapsed into one
counter:

| Revision | Protects | Changes when |
| --- | --- | --- |
| Project snapshot revision | A read/report/pagination view and its cross-row consistency | Any committed project-visible mutation that changes the returned snapshot. |
| Entity revision | Optimistic edit of one project entity | That entity is edited or its authoritative lifecycle/relationship changes. |
| Proof-relevant revision | Whether a receipt, review, summary, or close intent still describes the current subject | Work inputs, source/configuration, profile/gate policy, dependency/hold impact, or proof context changes. |
| Attempt fence | Whether this execution owner may write | Every valid replacement/recovery transition increments or replaces the fence; old fences never regain authority. |
| Database restore epoch | Whether an operation/client belongs to the current database lineage | Restore, replacement, or explicit database identity reset. |
| Service instance identity | Connection/restart provenance and subscriptions | Service process restarts or a new owner is elected. It does not by itself invalidate persisted work. |

An unrelated heartbeat must not invalidate a planning edit or review
confirmation merely because a global project counter moved. Every committing
transaction nevertheless rereads the relevant canonical facts, verifies the
requested entity/proof/fence preconditions, and emits the resulting revision
and audit event together.

## Authentication, roles, and threat boundary

Bootstrap may create the initial project and enrollment authority, but a
caller-provided actor ID/role/credential reference is not authentication.
Existing-project initialization must not silently re-enroll an actor or grant
privilege. Normal operation resolves the principal from the local credential
boundary, then applies stored role/delegation policy inside the application.

- Agents may act only on their own eligible attempt and declared agent
  operations. They cannot perform operator cancellation/override, independent
  review, or publisher actions by changing a CLI flag.
- Reviewers must be independent of the attempt actor under authenticated
  principal/delegation identity, not merely a different session string.
- Operators may perform reasoned holds, recovery, cancellation, and narrowly
  scoped exceptions. They cannot erase failed evidence or turn an exception
  into a fabricated receipt.
- Publishers may publish an explicitly authorized memory/software artifact at
  a named revision/digest. Publication cannot mutate live work status or
  satisfy a gate by implication.

The initial threat model covers accidental and policy-violating local agents,
foreign project paths, stale clients, reused sessions, forged actor text,
symlink/path escapes, and concurrent same-host processes. It does not claim
tamper-proof protection from a same-user process that can rewrite the SQLite
file, replace the installed binary, or read every local credential. That
limit is visible and must not be hidden by application role lookup.

Credential lifecycle is part of the authority boundary, not a bootstrap
convenience:

- The bootstrap creator receives a one-time enrollment capability and may
  enroll the initial principal only. A caller-supplied `actor_id`, role, or
  credential reference is metadata until it is bound to that enrollment
  capability; re-running initialization against an existing project cannot
  re-enroll or elevate anyone.
- An operator may provision or rotate an agent/reviewer/operator credential
  only through an authenticated, project-scoped operation naming the principal,
  role, validity interval, and credential digest. The store records the
  enrollment/rotation event and invalidates the prior credential at the
  requested effective revision; it never edits historical actor attribution.
- Revocation requires operator authority (or the bootstrap recovery authority
  before normal enrollment exists), a reason, target principal/credential,
  effective time, and operation ID. Revocation immediately prevents new
  claims, reviews, overrides, and publication under that credential and
  fences its active sessions/attempts through the normal recovery path.
- Rotation preserves the principal identity but creates a new credential
  generation. In-flight operations retain their original authenticated
  context for readback, while any mutation requiring a fresh authorization is
  denied after revocation/expiry. Provisioning, rotation, and revocation are
  auditable and read back with the same operation outcome rules below.

## Operation identity and outcomes

Every mutating endpoint requires an authenticated caller context and a stable
operation ID. The server stores the canonical request digest, project/epoch
scope, actor/session context, command identity, timestamps, and durable outcome
metadata before or atomically with the mutation boundary.

The public operation envelope remains authoritative. `INTERFACES.md` names
the transport-level outcomes `changed`, `unchanged`, `rejected`, `conflict`,
`busy`, `failed`, and `unknown`. This contract uses the following durable
semantic mapping so domain language cannot create a second wire vocabulary:

| Durable semantic result | Public envelope result | Meaning / retry behavior |
| --- | --- | --- |
| `committed` | `changed` | The requested durable mutation and audit event committed; repeating the same ID and identical digest returns the original outcome. |
| `committed` with no state delta | `unchanged` | The idempotent request was already reflected in the canonical state; no second mutation is emitted. |
| `rejected` | `rejected` | Validation, authority, revision, proof, or policy denied the request; change the bounded input or satisfy the named condition. |
| payload/project/epoch mismatch | `conflict` | The operation ID or expected revision was reused for different input; never reinterpret it as a retry. |
| `pending` | `busy` | A durable external job or service operation is registered but not finished; poll/read back the same operation rather than launching a duplicate. |
| terminal execution/system failure | `failed` | The operation durably failed without asserting the requested success; preserve diagnostic and recovery records. |
| `unknown` or expired readback window | `unknown` | Transport ended before commit was known, or retention/deadline prevents a definitive answer; read back by original operation ID and do not invent failure or success. |

The service may expose the durable semantic label in an additive diagnostic
field, but clients must branch on the public envelope result. `not_found` is
definitive only after registration/retention proves the operation cannot still
commit; otherwise it remains `busy`/`unknown` with a readback route.

Reusing an operation ID with a different payload, project, epoch, or command is
a typed conflict. A `not_found` readback is definitive only after the server
has established that registration/retention for that operation cannot still
commit; before that point the response must be `unknown` or `pending` with a
readback route. Operation results are project-scoped and bounded; untrusted
payloads cannot flood the audit log or inline envelope.

External commands, process termination, Git operations, and network/package
work run outside the SQLite committing transaction. They use a durable job or
operation record, explicit timeout/unknown semantics, and idempotent
readback/reconciliation.

## Wrong-context and stale cases

The public contract distinguishes these cases instead of returning a generic
“invalid” or silently selecting another project:

| Case | Required result |
| --- | --- |
| Foreign project/work ID or stale local metadata | `not_found`/isolation error with no cross-project data or mutation. |
| Caller actor does not own the authenticated principal | authority denial; no role lookup can repair it. |
| Same principal uses a second session to self-review | independent-review denial when the profile requires independence. |
| Entity revision is stale | revision conflict with current readback reference; no partial edit. |
| Proof-relevant revision changed | stale-proof/close-intent invalidation; prior receipt/review remains historical. |
| Attempt fence is stale or foreign | stale-fence denial; old process cannot advance or close work. |
| Database restore epoch differs | restore/incompatibility error; operation must be read back in the current lineage. |
| Workspace path resolves outside the bound root | isolation failure after canonicalization; no database target is opened. |
| Service owner is live | connect to the owner or return typed busy/unavailable; never force-break the lock. |

## Compatibility and baseline discrepancy

The versioned envelope remains additive and readable by existing clients. New
identity, outcome, and action fields must be optional/additive until their
consumer contract is frozen. The current v2 source has partial role/bootstrap,
revision, and operation plumbing; the full authentication boundary, restore
epoch, durable job set, and native project-isolation matrix remain later
implementation/acceptance work. This document is the contract target, not a
claim that every listed invariant already exists.

The baseline discrepancies have explicit owners and gates:

| Discrepancy | Owner | Required evidence |
| --- | --- | --- |
| Caller-supplied bootstrap actor/role/credential is not authentication | PF-S01-T04 / PF-S01-T11 | Enrollment, rotation, revocation, impersonation, and restart fixtures; S02 identity gate |
| Project/entity/proof revisions are not yet separated on every mutation | PF-S01-T05 / PF-S01-T11 | Revision/fence race matrix and protocol readback fixtures |
| Operation records do not yet cover every external job and unknown outcome | PF-S01-T06 / PF-S02 | Duplicate/timeout/interrupted-before-and-after-commit fixtures |
| Restore epoch and canonical path binding are incomplete | PF-S01-T04 / PF-S02 | Move, clone, symlink, `..`, restore, and late-response isolation fixtures |

These owners are implementation responsibility, not a claim of completion.

## Decision traceability

This artifact consumes D01–D07, D13–D17, D20, D22, D24, D26, and D27–D29.
The D08–D12 core constraints are accounted for explicitly: D08 keeps the v2
identity boundary standalone from the legacy repository; D09 keeps guided
`guide`/`next`, trusted directives, and evidence-driven claim/finish in the
authority contract; D10 requires a visible keep/rework/defer parity
disposition; D11 makes status/action derivation deterministic and forbids
agent-asserted success; and D12 requires expiry to fence the old attempt while
preserving safe recovery. D18, D19, D21, D23, and D25 compatibility/parity
impacts are tracked as explicit later gates rather than silently omitted. It
preserves the accepted Rust/store/application ownership, one claim/attempt
protocol, transactional history, local same-host boundary, role classes,
attempt/session cardinality, distinct lease/budget clocks, proof-gated close,
project-scoped memory, and explicit review/launch limits. The bootstrap and
mutation discrepancies are owned by PF-S01-T04/T05/T06/T11 and their
associated S02 acceptance gates above. Later PF-S01 tasks own the final
protocol field set, security budgets, profiles, and migration fixtures; they
may refine details only through a versioned reviewed decision.
