# PF-S03-T09 domain decision/action API handoff

## Scope and source identity

This handoff is the bounded non-shared portion of PF-S03-T09. It adds
`crates/domain/tests/production_domain_api.rs` and does not modify the domain
crate root or any application, store, service, protocol, or TUI policy path.

The tests were authored against:

- Git `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Working tree: dirty because coordinator-owned changes were present; the
  domain production source files were unchanged during this task.
- Domain root: `ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c`
- Action policy: `8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7`
- Status evaluator: `3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f`
- Added contract target: `d407b3dceffd1349485c23b4d3aad4f145b43154a31769947eb4923201b600b0`

The test target is intentionally a domain-boundary contract target, not a
claim that the production adapters already call the canonical action policy.

## Contract exercised

The adapter handoff is modeled as:

1. obtain one canonical snapshot of `DecisionInputs`;
2. obtain the canonical `StatusDecision` and preserve its `display_status` and
   ordered `reason_codes`;
3. call `evaluate_actions(ActionEvaluationInput::new(facts, status,
   reasons))`;
4. expose the returned descriptors and denials without rebuilding them from
   display labels;
5. submit a mutation using the descriptor's target, project/entity/proof
   revisions, attempt/fence and required authority inputs;
6. reread the same facts and evaluate the requested action again inside the
   committing transaction.

The target proves descriptor target identity, revision binding, required role
and input metadata, deterministic allowed/denied partitioning, reason-driven
authority, safe recovery under a hard hold, fail-closed stale context, and
quarantine repair versus forward-progress behavior.

The ignored test is a retained executable witness for PF-S03-R7. At the
current source, `evaluate_status` reports ordinary open task work as ready and
claimable for an Operator, while `actions::required_roles` requires Agent for
ordinary `Claim`. The test records the mismatch rather than normalizing it in
the fixture.

## Required coordinator integration requests

These are concrete requests for the shared-file steward. They are not applied
by this worker.

### R1 — one public decision/action seam

- In `crates/domain/src/lib.rs`, add a coordinator-owned public seam that
  accepts a canonical status decision plus the same `DecisionInputs` and
  returns the paired action decision, for example a typed
  `DecisionActionView { status, actions }` or an equivalently explicit
  `evaluate_decision_actions` function.
- Re-export the approved action descriptor/request/denial types from the
  domain root or publish an equivalent stable root path. Do not create a
  second evaluator or a wrapper that reconstructs status from strings.
- In application status/read and mutation use cases, call that seam from the
  same canonical snapshot. The service envelope must serialize descriptors,
  expected revisions, attempt/fence, required roles/inputs, confirmation and
  typed denial/recovery routes.
- Replace TUI action-availability calculations with the returned descriptors;
  the TUI may format them but must not decide policy.
- Add an application/service integration target that proves a descriptor from
  a read is rejected after its project/entity/proof/fence changes.

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

### R7 — reconcile ordinary Operator claim semantics

- Make an explicit contract decision for ordinary automatic work: either
  ordinary Operator claim is allowed and the action descriptor requires
  `Agent | Operator`, or status claimability for Operator is false while
  operator-only work remains an explicit operator path.
- Apply the decision in the one canonical status/action seam and add a vector
  that compares `StatusDecision.claimable_for_actor` with the returned Claim
  authorization for Agent, Operator, Reviewer and operator-only work.
- Do not satisfy this by changing only the test fixture or by making the TUI
  hide Claim.

## Non-claims and next safe action

This handoff does not claim R1–R6 production integration, service
authentication, corruption isolation, status/2 compatibility, or TUI parity.
The next safe action is for the coordinator to assign the shared-domain seam
and adapter remediation as bounded tasks, then rerun this target plus the
required store/application/service checks on the combined source revision.
