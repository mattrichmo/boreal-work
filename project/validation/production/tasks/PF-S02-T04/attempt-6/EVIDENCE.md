# PF-S02-T04 — Attempt 6 evidence record

## Integrated behavior

- Canonical status reads validate the immutable pinned requirement snapshot before projecting observed gates.
- A missing or malformed pinned snapshot produces an `acceptance_requirements_corrupt` row diagnostic, a `requirements_missing` gate diagnostic, and an `integrity_quarantined` hard hold instead of silently reducing the requirement set.
- Direct gate diagnostics fail closed on a corrupt pinned snapshot.
- Receipt admission checks the persisted declaration identity, kind, required flag, and profile identity before consulting the observed gate row.
- Closeout records `requirements_missing` in its rejected close diagnostics when the pinned requirement snapshot is corrupt; it does not treat corruption as “summary not required.”
- Noncanonical schema-v2 fallback compatibility remains unresolved for fixtures that contain the additive pinned tables but manually insert work without a pinned snapshot.

## Focused regression evidence

The focused target passed 19 tests, including:

- `status_quarantines_corrupt_pinned_requirements_instead_of_using_gate_rows`
- `closeout_rejects_corrupt_pinned_requirements_as_a_requirement_diagnostic`
- `receipt_admission_fails_closed_when_pinned_gate_declaration_is_corrupt`
- prior immutable profile, deletion, drift, restart, and version-pinning cases

## Broader gate result

The full store package did not pass. Existing `production_store_seams::execution_store` uses a schema-v2 fixture that has the pinned tables but manually inserts `w1` without a pinned requirement snapshot. The new integration correctly identifies the absent snapshot as `requirements_missing`, while that legacy fixture still expects the observed gate to be used. The bounded compatibility branch must distinguish that fixture path from canonical persisted-profile work before this task can be accepted.

This is an actual failing validation result, not a passing claim.
