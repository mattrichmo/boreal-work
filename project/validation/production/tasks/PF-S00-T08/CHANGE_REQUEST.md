# Bounded plan / write-boundary change request

Request ID / source task / plan version: `CR-PF-S00-WORKFLOW-001` / `PF-S00-T92 attempt 4` / production-completion v1

Why existing scope is insufficient: the T92 gate requires the supported
`bwrk workflows show boreal.workflow.audit.v1 --json` probe, but the current
source has embedded workflow assets without a public application, CLI, or
service read route. Waiting for the current database owner to exit will remove
the `service_busy` ambiguity but cannot make an unimplemented namespace work.

New invariant/finding and source evidence: workflow discovery must be a
read-only, versioned application capability backed by the embedded package;
it must not open the project database, read the working tree at runtime,
mutate lifecycle state, or authorize an operation. Evidence is recorded in
`PF-S00-T92 attempt 4`, and the missing route is visible in
`crates/application/src/workflow_assets.rs`, `crates/cli/src/main.rs`,
`crates/cli/src/command_registry.rs`, and `crates/cli/src/service.rs`.

Requested task ID(s), prerequisites and successor gates: add `PF-S00-T08`
with `kind: remediation`, depending on accepted `PF-S00-T90` but not on T91
or T92. Add it to the PF-S00 reconciliation prerequisites. T91 must be
re-run after this remediation; T92 remains blocked until the new T91/T92
evidence accepts the exact resulting tree. PF-S01 remains locked.

Exact proposed worker paths / shared integration paths:

- `crates/application/src/workflow_assets.rs`
- `crates/application/src/lib.rs`
- `crates/protocol/src/models.rs`
- `crates/cli/src/command_registry.rs`
- `crates/cli/src/main.rs`
- `crates/cli/src/service.rs`
- focused application, CLI, service, and workflow validation tests
- `project/validation/production/tasks/PF-S00-T08/attempt-<N>/`

The CLI registry, `main.rs`, `service.rs`, and protocol models are protected
shared files. One interface-owned worker must apply the combined patch
serially; no parallel worker may edit those files.

Contract/schema/protocol/migration/release impact: add typed read DTOs and
reuse the existing v2 envelope. No SQLite schema, migration, domain
transition, project identity, receipt, or release layout changes. The
installed binary must be rebuilt before runtime acceptance.

Conflict check and independent reviewer: coordinator-owned path allocation;
independent reviewer must be distinct from the implementation agent and the
prior T90/T91 agents. Required conflict checks are the plan helper output plus
the protected-file review in `execution/SHARED_FILES.md`.

Required acceptance cases and evidence layer:

1. `bwrk workflows list --json` succeeds without a database.
2. `bwrk workflows show boreal.workflow.audit.v1 --json` succeeds without a
   database owner and returns the embedded package identity.
3. Unknown references fail closed with a typed not-found result.
4. `commands --json` and `help workflows --json` advertise both routes.
5. Service-socket list/show responses match direct responses.
6. Existing workflow package validation and focused application/CLI/service
   tests run on the exact combined tree; unavailable toolchains remain
   explicitly blocked.
7. A new T92 attempt records raw responses, source identity, runtime/binary
   identity, and the successful audit receipt before authorizing successors.

Existing attempts/history preserved: T92 attempts 1–4, T90/T91 records, and
the current blocked ledger entry remain unchanged. This request adds a
remediation path; it does not convert a blocked or historical record into an
acceptance.

Scope/authority approval: **Coordinator-approved for bounded remediation**
under the user's production-completion objective. This approval authorizes
only the listed read-only workflow-discovery boundary and its evidence. It is
not product, service, release, or T92 acceptance; the graph and ledger must
be updated before dispatch, and independent review remains mandatory.

