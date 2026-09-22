# PF-S00-T05 attempt 1 command record

Workspace: `/Users/cybertron/Code/boreal-work`

This is an inventory-only command record. Commands were read-only except for
creating the attempt directory, `START.md`, and this file. No secrets, live
SQLite contents, credentials, or external services were accessed. Timestamps
are UTC. Status is the observed process result, not a parity or release claim.

## Context and authority probes

| Timestamp | Command | CWD | Status / observed result |
| --- | --- | --- | --- |
| not captured (earlier context probe) | `bwrk prime --json` | `/Users/cybertron/Code/boreal-work` | `exit 0`, rejected envelope: missing project identifier; no state change. Exact operation output retained in task notes. |
| not captured (earlier context probe) | `bwrk workflows show boreal.workflow.claim-and-finish-work.v1` | `/Users/cybertron/Code/boreal-work` | blocked with `service_busy`; existing database owner reported; no lock break. |
| not captured (earlier context probe) | `bwrk workflows show boreal.workflow.closeout-work.v1` | `/Users/cybertron/Code/boreal-work` | blocked with `service_busy`; no state change. |
| not captured (earlier context probe) | `bwrk workflows show boreal.workflow.checkpoint-git-state.v1` | `/Users/cybertron/Code/boreal-work` | blocked with `service_busy`; no state change. |
| not captured (earlier context probe) | `bwrk workflows show boreal.workflow.link-dependencies.v1` | `/Users/cybertron/Code/boreal-work` | blocked with `service_busy`; no state change. |
| not captured (earlier context probe) | `git rev-parse HEAD` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `784a41b3802c29a76721c55eef2e9493283396c2`. |
| not captured (earlier context probe) | `git status --short` | `/Users/cybertron/Code/boreal-work` | `exit 0`; pre-existing dirty tree preserved; no reset/clean/checkout. |
| not captured (earlier context probe) | `rg -n 'PF-S00-T0[125]|reviewer|...' project/build-plan/production-completion/execution/STATE.json` | `/Users/cybertron/Code/boreal-work` | `exit 0`; T01/T02 accepted, T03/T04/T05 in progress, T05 reviewer null, T90/T91/T92 unassigned. |

The earlier context probes were not timestamped at invocation, so their
timestamps are recorded as uncaptured rather than reconstructed. The exact-
timestamped checks below are the reproducible inventory checkpoints for this
attempt.

## Exact-timestamped inventory checkpoints

| Timestamp | Command | CWD | Status / observed result |
| --- | --- | --- | --- |
| 2026-09-21T22:08:01Z | `date -u '+%Y-%m-%dT%H:%M:%SZ'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; attempt start timestamp captured. |
| 2026-09-21T22:08:01Z | `mkdir -p project/validation/production/tasks/PF-S00-T05/attempt-1` | `/Users/cybertron/Code/boreal-work` | `exit 0`; created only the exclusive evidence directory. |
| 2026-09-21T22:13:47Z | `date -u '+%Y-%m-%dT%H:%M:%SZ'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; command-record checkpoint timestamp captured. |
| not captured (earlier inventory probe) | `find v1/.boreal/ledgers -maxdepth 1 -type f -print0 | xargs -0 wc -l` | `/Users/cybertron/Code/boreal-work` | `exit 0`; ledger counts read without mutation. |
| not captured (earlier inventory probe) | `python3 -c '<JSONL counts, keys, outcome/status distributions>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; counts captured without emitting record bodies. |
| not captured (earlier inventory probe) | `python3 -c '<SHA-256 selected archives, ledgers, schemas, and source files>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; raw-source hashes captured in the machine inventory. |
| not captured (earlier inventory probe) | `uname -srm; sw_vers; command -v cargo rustc node pnpm bwrk` | `/Users/cybertron/Code/boreal-work` | `exit 0`; local executor is macOS 15.2 arm64 with Cargo/Rust/Node/pnpm/bwrk paths present. |
| not captured (earlier inventory probe) | `find scripts/validation ...; find scripts/release ...; find .github/workflows ...` | `/Users/cybertron/Code/boreal-work` | `exit 0`; declared validation/release harnesses and workflow files present. |
| not captured (earlier inventory probe) | `find . ... restricted-name scan ...` | `/Users/cybertron/Code/boreal-work` | `exit 0`; names of SQLite/settings-local files recorded; contents not opened. |

## Final validation checkpoint

| Timestamp (UTC) | Command | CWD | Status / observed result |
| --- | --- | --- | --- |
| 2026-09-21T22:21:23.567062+00:00 | `python3 -c '<load JSON and require six EXT-* records>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `JSON_VALID PASS`, six required external-input records present, inventory-only and parity claim false. |
| 2026-09-21T22:21:23.578892+00:00 | `python3 -c '<rehash every path in legacy-source-inventory.json>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `HASH_RECHECK PASS`, 22 sources, no mismatches. |
| 2026-09-21T22:21:23.547062+00:00 | `python3 -c '<scan six scoped artifacts for trailing whitespace>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `TEXT_SCOPE_SCAN PASS`, six files, no trailing whitespace. |
| 2026-09-21T22:21:41.417819+00:00 | `python3 -c '<run git status --short --untracked-files=all on exclusive paths>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; exactly the two baseline files and four attempt-1 files are reported as new scoped outputs. |
| 2026-09-21T22:21:41.384713+00:00 | `python3 -c '<list attempt-1 files>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `ATTEMPT_FILE_LIST PASS`, COMMANDS/EVIDENCE/HANDOFF/START present. |
| 2026-09-21T22:23:08.223519+00:00 | `python3 -c '<load inventory, require six EXT-* records, and rehash every raw source>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `FINAL_JSON_HASH_SCOPE PASS`, six external inputs, 22 sources, no hash mismatches, inventory-only claims preserved. |
| 2026-09-21T22:23:08.214719+00:00 | `python3 -c '<verify six scoped artifacts exist and contain no trailing whitespace>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `FINAL_ARTIFACT_SCAN PASS`, six files present and clean. |
| 2026-09-21T22:23:51.512592+00:00 | `python3 -c '<post-edit load inventory, require inventory-only claims, and rehash 22 raw sources>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `POST_EDIT_JSON_HASH PASS`, 22 sources, no mismatches. |
| 2026-09-21T22:23:51.490450+00:00 | `python3 -c '<post-edit scan six scoped artifacts for trailing whitespace>'` | `/Users/cybertron/Code/boreal-work` | `exit 0`; `POST_EDIT_TEXT_SCAN PASS`, six files clean. |
| not captured (post-edit status probe) | `git status --short --untracked-files=all -- <six exclusive paths>` | `/Users/cybertron/Code/boreal-work` | `exit 0`; the two baseline files and four attempt-1 files remain the only scoped outputs. |

No application build, service lifecycle, migration, native release,
publication, or acceptance check is claimed by this inventory task.
