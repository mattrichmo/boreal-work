# PF-S01-T09 attempt 2 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`
Input revision: `784a41b3802c29a76721c55eef2e9493283396c2` plus dirty working-tree changes already in scope.

| Command | Result |
| --- | --- |
| `python3 project/spec/validate_contracts.py` | passed: 8 envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| T09 required-keyword, Markdown fence, and trailing-whitespace check | passed for `project/spec/production/release-support-and-budgets.md` |
| Native resource benchmark, multi-process isolation, signed artifact, backup/restore, supported-target release smoke | not run in this contract attempt; no product or release pass claimed |

The contract was authored against the current release, packaging, performance,
security, DEC-11, service, and compatibility references. No generated binary,
database, external service, or release artifact was changed.
