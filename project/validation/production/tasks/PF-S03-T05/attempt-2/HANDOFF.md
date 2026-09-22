# PF-S03-T05 independent review attempt 2 — handoff

## Identity and disposition

- Task / plan / attempt: `PF-S03-T05` / production-completion plan /
  `attempt-2`.
- Reviewer: independent reviewer; did not implement the leaf.
- Exact reviewed source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2` on
  `codex/apply-responsive-terminal-overlay`, dirty combined tree.
- Decision: **REJECT for PF-S03-T05 only**; reconciliation is required.
- Coordinator ledger/state: not edited. No sprint, service, native,
  publication, or release decision is made by this handoff.

## Review conclusion

The implementation passes the requested exact-tree checks and the visible
positive focused cases, including project-local graph validation,
direct-endpoint kind rejection, deterministic duplicate/self/cycle handling,
accepted-closed-only satisfaction for the supplied current observation,
edge-scoped waiver validity/readback, insertion-order-stable subgraphs, and
pending/active/historical impact classification.

It is not acceptable for this leaf because the source review found:

1. **F-PF-S03-T05-01 (blocker):** unreadable/corrupt/stale prerequisite facts
   have no typed representation. Missing observations are conservative but
   indistinguishable from unreadable facts, and malformed observations abort
   rather than preserving per-edge raw diagnostic context. This leaves known
   critical F06 uncovered.
2. **F-PF-S03-T05-02 (major):** a waiver-revocation event invalidates the
   named edge without checking that a current matching waiver exists or that
   the edge is currently waived. It can falsely invalidate accepted-close
   references and propagate to downstream successors.
3. **F-PF-S03-T05-03 (major):** waiver-revocation structural previews root at
   the predecessor, so sibling dependents unrelated to the waived edge appear
   in `affected_subgraph`; the preview scope disagrees with the successor
   propagation scope.

Exact line evidence, contract references, counterexamples, and the full
validation record are in `EVIDENCE.md` and `COMMANDS.md`.

## Validation receipt

| Check | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Passed, exit `0`. |
| `cargo test --locked -p boreal-domain --test production_dependency_policy` | Passed, `11` tests, exit `0`. |
| `cargo test --locked -p boreal-domain` | Passed, `96` tests and `0` doc tests, exit `0`. |
| `cargo check --locked -p boreal-domain --tests` | Passed, exit `0`. |
| Strict clippy (`--tests`, `--lib`, and focused target; `-D warnings`) | Passed, exit `0`. |
| `git diff --check` | Passed, exit `0`. |

The Boreal workflow/candidate probes were read-only and returned typed
`service_busy` because the local database owner was already held. No lock was
broken and no lifecycle operation was attempted.

## Write boundary and next safe action

Only these review files were written:

- `project/validation/production/tasks/PF-S03-T05/attempt-2/START.md`
- `project/validation/production/tasks/PF-S03-T05/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T05/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T05/attempt-2/HANDOFF.md`

No production source, `project/build-plan/production-completion/execution/STATE.json`,
prior attempt, or unrelated dirty path was edited. The coordinator should
preserve attempt-1 and this rejected review, route the three findings to
bounded reconciliation, add the missing negative fixtures, and request a new
independent review/revalidation on the resulting exact combined source tree.
