# PF-S01-T01 attempt 1 — local-production contract

Started: 2026-09-21 (America/Regina)

Worker: named `CONTRACT` worker in the current Codex task; independent review
and coordinator acceptance remain separate.

Task: `PF-S01-T01` / plan `PF-production-completion-2026-09-21` version 1.

Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2; dirty`.
The accepted prerequisite is `PF-S00-T92` attempt 6, whose gate authorizes
exactly `PF-S01-T01` and makes no product or release claim. The baseline archive
identity recorded by that gate is
`sha256:09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`.

Exclusive product write path:
`project/spec/production/scope-and-boundaries.md`.

Exclusive evidence path:
`project/validation/production/tasks/PF-S01-T01/attempt-1/`.

Off limits: Rust, TypeScript, schema, protocol, root manifests, `plan.json`,
`execution/STATE.json`, databases, other evidence, and all unlisted product
paths. The existing dirty tree is preserved as fixed input.

Interpreted invariant: define one local macOS/Linux, same-host,
project-scoped production boundary with one Rust authority and thin clients;
separate planning identity, execution ownership, and accepted outcome; retain
core guided work/source-memory/isolation obligations; and do not adopt the
later cycle, sealed-submission, or scheduled-status recommendations.

Expected verification: run the supplied contract validator, read-only plan
structure/link/conflict checks, whitespace/format checks available in the
workspace, and record unavailable or non-applicable service checks honestly.
