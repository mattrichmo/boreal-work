# PF-S02-T11 attempt-19 integration requests

This attempt is bounded. The following requests remain outside the completed
CLI/service integration or require an owner beyond the assigned write set.

1. **Store/application owner — parent operation audit contract.**
   `crates/cli/src/main.rs:5908` (`append_finish_parent_operation`) and
   `crates/cli/src/service.rs:3141` (`ServiceCommandHandler::start`) still call
   `SqliteStore::append_operation`. The exact attempted replacement was
   `SqliteStore::append_identity_operation_audit`; it fails when the parent
   operation reuses a revision whose audit row already exists. Provide a
   revision-safe parent-operation/audit API, or explicitly bless an
   identity-bound operation-only append for these parent records.

2. **Application/store owner — verifier external-job seam.**
   `crates/cli/src/main.rs:4355` (`evidence_run_result`) calls
   `crates/cli/src/main.rs:5103` (`execute_gate_command`) after the existing
   `admit_witnessed_execution`/`start_witnessed_execution` boundary. A safe
   external-job wrapper needs an application contract that binds the verifier
   job to the existing `receipt.insert` operation, audit subject, and revision;
   registering a second job from this CLI site would create competing identity
   records and is therefore not claimed here.

3. **Application/service owner — recovery route.**
   `crates/cli/src/service.rs:3216` (`ServiceCommandHandler::release`) delegates
   to `WorkApplication::release`, whose existing runtime hook requests terminal
   resource readback. There is no service command/DTO for listing or resolving
   recovery obligations. Expose the canonical recovery readback port and
   versioned service route before adding a CLI-only recovery writer.

4. **Memory publisher owner.** The publisher registration and memory-publication
   external-job caller requested by attempt-18 remain outside this attempt's
   exclusive CLI/service write set and were not edited.
