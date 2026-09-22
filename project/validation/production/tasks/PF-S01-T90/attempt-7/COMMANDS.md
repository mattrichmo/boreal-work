# PF-S01-T90 attempt 7 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`  
Attempt timestamp: `2026-09-22T06:26:34Z`  
Reviewer: `01a0c7b0-5953-7aa2-b1b5-3db17b4975d2`  
Branch: `codex/apply-responsive-terminal-overlay`  
HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty before and after this review; no source or `execution/STATE.json` edits were made.

## Executed checks

| Check | Result |
|---|---|
| `python3 project/spec/validate_contracts.py` | exit `0`; `PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed` |
| `(cd project/build-plan/production-completion && python3 tools/plan.py validate)` | exit `0`; `22 sprints, 265 tasks, 48 obligations, 56 acceptance rows, 265-node acyclic graph, 17,134 local links, 0 errors` |
| `(cd project/build-plan/production-completion && python3 tools/plan.py graph-ready)` | exit `0`; no task blockers reported; advisory only |
| `(cd project/build-plan/production-completion && python3 tools/plan.py verify-package)` | exit `0`; `444 files, 0 mismatches` |
| `python3 -m json.tool project/spec/production/conformance-matrix.json` | exit `0` |
| `git diff --check` | exit `0` |
| Read-only manifest/conformance join audit | exit `0`; `entries=19 hash_mismatches=0 obligations=48 vectors=49 metadata=49 dangling=0 join_difference=0 missing_categories=[] bad_dispositions=[]` |
| Accepted T11 source identity assertion | exit `1`; current contract-manifest SHA256 `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1` is not the accepted T11 state value `dcb757903063fd1aef64f910ebc3f1a5c6fa01990c38bb955f1901aa644fad99` |
| Accepted handoff pointer audit | exit `1`; `accepted_pointer_errors=21`: 10 task-level T02–T11 pointers and 11 accepted-attempt pointers bind `START.md` instead of the handoff record |
| Read-only T01 handoff consistency inspection | exit `0`; actual handoff remains marked implementation-complete/pending independent review while State/review records it accepted |
| `target/debug/bwrk workflows show boreal.workflow.review.v1 --json` | exit `0`; workflow resolved; package identity `sha256:3402fd57a473bfccd10888465eb1c714ecda6e7a9af45fdd70589d06b44380d5` |
| `target/debug/bwrk work review-candidates boreal --json` | exit `6`; typed `service_busy`; local database owner already held by process `68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8` |

## Not run and not claimed

No Rust build or test, service lifecycle, database migration, verifier, multi-process race/fault, TUI, native, installer, backup/restore, signing, performance, publication, or production-release check was run. These results are a static contract/plan/evidence review only.
