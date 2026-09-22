# PF-S00-T08 attempt 3 — handoff

Status: implementation complete, pending independent review; no task acceptance claimed.

## Outcome

The missing project-independent workflow discovery path is implemented within the approved remediation boundary. Direct and Unix-service queries use the embedded, validated workflow package, preserve exact package/asset identity, return typed unknown-reference errors, and do not require a project database. The stale-binary and service project-context issues that caused the previous T92 probe to fail are addressed.

## Invariants preserved

- Workflow assets remain guidance and routing data; they do not authorize lifecycle transitions.
- The Rust application/service boundary remains authoritative.
- No SQLite schema, migration, project identity, attempt, receipt, domain transition, or release layout changed.
- Failed worker attempts and prior T92/T91 evidence remain preserved.
- Direct workflow reads run before database-owner acquisition; a live dashboard owner is not force-broken.

## Review request

A fresh independent validator must inspect the combined source, rerun the focused tests and direct/service parity checks, verify the exact changed-path boundary, and report whether T08 is acceptable. The validator must not edit product source or the execution ledger. After that review, the coordinator will update the ledger and rerun T91/T92 as separate acceptance steps.

See [COMMANDS.md](COMMANDS.md) and [EVIDENCE.md](EVIDENCE.md) for exact commands, outcomes and artifact identities.
