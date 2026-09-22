# PF-S00-T92 attempt 6 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`  
Source scope: current `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty;
pre-existing source changes are treated as the fixed input and are outside this
attempt's write boundary.

| Check | Result |
| --- | --- |
| Absolute `target/debug/bwrk workflows list --json` | exit 0; embedded package listed, 10 assets, identity `sha256:3402fd57a473bfccd10888465eb1c714ecda6e7a9af45fdd70589d06b44380d5` |
| Absolute `target/debug/bwrk workflows show boreal.workflow.audit.v1 --json` | exit 0; exact audit asset resolved |
| Absolute `target/debug/bwrk workflows show boreal.workflow.unknown.v1 --json` | exit 3; expected `not_found`, non-retryable |
| Absolute `target/debug/bwrk commands workflows --json` | exit 0; 2 available workflow routes, zero registry gaps |
| `python3 tools/plan.py validate` | exit 0; 22 sprints, 265 tasks, 48 obligations, 113 references, 56 acceptance rows |
| `python3 tools/plan.py verify-package` | exit 0; 444 files, zero mismatches |
| Relevant JSON parse and 48-obligation assertion | exit 0; 48 unique/mapped, zero accepted, all `mapped_not_accepted` |
| Required conservative conflict checks T90/T91/T92/T06/T07 | exit 0; no overlaps |
| `python3 project/spec/validate_contracts.py` | exit 0; 8 envelopes, 11 guidance fixtures, 10 workflow assets |
| `cargo fmt --all -- --check` | exit 0 |
| Three focused workflow tests | exit 0; 3 tests, OK |
| T06/T07 attribution and source-scope assertion | exit 0; current reviewer is `independent-coordination:codex-independent-reviewer`; historical coordinator records preserved; current T92 owner is distinct |

No PATH `bwrk` was used. No service was inspected or killed, and no direct
database access was used.
