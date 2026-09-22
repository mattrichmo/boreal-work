# PF-S13-T02 bounded contribution review — evidence

## Observed implementation

The init path in `crates/cli/src/main.rs` now:

- resolves the setup project root;
- creates/opens the project database and initializes the project;
- canonicalizes the resolved workspace root;
- creates a `WorkspaceBinding` whose root and worktree are that canonical
  directory;
- derives a binding digest; and
- calls `IdentityStore::bind_project` after setup succeeds.

The dashboard path in `crates/cli/src/dashboard.rs` now:

- requires local project metadata for the default database route;
- canonicalizes the metadata project root and current directory;
- rejects copied metadata whose root is not the current project;
- canonicalizes the selected database before checking its location;
- rejects a default database that resolves outside the canonical project root;
- requires `--project` when an explicit `--db` is used alongside ambient
  metadata; and
- reports an actionable `bwrk init` message for an uninitialized directory.

The seven focused tests passed, including:

- fresh init and repeat-init behavior;
- uninitialized dashboard guidance;
- two independent roots using the same project identifier;
- copied metadata rejection;
- a database symlink escape after resolution; and
- the existing dashboard process supervision path.

## Findings

### Bounded slice: partially correct

The path and metadata protections are directionally correct and the focused
tests provide useful evidence for the covered cases. The canonical binding
call is also present on the successful init path.

### Limitation 1 — stored binding is not enforced by dashboard selection

`run_dashboard` opens the selected database and resolves a project by listing
database project IDs. The reviewed dashboard path does not read or validate
`IdentityStore::context`/`workspace_binding` before returning status or
launching the private service. Therefore the focused tests prove metadata and
path confinement, but do not prove that a database bound to another canonical
workspace is rejected when metadata is rewritten or otherwise made internally
consistent. The service/store identity seam still needs to become an
authoritative selection check.

### Limitation 2 — init can leave filesystem changes when binding fails

The current order calls `setup::apply(plan)` before
`bind_project_workspace(...)`. A workspace-binding conflict or identity
failure can therefore occur after project setup files have been created or
updated. The task card requires precise committed outcomes and safe repeated
initialization; the integration should either bind before applying mutable
setup, or provide an explicit compensating/atomic boundary and test the
failure outcome.

### Limitation 3 — error classification is too broad

`bind_project_workspace` maps all `IdentityStore::bind_project` failures to
`OperationConflict`. Project-not-found, missing/uninstalled database identity,
corrupt identity data, and an actual workspace conflict do not have the same
operator recovery path. The full task's stable machine outcomes require these
cases to remain distinguishable.

### Limitation 4 — test coverage does not assert the new identity record

`project_setup.rs` verifies files and repeat-init output, but does not assert
that a successful init creates a readable project workspace identity or that
re-init with a different canonical root is rejected without an unintended
mutation. The dashboard tests exercise path/metadata checks, not stored
identity readback.

### Full task status

PF-S13-T02 must remain `not_started`/unaccepted (or explicitly rejected by
the coordinator if this contribution is recorded as an attempted task).
This review does not accept the task. The full task still lacks, or does not
yet provide evidence for, the public project/info/select/rebind commands,
actor/session operations, authenticated principal/role enforcement,
machine/human parity across all outcomes, and the required wrong-principal,
stale-context, repeated-init, copied-metadata, Unicode/path, and explicit
selector matrix at the actual integrated source identity.
