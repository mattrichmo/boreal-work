---
name: boreal-handoff
description: "Boreal v2 handoff skill. Use when ending a session, preparing a resume or replacement handoff, or closing sprint work."
---

# Boreal v2 Handoff

Use this thin adapter to make session and work boundaries durable through the Boreal v2 application.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.handoff.v1` with `bwrk workflows show <ref> --json`.
- Identify the project, session, work/attempt, sprint, revision, and explicit handoff or closeout intent before writing a handoff.
- Use application-owned session end, summary, sprint report, gate, dashboard, and handoff actions. Do not create a parallel markdown state machine.
- Include current progress, evidence, blockers, lease/fence state, uncommitted changes, and a bounded next action; preserve historical attempts and failed evidence.
- Inspect `agentDirectives` and required gates. A handoff is not permission to force-break a lock or close work without eligibility.

## Completion

Report the durable handoff/closeout receipt, scope and revision, active-attempt state, unresolved gates, and the exact resume or replacement action.
