# BW-S02 — Packaging, runtime and release-surface hardening

**Goal:** Make the existing install/package path trustworthy and ensure the shipped Global TUI/runtime are validated like the project product.

**Entry dependency:** BW-S00-T90  
**Sprint close:** `BW-S02-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S02-T01](tasks/BW-S02-T01.md) | Fix release checksum provenance path and test the download-style installer | RELEASE | automatic | BW-S00-T90 |
| [BW-S02-T02](tasks/BW-S02-T02.md) | Preflight dashboard Node runtime before service startup | HOST_RUNTIME | automatic | BW-S00-T90 |
| [BW-S02-T03](tasks/BW-S02-T03.md) | Make Global TUI source and interaction tests part of release identity/validation | VALIDATION | automatic | BW-S00-T90, BW-S00-T02 |
| [BW-S02-T04](tasks/BW-S02-T04.md) | Qualify supported target install/launch surfaces without widening platform claims | RELEASE | automatic | BW-S00-T90, BW-S02-T01, BW-S02-T02, BW-S02-T03 |
| [BW-S02-T05](tasks/BW-S02-T05.md) | Align install, uninstall/data-retention and supply-chain documentation with real behavior | DOCS | operator_only | BW-S00-T90 |
| [BW-S02-T90](tasks/BW-S02-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S02-T01, BW-S02-T02, BW-S02-T03, BW-S02-T04, BW-S02-T05 |

## Parallelism

- T01 release checksum path, T02 runtime preflight, and T03 Global TUI validation can run in parallel.
- T04 supported-target smoke consumes the three interfaces.
- T05 documentation can draft in parallel and reconcile at T90.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S02-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] Release-style SHA256SUMS lookup works on the actual published layout.
- [ ] Staged and installed asset digests/build identities match release.json.
- [ ] Missing/unsupported Node produces a precise dashboard recovery message while CLI remains usable.
- [ ] Both TUIs are direct CI/full-suite targets.
- [ ] macOS ARM64, macOS x86-64, Linux x86-64 remain the declared release targets; others stay explicitly unsupported.
- [ ] No package task modifies project databases or deletes the per-user Global root.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
