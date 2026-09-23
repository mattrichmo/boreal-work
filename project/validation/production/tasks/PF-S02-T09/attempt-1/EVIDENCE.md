# Evidence record

Record: `PF-S02-T09 / attempt-1 / production-schema-path-remediation`

Evidence class: CLI/service/dashboard source integration with controlled
negative identity-boundary regression.

Input source: `HEAD 3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9` plus the three owned
uncommitted source files fingerprinted in `COMMANDS.md`.

## Observed behavior

| Case | Expected assertion | Observed result |
| --- | --- | --- |
| Direct post-init work route | The route opens the exact production schema and rejects a project whose workspace binding is removed. | Passed in `shipped_post_init_routes_require_canonical_project_binding`; `ClaimConflict` with workspace-binding diagnostic. |
| Service-host startup and concurrent request handling | Every production worker connection uses the exact production schema. | Covered by the existing production composition, timer, recovery, and socket-route tests; all passed in the CLI suite. |
| Dashboard store open | Dashboard reads use the exact production schema before identity validation. | Covered by the dashboard launcher/isolation suite; all six tests passed. |
| Explicit compatibility fixtures | Legacy schema remains available only in labeled in-process fixture helpers. | Passed; service legacy fixture tests continue to pass. |
| Fresh production `project.init` | Project identity must be bound before the project operation/audit is committed. | **Failed as expected** in the ignored regression. The current store/application API rejects the operation before the CLI can bind the new project. |

## Interpretation

The shipped post-init schema bypass is remediated. The bootstrap P1 is not
resolved. `IdentityStore::bind_project` requires an existing project row, while
`SqliteStore::initialize_project` creates that row and appends `project.init`
inside its own transaction. The CLI cannot safely interpose a binding between
those steps without duplicating lifecycle logic or adding a non-atomic side
effect. The required fix belongs in a shared store/application bootstrap
boundary.

Replay classification: if the process stops after `initialize_project` but
before `bind_project_workspace`, a second `init` sees the existing project and
returns the existing-project/replayed branch. The CLI then passes no operation
ID to the binding helper, so the workspace can become bound while the original
`project.init` operation still lacks its identity-context row. This is an
unresolved replay/readback gap, not a successful recovery.

No runtime service, release, or production-package claim is made by this
evidence. The negative regression is retained rather than converted into a
passing compatibility assertion.
