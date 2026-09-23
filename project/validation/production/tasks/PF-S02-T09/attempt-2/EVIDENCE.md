# PF-S02-T09 attempt-2 — evidence record

## Result

The production bootstrap boundary is implemented as a shared store primitive
and wired through the application and direct CLI init path. The focused
bootstrap and identity-boundary tests pass. Full CLI execution now compiles
and reaches the suites, but the combined tree is not fully green because an
unrelated concurrent `production_backup_restore` test fails to open its
database package; that failure is retained rather than attributed to this
bootstrap lane.

## Transaction semantics

`SqliteStore::initialize_project_with_workspace` requires the canonical
production schema and opens `BEGIN IMMEDIATE`. On a fresh project it performs,
in the same transaction:

1. actor/profile prerequisite checks;
2. project row creation;
3. canonical database/workspace identity binding, after rechecking the
   expected database instance and restore epoch inside the transaction;
4. identity-bound `project.init` operation and audit insertion; and
5. operation revision allocation and readback.

Any error before `COMMIT` rolls back the project row, workspace binding,
operation row, audit row, and operation-identity row together. The focused
rollback test removes the operation-identity seam before the append and
confirms that no project or operation remains.

## Replay semantics

An existing operation is replayed only after all of these checks succeed:

- operation ID, project, command, actor, empty session/attempt/fence fields,
  and request digest match exactly;
- the stored workspace binding equals the requested binding;
- the database instance and restore epoch are current; and
- the identity-bound operation journal returns a valid operation/audit
  readback.

An operation with no stored workspace identity is rejected as an incomplete
bootstrap. An existing project without a replayable `project.init` operation
is also rejected. The primitive never turns either condition into a
binding-only repair or manufactures a second initialization history.

If `COMMIT` itself returns an error, the outcome is intentionally treated as
ambiguous. The caller must resolve the original operation ID through the
identity-bound readback before retrying; it must not blindly issue a new
operation.

## Focused observations

- Fresh production bootstrap binds the workspace before the identity-bound
  `project.init` operation can be committed.
- An identical retry returns the original revision with `replayed = true`.
- Reusing the operation for a different workspace is rejected.
- A failure before commit leaves no project or operation residue.
- Repeating `init` with a fresh operation ID returns unchanged only after the
  original identity-bound `project.init` can be read back.
- The prior negative test still confirms that unbound canonical operation
  writes fail closed.

## Limitations

The SQLite transaction does not include filesystem writes performed by the
CLI setup adapter. Project setup files can therefore require ordinary
filesystem recovery if setup is interrupted after the database transaction;
the database cannot claim an unbound project, but it also cannot roll back
external files. Existing databases created by the old compatibility sequence
may still contain an unbound project/init operation; this primitive rejects
those rows and requires a separately reviewed migration or quarantine path.

Authentication of the caller-supplied actor identity, verifier-job admission,
backup/restore, and the remaining PF-S02/PF-S04 findings are outside this
bootstrap leaf.
