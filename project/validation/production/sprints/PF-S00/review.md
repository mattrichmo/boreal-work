# PF-S00 independent review — PF-S00-T90 attempt 2

## Disposition

**Result: findings; S00 remains blocked and unaccepted.** This is an independent,
bounded artifact/control review. It is not product, service, platform, native,
release, publication, or sprint-exit acceptance.

- Task: `PF-S00-T90`, attempt `2`
- Reviewer/agent: independent validation subagent, state agent
  `01a0c62c-f386-7950-936c-a28218342509`
- Assigned source identity:
  `working-tree-aggregate:b8b1aeb028553c6594bc0a9d5a674c7df3fb2b8c6dfe25a4d84014d13ef4fb55; HEAD:784a41b3; dirty`
- Observed checkout: `/Users/cybertron/Code/boreal-work`, branch
  `codex/apply-responsive-terminal-overlay`, full HEAD
  `784a41b3802c29a76721c55eef2e9493283396c2`, dirty.

## Scope and sources

Reviewed the PF-S00 sprint/task cards, the T01–T07 accepted handoffs, the
entry packet, obligations map, baseline findings, external-input register, T06
dispatch contract and evidence contract, the execution ledger read-only, and
the production-completion plan validators. No source, plan, ledger, or prior
evidence was edited.

Primary paths:

- `project/build-plan/production-completion/sprints/PF-S00/SPRINT.md`
- `project/build-plan/production-completion/sprints/PF-S00/tasks/PF-S00-T90.md`
- `project/validation/production/baseline/entry-packet.md`
- `project/validation/production/baseline/obligations-map.json`
- `project/validation/production/baseline/findings.json`
- `project/validation/production/baseline/external-inputs.md`
- `project/validation/production/dispatch/AGENT_DISPATCH.md`
- `project/validation/production/evidence-contract.md`
- `project/build-plan/production-completion/execution/STATE.json`

## Review results

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Original M02 obligations | **Pass at preservation layer** | `obligations-map.json` contains exactly 48 expected IDs; all 48 have `historical_state: unaccepted_historical_obligation`, `current_state: mapped_not_accepted`, and `accepted: 0` in the map counts. This is mapping evidence, not obligation completion. |
| Baseline finding ownership | **Pass with routing limitation** | All 27 entries in `baseline/findings.json` have a non-empty owner. The seven T03 baseline failures also have downstream mappings in T03 evidence. `F22` uses sprint-level routing rather than a leaf-level owner and should be refined during reconciliation. |
| Missing input ownership/blockers | **Pass at register layer** | All six required external inputs have a status and named downstream gate/disposition. `EXT-MACOS`, `EXT-LINUX`, `EXT-HARNESSES`, `EXT-INDEPENDENT-REVIEW`, and `EXT-RELEASE-AUTHORITY` remain missing or restricted; `EXT-LEGACY` remains available only with completeness limits. |
| Evidence classification | **Pass; no promotion observed** | T03 records 16 pass/7 fail, labels static/fixture/unit/store/application-service/package classes, and explicitly disclaims genuine service, native, published-channel, and release proof. The focused application/service-boundary test is expressly not a genuine authenticated service lifecycle result. |
| Proposal/adoption boundary | **Pass** | The plan is `proposed_not_adopted`, the execution ledger adoption is `not_adopted`, and the entry packet says D22/D27, cycle, gate-stage, review, expiry, status, protocol, and identity recommendations are proposals only. No proposal is treated as authorization for a source change. |
| Dispatch write separation | **Pass for checked path intersections** | Plan conflict checks for T06/T90 and T07/T90 returned no path overlaps. T06 controls preserve whole-file/directory boundaries, failed attempts, unknown outcomes, and separate review/reconciliation/revalidation gates. Conservative conflict checks do not prove semantic isolation. |
| Plan structure | **Pass at planning layer** | `tools/plan.py validate` passed with 22 sprints, 264 tasks, 48 original obligations, 113 source references, and 56 acceptance rows. `graph-ready` returned no tasks and warns that readiness is not authority. |

## Findings

### PF-S00-T90-001 — coordinator self-acceptance is inconsistent with independent dispatch

Severity: **critical**. `execution/STATE.json` records PF-S00-T06 and
PF-S00-T07 with both `agent: coordinator` and `reviewer: coordinator`, while
the dispatch rules require reviewers to be independent of the implementation
principal. The T06 handoff also describes a coordinator takeover, so this is
not merely a missing label. The controls are documented, but their own
acceptance records do not satisfy the independence control.

Required disposition: PF-S00-T91 must require an attributable independent
review/reconciliation of the T06/T07 coordination outputs, or explicitly
record a justified non-acceptance and rerun the affected gate. PF-S00-T92 must
verify the corrected attribution on the exact combined tree. This finding does
not authorize editing the ledger in this attempt.

### PF-S00-T90-002 — independent gate attribution is absent for the review chain

Severity: **critical**. The external-input register still classifies
`EXT-INDEPENDENT-REVIEW` as missing. The current T90 attempt is attributable by
its assigned worker identity, but the ledger has `reviewer: null` for T90 and
T92 is not started and has no reviewer/gate owner. Therefore the current
attempt does not establish an independent T92 gate or an external reviewer
capacity claim. S00 cannot unlock on this review alone.

Required disposition: the coordinator must assign and record an independent
T92 gate owner distinct from the implementation/coordinator principal, retain
this attempt, and have T92 rerun the reconciled exact-tree checks. No external
reviewer, service, platform, or release capability is claimed here.

### Inherited open baseline discrepancy — package identity

`python3 tools/plan.py verify-package` remains failed with a mismatch at
`execution/STATE.json`. This is the already-routed T03 package-identity
failure, not a new product finding; it remains open and must retain its named
follow-up rather than being relabeled as a pass.

## Audit and evidence limitations

- The required `boreal.workflow.audit.v1` resolver could not be completed:
  `bwrk workflows show boreal.workflow.audit.v1 --json` returned exit `6`
  with `service_busy` because the local database owner was already held by
  another process. The repository root also has no `boreal.yaml` to resolve
  locally. No live database or service state was changed.
- The plan package check is a planning/package check only; its failure is
  preserved above and is not converted into a product claim.
- No Rust/service/native/platform/release/publication or external reviewer
  execution was performed by this review. Static, fixture, unit, store, and
  package evidence remains at its stated layer.
- The assigned tree is dirty and the prerequisite handoffs were produced at
  earlier aggregate identities. This review uses the assigned identity above;
  no clean-tree or release identity is inferred.

## Gate conclusion

`PF-S00-T90` has produced its independent review artifacts, but the findings
remain unresolved. PF-S00-T91 must reconcile them; only PF-S00-T92 may perform
the exact-tree revalidation and authorize successor consideration. No
coordinator ledger update was made by this attempt.
