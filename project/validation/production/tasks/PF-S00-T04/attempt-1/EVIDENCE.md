# PF-S00-T04 attempt 1 evidence

## Scope and evidence class

This attempt is a source-backed contract inventory. It is not an acceptance or release record. The primary evidence is current source inspection at the dirty checkout, with historical M02 findings retained and classified in `project/validation/production/baseline/findings.json`.

## Fresh check

`python3 project/spec/validate_contracts.py` returned exit 0. It parsed the current protocol, guidance, workflow, transition, clock/dependency, conformance, and SQLite schema fixtures. This proves structural fixture consistency only; it does not prove that a built public binary/service or real TUI workflow satisfies those contracts.

## Inventory evidence

- `crates/cli/src/command_registry.rs:1-35` declares the registry identity and the `CommandSpec` fields (`path`, `syntax`, `action`, `output`, `direct`, `service`, `summary`).
- `crates/cli/src/command_registry.rs:35-486` declares the available route set; `:488-900` declares typed unavailable route families. The inventory records the 49 available entries and their families without treating unavailable entries as routes.
- `crates/protocol/src/lib.rs:31-32,487-540` declares envelope identity and capability/schema negotiation. `crates/protocol/src/models.rs:180-280` declares guidance and next-action DTOs.
- `crates/cli/src/main.rs:3560-3630` emits guidance provenance (`directives.v1`, registry path, workflow refs) and therefore establishes trusted-reference groundwork, not end-to-end proof.
- `crates/cli/src/main.rs:2006-2286` provides source route adapters; the registry marks these routes direct-only.
- `crates/cli/src/update.rs:14-69` implements update/upgrade behavior; the inventory explicitly records it as existing but not production-proven.
- `apps/tui/src/controller.ts`, `apps/tui/src/line-shell.ts`, and `apps/tui/src/test.ts` establish mounted controller actions and fixture-backed lifecycle behavior; they do not establish real service parity or release acceptance.

## Findings evidence

F01-F22 are retained from `project/validation/m02/REVIEW.md` and cross-checked against current source anchors. The classification is intentionally conservative: source confirmation means the limitation remains visible or unproven in current source; it does not mean the historical reproduction was rerun. F08 and F09 are classified no-longer-applicable only for their narrow historical defect, while their broader packaging/independent-gate obligations remain open. ARCH-01 through ARCH-05 record final architecture drift/gaps found during this inventory.

Every finding has a downstream PF owner in the machine-readable ledger. Source, memory, recovery, project isolation, review, parity, and release gaps are included rather than limiting the report to status and TUI.

## Contradictions preserved

- T01 archive identity and current dirty checkout are different evidence subjects.
- The registry exposes a deliberate narrow public boundary while `main.rs`/application modules contain v3/cycle/intake groundwork. Groundwork is not public capability.
- The current toolchain lock reports Rust tools available, while historical M02 evidence records seven Cargo commands unavailable. This task did not run Cargo and does not resolve that evidence contradiction.
- Contract fixtures pass, but that pass is not a service, lifecycle, reviewer, installer, publication, or release pass.
