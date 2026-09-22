# R-WORKFLOWS — project/spec/workflows/manifest.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/workflows/manifest.json:L1–L13`  
**File SHA-256:** `3ca72896de4f9fda975b9201386b0322b2facc147ab194d0b24416f02033bc63`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Core workflow identities and versioned package registry; scripts must match implemented commands.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,13p' 'project/spec/workflows/manifest.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "schema_version": "boreal.workflow_asset.v1",
    3 |   "fixture_version": "p0-03.v2",
    4 |   "registry_version": "workflows.v1",
    5 |   "trusted": true,
    6 |   "workflow_refs": [
    7 |     "boreal.workflow.route.v1", "boreal.workflow.context.v1", "boreal.workflow.plan.v1",
    8 |     "boreal.workflow.claim.v1", "boreal.workflow.finish.v1", "boreal.workflow.review.v1",
    9 |     "boreal.workflow.audit.v1", "boreal.workflow.handoff.v1", "boreal.workflow.health.v1",
   10 |     "boreal.workflow.memory.v1"
   11 |   ],
   12 |   "asset_policy": {"checked_in":true,"allowed_commands_only":true,"free_form_commands_are_data":true,"unknown_fields":"reject"}
   13 | }
````
