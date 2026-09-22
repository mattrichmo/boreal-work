# R-INTERFACES — project/INTERFACES.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/INTERFACES.md:L1–L152`  
**File SHA-256:** `db9d5da087cd89e1dcc954810d3eed3f76c52ccd35932355ee8a14baa5a7cbe4`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Operation, snapshot and application-adapter contract vocabulary.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,152p' 'project/INTERFACES.md'
```

## Exact baseline excerpt

````text
    1 | # CLI, local API, and TUI contract
    2 | 
    3 | ## One API
    4 | 
    5 | The Rust application layer owns use cases. The Rust CLI and TypeScript TUI are
    6 | clients of the same versioned local API. Neither client reads the SQLite file
    7 | or reconstructs work/attempt/memory state independently. A small embedded CLI
    8 | mode may use the same Rust application service while the local service is
    9 | offline, but it must not introduce a separate transition path.
   10 | 
   11 | Initial CLI families (the command-by-command keep contract and purpose live in
   12 | [CLI_COMMANDS.md](CLI_COMMANDS.md)). These are observed v1 paths to preserve,
   13 | not every command in each family:
   14 | 
   15 | ```text
   16 | bwrk commands|prime|next|init|setup|dashboard|doctor
   17 | bwrk agent guide|status|start|finish
   18 | bwrk work create|edit|show|list|rollup|next|ready|claim|verify|release|close
   19 | bwrk sprint list|launch|show|status|current|activate|board|report|metrics|close
   20 | bwrk dep add|remove|tree|cycles
   21 | bwrk evidence run|add
   22 | bwrk raw add|list|show|triage
   23 | bwrk source add|list|show
   24 | bwrk context show|search|rebuild
   25 | bwrk search query|index
   26 | bwrk decision create|list|show|supersede
   27 | bwrk workflows list|show
   28 | bwrk sync status|refresh
   29 | ```
   30 | 
   31 | The exact flag grammar is defined by command fixtures before agents automate
   32 | it. Help output and machine-readable argument errors must agree. No adapter
   33 | should require a model to rediscover the same flag syntax after a pause.
   34 | The keep contract distinguishes preserving a v1 behavior from preserving its
   35 | exact spelling; a changed spelling needs a tested alias or migration map.
   36 | The v1 `status` alias means `prime`; use `agent status` for the active snapshot
   37 | and add a revision cursor there or under a new `snapshot` path. Milestones and
   38 | tasks are `work` kinds, not existing top-level CLI families. `memory ...`,
   39 | `agent resume`, and low-level `work accept|heartbeat|checkpoint|finish` are
   40 | proposed v2 surfaces/API operations, not observed v1 commands; their exact CLI
   41 | grammar is a P0 decision.
   42 | `agent start` and `agent finish` are guided, consolidated entry points over
   43 | the same atomic claim/attempt and evidence/closeout use cases as lower-level
   44 | commands; they do not create a second state machine. Preserve useful v1
   45 | aliases or provide an explicit command migration map.
   46 | 
   47 | ## Self-guiding agent contract
   48 | 
   49 | The Rust application compiles a revision-bound `AgentGuide` from current
   50 | work, attempt, eligibility, blockers, gate state, receipts, and relevant
   51 | project context. It owns a versioned, trusted directive registry. The CLI and
   52 | TUI render that same guide; a harness can request it through the local API.
   53 | The first routes are discover/claim, resume, implement/checkpoint,
   54 | verify/evidence, finish/release, and recover. Broad custom workflow packs may
   55 | come later; this core loop cannot.
   56 | 
   57 | `bwrk agent guide --json` explains the loop and current obligations;
   58 | `bwrk next --json` selects one safe action or returns typed `idle`, `blocked`,
   59 | `needs_operator`, or `unavailable`. The result includes project revision,
   60 | attempt ID/fence when applicable, directive-registry version, reason codes,
   61 | context references, required/optional obligations, and an exact action with
   62 | runner, argv, cwd, and `shell: false`. It never requires a model to assemble
   63 | a command from prose. Mutating actions still recheck revision/fence and
   64 | eligibility in the store transaction; a guide is not a claim or lease.
   65 | 
   66 | Only registry-owned instruction templates may become trusted executable
   67 | actions. Work titles, descriptions, source text, summaries, and authored
   68 | commands are displayed as data. A declared verification command requires
   69 | explicit bounded execution/attestation policy; it is not promoted to shell
   70 | authority by appearing in a task. Required/blocking directives and gate
   71 | failures are enforced by application transactions, not just CLI rendering.
   72 | If context is stale or an operation outcome is unknown, return a readback or
   73 | resnapshot action instead of blindly retrying.
   74 | 
   75 | ## JSON envelope
   76 | 
   77 | Every JSON command returns one bounded, versioned envelope with stable field
   78 | types. A proposed shape:
   79 | 
   80 | ```json
   81 | {
   82 |   "api_version": "2",
   83 |   "operation_id": "op_...",
   84 |   "revision": 42,
   85 |   "as_of": "2026-09-14T22:00:00Z",
   86 |   "next_status_change_at": null,
   87 |   "transport": "ok",
   88 |   "outcome": "changed",
   89 |   "data": { "active_attempts": [], "ready": [], "counts": {} },
   90 |   "detail_ref": null,
   91 |   "error": null
   92 | }
   93 | ```
   94 | 
   95 | `transport` means the request reached the service and was decoded. `outcome`
   96 | means the application result: changed, unchanged, rejected, conflict, busy,
   97 | or failed. A successful process exit with a failed application outcome is not
   98 | silently treated as success. The CLI exit code mirrors the documented outcome
   99 | class. Lists remain arrays even when empty. A truncated result is never normal
  100 | `data`; it is an explicit referenced detail with digest, size, and expiry.
  101 | 
  102 | Routine status includes current attempts, ready counts, blockers, active
  103 | sessions, closeout gaps, and the next event/timer deadline. Historical
  104 | assignments require a separate paginated query. The initial response-size
  105 | target from the audit is approximately 2–8 KiB for a three-agent active
  106 | snapshot, independent of completed history length; measure actual bytes.
  107 | It reports `queued` prerequisite waits separately from hard `blocked` work,
  108 | and `expired_review` separately from closed or cancelled tasks. Time-driven
  109 | labels are evaluated at `as_of` with `next_status_change_at`, so a late timer
  110 | does not make an expired claim appear valid. See [STATUS_MODEL.md](STATUS_MODEL.md).
  111 | 
  112 | ## Revisions and notifications
  113 | 
  114 | Each mutation returns a monotonic project revision and operation ID. Read
  115 | models name the revision used for all fields. A change stream reports revision
  116 | and affected subject IDs, with a bounded replay cursor. The TUI coalesces
  117 | notifications, requests one snapshot when needed, and renders after the read
  118 | transaction closes. On disconnect or missed cursor, it fetches a fresh
  119 | snapshot. On unchanged state, it does not perform a new model-mediated poll.
  120 | 
  121 | Use a single validation adapter for inline/referenced objects and arrays,
  122 | empty stdout, stderr, invalid JSON, nonzero exits, missing files, and a
  123 | successful transport carrying an application failure. Referenced paths are
  124 | validated against an allowed directory with size/digest checks. Cache writes
  125 | are atomic and tagged by source revision.
  126 | 
  127 | Keep protocol schemas and example fixtures in the v2 repository. Generate or
  128 | validate the TypeScript client types from the Rust protocol contract; never
  129 | hand-maintain a second incompatible DTO definition. Include version-negotiation
  130 | and unknown-field behavior in the fixtures.
  131 | 
  132 | ## Runtime and compatibility identity
  133 | 
  134 | Each attempt records the Rust binary/protocol version, schema version,
  135 | harness adapter identity, and relevant toolchain fingerprint. A running
  136 | attempt uses a resolved immutable executable identity. Updating the CLI or
  137 | app dependencies during a run does not silently rebase that attempt. Upgrade
  138 | uses explicit pause, compatibility check, and resume. App source/lockfile
  139 | changes are evidence inputs; they are not automatically the Boreal binary's
  140 | identity.
  141 | 
  142 | ## TUI specifics
  143 | 
  144 | Keep the TS TUI as a replaceable client. Port useful navigation, responsive
  145 | layouts, validation, refresh coalescing, and confirmation behavior from the
  146 | legacy TUI selectively. Use a long-lived API connection; do not spawn one CLI
  147 | process per route refresh. The TUI must display `queued`, `claimed`,
  148 | `accepted`, `running`, `blocked`, `expired_review`, `verification needed`,
  149 | `complete`, and `closed` without conflating them. It must support the core
  150 | mutation loop with the same request types as
  151 | CLI clients. A manual refresh returns a current revision or a precise stale/
  152 | unavailable indication.
````
