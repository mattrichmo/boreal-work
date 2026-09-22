# R-PROFILES — project/spec/acceptance-profiles.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/acceptance-profiles.json:L1–L60`  
**File SHA-256:** `7651befe38f6afd7180463cbce9cfab2fab2ebab390c1c7c2e4ce31af804be4e`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Versioned gate/profile definitions; reconcile summary/audit semantics, not names alone.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,60p' 'project/spec/acceptance-profiles.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "schema_version": "boreal.acceptance_profile.v1",
    3 |   "fixture_version": "p0-03.v2",
    4 |   "profiles": [
    5 |     {
    6 |       "id": "focused",
    7 |       "version": "1",
    8 |       "review_gate": false,
    9 |       "required_gates": [
   10 |         "checkpoint",
   11 |         "verification",
   12 |         "summary"
   13 |       ],
   14 |       "close_requires": "durable_close_intent",
   15 |       "implementation": "existing built-in"
   16 |     },
   17 |     {
   18 |       "id": "reviewed",
   19 |       "version": "1",
   20 |       "review_gate": true,
   21 |       "required_gates": [
   22 |         "checkpoint",
   23 |         "verification",
   24 |         "review",
   25 |         "summary"
   26 |       ],
   27 |       "close_requires": "durable_close_intent",
   28 |       "implementation": "existing built-in"
   29 |     },
   30 |     {
   31 |       "id": "operator",
   32 |       "version": "1",
   33 |       "review_gate": false,
   34 |       "required_gates": [
   35 |         "verification",
   36 |         "operator_approval",
   37 |         "summary"
   38 |       ],
   39 |       "close_requires": "durable_close_intent",
   40 |       "implementation": "target only; unavailable until S03-T02"
   41 |     }
   42 |   ],
   43 |   "rules": {
   44 |     "independent_review": "required only when review_gate=true",
   45 |     "auto_finalize": "only after close intent and last matching receipt/review for same attempt, source snapshot, config, and policy",
   46 |     "invalidators": [
   47 |       "attempt_changed",
   48 |       "source_snapshot_changed",
   49 |       "policy_version_changed",
   50 |       "fence_changed",
   51 |       "configuration_changed"
   52 |     ],
   53 |     "failed_receipts": "immutable and queryable",
   54 |     "gate_identity": "Definitions use local IDs; persisted instance IDs are WORK_ID:LOCAL_ID. Classify gates by GateKind, never by a bare instance ID.",
   55 |     "audit_vs_summary": "summary is a required closeout gate; an audit event is mandatory operation history, not a substitute receipt. The optional audit gate is distinct.",
   56 |     "migration": "Do not rename stored gate IDs or rewrite historical receipts. Existing focused/1 and reviewed/1 retain their summary gates. v1/audit fixtures were planning drift, not evidence of a deployed schema migration."
   57 |   },
   58 |   "status": "candidate; S00-T07 and S03 profile/public-route gates remain open",
   59 |   "candidate_revision": "m02-candidate.1"
   60 | }
````
