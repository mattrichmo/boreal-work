# Local orchestration workers

Orchestration remains a pull queue until an operator installs a trusted harness policy and explicitly requests local dispatch. Project runs and ticks use the canonical attempt lifecycle; a successful child process does not finish its attempt. The harness must produce evidence and use the normal finish path.

## Configure a harness

Create a small JSON file inside the linked project workspace. The path passed to `--input` must resolve inside that workspace and the file is limited to 32 KiB. Example:

```json
{
  "harness_id": "codex-local",
  "executable": "/absolute/path/to/trusted-runner",
  "args": ["run", "--project", "{project}", "--work", "{work}", "--attempt", "{attempt}", "--fence", "{fence}"],
  "cwd": ".",
  "environment": [],
  "timeout_ms": 1800000,
  "output_cap_bytes": 1048576
}
```

Arguments are passed as separate argv entries; there is no shell parsing. Available placeholders are `{project}`, `{work}`, `{attempt}`, `{actor}`, `{session}`, and `{fence}`. The configured working directory must be inside the linked workspace. The executable must be an absolute, executable, non-symlink file. The runtime clears inherited environment variables and provides Boreal identity variables plus the explicitly listed policy entries. Variable names containing `TOKEN` or `SECRET` are rejected. Configure records the JSON and its digest in append-only project storage, bound to the operator actor, session, and expected project revision:

```sh
bwrk orchestrate harness configure --project PROJECT --input .boreal/harness.json --expected-revision REV --yes
bwrk orchestrate harness list --project PROJECT
bwrk orchestrate harness show HARNESS_ID --project PROJECT
bwrk orchestrate harness remove HARNESS_ID --project PROJECT --expected-revision REV --yes
```

The actor must have the project operator role and the session must be active. Updating or revoking policy appends history; stored policy rows cannot be edited or deleted.

## Configure worker identities

An operator may register an allowlist of local worker identities. Each member uses an actor credential already stored in the project's owner-only `.boreal/credentials` directory and an active session bound to that actor and harness. Session IDs must be distinct because the canonical attempt model permits one current attempt per session. No credential is copied into the pool policy or passed to the child process.

```json
{
  "workers": [
    {"actor_id": "agent-a", "session_id": "session-a", "harness_id": "codex-local"},
    {"actor_id": "agent-b", "session_id": "session-b", "harness_id": "codex-local"}
  ]
}
```

Use `orchestrate pool configure POOL_ID --project PROJECT --input .boreal/worker-pool.json --expected-revision REV --yes`, then inspect with `orchestrate pool list` or `orchestrate pool show POOL_ID`. Revocation uses `orchestrate pool remove POOL_ID --expected-revision REV --yes`. Pool policy changes are append-only and stop new dispatch from an already running daemon.

## Dispatch and daemon

A single pull can opt into local launch with `orchestrate tick RUN_ID --dispatch-now`. Policy, executable, working directory, and session are checked before the canonical claim. A policy change between preflight and launch releases the claim without starting a child. Child output is drained with per-stream caps; only a digest and byte count are retained in the process record.

`orchestrate daemon run --pool POOL_ID --workers N --max-requests N` runs the same tick/claim/dispatch lifecycle for eligible queued or running runs. The pool can run up to 32 workers, each bound to its own active actor/session/harness identity and database connection. The scheduler only dispatches runs whose exact identity triple appears in the selected pool. It stops after the request limit, after 60 idle polls, or on SIGINT/SIGTERM. It does not impersonate a run bound to a different actor/session/harness. A daemon lease and every process job are durable and visible through `orchestrate daemon status`.

On restart, active process rows are marked `uncertain` and are never automatically redispatched: a coordinator crash cannot prove that an external harness stopped. Inspect the process job, verify external process state, and reconcile the canonical attempt using the normal Boreal lifecycle. The daemon is an explicit foreground command; no detached service is implied by status output.
