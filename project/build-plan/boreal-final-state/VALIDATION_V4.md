# Revision 4 planning validation

Validated 2026-10-02 against source plan at 7b56cca95c2bd482ea6880ea098993629cf3be78.

- PASS plan consistency: 14 sprints, 85 required tasks, 100 native items, 3 deferred tasks, 24 required journeys.
- PASS exact task-card/context/index correspondence, direct task edges, acyclic graph, sprint gate coverage and S11 general-work joins.
- PASS native schema-1 fields, 0–9 priority, identifier/label bounds and the existing 100-item admission ceiling.
- PASS historical V1/V2/V3 bytes and every existing key, kind, parent, dispatch and profile preserved.
- PASS eight negative mutations rejected: duplicate key, container dependency, missing dependency, priority overflow, unsupported item field, unsupported profile, extra item and missing S13 release join.

Run `python3 project/build-plan/boreal-final-state/validate_plan.py` to reproduce the structural checks. Mutation checks used isolated temporary copies and made no runtime changes. This validates planning artifacts only: no Rust product tests, live import, database amendment, runtime publication/claim, deployment, or milestone completion is asserted. Existing runtime adoption still requires IMPORT.md read/patch/read-back.
