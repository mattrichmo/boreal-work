# PF-S01-T06 attempt 1 start

Task: Freeze profiles, proof selection and independent review policy.

Input source snapshot: `codex/apply-responsive-terminal-overlay` at
`784a41b3802c29a76721c55eef2e9493283396c2`, with a pre-existing dirty
working tree owned by other lanes. Those paths are read-only for this attempt.

Registered write paths for this attempt:

- `project/spec/production/acceptance-profiles-and-review.md`
- `project/validation/production/tasks/PF-S01-T06/attempt-1/`

No source, plan, manifest, protocol, or other specification file will be
edited by this attempt. The task-card proposed paths are superseded for this
run by the explicit registered path above.

Interpreted invariant: a work item pins an immutable, content-addressed
profile and required-gate declaration; later observations, proof selection,
review decisions, overrides, dependency exceptions, and close intent cannot
rewrite that requirement or silently broaden optional gates. Evidence is
selected only after complete subject/source/config/policy matching, with
deterministic ordering and explicit supersession. Rejection remains distinct
from absence, and only an independent authenticated review can satisfy the
review gate.

Planned artifact: one normative production contract covering profile
versioning, required declarations versus observations versus decisions,
proof selection/supersession, review and intervention semantics, forced gate
and dependency exceptions, close-intent binding, migration/protocol impact,
and conformance vectors.

Verification: capture the baseline and prerequisite handoff identities;
validate the authored contract with the repository contract checks and
JSON/Markdown parsers that apply to the artifact; record exact commands,
versions, source identity, outputs, and any unavailable native checks in this
attempt directory. No product or release claim is made by this attempt.
