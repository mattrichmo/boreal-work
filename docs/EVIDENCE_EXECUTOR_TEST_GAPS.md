# Evidence executor regression coverage

The Unix integration tests in
`crates/cli/tests/evidence_executor_regressions.rs` exercise the public
`bwrk evidence run` path for:

- standard `.boreal/boreal.sqlite` layouts and workspace-root command cwd;
- the default environment allowlist, omitted `HOME`, measured environment
  fingerprints, and sensitive-variable rejection before admission;
- timeout cleanup of a descendant process in the executor's process group;
- durable admission/replay using a counter-writing command, including replay
  with a malformed declaration so policy parsing cannot accidentally relaunch;
- existing stream, combined-artifact, observable, and aggregate output-quota
  cases in `evidence_runner_hardening.rs`.

The following boundaries are not claimed as executed regression coverage:

1. There is no public synchronization or fault-injection hook between the
   durable admission transaction and the external `spawn` call. A test can
   inspect an admitted row, but cannot deterministically terminate the CLI at
   that exact boundary without adding a production test seam. The safe replay
   behavior is therefore tested after a completed operation, while admission
   and unknown-state transitions remain source/store coverage.
2. The direct CLI has no public cancellation operation that can be delivered
   to a running executor from the same test. External SIGTERM/SIGINT handling
   and cancellation races require a service-level process fixture and are not
   inferred from the timeout test.
3. The descendant test verifies cleanup behaviorally with a delayed marker.
   It does not claim platform-independent process-tree or resource telemetry;
   the test is Unix-only because the runner intentionally fails closed where
   process-group cleanup is unavailable.

These limitations are documented rather than addressed by weakening executor
policy or introducing test-only behavior in production code.
