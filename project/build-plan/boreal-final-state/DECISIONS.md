# Settled product and architecture decisions

1. Global is an installation-wide personal/business manager useful with zero projects or linked workspaces.
2. Global management completion never claims project execution acceptance.
3. Project Boreal retains guide/next, attempts/fences, evidence, gates, review and finish/release authority.
4. Global/project commands remain explicit and fail closed; no silent fallback.
5. Linked project data is read-only context in Global and stays stale/unknown on failure, never false zero/complete.
6. Physical Global backup/restore and machine update recovery ship before Global schema 3.
7. Personal Inbox is one ordinary management workflow state, not a separate capture/disposition subsystem.
8. Due is an obligation; follow-up is a waiting check-back; neither implies a reminder. Planned-work date/recurrence/calendar are deferred.
9. Management Next requires all prerequisites completed; hierarchy and related links do not imply blocking.
10. Capture provenance is created only for explicit capture; old rows receive no invented history.
11. Cross-project Send is explicit and later than the standalone local loop. It lands in Project Intake, then archives (never completes) the Global source.
12. Send idempotency is a typed immutable Intake delivery receipt; per-attempt operation IDs retain their stricter actor/session/revision identity.
13. No Global claim/evidence/finish skill family. `boreal-route` chooses authority then uses existing project workflows for execution.
14. Keep serialized Global authority until measured scale evidence justifies a change.
