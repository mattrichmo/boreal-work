# P2-09 — Revalidation record

Status: **bounded application and local socket proof passed; release gate remains open**.

The reconciled snapshot now has a deterministic cross-layer proof in
`crates/application/tests/p2_guided_flow.rs`. It uses injected timestamps and
in-memory SQLite to verify:

- three distinct actor/harness claims on independent work items;
- explicit accept/start transitions and durable current attempts;
- expiry requiring reviewed safe recovery before replacement;
- historical expired attempts rejecting old-fence heartbeats;
- operation readback after a simulated service restart and in-flight recovery;
- a versioned `ApplicationRoute` status request backed by the store snapshot;
- one project revision, status contract version, project identity, and exact
  total surviving the route boundary.

The full workspace matrix also passes: `cargo test --workspace --locked
--offline`, `cargo clippy --workspace --all-targets --locked --offline --
-D warnings`, `cargo fmt --all -- --check`, the contract validator, and the TUI
typecheck/test pair.

An elevated local Unix-socket smoke also passed on a fresh temporary project:
the long-lived CLI-owned service served routed status, registered a
session-bound claim, returned a fenced release with `current: false`, and
served a post-release status showing the work ready again. The service was
stopped and restarted between reads; the temporary database/socket were
removed afterward. This run exposed and fixed generated positional routing
for `work claim` and the release response's historical-attempt readback.

A second elevated run, now captured by the checked-in
`scripts/service-smoke.sh`, exercised two bounded service lifetimes and four
client process roles. A reader observed three ready tasks; three distinct
actor/harness/session client processes claimed separate tasks; the service
exited at its request bound; a restarted service accepted three fenced release
requests; and the reader then observed all three tasks ready with historical
attempts no longer current. Both service lifetimes reported zero recoverable
errors and four served requests.

The production P2-09 gate remains open because the full required acceptance
profile still includes an external unfamiliar-harness transcript proving the
directive cannot be skipped. The Rust-owned enforcement seam, bounded
service-routed closeout, focused failure/replay, and multi-harness guided
execution transcripts now pass.
The three-harness claim/release and real restart portion is now bounded proof.
Both direct SQLite and the versioned Unix-socket service route now accept a
structured `agent finish --close` payload: they record the receipt, submit the
attempt, request/finalize the close intent, and retain namespaced close-gate
diagnostics when gates remain open. The service route also accepts structured
`evidence add` receipts; the CLI service handler test exercises this persistence
sequence on a session-bound attempt. The direct runner now loads a project-local
gate declaration, executes validated argv without a shell, bounds runtime and
output, constructs a typed receipt, and persists it through the normal
application path. Service routing is wired to the same runner seam.

The checked-in `scripts/guided-closeout-smoke.sh` now supplies the missing
basic transcript: on a fresh temporary database it routes claim, start, three
declared `true` gates, receipt-backed `agent finish --close`, and final status
through the service, then restarts the service and reads the closed status
back. The run passed under elevated Unix-socket permissions. It also exposed
and fixed unbounded auto-generated operation IDs when transport or receipt
paths were long; the CLI regression test covers path independence and the
255-byte identifier bound. The service test
`service_evidence_run_retains_failure_and_replays_the_receipt` also proves a
nonzero declared gate is retained as failed evidence and the same operation
replays as unchanged. These prove the single-work guided closeout,
restart/readback, focused failure/replay, and three-harness execution slices.
The remaining formal gap is proving directive enforcement inside an unfamiliar
supported harness. The application now exposes typed severity/action-required
semantics and fail-closed safe-argv validation through `guide_checked`; the
CLI regression test
`no_goal_next_emits_one_required_contract_valid_action` now proves the
no-goal `next` response contains exactly one required, shell-free
`agent.start@v1` action whose argv reparses through the CLI grammar. That is
Rust-enforced action emission, not yet proof that an arbitrary harness cannot
skip the directive in a complete guided loop.

The declaration format and current hardening boundary are recorded in
[`docs/EVIDENCE_RUNNER.md`](../../docs/EVIDENCE_RUNNER.md). This is pre-gate
implementation evidence, not a P2-09 pass.
