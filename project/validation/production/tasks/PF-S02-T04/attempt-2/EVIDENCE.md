# PF-S02-T04 — Attempt 2 independent review evidence

## Disposition

**REJECT — bounded implementation groundwork only; not accepted.**

The worker’s `profiles.rs` module correctly supplies useful pure contracts for canonical profile hashing, same-version drift detection, pinned requirement shapes, observation auditing, and legacy classification. The actual product boundary required by PF-S02-T04 is not implemented on the current combined source. In particular, the declarations are not durable and cannot protect status, claim, or close from observation deletion.

## Mandatory acceptance review

| Acceptance item | Result | Evidence |
| --- | --- | --- |
| Deleting a required observed gate leaves a configuration/integrity gap, never fewer requirements | **Reject** | The focused test passes only against `PinnedRequirements` plus an in-memory `[]` (`crates/store/tests/production_profile_requirements.rs:100-126`). Production status reads `gate` rows as its requirement source (`crates/store/src/lib.rs:3855-3873`) and computes `missing` only from those rows (`:4041-4048`). Deleting the observed row can therefore remove the apparent requirement from durable status/claim/close inputs. |
| Changing a profile default does not silently change existing pinned tasks | **Not demonstrated / reject** | `work_item` stores only profile ID/version (`project/spec/schema-production.sql:68-77`). There is no persisted resolved declaration set or profile-content binding for the task. Work creation still registers a synthetic `sha256:<profile-id>` and `{}` (`crates/store/src/lib.rs:2362-2370`). |
| Sibling tasks retain different profile versions and gate requirements after reopen/restart | **Not demonstrated / reject** | The pure test proves two in-memory `PinnedRequirements` values differ, but the production schema has no task/container requirement rows and no restart readback for them. Existing status reconstructs from surviving gate observations. |
| Effective prerequisites, owner decisions, schema/protocol impacts and baseline discrepancy are accounted for | **Partial only** | Worker handoff records the required shared integration request and residual risk. The current combined schema/root/lifecycle implementation does not contain that integration. |
| Focused and required integration checks ran on the actual combined source/artifact identity | **Checks pass; acceptance still fails** | Focused target 6/6, full store suite passed, strict clippy passed, format passed, and contract validation passed. The required behavior is not covered by those tests because no durable declaration/readback path exists. |
| Changes remain within granted boundary and prior failures/evidence are preserved | **Pass for this review** | Worker attempt-1 respected its non-shared write grant. This review writes only `attempt-2/`; prior attempts remain untouched. |
| Complete handoff/evidence and coordinator acceptance | **Pending coordinator; review rejects** | This attempt supplies the independent review record. The coordinator must not mark the leaf accepted. |

## Concrete release-blocking findings

### Finding F-PF-S02-T04-01 — no independent durable declaration set

`project/spec/schema-production.sql:50-57` contains only the profile document row. It has no immutable profile-gate declaration table and no subject-pinned requirement table for tasks or containers. The new `PinnedRequirements` value is constructed in memory and never persisted or reloaded by the canonical store.

Consequence: deleting a `gate` observation can make a required condition disappear from the only durable relation consumed by status/claim/close. This violates AC-06 and the task’s first mandatory acceptance item.

### Finding F-PF-S02-T04-02 — canonical work creation still writes an empty profile definition

`crates/store/src/lib.rs:2362-2370` passes `"{}"` and a synthetic digest to `ensure_acceptance_profile`, even when the work object has gates. This is the exact legacy placeholder behavior the task requires to be replaced or quarantined with authoritative provenance.

The root function does reject most conflicting raw rows (`:2326-2341`), but it explicitly treats an existing empty definition plus another empty definition as reusable (`:2332-2337`). It does not resolve or pin the supplied gate declarations independently.

### Finding F-PF-S02-T04-03 — status/claim/close do not consume pinned requirements

`status_gate_diagnostics_for_project` reads `gate` rows and derives `GateDiagnostic.required` and the `missing` list from those observations (`crates/store/src/lib.rs:3855-3873`, `:4032-4048`). There is no query of an immutable declaration set, no legacy quarantine result in the status snapshot, and no call to `profiles::audit_observations` from the canonical status/claim/close paths.

Consequently, the worker’s correct pure deletion test is not evidence for the real lifecycle. A missing gate row can still reduce the durable requirement set and allow downstream eligibility to be evaluated against incomplete requirements.

### Finding F-PF-S02-T04-04 — focused tests explicitly stop before the required integration layer

The test file’s module-level comment says durable root registration is intentionally not hidden behind a test-local module. Its six tests cover only pure/in-memory profile and observation values. The full store suite passing is not a substitute for a fresh/reopen/delete-observation status, claim, and close regression on the canonical schema.

## What passed and what it proves

- Same-version conflicting in-memory profile content is rejected.
- Canonical digest drift is rejected by `ProfileVersion`.
- In-memory task/container requirement values remain distinct.
- In-memory observation deletion yields `MissingRequiredObservation`.
- Empty legacy definitions can be classified as quarantined without authoritative provenance.
- The combined store package, clippy, formatting, and contract validators pass.

These results establish bounded scaffolding and source hygiene only. They do not establish durable production behavior, migration support, restart readback, lifecycle enforcement, or AC-06 acceptance.

## Required remediation before re-review

1. Add migration/schema support for immutable profile declarations and subject-pinned task/container requirement records, including profile/version/digest/provenance and integrity/quarantine state.
2. Change canonical work/profile creation to validate real profile content, persist the declaration set atomically, and reject or explicitly quarantine legacy `{}` rows without authoritative reconstruction.
3. Make status, claim eligibility, and close/finalization load the independent declaration set and compare observations to it inside their canonical transaction/read boundary.
4. Add real SQLite fresh/reopen/restart tests covering profile-default drift, sibling profile versions, deletion of observed gates, and status/claim/close fail-closed behavior.
5. Re-run the required combined checks and obtain an independent review on the integrated source identity.
