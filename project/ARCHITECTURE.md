# Architecture and process model

## Local topology

```text
agent harness A -- bwrk CLI --\
agent harness B -- bwrk CLI ---+--> local API --> Rust Boreal service
TypeScript TUI ----------------/                    |  application services
                                                   |  bounded writer queue
                                                   |  read connection pool
                                                   +--> SQLite WAL (canonical)
                                                   +--> blob store (source/output)
                                                   +--> Git memory publication worker
```

The recommended first deployment is one Rust service process per project
workspace. It owns migrations, the write queue, revision publication, memory
index maintenance, and Git memory-publication jobs. The Rust CLI is a thin,
scriptable client. Agent harnesses share one protocol regardless of how
they were launched. The TypeScript TUI uses the same API and subscribes to
revision changes.

The Rust application also owns a read-only guidance compiler. It projects
one revisioned snapshot of task conditions, attempt, gates, and context into
trusted directives and a single next safe action. CLI `guide`/`next`, TUI
guidance, and harness adapters consume that result; no adapter chooses
claimability or invents its own workflow state. Core canonical workflow
assets are versioned with the release and reference the same application
commands. See [AGENT_GUIDANCE.md](AGENT_GUIDANCE.md).

The local API should be HTTP over a Unix-domain socket on macOS/Linux, with a
Windows named-pipe equivalent if Windows support is in scope. The specific
transport library is an implementation choice; request and response schemas
are not. The socket lives in the project's private runtime directory, has
restricted permissions, and is bound to a workspace identity. A remote HTTP
transport can be added later with explicit authentication and authorization.

The CLI can perform setup and recovery commands without an already running
service. During an active run, ordinary reads and mutations go through the
service. An offline CLI path may use the **same Rust application/store
transaction code** after confirming no active service owner; it cannot invent
a second lifecycle. Service startup must use one elected owner; concurrent
first commands either connect to it or receive a structured startup/busy
result. A service crash leaves the SQLite database recoverable and lets the
next client restart it. The client must never break a live service lock.

## Rust layout

The current workspace has small placeholder crates. The implementation target
is a modest number of Rust modules, not one crate per concept:

```text
crates/domain       IDs, work/memory types, lifecycle and graph rules
crates/store        schema, transactions, queries, migrations, blobs, events
crates/application  commands, read models, guidance, policy, dispatch, retrieval
crates/protocol     versioned request/response/event types (add when needed)
crates/service      local API, writer queue, subscriptions, background jobs
crates/cli          argument parsing, local API client, JSON/human output
apps/tui            TypeScript client, rendering, keybindings, confirmation
```

The `protocol` and `service` crates now contain the versioned envelope and
local runtime primitives; their broader product command and UI integration is
still planned. Memory starts as domain/application/store modules so it shares
transaction semantics with work and attempts. Split it into a crate only after
a stable dependency boundary appears.

## Ownership

| Concern | Owner |
| --- | --- |
| Valid work/memory/attempt transitions | domain + application |
| Canonical records and audit events | store |
| Conditional status and trusted directive/next-action selection | application, using domain rules |
| Core workflow asset validation and route metadata | application; versioned release assets |
| Writer fairness, subscriptions, jobs | service |
| Request/response schemas | protocol |
| CLI syntax and exit codes | cli |
| TUI rendering and navigation | apps/tui |
| Published curated memory | serialized Git publisher; indexed by store |
| Work-state export | optional export worker, driven by committed revision |

The service may use a short transaction for a state change and its audit event.
It must not call an agent, run a test, parse a large source, or perform a Git
commit inside that transaction. Such work happens outside the transaction and
returns a structured receipt or a new command.

## Single-host boundary

SQLite WAL is a fit for many clients on one host: readers and a writer can
proceed concurrently, but only one writer commits at a time. WAL is not a
shared database format for multiple hosts over a network filesystem. If agents
run on separate machines, they must reach a service over a network transport;
they must not open one SQLite file across hosts. Long-lived read transactions
can also stall WAL checkpointing, so API queries must materialize their result
and close the read transaction before serialization or TUI rendering. See
[SQLite's WAL documentation](https://www.sqlite.org/wal.html).

## TypeScript TUI

The TUI owns no canonical state. It consumes revisioned snapshots and change
notifications, asks the Rust application API to mutate, and renders from
validated DTOs. It also renders the same conditional status and guidance as
the CLI; it does not reimplement directive selection. It never opens the
database, reads the legacy object store, or
spawns `bwrk` once per refresh. It can reconnect after service restart using a
revision cursor. A missed event triggers one snapshot refresh. A manual
refresh must bypass display cache and return a new snapshot/revision result.

The first release can remain CLI-only while the TS client is built. The TUI
must eventually support the complete task lifecycle, not just read dashboards.
