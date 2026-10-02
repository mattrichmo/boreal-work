# Plan change 003 — general-purpose work, 2026-10-02

User request: update the existing Boreal milestone through GitHub to support general work, optional deliverables/evidence/context, deadlines/follow-ups and consistent CLI/TUI/visual planning; preserve active work and permit nested workers. This changes planning scope, not product runtime status.

Reviewed repository head: `7b56cca95c2bd482ea6880ea098993629cf3be78`. Current V3 has 95 native items; the store template batch limit is 100. V4 retains native schema 1 and contains exactly 100 items: 14 sprints and 85 required tasks plus the milestone. All old required keys remain. The added S13 vertical comprises dates/waits, project TUI, reusable non-software fixtures and sprint integration; existing S12 owners implement the core requirements/artifact/proof extensions so a competing subsystem is not introduced.

Changes:
- General work becomes an explicit release promise, with bounded contract GENERAL_WORK_CONTRACT.md.
- Extend S12-T01–T06/T90 with output requirements, accepted input/artifact lineage, typed evidence, adjustable rigor, binary portability, capability parity and headless recovery.
- Add S13/T01/T02/T03/T90 and add S13-T90 to every S11 release leaf.
- Add journeys J19–J24; preserve all J01–J18 journeys and original software/security/recovery checks.
- Repair stale root-plan routing to the active revision while retaining historical bodies.
- Preserve historical V1–V3 templates, existing runtime IDs, S00-T05 ownership and the three deferred S10 tasks.
- Extend the planning validator to assert native admission/priority bounds, old-key preservation, exact context/card/index consistency, new joins and immutable historical templates.

No executable product code, database, live claims, account permissions, provider integrations or business launch is changed by this commit. The user's downloadable business V1 ZIP is a separate deliverable and is not included. Adoption requires supported runtime read/patch/read-back; see IMPORT.md. Plan validation is not product testing.
