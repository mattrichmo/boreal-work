# R-ARCH — project/ARCHITECTURE.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/ARCHITECTURE.md:L1–L111`  
**File SHA-256:** `a28dfc1294d51d493f27268fe1616e06638e4e8fa6862daed8f3abea6ff4679b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Application, domain, service, store, projections, source and Git-memory boundaries.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,111p' 'project/ARCHITECTURE.md'
```

## Exact baseline excerpt

````text
    1 | # Architecture and process model
    2 | 
    3 | ## Local topology
    4 | 
    5 | ```text
    6 | agent harness A -- bwrk CLI --\
    7 | agent harness B -- bwrk CLI ---+--> local API --> Rust Boreal service
    8 | TypeScript TUI ----------------/                    |  application services
    9 |                                                    |  bounded writer queue
   10 |                                                    |  read connection pool
   11 |                                                    +--> SQLite WAL (canonical)
   12 |                                                    +--> blob store (source/output)
   13 |                                                    +--> Git memory publication worker
   14 | ```
   15 | 
   16 | The recommended first deployment is one Rust service process per project
   17 | workspace. It owns migrations, the write queue, revision publication, memory
   18 | index maintenance, and Git memory-publication jobs. The Rust CLI is a thin,
   19 | scriptable client. Agent harnesses share one protocol regardless of how
   20 | they were launched. The TypeScript TUI uses the same API and subscribes to
   21 | revision changes.
   22 | 
   23 | The Rust application also owns a read-only guidance compiler. It projects
   24 | one revisioned snapshot of task conditions, attempt, gates, and context into
   25 | trusted directives and a single next safe action. CLI `guide`/`next`, TUI
   26 | guidance, and harness adapters consume that result; no adapter chooses
   27 | claimability or invents its own workflow state. Core canonical workflow
   28 | assets are versioned with the release and reference the same application
   29 | commands. See [AGENT_GUIDANCE.md](AGENT_GUIDANCE.md).
   30 | 
   31 | The local API should be HTTP over a Unix-domain socket on macOS/Linux, with a
   32 | Windows named-pipe equivalent if Windows support is in scope. The specific
   33 | transport library is an implementation choice; request and response schemas
   34 | are not. The socket lives in the project's private runtime directory, has
   35 | restricted permissions, and is bound to a workspace identity. A remote HTTP
   36 | transport can be added later with explicit authentication and authorization.
   37 | 
   38 | The CLI can perform setup and recovery commands without an already running
   39 | service. During an active run, ordinary reads and mutations go through the
   40 | service. An offline CLI path may use the **same Rust application/store
   41 | transaction code** after confirming no active service owner; it cannot invent
   42 | a second lifecycle. Service startup must use one elected owner; concurrent
   43 | first commands either connect to it or receive a structured startup/busy
   44 | result. A service crash leaves the SQLite database recoverable and lets the
   45 | next client restart it. The client must never break a live service lock.
   46 | 
   47 | ## Rust layout
   48 | 
   49 | The current workspace has small placeholder crates. The implementation target
   50 | is a modest number of Rust modules, not one crate per concept:
   51 | 
   52 | ```text
   53 | crates/domain       IDs, work/memory types, lifecycle and graph rules
   54 | crates/store        schema, transactions, queries, migrations, blobs, events
   55 | crates/application  commands, read models, guidance, policy, dispatch, retrieval
   56 | crates/protocol     versioned request/response/event types (add when needed)
   57 | crates/service      local API, writer queue, subscriptions, background jobs
   58 | crates/cli          argument parsing, local API client, JSON/human output
   59 | apps/tui            TypeScript client, rendering, keybindings, confirmation
   60 | ```
   61 | 
   62 | The `protocol` and `service` crates now contain the versioned envelope and
   63 | local runtime primitives; their broader product command and UI integration is
   64 | still planned. Memory starts as domain/application/store modules so it shares
   65 | transaction semantics with work and attempts. Split it into a crate only after
   66 | a stable dependency boundary appears.
   67 | 
   68 | ## Ownership
   69 | 
   70 | | Concern | Owner |
   71 | | --- | --- |
   72 | | Valid work/memory/attempt transitions | domain + application |
   73 | | Canonical records and audit events | store |
   74 | | Conditional status and trusted directive/next-action selection | application, using domain rules |
   75 | | Core workflow asset validation and route metadata | application; versioned release assets |
   76 | | Writer fairness, subscriptions, jobs | service |
   77 | | Request/response schemas | protocol |
   78 | | CLI syntax and exit codes | cli |
   79 | | TUI rendering and navigation | apps/tui |
   80 | | Published curated memory | serialized Git publisher; indexed by store |
   81 | | Work-state export | optional export worker, driven by committed revision |
   82 | 
   83 | The service may use a short transaction for a state change and its audit event.
   84 | It must not call an agent, run a test, parse a large source, or perform a Git
   85 | commit inside that transaction. Such work happens outside the transaction and
   86 | returns a structured receipt or a new command.
   87 | 
   88 | ## Single-host boundary
   89 | 
   90 | SQLite WAL is a fit for many clients on one host: readers and a writer can
   91 | proceed concurrently, but only one writer commits at a time. WAL is not a
   92 | shared database format for multiple hosts over a network filesystem. If agents
   93 | run on separate machines, they must reach a service over a network transport;
   94 | they must not open one SQLite file across hosts. Long-lived read transactions
   95 | can also stall WAL checkpointing, so API queries must materialize their result
   96 | and close the read transaction before serialization or TUI rendering. See
   97 | [SQLite's WAL documentation](https://www.sqlite.org/wal.html).
   98 | 
   99 | ## TypeScript TUI
  100 | 
  101 | The TUI owns no canonical state. It consumes revisioned snapshots and change
  102 | notifications, asks the Rust application API to mutate, and renders from
  103 | validated DTOs. It also renders the same conditional status and guidance as
  104 | the CLI; it does not reimplement directive selection. It never opens the
  105 | database, reads the legacy object store, or
  106 | spawns `bwrk` once per refresh. It can reconnect after service restart using a
  107 | revision cursor. A missed event triggers one snapshot refresh. A manual
  108 | refresh must bypass display cache and return a new snapshot/revision result.
  109 | 
  110 | The first release can remain CLI-only while the TS client is built. The TUI
  111 | must eventually support the complete task lifecycle, not just read dashboards.
````
