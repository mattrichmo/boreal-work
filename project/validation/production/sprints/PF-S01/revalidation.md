# PF-S01 exact-tree revalidation — PF-S01-T92 attempt 3

## Decision

**Accepted for AC-01 / PF-S01-T92 only.** The current combined tree passed
every required structural and provenance check listed for this revalidation.
This is the independent PF-S01 exit-gate result; it is not runtime, service,
native, installer, publication, backup/restore, signing, performance, or
production-release acceptance.

## Source and reviewer identity

- Reviewer: independent validation reviewer; no PF-S01 implementation leaf was
  implemented by this reviewer.
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 54 entries. The dirty
  state is part of the evidence subject and is not a release identity.
- `execution/STATE.json` SHA-256: `05b1efb15d2b74fecccc6cf913b11a08a80e57db84ea5b6a5cac5bc801b75704`.
- Current contract-manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.

## Prerequisite and provenance readback

- PF-S00-T92 is accepted at its bounded exact-tree gate and its handoff exists.
- Canonical accepted T01–T11 handoffs were read. T01 attempt 2 remains the
  preserved historical accepted-attempt handoff; T01 attempt 3 is the accepted
  task-level superseding provenance handoff.
- T90 attempt 7 remains a rejected finding review with three preserved
  provenance findings. T90 attempt 8 independently accepted that bounded
  finding-classification task after T91 remediation; it did not accept PF-S01
  or T92.
- T91 attempt 2 is accepted only at the coordinator provenance-remediation
  layer. Its three corrections were independently read back here without
  editing `STATE.json` or any source/contract file.

## Required exact checks

| Check | Result | Current observation |
| --- | --- | --- |
| Source identity / dirty state | passed | HEAD, branch, dirty worktree, state digest, and manifest digest recorded above. |
| `python3 -m json.tool project/build-plan/production-completion/execution/STATE.json` | passed | Current ledger parses as valid JSON. |
| T11 digest + 21 pointer + T01 preservation/supersession assertion | passed | Manifest digest matches T11; 10 task-level and 11 accepted-attempt pointers target existing `HANDOFF.md`; zero `START.md` targets; T01 attempt 2 stale text is preserved and attempt 3 is canonical/accepted. |
| `python3 project/spec/validate_contracts.py` | passed | 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `python3 tools/plan.py validate` from the plan directory | passed | 22 sprints, 265 tasks, 48 obligations, 56 acceptance rows, 265-node acyclic graph, 17,134 local links, zero errors. The prior T90 reviewer-attribution blocker did not reproduce on this current tree. |
| `python3 tools/plan.py graph-ready` from the plan directory | passed (advisory) | `tasks: []`; readiness is not authorization. |
| `python3 tools/plan.py verify-package` from the plan directory | passed | 444 files checked, zero mismatches. |
| Read-only manifest/conformance identity and joins | passed | 19 manifest entries, 48 obligations, 49 vectors, 49 vector-metadata rows, zero hash mismatches/dangling/join differences, 14 required categories represented, all vector dispositions `unmeasured`. |
| `git diff --check` | passed | No whitespace errors. |

## Gate effect and limitations

PF-S01-T92 is accepted for AC-01. The ordinary PF-S01 successor entry gates
may be evaluated by their own dependency and authorization rules; this record
does not bypass them. No target capability is advertised by this evidence.

The conformance vectors remain `unmeasured` by design, and all runtime,
service, migration, verifier, race/fault, TUI, native, installer,
backup/restore, signing, performance, publication, and release layers remain
unrun and unaccepted. Historical failed/rejected attempts and the dirty source
identity are preserved.
