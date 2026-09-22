# PF-S13-T02 independent review — evidence

## Bounded behavior confirmed

The reviewed dashboard path now performs stored identity validation after opening
the selected database and resolving the project, before either JSON status output
or interactive dashboard launch. The focused tests demonstrate:

- an uninitialized directory receives actionable `bwrk init` guidance;
- two independent roots may use overlapping project identifiers without sharing
  dashboard selection;
- copied metadata is rejected when it is not bound to the current root;
- a copied database with rewritten, plausible metadata is rejected because its
  stored workspace binding still points at the original root;
- a database symlink resolving outside the local project is rejected; and
- the existing managed service/TUI launcher behavior still passes its focused
  integration checks.

The implementation uses the existing `IdentityStore` boundary rather than reading
the canonical database from the TUI. That is consistent with the v2 architecture.

## Residual findings

### 1. Initialization binding is not failure-atomic — release-blocking for the full task

The coordinator-context code in `main.rs` performs project initialization, optional
filesystem setup, workspace binding, and operation-context recording as separate
steps. A setup failure after the database mutation, a binding failure after setup,
or an operation-context recording failure after `bind_project` can leave a project
partially initialized. The next dashboard invocation then correctly quarantines the
project, but the user is left with a repair-required partial state rather than an
atomic initialization result.

This is outside the reviewed dashboard files, but it prevents the full PF-S13-T02
task from being accepted. The coordinator must provide an explicit recovery/rebind
path or a failure-atomic initialization workflow with durable readback.

### 2. Error mapping is not yet uniformly precise — follow-up required

`validate_dashboard_identity` distinguishes a small set of `IdentityError` variants,
but maps the remaining variants to `OperationConflict`; the workspace-binding lookup
maps every error to `OperationConflict`. The init binding helper in `main.rs` also
maps all identity failures to one conflict outcome. Store-unavailable, missing
identity, invalid data, foreign identity, and workspace conflict should retain
stable typed CLI outcomes and actionable remediation without exposing sensitive rows.

The current messages are useful for the tested cases, but the complete public
identity contract is not yet demonstrated for all error classes.

### 3. Explicit cross-root selection needs a policy decision and regression coverage

When ambient metadata exists, the dashboard identity comparison uses the metadata's
project root even when an explicit `--db PATH --project PROJECT` pair is supplied.
That safely prevents accidental cross-project leakage, but the focused suite does
not establish whether an intentionally selected, separately bound project should be
allowed from that directory or rejected. Add an explicit test and document the
chosen rule. In either case, the selected database/project pair must be checked
against its own stored binding rather than relying on an ambient project context.

### 4. Full project/identity/actor/session parity is absent

The task card requires public init/info/select/rebind and supported authority/session
operations, authenticated actor/session handling, machine/human parity, and wrong-
principal rejection. The bounded dashboard change only validates an existing stored
identity; it does not implement or certify those command surfaces. No full
`production_project_cli` target or equivalent command-parity evidence was reviewed.

### 5. Exact-tree and release limits

The three requested gates pass on the current combined working tree, but the tree is
dirty and contains unrelated changes. This review does not establish a reproducible
release artifact, installed binary identity, real service lifecycle behavior, or
platform smoke coverage. Those remain required by the task's acceptance chain.

## Review conclusion

The bounded dashboard identity-hardening contribution is technically acceptable as
an incremental slice: the intended selector quarantine behavior is present and its
focused tests pass. It is not acceptance of PF-S13-T02, its parent sprint, or any
release claim.
