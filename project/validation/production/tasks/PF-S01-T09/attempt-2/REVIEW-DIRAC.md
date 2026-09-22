# PF-S01-T09 attempt 2 — independent contract review

Reviewer: independent review (Dirac)
Scope: registered T09 contract artifact and attempt-2 evidence only
Decision: REJECTED — contract boundary is substantially covered, but the artifact is not yet complete against the T09 ordered instructions and acceptance checklist.

## Reviewed inputs

- `project/spec/production/release-support-and-budgets.md`
- `project/validation/production/tasks/PF-S01-T09/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S01-T09/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S01-T09/attempt-2/HANDOFF.md`
- PF-S01-T09 task card
- T08 `service-contract.md` and `compatibility-matrix.md`
- `docs/RELEASE.md`, `docs/PACKAGING.md`, `docs/RELEASE_PERFORMANCE.md`, `docs/SECURITY.md`
- DEC-11 in `reference/DECISION_REGISTER.md`

## Findings

### T09-2-R1 — Source/receipt limits are not concretely defined [P1]

The task requires source/receipt limits. The contract requires provenance,
digests, redaction, and bounded responses, but does not define acceptance
limits for source size, receipt size, retained raw output, nesting/count,
or truncation/detail-reference behavior for those records. The response-size
budget at lines 77 and 82 is not a source/receipt retention limit.

Anchors: T09 task card lines 67–72; contract lines 43–67, 77, 117–125.

Required disposition: add fixed limits and observable rejection/truncation/
retention evidence, including the safe detail-reference rule and preservation
of the original digest.

### T09-2-R2 — Process-tree cleanup is named but not budgeted [P1]

The contract lists process cleanup among required security measurements, but
sets no cleanup deadline, descendant-count/scope rule, orphan-process
disposition, or required observable. This does not concretely address the
ordered instruction to define process-tree cleanup or provide a measurable
acceptance budget.

Anchors: T09 task card lines 67–72; contract lines 130–136; release-performance
limitations at `docs/RELEASE_PERFORMANCE.md` lines 133–147.

Required disposition: specify supported-platform cleanup behavior, timeout and
failure threshold, descendant verification, and `pass`/`fail`/`unsupported`
evidence requirements.

### T09-2-R3 — Credential storage and audit access control are underspecified [P1]

The contract requires authentication and redaction, and limits ordinary
diagnostics, but does not define where credentials are stored, what storage
permissions/encryption rule applies, how revocation is checked, or which
principal/role may retrieve raw receipts and advanced audit diagnostics.
The ordered T09 instruction expressly requires credential storage and audit
access controls.

Anchors: T09 task card line 69; contract lines 103–125 and 208–215; T08
service contract lines 135–140.

Required disposition: name the supported credential store/permission boundary,
redaction-at-rest rule, revocation/readback behavior, and authorized audit
roles with denial evidence.

### T09-2-R4 — T08/schema/protocol impact traceability is not explicit [P1]

The handoff says the artifact consumes T08 boundaries, and the contract refers
to operation IDs, restore epochs, manifests, and readback. It does not provide
an explicit impact statement mapping T09 requirements to T08 service/compatibility
fields, identifying whether schema/protocol changes are required or deferred,
or recording the baseline discrepancy and owner decision as required by the
T09 acceptance checklist.

Anchors: T09 task card lines 74–82; contract lines 138–162, 185–215; T08
service contract lines 91–113 and 164–169; compatibility matrix lines 39–61;
DEC-11 lines 115–123.

Required disposition: add a traceability section stating the affected service,
protocol, schema, manifest, and migration surfaces, or explicitly recording
“no change” with rationale and the later owner/gate for deferred integration.

## Satisfied at the contract boundary

- The three release targets and runner/install modes match the workflow matrix:
  `.github/workflows/release.yml` lines 39–46; contract lines 22–36.
- Fixed measurable budgets are present for dashboard, bounded reads, queue,
  transaction hold, heartbeat, reconnect, history, and offline view: contract
  lines 69–89.
- Security, authority, isolation, proof, quarantine, shell, redaction, and
  live-lock boundaries are explicitly nonwaivable: contract lines 91–136.
- Artifact identity, checksum, signing disposition, dependency, SQLite-floor,
  installer, backup, restore, upgrade, and rollback rules are stated: contract
  lines 138–183.
- The artifact and evidence do not fabricate implementation, native, or release
  passes: contract lines 5–11 and 217–221; COMMANDS lines 8–14; EVIDENCE lines
  19–26.
- The recorded changed product path is the registered T09 path only: EVIDENCE
  lines 28–30; HANDOFF lines 5–13.

## Review conclusion

Do not accept PF-S01-T09 attempt 2 yet. Reconcile T09-2-R1 through T09-2-R4
within the registered contract artifact, preserve this finding record, then
rerun the contract-level checks and obtain a new independent review. This
review makes no claim about implementation, native execution, package
installation, backup/restore, or release acceptance.
