# CLI, local API, and TUI contract

## One API

The Rust application layer owns use cases. The Rust CLI and TypeScript TUI are
clients of the same versioned local API. Neither client reads the SQLite file
or reconstructs work/attempt/memory state independently. A small embedded CLI
mode may use the same Rust application service while the local service is
offline, but it must not introduce a separate transition path.

Initial CLI families (the command-by-command keep contract and purpose live in
[CLI_COMMANDS.md](CLI_COMMANDS.md)). These are observed v1 paths to preserve,
not every command in each family:

```text
bwrk commands|prime|next|init|setup|dashboard|doctor
bwrk agent guide|status|start|finish
bwrk work create|edit|show|list|rollup|next|ready|claim|verify|release|close
bwrk sprint list|launch|show|status|current|activate|board|report|metrics|close
bwrk dep add|remove|tree|cycles
bwrk evidence run|add
bwrk raw add|list|show|triage
bwrk source add|list|show
bwrk context show|search|rebuild
bwrk search query|index
bwrk decision create|list|show|supersede
bwrk workflows list|show
bwrk sync status|refresh
```

The exact flag grammar is defined by command fixtures before agents automate
it. Help output and machine-readable argument errors must agree. No adapter
should require a model to rediscover the same flag syntax after a pause.
The keep contract distinguishes preserving a v1 behavior from preserving its
exact spelling; a changed spelling needs a tested alias or migration map.
The v1 `status` alias means `prime`; use `agent status` for the active snapshot
and add a revision cursor there or under a new `snapshot` path. Milestones and
tasks are `work` kinds, not existing top-level CLI families. `memory ...`,
`agent resume`, and low-level `work accept|heartbeat|checkpoint|finish` are
proposed v2 surfaces/API operations, not observed v1 commands; their exact CLI
grammar is a P0 decision.
`agent start` and `agent finish` are guided, consolidated entry points over
the same atomic claim/attempt and evidence/closeout use cases as lower-level
commands; they do not create a second state machine. Preserve useful v1
aliases or provide an explicit command migration map.

## Self-guiding agent contract

The Rust application compiles a revision-bound `AgentGuide` from current
work, attempt, eligibility, blockers, gate state, receipts, and relevant
project context. It owns a versioned, trusted directive registry. The CLI and
TUI render that same guide; a harness can request it through the local API.
The first routes are discover/claim, resume, implement/checkpoint,
verify/evidence, finish/release, and recover. Broad custom workflow packs may
come later; this core loop cannot.

`bwrk agent guide --json` explains the loop and current obligations;
`bwrk next --json` selects one safe action or returns typed `idle`, `blocked`,
`needs_operator`, or `unavailable`. The result includes project revision,
attempt ID/fence when applicable, directive-registry version, reason codes,
context references, required/optional obligations, and an exact action with
runner, argv, cwd, and `shell: false`. It never requires a model to assemble
a command from prose. Mutating actions still recheck revision/fence and
eligibility in the store transaction; a guide is not a claim or lease.

Only registry-owned instruction templates may become trusted executable
actions. Work titles, descriptions, source text, summaries, and authored
commands are displayed as data. A declared verification command requires
explicit bounded execution/attestation policy; it is not promoted to shell
authority by appearing in a task. Required/blocking directives and gate
failures are enforced by application transactions, not just CLI rendering.
If context is stale or an operation outcome is unknown, return a readback or
resnapshot action instead of blindly retrying.

## JSON envelope

Every JSON command returns one bounded, versioned envelope with stable field
types. A proposed shape:

```json
{
  "api_version": "2",
  "operation_id": "op_...",
  "revision": 42,
  "as_of": "2026-09-14T22:00:00Z",
  "next_status_change_at": null,
  "transport": "ok",
  "outcome": "changed",
  "data": { "active_attempts": [], "ready": [], "counts": {} },
  "detail_ref": null,
  "error": null
}
```

`transport` means the request reached the service and was decoded. `outcome`
means the application result: changed, unchanged, rejected, conflict, busy,
or failed. A successful process exit with a failed application outcome is not
silently treated as success. The CLI exit code mirrors the documented outcome
class. Lists remain arrays even when empty. A truncated result is never normal
`data`; it is an explicit referenced detail with digest, size, and expiry.

Routine status includes current attempts, ready counts, blockers, active
sessions, closeout gaps, and the next event/timer deadline. Historical
assignments require a separate paginated query. The initial response-size
target from the audit is approximately 2–8 KiB for a three-agent active
snapshot, independent of completed history length; measure actual bytes.
It reports `queued` prerequisite waits separately from hard `blocked` work,
and `expired_review` separately from closed or cancelled tasks. Time-driven
labels are evaluated at `as_of` with `next_status_change_at`, so a late timer
does not make an expired claim appear valid. See [STATUS_MODEL.md](STATUS_MODEL.md).

## Revisions and notifications

Each mutation returns a monotonic project revision and operation ID. Read
models name the revision used for all fields. A change stream reports revision
and affected subject IDs, with a bounded replay cursor. The TUI coalesces
notifications, requests one snapshot when needed, and renders after the read
transaction closes. On disconnect or missed cursor, it fetches a fresh
snapshot. On unchanged state, it does not perform a new model-mediated poll.

Use a single validation adapter for inline/referenced objects and arrays,
empty stdout, stderr, invalid JSON, nonzero exits, missing files, and a
successful transport carrying an application failure. Referenced paths are
validated against an allowed directory with size/digest checks. Cache writes
are atomic and tagged by source revision.

Keep protocol schemas and example fixtures in the v2 repository. Generate or
validate the TypeScript client types from the Rust protocol contract; never
hand-maintain a second incompatible DTO definition. Include version-negotiation
and unknown-field behavior in the fixtures.

## Runtime and compatibility identity

Each attempt records the Rust binary/protocol version, schema version,
harness adapter identity, and relevant toolchain fingerprint. A running
attempt uses a resolved immutable executable identity. Updating the CLI or
app dependencies during a run does not silently rebase that attempt. Upgrade
uses explicit pause, compatibility check, and resume. App source/lockfile
changes are evidence inputs; they are not automatically the Boreal binary's
identity.

## TUI specifics

Keep the TS TUI as a replaceable client. Port useful navigation, responsive
layouts, validation, refresh coalescing, and confirmation behavior from the
legacy TUI selectively. Use a long-lived API connection; do not spawn one CLI
process per route refresh. The TUI must display `queued`, `claimed`,
`accepted`, `running`, `blocked`, `expired_review`, `verification needed`,
`complete`, and `closed` without conflating them. It must support the core
mutation loop with the same request types as
CLI clients. A manual refresh returns a current revision or a precise stale/
unavailable indication.
