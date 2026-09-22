# PF-S03-T08 — attempt 4 evidence

## Record and source identity

- Record: `PF-S03-T08/attempt-4`.
- Evidence class: pure-domain, deterministic property, differential, and
  exhaustive transition evidence.
- Input/current committed source: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`.
- Worktree: dirty combined tree; unrelated worker changes were preserved.
- Executable source record:
  `project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md`.
- Bound policy: `boreal.work-status/3`, `boreal.work-transition/2`, fixture
  `m02-candidate.1`.
- Contract artifact hashes and bound domain implementation/test hashes are
  recorded in the source record and repeated in `COMMANDS.md`.

## Reviewed defects fixed

1. The oracle now binds to the current integrated committed revision and the
   actual included policy, domain implementation, test, and oracle bytes. A
   changed `HEAD` or bound byte fails the focused target until the record is
   intentionally regenerated.
2. Every legal `T01`–`T18` and illegal `I01`–`I15` ID is checked against its
   normative transition-table row and executes a distinct semantic assertion,
   except for the explicitly bounded service-only persistence rows `T18` and
   `I14`.
3. `I04` now mutates a requested action's incumbent attempt identity/fence and
   asserts a typed `StaleFence` denial; observing `Claimed` alone is not used
   as a parallel-attempt proof.
4. `I06` distinguishes missing review, self-review rejection, and an accepted
   independent review at the close-readiness boundary.
5. `I08` evaluates `Complete`, `Verified`, and `Cancelled` prerequisite facts
   as typed `NotAcceptedClosedOutcome` results, retains each raw observation,
   and uses an exact accepted closed identity as the positive control.

## Pure-domain coverage retained

- Four fixed LCG seeds × 256 generated status cases (1,024 total), repeated
  evaluation, reordered facts, stable primary/secondary reason ordering, and a
  deterministic serialized shrink/replay path.
- Legal and illegal attempt/lifecycle transition matrices, derived-status
  write rejection, exact lease/hard-budget equality, renewal immutability,
  backward-clock expiry stability, terminal/reopen invariance, and failed /
  released / cancelled history preservation.
- Schedule before/equality/activation boundaries with status/2 compatibility
  preserved as queued plus scheduled-start/non-claimable behavior; no status/3
  serializer is advertised.
- Availability `stale`/`unavailable`/`incompatible` and integrity
  `degraded`/`quarantined` action limits, typed diagnostics, role denial,
  stale revision/entity/proof/fence, malformed facts, and safe recovery paths.
- Close-only dependency truth across complete, verified, cancelled, failed,
  unaccepted, revoked, mismatched, unreadable, corrupt, stale, waiver, and
  exact accepted-close observations, including raw-fact retention and cycle
  rejection.

## Results

| Check | Outcome |
| --- | --- |
| Focused `production_properties -- --nocapture` | Passed, 23/23. |
| Full `boreal-domain` suite | Passed, 139 unit/integration tests; doc-tests 0/0. |
| Strict domain Clippy | Passed with `-D warnings`. |
| Owned rustfmt | Passed. |
| Contract validator | Passed. |
| `git diff --check` | Passed. |
| Workspace rustfmt | Not passed because of pre-existing drift outside the grant in CLI/memory test files. |

## Layer boundary and limitations

This is pure-domain evidence only. It does not prove SQLite transactions or
revision advancement, authenticated service routes, operation replay/readback,
genuine verifier execution, process/resource stop, store snapshot completeness,
CLI/TUI behavior, native packaging, installation, publication, or release
qualification. `T18` expiry resolution and `I14` operation replay conflict
remain service/persistence boundaries and are not faked here. `T08` close
readiness and `I07` missing close intent are pure predicates; persisted close
intent and terminal writes remain outside this evidence layer.

Attempts 1–3, including their failed/rejected observations, remain preserved.
No operation, receipt, reviewer identity, plan/state update, commit, or push was
fabricated by this attempt.
