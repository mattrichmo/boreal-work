# Vertical 09 — distribution, compatibility, and cutover

Task IDs: P4-05, P4-06, P4-07–P4-09, P5-08. Read
[the protocol contract](../../INTERFACES.md),
[decision record](../../DECISIONS.md), and
[task index](../TASK_INDEX.md).

## Outcome and ownership

An agent can install and run the same immutable v2 CLI/service build throughout
an active attempt, while a human can install the TypeScript TUI and migrate a
project with a rehearsed rollback. The entire v2 folder builds after being
copied outside the legacy checkout.

Own build scripts, release manifests, install/update flows, package tests,
and operator docs. Coordinate binary/protocol/schema version changes with the
protocol and store owners. Do not rewrite task/memory state as an install side
effect.

## Prerequisites

P4-10 for the versioned core workflow/directive assets (which depends on
P2-09/P3-09), P4-01 for the TS client, P4-04 for import, and an explicit
supported-platform decision from P0-01. P4-06 docs additionally waits for
P4-03 and P4-05.

## Build steps

1. Define one release manifest: Rust binary build digest, protocol version,
   SQLite schema reader/writer compatibility, memory manifest version, TS
   client compatibility range, directive registry/workflow versions, and
   bundled asset digests.
2. Produce reproducible artifacts for supported platforms. Install CLI and
   service atomically; TUI resolves the compatible service protocol rather
   than importing legacy TS packages. `guide`, `next`, and packaged core
   workflows resolve from the same immutable release, never the legacy tree.
3. Pin executable/toolchain identity per attempt. An upgrade while attempts
   are active pauses dispatch, checks compatibility, and resumes or rolls back
   explicitly. Application lockfile changes are evidence inputs, not the
   identity of the Boreal binary.
4. Exercise clean install, update, removed runtime dependency, failed asset
   install, interrupted upgrade, rollback, and service restart on an existing
   project. Validate checksums/manifests in the smoke test.
5. Document service startup/status/recovery, migration dry run, backup, memory
   publication, project isolation, and unsupported v1 features with exact
   version-matched commands.
6. Extract the v2 folder to a clean checkout and run the full build and smoke
   without legacy paths, node_modules, caches, or `.boreal` state.

## Acceptance and failures

- Every active attempt reports the exact CLI/service build and schema
  identity it used; upgrade never silently changes it mid-attempt.
- A failed install/update leaves the previous executable and project state
  usable. Rollback has a tested path and does not erase failed attempts.
- A clean machine runs `init`, no-goal `next`/`agent start`, task creation,
  competing claim, evidence/verification/finish, core contextual workflow
  routes, memory publication/retrieval, and TUI status with the packaged
  artifacts.
- Protocol mismatch yields a typed actionable error; the TUI does not render
  malformed or stale data as normal state.
- The standalone v2 checkout passes its required checks without reading the
  legacy repository.

Handoff evidence: artifact manifest and checksums, install/upgrade/rollback
logs, compatible version matrix, clean-checkout commands, release notes,
known limitations, and rollback instructions. P5-08 is a cutover decision
after P5-07, not an automatic deletion of the legacy system.
