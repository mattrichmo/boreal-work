# Long-running tasks

Boreal separates planning state from execution state. A `WorkItem` describes what should be done; an `ExecutionRun` describes one attempt to do it. This separation makes long-running work restartable, observable, and safe to reconcile after a process or machine interruption.

## Lifecycle

```text
queued → running → succeeded
   │        │  └── failed → retry → queued
   │        ├── waiting → queued
   │        ├── paused → running
   │        └── stale → needs_attention → resume/retry
   └────────────────────── cancelled
```

Runs are durable records under `.boreal/objects/runs/` in the default object store. File-v2 stores the same records in `state.json`. Checkpoints are separate append-only records under `.boreal/objects/run-checkpoints/`; the run only stores the latest checkpoint pointer and sequence.

Each run records:

- the work item and attempt number;
- an optional reservation and idempotency key;
- the worker fence identity;
- heartbeat and stale-after timestamps;
- phase and bounded progress data;
- a typed wait condition;
- retry limits and backoff;
- bounded command result hashes and excerpts; and
- the last checkpoint reference.

Work status remains the project-management truth. A successful run does not close work automatically: evidence, verification, and closeout still use the existing guarded workflow.

## CLI

Create an external-worker run:

```bash
bwrk run start <work-ref> --idempotency-key import:2026-08-04 --max-attempts 3 --json
```

Create a locally executable run. Commands are parsed without a shell and are limited to approved executables (`bwrk`, `git`, `node`, `npm`, and `pnpm`):

```bash
bwrk run start <work-ref> \
  --command 'pnpm test -- tests/runtime/long-running-runs.test.ts' \
  --timeout-ms 3600000 \
  --json
bwrk run worker --json
# Or keep a local worker polling until interrupted:
bwrk run worker --loop
```

Record progress and a resumable cursor:

```bash
bwrk run checkpoint <run-id> --phase ingest --completed 200 --total 1000 \
  --unit records --cursor source:200 --json
```

Use typed waiting, manual retry, and reconciliation:

```bash
bwrk run wait <run-id> --kind timer --reason-code rate_window \
  --reason 'Waiting for the next source window' --wake-at 2026-08-04T01:00:00Z --json
bwrk run reconcile --json
bwrk run retry <run-id> --json
```

`--idempotency-key` makes repeated start requests return the existing attempt for that work and key. Retry creates a new attempt linked by `parentRunId`; no side-effecting retry is implicit.

## Worker safety

The built-in worker is intentionally small. It claims one queued run atomically, records its worker identity and heartbeat, executes a shell-free approved command with bounded output, and persists the result. The process runner can start a dedicated process group and terminates the group on timeout or cancellation so child processes do not outlive the run.

Runs without a command are for external workers. External workers should claim/resume a run, heartbeat while active, checkpoint at safe boundaries, and finish or fail it explicitly. A worker identity fences updates from an old or duplicate worker.

The daemon watch performs reconciliation only when the selected project boundary and locks are healthy. It marks missed heartbeats as `needs_attention` and requeues timer waits whose wake time has arrived. It does not execute arbitrary work.

## Events and cursors

Run transitions and checkpoints append runtime events. Consumers can read the event stream without using reviewer heartbeats:

```bash
bwrk events tail --limit 100 --json
bwrk events cursor ci --consumer buildkite --event <event-id> --json
bwrk events tail --cursor ci --consumer buildkite --json
```

Event cursors are durable, named by consumer and stream, and can be exported with the rest of the runtime state. They are independent of work review watermarks.

## Operational limits

Runs are durable orchestration primitives, not a distributed queue. The worker processes one local run per invocation by default, or polls locally with `--loop`; command execution is bounded by timeout and output caps. Use an external scheduler or worker fleet when execution requires multi-host placement, provider-specific leases, large log storage, secret injection, or durable artifact storage. Persist the provider’s run identity and checkpoint URI in the run/checkpoint fields so the external system remains inspectable without making Boreal depend on it.
