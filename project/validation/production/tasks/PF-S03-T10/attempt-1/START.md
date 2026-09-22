# PF-S03-T10 — attempt 1 start

## Identity and boundary

- Task: `PF-S03-T10` / plan `PF-production-completion-2026-09-21`.
- Worker: Codex validation worker; independent review remains required.
- Input source: `codex/apply-responsive-terminal-overlay@784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined tree.
- Granted writes: `crates/domain/tests/production_properties.rs`, `project/validation/production/domain/`, and this attempt directory only.
- Off limits: production source, plan/task cards, execution ledger, manifest, shared roots, prior evidence, live databases and service state.

## Inherited findings being remediated

This attempt consumes the rejected PF-S03-T08 independent review attempt 2:

- bind the oracle to `boreal.work-status/3`, `boreal.work-transition/2`, and the accepted policy/source identities;
- map every normative T01–T18 and I01–I15 vector to executable pure-domain cases or explicitly record the service-only boundary;
- cover scheduled timing, all availability/integrity levels, and expected action allow/deny outcomes;
- extend historical invariance to evidence, review, submission, reopen and recovery facts;
- add deterministic shrinking and serialized minimal counterexamples.

## Accepted context read before editing

The worker read `AGENTS.md`, the execution startup/parallel/shared-file rules,
PF-S03 context, the PF-S03-T10 card, the rejected T08 handoff/evidence, the
accepted T02/T03/T04/T05/T06/T07 bounded handoffs, the production contract
manifest, `status-and-actions.md`, `transition-table.md`, and the validation
playbook. This is pure-domain evidence only; no service, store, verifier,
installation or release claim is in scope.

## Invariant and verification strategy

For a fixed canonical input, policy identity, source identity and clock, the
oracle must return the same status/reasons/actions and must reject every
illegal transition without mutating the input. Generated failures must print a
seed, case index and serialized minimized case. The focused property target,
full domain tests, strict domain Clippy, formatting, contract validation and
diff checks will be run on the final dirty tree and recorded in this attempt.
