# Protected shared files and integration ownership

Treat each listed file as a whole-file resource. Two workers must not edit
different lines of the same file at the same time. The task packet's owned
paths provide exclusive access for that task; when another task needs one of
these files, the coordinator serializes the patch through the named steward.

The sprint coordinator names a person or agent for each role before dispatch.
Role names describe responsibility, not permission to expand a task's write
boundary. `T90` integrates the sprint after leaf handoffs; it does not silently
take ownership of implementation work.

| Protected resource | Steward responsibility |
| --- | --- |
| `crates/cli/src/main.rs`, `crates/cli/src/service.rs`, `crates/cli/src/global_service.rs` | CLI and host integration; serialize command/service wiring and startup changes. |
| `crates/cli/src/command_registry.rs`, `crates/cli/src/global_commands.rs`, `crates/cli/src/global_discovery.rs`, `crates/cli/src/global_send.rs` | CLI interface integration; reconcile command registration, discovery, and Global/project bridges. |
| `crates/cli/src/recovery_commands.rs`, `crates/cli/src/dashboard.rs`, `crates/cli/src/global_dashboard.rs`, `crates/cli/src/machine_update.rs`, `crates/cli/src/update.rs` | CLI execution and host-runtime steward; serialize recovery, dashboard, update, and machine-lifecycle route changes. |
| `crates/application/src/runtime.rs`, `crates/application/src/intake.rs` | Project application steward; coordinate attempt/recovery changes with typed Intake and general-work planning use cases. |
| `crates/application/src/global_manager.rs`, `crates/application/src/global_manager_recovery.rs`, `crates/application/src/global_manager_attention.rs`, `crates/application/src/global_send.rs` | Global application integration; reconcile shared use cases and invariants. |
| `crates/domain/src/global_manager.rs`, `crates/application/src/global_time.rs`, `crates/application/src/global_daily_review.rs` | Global domain steward; reconcile civil-time rules and domain behavior. |
| `crates/store/src/lib.rs`, `crates/store/src/global_manager.rs`, schema manifests, SQL migrations, migration ordering | Store and migration steward; serialize store wiring and schema changes. |
| `crates/store/src/intake_delivery.rs`, `crates/store/src/work_model_v3.rs` | Project-store steward; serialize Intake-delivery and typed work-model persistence changes with `lib.rs` and migration ownership. |
| `crates/protocol/src/models.rs`, `crates/protocol/src/global_manager.rs`, protocol manifests | Protocol steward; coordinate versioned contract changes and all consumers. |
| `apps/global-tui/src/model.ts`, `interaction.ts`, `view.ts`, `client.ts` | Global TUI integrator; serialize edits to each existing file and check mounted behavior. |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `install.sh`, `scripts/release/`, `packaging/` | Release and CI integrator; keep source, generated, embedded, and packaged identities aligned. |
| `scripts/validation/run_full_suite.py` and shared validation entry points | Validation integrator; coordinate invocation order, fixtures, and output contracts. |
| `scripts/validation/` | Validation integration steward; BW-S13-T03 has a broad directory grant, so serialize it against every task owning any child path here, including BW-S12-T06's `scripts/validation/boreal-portability/`. |
| `scripts/validation/final-product/` | Final-journey validation steward; keep end-to-end fixtures and release evidence aligned across final validation tasks. |
| `project/GLOBAL_MANAGER.md`, `project/CLI_COMMANDS.md`, `project/AGENT_GUIDANCE.md`, `docs/INSTALL.md`, `docs/PACKAGING.md`, `skills/boreal-route/` | Documentation and guidance steward; reconcile overlapping operator instructions and published command surfaces. |
| `docs/WORKFLOWS.md`, `skills/manifest.json` | Workflow and skill steward; keep portable workflow guidance and the installed-skill inventory versioned together. |
| `project/INTERFACES.md`, `project/spec/cli-contract.json`, `project/spec/workflows/` | Protocol and workflow-contract steward; serialize typed interface and workflow-registry changes across consumers. |
| `project/legacy-map/` | Migration steward; preserve explicit provenance and unsupported legacy-data dispositions. |
| `project/build-plan/boreal-final-state/**`, `project/validation/boreal-final-state/**` | Plan and acceptance steward; only the coordinator edits task graph, state, acceptance, and sprint evidence records. Workers submit proposals or evidence for review. |

This list reflects shared files used by the current task packets. Before
dispatch, compare the complete owned paths from the actual task cards; newly
introduced shared files must be added here or explicitly assigned to one task
before parallel work begins. A task card that owns one listed path exclusively
has that path for the duration of its assignment. All other workers use the
shared-patch request in `PARALLEL_DISPATCH.md`.

## Patch integration record

For each shared patch, record:

- task, attempt, and fence;
- input source snapshot and project revision;
- protected path and steward;
- patch identity and resulting combined source identity;
- dependent tasks, exported contracts, and migration/protocol impact;
- checks run, checks still required, and the owner of each follow-up.

Apply one patch at a time to a shared file. If its base has changed, stop and
reconcile against the new base with the original worker before applying it.
Never infer ownership from an uncommitted checkout or edit another worker's
worktree to make integration easier.
