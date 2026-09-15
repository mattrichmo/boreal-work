# Security and resource-boundary probe

`scripts/validation/security/probe.sh` is an early P5 probe for the v2 local
boundaries. It creates a fresh temporary fixture, compiles a short harness
against the checked-in v2 crates, runs it, and removes the fixture on exit.
The probe does not modify Rust, CLI/TUI, workflow assets, or Boreal sprint
records.

Run it from the v2 package root:

```sh
scripts/validation/security/probe.sh
```

The checks cover:

- project IDs, source origins, memory entry IDs, and forged cross-project
  records;
- source and memory retrieval scope, including bounded excerpts;
- zero and over-limit application/transport request sizes;
- guidance argv safety and workflow command-data shell metacharacters;
- malformed application envelopes and malformed/oversized framed transport
  requests;
- Unix socket binding and the caller-owned private-runtime-directory
  assumption.

## Interpretation

`PASS` is an observed invariant. `FAIL` is a boundary violation and causes
the probe to exit non-zero. `SKIP` means the runner could not exercise an
environment-dependent check; it is recorded as a limitation and does not
pretend to be proof.

The transport requires an absolute Unix socket path before binding or
connecting. The CLI/service composition still owns selection of a private
runtime directory; the transport check does not claim OS-level isolation.

The probe is intentionally not a complete P5 security review. It does not
establish multi-process isolation, OS MAC/sandbox policy, database file
permissions, denial-of-service behavior over repeated connections, durable
outbox/recovery safety, or production deployment hardening. Unix socket checks
may be `SKIP` in restricted runners that deny Unix-domain socket creation.

## Observed run

Run from the v2 package root on 2026-09-14:

```text
PASS workflow-shell-boundary
14 PASS compiled boundary checks
0 FAIL
1 SKIP: runner denied Unix socket creation (`Operation not permitted`)
```

Because this runner denied the socket bind, the malformed-frame,
oversized-frame, and relative-path subchecks were not exercised in that run.
The non-socket application envelope rejection did run and passed. Re-run the
probe on a Unix environment that permits temporary Unix-domain sockets to
close those skips; on such an environment, relative socket paths are rejected
before bind.

## Latest observed run

Run from the v2 package root on 2026-09-15 with elevated temporary-socket
permissions:

```text
PASS workflow-shell-boundary
17 PASS compiled boundary checks
0 FAIL
0 SKIP
```

The new `unix-socket-path-assumption` check passes because both server bind
and client connect reject relative paths with typed invalid-input I/O.
