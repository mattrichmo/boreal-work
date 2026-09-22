# R-SKILL-MANIFEST — skills/manifest.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `skills/manifest.json:L1–L23`  
**File SHA-256:** `78d0d0ec0fbea8ebd7e77c6e7b18b499d0b375dac2c895321077a307e64d5d49`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Packaged supported harness workflow identities; preserve command registry and skill version agreement.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,23p' 'skills/manifest.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "schema_version": "boreal.skill_package.v2",
    3 |   "package_id": "boreal.core-skills",
    4 |   "package_version": "1.0.0",
    5 |   "workflow_package": {
    6 |     "package_id": "boreal.core-workflows",
    7 |     "package_version": "1.0.0"
    8 |   },
    9 |   "harnesses": ["codex", "claude"],
   10 |   "state_authority": "boreal.application.v2",
   11 |   "skills": [
   12 |     {"name": "boreal-route", "path": "boreal-route", "workflows": ["boreal.workflow.route.v1"]},
   13 |     {"name": "boreal-context", "path": "boreal-context", "workflows": ["boreal.workflow.context.v1"]},
   14 |     {"name": "boreal-plan", "path": "boreal-plan", "workflows": ["boreal.workflow.plan.v1"]},
   15 |     {"name": "boreal-claim", "path": "boreal-claim", "workflows": ["boreal.workflow.claim.v1"]},
   16 |     {"name": "boreal-finish", "path": "boreal-finish", "workflows": ["boreal.workflow.finish.v1"]},
   17 |     {"name": "boreal-review", "path": "boreal-review", "workflows": ["boreal.workflow.review.v1"]},
   18 |     {"name": "boreal-audit", "path": "boreal-audit", "workflows": ["boreal.workflow.audit.v1"]},
   19 |     {"name": "boreal-handoff", "path": "boreal-handoff", "workflows": ["boreal.workflow.handoff.v1"]},
   20 |     {"name": "boreal-health", "path": "boreal-health", "workflows": ["boreal.workflow.health.v1"]},
   21 |     {"name": "boreal-memory", "path": "boreal-memory", "workflows": ["boreal.workflow.memory.v1"]}
   22 |   ]
   23 | }
````
