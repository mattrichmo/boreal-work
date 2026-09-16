# P4-09 dashboard launcher addendum

Date: 2026-09-16
Scope: current v2 dashboard composition and its public documentation.

This addendum records the dashboard work that landed after the original
P4-09 readiness review. It is documentation and evidence bookkeeping only; it
does not close P4-09 or replace the required independent review,
reconciliation, revalidation, packaging, and full-product gates.

## Current behavior documented

- `bwrk dashboard` is the normal one-terminal entry point when the selected
  database already exists. Interactive mode resolves a project, starts a
  private supervised Rust service, launches one TUI child, and returns the TUI
  result.
- `bwrk dashboard --json` reads the canonical derived status projection
  directly. It does not launch the TUI or a private service.
- Project selection supports explicit `--project PROJECT`, the positional
  `dashboard PROJECT` compatibility form, environment/metadata beside the
  selected database, and the exactly-one-project database fallback. Ambiguous
  metadata or multiple database projects require an explicit project.
- `bwrk view --project PROJECT` is the implemented exact top-level alias for
  `dashboard`. The positional `view PROJECT` spelling is not currently
  accepted.
- The direct TypeScript entrypoint remains a developer/debug seam. It requires
  an already-running service socket and does not open SQLite or supervise the
  service. `service run` is for deliberate shared-agent or protocol-debugging
  use, not ordinary dashboard startup.

The corresponding behavioral details are in
[`project/spec/cli-contract.json`](../spec/cli-contract.json), and the local
walkthrough is in [`test-project/README.md`](../../test-project/README.md).

## Evidence and remaining limitations

The current launcher implementation is in `crates/cli/src/dashboard.rs`; the
launcher integration fixture is
`crates/cli/tests/dashboard_launcher.rs`, and the scripted smoke path is
`scripts/dashboard-smoke.sh`. Those checks cover the normal private-service
composition, TUI argument forwarding, JSON no-launch behavior, and normal
endpoint cleanup.

The following remain open and are intentionally not presented as acceptance:

- Dashboard does not attach to or reuse an already-running service; `--socket`
  is rejected. A service already owning the same database must be handled as a
  separate shared-client workflow.
- Startup currently observes endpoint creation rather than a complete
  protocol-level readiness handshake.
- Cleanup and signal behavior outside the tested normal-exit path, including
  in-flight TUI mutations and service-level signal shutdown, still require
  hardening and fault tests.
- Clean-install execution of the real packaged TUI, current-directory/ancestor
  metadata discovery with an external `--db`, and the full v1 dashboard parity
  surface remain release work.

P4-09 therefore remains open until its prerequisite phase gates and the full
fresh-install, imported-project, real-service/TUI revalidation are complete.
