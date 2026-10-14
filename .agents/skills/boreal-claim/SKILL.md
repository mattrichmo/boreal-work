---
name: boreal-claim
description: "Boreal v2 claim skill. Use when accepting, starting, resuming, renewing, or checkpointing one fenced work attempt."
---

# Boreal v2 Claim

Use this thin adapter to operate one fenced work attempt through the Boreal v2 application boundary.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.claim.v1` with `bwrk workflows show <ref> --json`.
- Confirm project, work, authenticated actor, session, harness, transport, revision, and current attempt state before claiming or resuming; carry the same scope through every returned action.
- Use the application-owned `claim`, `start`, `resume`, `accept`, `heartbeat`, `checkpoint`, `renew`, and `release` actions exactly as allowed by the workflow.
- Preserve the attempt ID and fence token. Never force-break a live lock, reuse another agent's fence, or synthesize progress outside the service.
- The harness owns two separate timers at the cadence returned by the service: heartbeat records process liveness; lease renewal extends only the renewable lease. Keep both running during long tool calls, and do not treat heartbeat as renewal or either action as extending the hard deadline.
- Before recovery releases resources, the harness confirms the owned worker process has stopped. A missing heartbeat alone does not prove the process stopped; never force-break live ownership.
- Check `agentDirectives`, lease/deadline diagnostics, and checkpoint requirements after every action. One state-changing action per response.

## Completion

Report the attempt/fence, accepted scope, checkpoint or progress receipt, lease state, and the next safe action or release reason.
