---
name: boreal-review
description: "Boreal v2 review skill. Use when selecting review candidates, evaluating evidence, or recording a bounded review decision."
---

# Boreal v2 Review

Use this thin adapter for evidence-based review through the Boreal v2 application workflow.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.review.v1` with `bwrk workflows show <ref> --json`.
- Select candidates through the application using the workflow's review-candidate and work-show commands; do not infer eligibility from filenames, timestamps, or chat history.
- Verify the requested review profile, required evidence, attempt/fence, revision, and dependency state before recording a decision.
- Treat review output and `agentDirectives` as typed results. Keep findings, rejected evidence, and follow-up work attached to the reviewed item.
- Make one state-changing action per response and stop on missing or blocking gates.

## Completion

Report the candidate, profile, evidence checked, findings, decision, gate/receipt state, and the next required workflow.
