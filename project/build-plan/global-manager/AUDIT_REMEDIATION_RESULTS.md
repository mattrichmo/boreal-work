# Global management audit remediation — 2026-09-30

This follow-up implements the reliability, integrity, daily-use, and core
scale/presentation phases from the global management audit. It preserves the
installation-wide management boundary and leaves project-scoped Boreal Work
as the execution authority.

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

### 3. Scale and presentation — core work implemented

- Add atomic bulk triage with per-item destination, workflow, and parent
  validation; expose it as one application/store mutation.
- Run linked detail reads through a fixed-size worker pool with bounded queue,
  per-job readback, page limits, and short result retention. Exact workspace
  association reads work beyond the 100-row summary window.
- Measure retained full-snapshot history growth in bytes across state size and
  edit count. Keep lossless history; do not prune until a separately verified
  archival and restore path can preserve evidence.
- Compute project attention summaries from the full state before summary caps,
  including next action and milestone progress.
- Add note-to-item links and backlinks, hierarchy collapse and breadcrumbs,
  all-project workflow grouping, pane-local selection styling, dark/light/mono
  themes, grouped navigation, and compact responsive behavior.

### Remaining follow-up — intentionally deferred

- Add saved views after scope and filtering have been qualified with larger
  portfolios. Bulk triage is available; broader bulk operations can follow user
  feedback on that interaction.
- Qualify in installed terminals and at the audit's full viewport matrix,
  including Unicode, long labels, and terminal-specific resize behavior.
- Measure real lifecycle history growth and service latency before setting a
  retention/compaction policy. Preserve all history in the meantime.
- Recurrence and reminders need explicit schedule and delivery semantics;
  team sync, Gantt/resource planning, and rich document editing remain outside
  this release.

## Verification

Verification passed:

- `cargo test -p boreal-application --test global_manager`: 16/16.
- `cargo test -p boreal-cli --test global_service`: 6/6.
- `cargo test -p boreal-cli --bin bwrk global_commands::tests::linked_detail`:
  2/2 bounded linked-detail job tests.
- `npm test` in `apps/global-tui`: 80/80 under Node 20.
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

## Follow-up hardening after the later full audit

The follow-up implementation closes additional defects found during the
independent source review:

- Reject export paths that resolve to the canonical global database. Write
  private exports through unique exclusive temp files before atomic rename.
- Validate typed `detail page` requests at the protocol boundary. Reuse one
  validated workspace identity/store for linked reads, discard results that
  finish after their deadline, and compute linked-page continuation from the
  requested offset.
- Reject item transfers that split child, relationship, or note-link
  ownership. Require both source and destination workflow identity before
  transferring items with history; validate each historical status side
  against its recorded workflow.
- Bound recursive imported history and interactive response projections.
  Keep exact totals, mark snapshot samples that were reduced, and preserve
  page offsets when response-size limits shorten a page. Scope searchable
  status history to either transition owner.
- Preserve mixed-row identity and project origin in the TUI. Start archive
  paging at the raw detail-page origin because routine summaries omit
  archived-project children; use stable row keys to deduplicate. Enter opens
  work, note, status, activity, and linked records in the inspector; project
  rows open their board, and linked details remain pageable.

The follow-up received `cargo check` for the changed Rust packages,
`npm run typecheck` for the global TUI, edition-matched `rustfmt --check`, and
`git diff --check`. No tests were added or run in this follow-up. Saved views,
legacy inbox capture provenance/import, installed-terminal qualification, and
measured history-retention policy remain separate work. A synchronous linked
SQLite projection cannot be interrupted once it starts; late results are
discarded and the worker/queue remain bounded.
