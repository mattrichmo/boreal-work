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
payloads. Transport failures become `service_unavailable` envelopes. Status
reads carry a `cursor_revision`; a missed revision notification requests a
complete resnapshot, while an unchanged notification does not poll.

Mounted workflow actions remain routed through `VersionedServiceApi` and expose
ready, queued, blocked, expired-review, and open-gate states. The controller
also preserves attempt fences and revision preconditions for mutations.

## Node entrypoint

`src/node-transport.ts` provides `UnixSocketFramedTransport`, using only
Node's built-in `node:net` API. It validates the four-byte frame before sending,
reads exactly one complete response frame, enforces the payload bound and
timeout, and closes the request connection. The one-request connection shape
matches the current Rust service listener; the controller remains independent
of that choice.

`src/entrypoint.ts` is the smallest executable mounted path:

```text
npm run start -- --socket /path/to/boreal.sock --project project-id [--work work-id]
```

It mounts `MountedWorkflowController`, fetches one revision-bound snapshot, and
renders it as deterministic plain text. The default path remains one-shot,
including when input is piped. An explicit `--interactive` line shell adds
`help`, `refresh`, `select WORK_ID`, lifecycle commands, and `quit` for
operators and scripted sessions. Lifecycle commands first stage a mutation and
require a separate `confirm` (or `cancel`) line; they dispatch only through the
mounted controller and show the target, revision, attempt fence, operation,
and outcome. The bounded shell supports `claim`, `accept-start`, `evidence`,
`finish`, and `release`; it does not read SQLite or retry unknown outcomes.
Ink rendering, subscription streams, automatic reconnect loops, and full
keyboard navigation remain open follow-up work.
The socket adapter is tested against a local fake Unix socket server; the
controller tests continue to use an in-memory transport for deterministic
workflow assertions. The focused socket fixture also drops the first mount
connection and verifies that a later mount retries over a fresh connection and
recovers the revision-bound view. This is a local transport/controller proof,
not packaged-service acceptance; subscription handling and full keyboard
navigation remain open.
