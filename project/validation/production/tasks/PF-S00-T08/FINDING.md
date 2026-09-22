# Finding

Finding ID / producing task and review attempt: `F-S00-WORKFLOW-001` / `PF-S00-T92 attempt 4`

Source identity / file and exact symbol/range: current dirty tree at
`HEAD:784a41b3`; `crates/application/src/workflow_assets.rs` (embedded
registry), `crates/cli/src/main.rs` (`run_with_operation` and `dispatch`),
`crates/cli/src/command_registry.rs` (registry/gaps), and
`crates/cli/src/service.rs` (`supports` and handler dispatch).

Severity and concrete impact: **release blocker for the S00 gate**. The
required supported audit workflow cannot produce an attributable receipt. The
running dashboard owner additionally returns `service_busy`, but releasing
that owner alone still leaves the route unavailable.

Affected contract/acceptance row: PF-S00-T92 audit-workflow-resolver;
workflow-discovery requirement recorded in the original M02 parity plan.

Observed behavior / expected rule: the direct probe attempts the database
owner path and returns retryable `service_busy` while PID 68913 owns the
database; the service-socket route returns `unknown_command_namespace`; the
installed command registry reports no workflow entries. Expected behavior is
that list/show are deterministic read-only routes sourced from the embedded
versioned workflow package and do not require a project database.

Reproduction commands, inputs, raw evidence and result:

```text
bwrk workflows show boreal.workflow.audit.v1 --json
direct: exit 6 / service_busy / owner process 68913
socket: unknown_command_namespace
bwrk commands --json
installed registry: workflow_entries []
```

Evidence limits (source-only versus reproduced): the missing route is
source- and installed-binary-confirmed; the owner identity and busy response
were reproduced through the supported application path. No SQLite inspection,
synthetic receipt, or force-break was used.

Project/authority/proof/history/resource implications: workflow assets guide
agents but cannot authorize lifecycle transitions. The remediation must remain
project-independent, preserve the v2 Rust authority boundary, and avoid all
database or receipt mutation.

Proposed bounded corrective owner/task/write set: PF-S00-T08, one
interface-owned worker, with the exact paths in
`PF-S00-T08/CHANGE_REQUEST.md`; then T91 reconciliation and a fresh T92
revalidation.

Required negative/regression/native reruns: unknown reference and malformed
package failures; direct no-database invocation; service/direct parity;
workflow package validator; CLI registry/help; Rust compilation and tests if
the toolchain is available. Native/release checks are not claimed by this
remediation.

Disposition: unresolved / fixed / justified-no_change / approved-optional-defer:
**unresolved — remediation authorized, not yet implemented**.

Disposition approver/evidence/follow-up: coordinator approval in
`CHANGE_REQUEST.md`; independent implementation review and T91/T92 evidence
are required before any successor authorization.

