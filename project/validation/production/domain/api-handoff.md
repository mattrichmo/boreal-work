# PF-S03-T09 domain decision/action API handoff

**Disposition:** bounded domain contract work is ready for coordinator
integration; it is not task acceptance or sprint acceptance.

## Scope and source identity

This handoff covers only the bounded non-shared portion of PF-S03-T09:
`crates/domain/tests/production_domain_api.rs` and this document. The test
file already contained uncommitted work before this pass; those changes were
preserved and extended. No domain production source, crate root, application,
store, service, protocol, TUI, plan, or coordinator state was edited.

Current inspection identity:

- Git `HEAD`: `abf87bb528b55632499bb246c10aeb902680a582`
- Branch: `codex/apply-responsive-terminal-overlay`
- Working tree: dirty before and after this bounded pass; unrelated changes
  were preserved. A dirty tree hash is not an immutable integrated revision.
- The PF-S01-T92 prerequisite is accepted at its attempt-3 handoff; PF-S03-T08
  is accepted for pure-domain test evidence at attempt 5. Their accepted
  handoffs identify older source revisions, so this pass reran its own focused
  target against the current working tree.

The test target is intentionally a domain-boundary contract target, not proof
that production adapters already call the canonical action policy.

## Contract exercised

The test exercises the currently public domain path as:

1. create one typed `DecisionInputs` snapshot, including clock, subject,
   authority, requirements, integrity, and permitted actions;
2. call the crate-root `evaluate_canonical_status` with matching domain work
   context and that snapshot;
3. pass the returned status and ordered reasons, with the *same* snapshot, to
   the public `actions::evaluate_actions` API;
4. verify that claimability agrees for Agent, Operator, Reviewer, and
   Publisher under both automatic and operator-only dispatch;
5. retain descriptor target/revision/fence bindings and typed denials, without
   deriving authority from status labels.

The target also proves descriptor target/revision binding, required role and
input metadata, deterministic allowed/denied partitioning, safe recovery under
a hard hold, stale-context denial, and quarantine repair versus forward
progress. A second focused test verifies the public persistence guard rejects
all 15 `DerivedStatus` variants with `DerivedStatusReadOnly`.

## Current public API boundary

`crates/domain/src/lib.rs` currently exports `evaluate_canonical_status` and
the legacy-compatible `evaluate_status`; `actions` and `decision_inputs` are
public modules whose types and functions are reachable through those module
paths. The bounded test now uses `evaluate_canonical_status` for its
status/action conformance vector. It does not prove there is a single paired
status-plus-actions function or that adapters cannot supply a mismatched
status/reason vector to `evaluate_actions`.

The only persisted lifecycle type is `PersistedLifecycle` (`Draft`, `Open`,
`Closed`, `Cancelled`). Derived labels are represented by `DerivedStatus` and
the public `reject_derived_status_write` guard returns a typed error. A
source/API search found no domain setter that persists `display_status`; the
test covers rejection for every current derived label. This is not a claim
about direct edits to a database by a same-user process.

Current consumer inspection found that `crates/application/src/status.rs`
and `crates/store/src/status_evaluation.rs` each call the canonical status
evaluator and then separately construct `ActionEvaluationInput` for
`actions::evaluate_actions`. They pass the same canonical action facts and
status decision, but the pairing is not enforced by one domain API. The TUI's
current `serverActionAvailability` consumes service-provided descriptors and
fails closed when they are absent; this bounded facade request does not call
for a new TUI policy implementation.

## Required coordinator integration requests

These are concrete requests for the shared-file steward. They are not applied
by this worker.

### R1 — one stable paired public decision/action seam (coordinator action)

- `crates/domain/src/lib.rs` is coordinator-managed and was not edited. Add a
  minimal typed facade (for example `evaluate_decision` returning
  `{ status, actions }`) that evaluates status and actions from one validated
  fact snapshot. It must not accept caller-authored status strings or allow a
  caller to pair unrelated `DerivedStatus`/reason values with those facts.
- Re-export the approved canonical fact and action input/output types from the
  crate root, or name one root-level stable facade as the supported public
  API. Preserve compatibility for existing callers; do not add a second
  status or action policy implementation.
- The facade must reject or diagnose mismatched subject, project, revision,
  actor, clock, lifecycle, requirements, and gate context rather than
  silently reconciling them.
- After the facade lands, extend this owned target to call it directly and
  assert the returned status/actions are one result. Application/store/service/TUI
  envelope compatibility and transaction-time revalidation remain separate
  integration work; this task did not modify those layers. At the current
  source, application status projection, store read/claim authorization, and
  TUI descriptor decoding are the concrete consumers to preserve while the
  application/store calls move to the facade.

### R2 — rejected review remains intervention

- In the store status projection, preserve the typed review outcome and exact
  submission/proof subject instead of reducing review state to an
  accepted/not-accepted boolean.
- Map a rejected required review to `GateState::Failed` with its gate kind
  `Review`, so the domain produces `ReviewRejected` / blocked reconciliation,
  not an open/missing-proof fallback.
- Add store/application coverage for rejected, returned, pending and
  approved review readback, including the exact review and submission IDs.

### R3 — recovery obligations enter status inputs

- Load unresolved recovery obligations and retained expired-attempt facts into
  the canonical snapshot used for status. Clearing `current_attempt` must not
  remove the recovery fact.
- Extend the shared status/action input seam as needed so both status and
  actions see the same recovery identity, attempt/fence and project revision.
- Add restart/late-sweeper coverage proving the dashboard reports
  `expired_review` and exposes recovery while claim remains denied.

### R4 — row-scoped corruption quarantine

- Change project-wide gate, receipt, review and summary scans from fail-the-
  whole-snapshot parsing to row-scoped diagnostics when subject identity can
  be established safely.
- Preserve valid sibling rows and mark only the affected work integrity
  degraded/quarantined. Counts must be exact or explicitly incomplete.
- Add malformed gate/receipt/review fixtures through the store/application
  boundary; a passing pure-domain fixture is not sufficient for this request.

### R5 — status/2 compatibility mapping

- In the application compatibility mapper, map `ExpiredReview` to status/2
  `blocked` with `expiry_review_required` and the original expiry reason.
- Ensure CLI, service and TUI consume that one mapped response; no adapter may
  emit raw `expired_review` to a status/2 client or treat it as ordinary
  dependency waiting.
- Add a protocol/application regression for scheduled and expired mappings,
  including mutation denial and recovery descriptors.

### R6 — authenticated actor authority

- Stop treating a caller-supplied actor ID as authentication. Resolve the
  authenticated principal/session/delegation at the service boundary and bind
  it to the project and role used to construct `DecisionInputs`.
- Reject wrong-principal, project-crossing, session-reuse and invalid
  delegation cases before action evaluation; preserve typed denial and audit
  identity.
- Add a real service-boundary test. Store role lookup alone is not evidence of
  caller identity.

### R7 — ordinary Operator claim semantics (current source is aligned)

The current domain source chooses Agent-only claim for ordinary automatic
work, while Operator may claim explicitly operator-only work. The active
contract vector now exercises Agent, Operator, Reviewer, and Publisher against
both dispatch modes through canonical status evaluation and the action
descriptor API. This is a source-level conformance result, not a separate
owner decision or adapter/service acceptance.

## Validation performed for this bounded pass

| Command | Exit | Result |
| --- | ---: | --- |
| `cargo test --locked --offline -p boreal-domain --test production_domain_api` (before edits) | 0 | Existing target: 7 passed. |
| `rustfmt crates/domain/tests/production_domain_api.rs` | 0 | Formatted only the owned test file. |
| `cargo test --locked --offline -p boreal-domain --test production_domain_api` (after edits) | 0 | 8 passed; 0 failed; 0 ignored. |

This pass did not run full-domain, adapter, service, release, or native checks.
Prior attempt-1 evidence was not rewritten; its source identity is historical.

## Non-claims and next safe action

This handoff does not claim application/store/service/TUI integration,
authenticated service authority, corruption isolation, status/2 compatibility,
or task/sprint acceptance. The next safe action is the coordinator-owned
paired API/export change in R1, followed by a fresh direct test through that
API and separately bounded adapter integration/review work. R2–R6 above are
inherited out-of-scope integration requests and must not be treated as solved
by this pure-domain target.
