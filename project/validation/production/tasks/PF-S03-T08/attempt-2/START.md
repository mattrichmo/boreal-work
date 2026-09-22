# PF-S03-T08 — independent review attempt 2 start

## Identity and boundary

- Task: `PF-S03-T08` — property, differential and exhaustive transition tests.
- Plan: `PF-production-completion-2026-09-21`.
- Reviewer: Codex independent validation reviewer; did not implement attempt 1.
- Review start: `2026-09-22T11:55:46Z`.
- Input source: branch `codex/apply-responsive-terminal-overlay`, HEAD
  `784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined tree.
- Review write boundary: this new directory only:
  `project/validation/production/tasks/PF-S03-T08/attempt-2/`.

No production source, task card, coordinator ledger, manifest, prior evidence,
or shared integration file may be edited by this review.

## Context read

Read the repository instructions, production-completion startup, dispatch and
shared-file rules, PF-S03 sprint and complete PF-S03-T08 card, the accepted
PF-S01-T92 gate, accepted PF-S03-T02 through T07 handoffs/evidence, the
production contract manifest and referenced status/action, transition,
execution/submission, acceptance/proof, and dependency contracts, plus the
attempt-1 source/evidence.

The prerequisite leaves are accepted only within their bounded scopes. Their
limits do not authorize a broader status, service, or release claim here.

## Review question

Determine whether the attempt-1 oracle and eight tests satisfy the task's
mandatory pure-domain coverage: normative status/action coverage, negative
cases, idempotence and ordering, deadline boundaries, close-only dependency
truth, historical invariance, legal/illegal transitions, and explicit
source/policy identity. Do not require service integration from this pure
validation leaf, but do reject claims that exceed the pure-domain evidence.

## Initial observations

- The submitted target is present and the focused command is runnable.
- The target exercises the current `DerivedStatus`/status-2 surface. The
  accepted status contract is status/3 and additionally defines `scheduled`,
  availability (`live`, `stale`, `unavailable`, `incompatible`), and integrity
  (`valid`, `degraded`, `quarantined`) dimensions.
- The action test checks partition and descriptor self-round-trip, but does
  not yet assert the normative allow/deny result for each status/role/fact
  combination.
- The local transition oracle is co-located with the test and is not linked to
  the normative transition IDs or a versioned policy identity.

These observations are hypotheses for fresh validation, not acceptance or
rejection by themselves.
