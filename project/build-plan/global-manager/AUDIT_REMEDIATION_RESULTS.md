# Global management audit remediation — 2026-09-30

This follow-up implements the first reliability and daily-use phases from the
global management audit. It preserves the installation-wide management
boundary and leaves project-scoped Boreal Work as the execution authority.

## Plan and disposition

### 1. Reliability and integrity — implemented

- Keep the global service alive after EOF, partial frames, invalid lengths,
  idle connections, and response disconnects. A committed write remains
  discoverable by its durable operation receipt.
- Return bounded snapshot summaries with exact collection totals and full-state
  attention counts. Use revision-consistent, searchable detail pages and
  single-record reads for note bodies and item descriptions.
- Route file export and import around interactive frame limits while keeping
  both operations inside the application/store boundary.
- Treat a confirmed mutation as saved even when the following refresh fails;
  preserve the prior snapshot and retry only the read.
- Reject relationship-splitting transfers atomically. Record workflow owner,
  status label, and category in new history entries; reject unsafe transfers
  with legacy history that lacks portable workflow identity.
- Validate nested backup history before replacement and include project and
  both endpoint IDs in relationship activity records.
- Preserve last-good linked workspace counts and report their age when a
  refresh fails. Keep refresh concurrency and queued work bounded.

### 2. Correctness and everyday triage — implemented in the core TUI flow

- Keep the last explicit project scope when switching through All projects.
- Use one search result contract across routes, including note bodies and
  matching descendants with their planning ancestors.
- Hide children of archived projects from active views while preserving their
  own archive flags and recoverability.
- Share displayed and selectable Home rows; identify project origin in mixed
  rows and preserve selected identity across refresh and paging.
- Pin multiline form controls and errors, scroll to the wrapped cursor, make
  destination/workflow/parent choices explicit, and show date and priority
  rules. Blank optional priorities now use defaults or preserve existing data.
- Label global capture as Personal inbox, default scoped capture to its
  project, and support individual move, reparent, parent clearing, and explicit
  target workflow selection. Add a distinct follow-up date for waiting work.
- Keep Today, Overdue, Unscheduled, Waiting, and All open as separate filters;
  add project attention summaries to Home and keep linked execution progress
  separately labeled.
- Add linked workspace detail pagination and a quoted line-interface tokenizer.

### 3. Scale and presentation — follow-up work remains

- Add an atomic bulk-triage command before exposing bulk project/parent/status
  moves. Do not implement it as a loop of independent writes.
- Move linked detail reads off the synchronous service dispatch path or add a
  bounded asynchronous page/readback protocol. The client socket timeout does
  not cancel a blocked SQLite read.
- Measure retained full-snapshot history growth and define a safe retention or
  compaction policy without deleting evidence before that policy is verified.
- Make Home next-action/milestone summaries authoritative for records beyond
  the capped summary sample, and measure portfolios with very many projects.
- Continue pane-local styling, theme exposure, responsive help/inspector polish,
  all-project workflow grouping, saved views, and broader terminal qualification.

## Verification

Verification passed:

- `cargo test -p boreal-application --test global_manager`: 11/11.
- `cargo test -p boreal-cli --test global_service`: 6/6.
- `cargo test -p boreal-cli --bin bwrk linked_failure`: 1/1 linked last-good
  cache unit test.
- `npm test` in `apps/global-tui`: 64/64 under Node 20.
- `rustfmt --check` on the changed Rust files and `git diff --check`.

The TUI socket tests require a writable temporary directory; sandboxed Unix
socket binds fail with `EPERM`, so qualification used `TMPDIR=/private/tmp` in
the approved local test environment.

Workspace-wide `cargo fmt --check` still reports formatting differences in
untouched Rust modules; every Rust file changed for this remediation passed the
edition-matched `rustfmt --check`.

These focused checks do not claim full-workspace Cargo qualification,
installed-terminal behavior, or a production database migration run. No live
management state was changed.
