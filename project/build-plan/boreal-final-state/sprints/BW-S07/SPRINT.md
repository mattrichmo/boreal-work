# BW-S07 — Complete standalone Global daily product and authority guidance

**Goal:** Turn the existing routes into a polished keyboard-first daily session and teach humans/agents exactly when to use Global versus project execution.

**Entry dependency:** BW-S06-T90  
**Sprint close:** `BW-S07-T90` — integration + sprint-level validation.

## Required context

Read `../../MASTER_PLAN.md`, `../../DECISIONS.md`, `../../execution/PARALLEL_DISPATCH.md`, `../../execution/SHARED_FILES.md`, repository `AGENTS.md`, then the selected task packet. Inspect the current dispatched source; retain already-correct implementation.

## Tasks

| Task | Outcome | Lane | Dispatch | Direct prerequisites |
| --- | --- | --- | --- | --- |
| [BW-S07-T01](tasks/BW-S07-T01.md) | Make quick capture and Inbox triage a keyboard decision queue | GLOBAL_TUI | automatic | BW-S06-T90 |
| [BW-S07-T02](tasks/BW-S07-T02.md) | Render grouped Today/Open and management project heartbeat | GLOBAL_TUI | automatic | BW-S06-T90, BW-S05-T90 |
| [BW-S07-T03](tasks/BW-S07-T03.md) | Polish archive/restore/history and capture provenance inspection | GLOBAL_TUI | automatic | BW-S06-T90, BW-S06-T03 |
| [BW-S07-T04](tasks/BW-S07-T04.md) | Expose daily filters and atomic bulk triage truthfully through public CLI help | CLI | automatic | BW-S06-T90, BW-S05-T05, BW-S06-T05 |
| [BW-S07-T05](tasks/BW-S07-T05.md) | Make boreal-route choose Global management or project execution first | GUIDANCE | automatic | BW-S06-T90 |
| [BW-S07-T06](tasks/BW-S07-T06.md) | Add two-door help and reconcile Global docs with the callable registry | DOCS | operator_only | BW-S06-T90, BW-S07-T04, BW-S07-T05 |
| [BW-S07-T90](tasks/BW-S07-T90.md) | Integrate the sprint and validate the combined behavior | INTEGRATION | operator_only | BW-S07-T01, BW-S07-T02, BW-S07-T03, BW-S07-T04, BW-S07-T05, BW-S07-T06 |

## Parallelism

- T01 Inbox interaction, T04 CLI parity, and T05 guidance can begin in parallel.
- T02 grouped daily UI consumes S05 contracts and can run beside T01.
- T03 history/provenance inspector consumes S06.
- T06 docs reconcile after command/guidance wording freezes.

## Sprint validation

Validation is intentionally concentrated here, in `BW-S07-T90`, unless a leaf packet names a dependency-sensitive local check.

- [ ] n always captures into Personal Inbox; N remains deliberate detailed/project-aware creation.
- [ ] Inbox triage auto-selects the next undecided item after a successful save and does not advance on failure/unknown outcome.
- [ ] Today/Open shows truthful grouped daily work and preserves keyboard/small-terminal usability.
- [ ] Archive remains not-complete and restore returns the same item/history.
- [ ] CLI help matches callable filters/bulk triage and Global/project authority.
- [ ] boreal-route first chooses Global management vs project execution without introducing Global claim/evidence/finish.
- [ ] All linked workspaces may be unavailable while the complete local session continues.

## Sprint handoff

The integrator records the exact combined source identity, changed shared contracts, checks actually run, failures/unsupported cases, and successor tasks unlocked. A task worker's branch or focused check does not by itself close the sprint.
