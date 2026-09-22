# Local service, envelope, external-job, and readback contract

**Contract:** `boreal.service/2`
**Status:** proposed PF-S01-T08 artifact; target contract only.

## One versioned service boundary

The Rust local service is the sole active policy owner for CLI, TUI, agent
harness, and maintenance adapters. A client does not read SQLite or invent a
second transition engine. Offline maintenance uses the same application rules
behind an exclusive maintenance boundary. One project service is elected;
clients connect to the owner or receive typed `busy`/`unavailable`, never
force-break a live lock.

Every request and response uses the existing envelope fields:

```text
api_version, schema_version, operation_id, revision, as_of,
next_status_change_at, transport, outcome, data, detail_ref, error
```

`outcome` is exactly `changed`, `unchanged`, `rejected`, `conflict`, `busy`,
`failed`, or `unknown`. `transport=ok` means the request was decoded and an
application result is present; it does not imply a successful mutation.
`revision` is the canonical project snapshot revision or null when no project
revision was observed. `as_of` and `next_status_change_at` come from the same
authoritative service/store clock.

## Public route/use-case families

Every intended route maps to one Rust application use case and a typed schema;
aliases may map to the same use case but never to a second policy path.

| Route family | Application use case | Required response |
| --- | --- | --- |
| project health/identity/init | establish/rebind project and service context | project identity, binding, restore epoch, capability, health |
| `commands` / `prime` | command registry and project snapshot guide | typed command list, prime snapshot, revision, availability/integrity |
| `setup` / `init` | project setup and identity establishment | setup choices/result, project identity, binding, restore epoch |
| `dashboard` | dashboard snapshot subscription/read | bounded project snapshot, counts, status/reasons, diagnostics |
| `doctor` | health/maintenance diagnostics | service/database/context health and safe recovery actions |
| snapshot/status/list/search | revision-consistent read | snapshot revision, bounded page/cursor, counts, statuses/reasons, integrity/availability |
| plan/work/milestone/cycle/dependency | planning mutation/readiness | entity revision, graph/readiness report, action descriptors |
| claim/accept/start/heartbeat/checkpoint | fenced attempt lifecycle | attempt/session/fence, lease/hard deadlines, operation readback |
| evidence/verify/submit/review/finish | proof and closeout | requirement/gap/receipt/review/submission state and exact next action |
| release/fail/expire/recover/reopen/override | recovery and operator decision | impact preview, durable obligation/decision, audit/readback |
| guide/next/workflows/directives | trusted guidance discovery | versioned workflow/directive reference, argv/cwd, `shell:false`, required inputs |
| operation readback/audit/diagnostics | unknown-result and history resolution | original outcome, digest, revision, scope, retry instructions |
| source/memory/publish/backup/restore | project context and external jobs | source/memory/job state, digest, Git/backup readback, reconciliation state |
| `raw add/list/show/triage` | project-scoped raw intake | source/version/digest, parser state, citation and retention state |
| `source add/list/show` | immutable source registry | project-scoped source identity/version/provenance |
| `context show/search/rebuild` | bounded context projection | canonical revision, citations, stale/rebuild diagnostics |
| `search query/index` | project-scoped search/read-model use case | query digest, page cursor, source revision, exact/partial totals |
| `decision create/list/show/supersede` | append-only operator/memory decision | decision identity, target revision, scope, audit/readback |
| `sync status/refresh` | service/context synchronization job | operation/job state, source/DB/Git revisions, unknown readback |

Action descriptors are server-produced and include target, expected revisions,
actor/role, attempt/fence when required, input schema, confirmation text,
runner, argv, cwd, and whether the action is recovery/read-only. Work text,
source content, summaries, and raw memory are data and never become trusted
commands.

## Mutation, unknown outcome, and retry rules

Before a mutation commits, the application authenticates the operation
context, opens the project transaction, re-reads canonical facts, evaluates
the action, checks operation ID/digest, entity/project/proof revision and
attempt fence, writes the outcome/audit event, and commits. Candidate lists and
TUI affordances are hints only. External process/Git/package work is outside
the transaction.

The operation record is registered before an external side effect and contains
project/restore epoch, command, actor/session, subject, request digest,
expected revision, and stage. Repeating the same operation ID and digest
returns the same result. Reusing it with another payload is `conflict`.

| Situation | Envelope outcome | Required client behavior |
| --- | --- | --- |
| mutation committed | `changed` | use returned revision/readback |
| idempotent no-op | `unchanged` | do not duplicate side effect |
| validation/authority/proof denial | `rejected` | follow typed recovery; do not blind replay |
| stale revision, fence, payload, project, or epoch | `conflict` or typed `rejected` | resnapshot or read current attempt; no partial mutation |
| bounded writer/service capacity | `busy` | retry same operation ID after `retry_after_ms` |
| durable execution failure | `failed` | inspect retained diagnostics/recovery obligation |
| transport interruption before result | `unknown` | read original operation by ID/digest before any retry |

`not_found` is definitive only after registration/retention proves the
operation cannot still commit. Otherwise readback remains `busy`/`unknown`.
Timeout is never normalized to rejected or failed without authoritative
readback.

## External jobs and side-effect stages

Verifier execution, Git publication, backup/restore, package/update
activation, and process stop use a durable external-job record:

```text
job_id, operation_id, project_id, subject, kind, request_digest,
stage, side_effect_ref, source/config identity, actor/session,
started_at, deadline, result_digest, reconciliation_state, error
```

Stages are `registered`, `admitted`, `running`, `side_effect_started`,
`side_effect_finished`, `readback_required`, `committed`, `rejected`,
`failed`, `cancel_requested`, and `reconciled`. A crash after the side effect
but before the database response becomes `readback_required`, not a duplicate
job. The reconciler compares the side-effect identity/digest and appends the
actual result. External work cannot hold the SQLite writer transaction open.

Verifier jobs bind command/argv/cwd, source snapshot, configuration,
acceptance profile, output/artifact digest, executor attestation, and gate.
Publication jobs bind expected Git parent and resulting commit. Backup jobs
bind database restore epoch, referenced blobs, memory commit, and manifest.
Update activation binds binary/assets manifest and compatibility range.

## Reads, pagination, subscriptions, and maintenance

Reads use one snapshot revision. Pages carry cursor, query digest, revision,
returned count, exact/partial totals, and a continuation token. Search states
whether it covers the full project or only the loaded page. Routine responses
target 2–8 KiB for three active agents, cap inline items/requirements/reasons,
and use a digest-bound `detail_ref` above the inline size bound.

Subscriptions report revision and affected subject IDs with a bounded replay
cursor. A gap, reconnect, project switch, or incompatible event requires a
fresh snapshot; clients do not apply speculative local patches. A TUI late
response from a former project is discarded by project/epoch/request context.

Maintenance mode is exclusive with the elected service and advertises a
typed state. Service election, socket/path permissions, liveness, and shutdown
are operational concerns; lifecycle decisions remain in application/domain
transactions. A live lock is never force-broken as normal recovery.

## Compatibility, diagnostics, and baseline

Unknown enum values, envelope versions, error codes, action runners, or
required fields fail closed as `protocol_mismatch`; they are not silently
coerced. Unknown additive fields are ignored after validation and never
interpreted as policy. Diagnostics include raw typed code, safe message key,
detail reference, retryability, and recovery route; raw SQL/receipt blobs stay
in advanced diagnostics.

The authoritative corruption/quarantine error is the following required
addition to `project/spec/protocol/error-registry.json`, to be integrated by
PF-S01-T11 before a client can perform forward-progress writes:

```json
{
  "code": "integrity_quarantined",
  "outcome": "rejected",
  "exit_class": "blocked",
  "retryable": false,
  "message": "Canonical facts for this scope are quarantined and require repair.",
  "recovery": "inspect_integrity_diagnostics"
}
```

The envelope for a quarantined scope is `transport=ok`, `outcome=rejected`,
`revision` equal to the trusted snapshot when available, `error.code` set to
`integrity_quarantined`, `data.integrity=quarantined`, and only diagnostics,
export, repair, or authorized recovery action descriptors. If no trusted
project revision exists, `revision=null` and the response is a bounded
protocol/identity failure; it never becomes normal `not_found` or success.

The current protocol manifest is `protocol_version=2` with envelope/schema
versions listed in `project/spec/protocol/protocol-manifest.json`. This
contract proposes additive status/3, cycle/1, acceptance/2, service/2, and
job/readback fields behind capability negotiation; it does not claim the
current DTOs already implement them. PF-S01-T11 owns manifest integration;
PF-S02 owns service/store implementation and real-service race/fault tests.

## Conformance and traceability

Required vectors cover every route/use-case mapping, unknown outcome before and
after commit, duplicate operation, payload conflict, writer busy, stale
revision/fence/epoch, side-effect crash/reconciliation, pagination snapshot,
subscription gap, project switch/late response, maintenance election, unknown
enum, N/N-1 compatibility, bounded response, and service unavailable/offline
recovery. Evidence must name the exact source, schema, service binary,
operation ID, request digest, response/readback, and artifact manifest.

This contract consumes D01–D07, D09–D18, D20–D29, INTERFACES.md, the protocol
and error registries, and the accepted identity/status/profile/dependency
contracts. Any change to envelope outcome, retry/unknown semantics,
capability negotiation, or external-job stages requires a reviewed versioned
decision and fixture update.
