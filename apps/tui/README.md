# Boreal v2 TUI

The terminal UI is a TypeScript client of the versioned Rust service API. It
owns navigation, refresh coalescing, mutation confirmation, and presentation
of service-provided lifecycle state. It does not open SQLite or reconstruct the
work lifecycle.

Implementation starts after the protocol fixtures in
[`../../project/INTERFACES.md`](../../project/INTERFACES.md) are stable. Useful
legacy visual behavior can be ported selectively; the legacy TUI is not a
runtime dependency.

## Service seam

`VersionedServiceClient` in `src/client.ts` is dependency-free and accepts a
`FramedTransport`. The runtime-specific connector only needs to implement one
complete `roundTrip(request: Uint8Array)`; the request and response bytes use a
four-byte big-endian payload length followed by UTF-8 JSON. This lets a Node
Unix-socket connector use streams without making Node types or SQLite part of
the TUI package.

The adapter validates API/schema versions, operation correlation, structured
application errors, request fields, UTF-8, exact frame lengths, and bounded
payloads. It retains project/actor/harness/session context and emits the
current service route names (`create_project`, `create_work`, `evidence_add`,
and `finish_close`). Project creation maps the ergonomic `display_name` input
to Rust's canonical `name` field. Work creation maps dispatch and acceptance
profile inputs to Rust's `dispatch` and string `profile` fields. Non-empty
hard holds are rejected until that route supports them, rather than silently
discarded. Status reads
carry a `cursor_revision`; the envelope `as_of` is the authoritative snapshot
timestamp even when the service's nested echo was sampled later.

Transport failures on reads become `service_unavailable` envelopes. A
potentially delivered mutation becomes an `unknown` envelope with its
operation ID and `readback_required`; the TUI never retries it automatically.
Mounted controllers can also subscribe to revision/deadline notifications
through an optional push seam. The current one-request Unix transport does
not provide push notifications, but the controller refreshes when a host
integrates that seam.

Mounted workflow actions remain routed through `VersionedServiceApi` and expose
ready, queued, blocked, expired-review, and open-gate states. The controller
also preserves attempt fences and revision preconditions for mutations. A
mounted controller requires one project and actor and one dashboard-scoped
harness/session pair. Lifecycle actions cannot override that identity per
request.

Proof-gated finish also requires a non-empty typed summary. The line interface
accepts `finish <summary>` and maps it to the Rust `summary_body` field. The
full-screen keyboard view refuses to invent summary text and directs the
operator to the line interface until an editor/prompt is added.

## Node entrypoint

`src/node-transport.ts` provides `UnixSocketFramedTransport`, using only
Node's built-in `node:net` API. It wraps the application envelope in Rust's
outer `{request_id,payload}` transport envelope, validates both outer request
correlation and the inner application operation correlation, reads exactly one
complete response frame, enforces the payload bound and timeout, then closes
the request connection. The one-request connection shape matches the current
Rust service listener; the controller remains independent of that choice.

`src/entrypoint.ts` is the smallest executable mounted path:

```text
npm run start -- --socket /path/to/boreal.sock --project project-id [--work work-id]
```

It mounts `MountedWorkflowController`, fetches one revision-bound snapshot, and
renders it as deterministic plain text. The default path remains one-shot,
including when input is piped. With `--interactive` and a TTY, it enters a
full-screen dashboard with bounded rendering, resize handling, arrow or `j`/`k`
navigation, detail/back navigation, manual refresh, lifecycle confirmation,
help, and clean `q`, Ctrl-C, SIGTERM, or SIGHUP shutdown. It restores raw mode,
cursor visibility, the alternate screen, listeners, and refresh timers on all
exit paths.

Keyboard bindings:

```text
j / Down    next work       k / Up      previous work
Enter       work detail     Esc         monitoring view
r           refresh         ?           help
c           claim           s           accept/start
f           finish          x           release
y / Enter   confirm         n / Esc     cancel
q / Ctrl-C  quit
```

The full-screen dashboard also supports presentation-only queue navigation:

```text
1 all       2 ready       3 active       4 blocked      5 expired review
6 closed    7 milestones  8 sprints      9 tasks        / search
p command palette
```

These filters and the bounded text search operate on one immutable service
snapshot; they do not recalculate claimability or mutate status locally. The
selected row shows service-provided hierarchy, planning, dependency, gate,
attempt, deadline, and activity fields when the status route includes them.
Missing Rust routes such as work editing, dependency mutation, cycle
activation, intake promotion, source/memory operations, and session recovery
are rendered as typed unavailable capabilities. The TUI never substitutes a
local database write or a CLI subprocess for those routes.

When `--interactive` is used without a TTY, the deterministic line shell is
retained for scripts and tests. It supports `help`, `refresh`, `select`,
`create-project`, `create-work`, `claim`, `accept-start`, `evidence`, `finish`,
`release`, `confirm`, `cancel`, and `quit`. Mutations show the target, revision,
attempt fence, operation, and outcome. Neither mode reads SQLite or retries an
unknown mutation outcome.

Subscription streams and automatic reconnect loops remain open follow-up work.
The socket adapter is tested against a local fake Unix socket server; the
controller tests continue to use an in-memory transport for deterministic
workflow assertions. The focused socket fixture also drops the first mount
connection and verifies that a later mount retries over a fresh connection and
recovers the revision-bound view. This is a local transport/controller proof,
not packaged-service acceptance.
