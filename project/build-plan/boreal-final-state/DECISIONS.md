# Product and architecture decisions — revision 3

The first fourteen decisions are retained from the existing plan. V3 narrows the release boundary and adds workflow completeness; it does not reopen the Rust design.

1. Global is an installation-wide personal/business manager useful with zero projects or linked workspaces.
2. Global management completion never claims Project execution acceptance.
3. Project retains guide/next, attempts/fences, evidence, gates, review and finish/release authority.
4. Global/Project commands remain explicit and fail closed; no silent fallback.
5. Linked Project data is read-only Global context and stays stale/unknown on failure, never false zero/complete.
6. Physical Global backup/restore and machine update recovery ship before Global schema 3.
7. Personal Inbox is one ordinary management workflow state, not a separate disposition subsystem.
8. Due is an obligation; follow-up is a waiting check-back. Neither implies reminders, recurrence or a calendar.
9. Management Next requires completed prerequisites; hierarchy/related links do not imply dependency. Cancel/archive/missing are not implicit completion.
10. Explicit capture preserves original provenance; older rows receive no invented history.
11. Send is explicit and waits for the usable standalone Global loop. It lands in Project Intake, then archives (never completes) the Global source.
12. Immutable Intake receipts own semantic delivery idempotency; per-attempt operation IDs keep stricter actor/session/revision identity.
13. No Global claim/evidence/finish family. Authority routing uses existing Project workflows for execution.
14. Keep serialized Global authority until measured evidence justifies a change.
15. The release promise is complete local workflows plus a portable typed application contract. Full MCP/remote service delivery has its own successor gate, not an implicit promise or a blocker for local completion.
16. CLI/TUI/skills and future adapters invoke one Rust authority. The existing protocol is extended only for demonstrated workflow gaps; no framework or language rewrite.
17. Every advertised required action must be callable with typed inputs or return an actionable intervention. Historical recovery-route failure justifies capability/guide/handler parity checks.
18. Project planning, publishing, Intake promotion, ordinary-agent enrollment, changed-result proof, independent review and durable context remain required inherited workflows, not new deferrals.
19. Keep logical IDs distinct from local paths and physical store activation. Local filesystem/maintenance capabilities remain explicit; necessary context/artifact reads have bounded identity-based interfaces.
20. Prepare Project receipt/restore groundwork independently of Global UI. S09 still waits for both the standalone Global gate and the receipt gate.
21. V3 fresh import uses task-only dependency edges. Preserve existing IDs; do not replay a whole template over an active project or mutate its database from GitHub.
22. Keep one T90 per sprint. Focused contract checks are used where downstream integration needs them; final native/artifact acceptance stays reviewed.
23. S10-T04/T05/T06 remain deferred IDs outside the required release template. Failed mandatory performance budgets demand remediation, not a conveniently weaker definition of done.
24. A named environment/harness is supported only after its actual capabilities and journey are qualified. A compiled binary, simulated client or GitHub connection does not prove access to ChatGPT's running environment.
