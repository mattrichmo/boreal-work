---
name: boreal-claim
description: "Boreal v2 claim skill. Use when accepting, starting, resuming, renewing, or checkpointing one fenced work attempt."
---

# Boreal v2 Claim

Use this thin adapter to operate one fenced work attempt through the Boreal v2 application boundary.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.claim.v1` with `bwrk workflows show <ref> --json`.
- Confirm project, work, actor/session, revision, and current attempt state before claiming or resuming.
- Use the application-owned `claim`, `start`, `resume`, `accept`, `heartbeat`, `checkpoint`, `renew`, and `release` actions exactly as allowed by the workflow.
- Preserve the attempt ID and fence token. Never force-break a live lock, reuse another agent's fence, or synthesize progress outside the service.
- Check `agentDirectives`, lease/deadline diagnostics, and checkpoint requirements after every action. One state-changing action per response.

## Completion

Report the attempt/fence, accepted scope, checkpoint or progress receipt, lease state, and the next safe action or release reason.
