# R-GUIDANCE-REGISTRY — project/spec/guidance/directive-registry.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/guidance/directive-registry.json:L1–L140`  
**File SHA-256:** `b35eb92b2c43cd389026a15c025f25e196b588bd4d32ff5dcb4c25ef860b0858`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Trusted conditional directives, command paths and policy outputs.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,140p' 'project/spec/guidance/directive-registry.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "schema_version": "boreal.guidance.directive_registry.v1",
    3 |   "registry_version": "directives.v1",
    4 |   "registry_id": "boreal.core.directives",
    5 |   "immutable": true,
    6 |   "entries": [
    7 |     {
    8 |       "registry_id": "work.discover@v1",
    9 |       "entry_version": 1,
   10 |       "family": "work",
   11 |       "severity": "advisory",
   12 |       "kind": "discover",
   13 |       "title": "Discover the next eligible work",
   14 |       "instruction": "Review the current project snapshot and claim the selected eligible work through the bounded CLI action.",
   15 |       "trigger_codes": ["no_goal.ready_work"],
   16 |       "command_template_id": "work.claim.v1",
   17 |       "effect": "claim_attempt"
   18 |     },
   19 |     {
   20 |       "registry_id": "work.claim@v1",
   21 |       "entry_version": 1,
   22 |       "family": "work",
   23 |       "severity": "required",
   24 |       "kind": "claim",
   25 |       "title": "Claim the ready work item",
   26 |       "instruction": "Claim the selected work item with the supplied revision and typed session identity.",
   27 |       "trigger_codes": ["work.ready", "work.no_goal_ready"],
   28 |       "command_template_id": "work.claim.v1",
   29 |       "effect": "create_fenced_attempt"
   30 |     },
   31 |     {
   32 |       "registry_id": "work.prerequisite@v1",
   33 |       "entry_version": 1,
   34 |       "family": "work",
   35 |       "severity": "advisory",
   36 |       "kind": "queued",
   37 |       "title": "Inspect the open prerequisite",
   38 |       "instruction": "Inspect the named prerequisite; this work remains queued until its default close-only satisfaction condition is met.",
   39 |       "trigger_codes": ["prerequisite_open"],
   40 |       "command_template_id": "work.show.v1",
   41 |       "effect": "read_context"
   42 |     },
   43 |     {
   44 |       "registry_id": "recovery.blocked@v1",
   45 |       "entry_version": 1,
   46 |       "family": "recovery",
   47 |       "severity": "blocking",
   48 |       "kind": "blocked",
   49 |       "title": "Resolve the hard work block",
   50 |       "instruction": "Ask the authorized operator to resolve the named hard block; do not claim or bypass it.",
   51 |       "trigger_codes": ["operator_decision_required", "integrity_check_required", "unsafe_environment"],
   52 |       "command_template_id": "work.show.v1",
   53 |       "effect": "operator_resolution_required"
   54 |     },
   55 |     {
   56 |       "registry_id": "recovery.expired-review@v1",
   57 |       "entry_version": 1,
   58 |       "family": "recovery",
   59 |       "severity": "blocking",
   60 |       "kind": "expired_review",
   61 |       "title": "Review the expired attempt",
   62 |       "instruction": "Inspect the fenced expired attempt and worktree before an authorized disposition; do not blindly reclaim the work.",
   63 |       "trigger_codes": ["lease_elapsed", "hard_budget_elapsed", "stop_unconfirmed"],
   64 |       "command_template_id": "attempt.review-expiry.v1",
   65 |       "effect": "expiry_review"
   66 |     },
   67 |     {
   68 |       "registry_id": "attempt.resume@v1",
   69 |       "entry_version": 1,
   70 |       "family": "attempt",
   71 |       "severity": "required",
   72 |       "kind": "resume",
   73 |       "title": "Resume the current fenced attempt",
   74 |       "instruction": "Reload the durable attempt and continue through its current safe action; do not claim replacement work.",
   75 |       "trigger_codes": ["attempt.active", "attempt.restart"],
   76 |       "command_template_id": "agent.resume.v1",
   77 |       "effect": "resume_attempt"
   78 |     },
   79 |     {
   80 |       "registry_id": "operator.claim@v1",
   81 |       "entry_version": 1,
   82 |       "family": "operator",
   83 |       "severity": "blocking",
   84 |       "kind": "operator_only",
   85 |       "title": "Obtain operator authorization",
   86 |       "instruction": "An authorized operator must claim or explicitly resume this operator-only work item.",
   87 |       "trigger_codes": ["dispatch.operator_only"],
   88 |       "command_template_id": "work.claim-operator.v1",
   89 |       "effect": "operator_claim_required"
   90 |     },
   91 |     {
   92 |       "registry_id": "operator.resume@v1",
   93 |       "entry_version": 1,
   94 |       "family": "operator",
   95 |       "severity": "blocking",
   96 |       "kind": "paused",
   97 |       "title": "Resume the paused work item",
   98 |       "instruction": "An authorized operator must remove the explicit policy hold before this work can be claimed.",
   99 |       "trigger_codes": ["dispatch.paused"],
  100 |       "command_template_id": "work.resume.v1",
  101 |       "effect": "resume_policy"
  102 |     },
  103 |     {
  104 |       "registry_id": "verification.evidence-required@v1",
  105 |       "entry_version": 1,
  106 |       "family": "verification",
  107 |       "severity": "required",
  108 |       "kind": "evidence",
  109 |       "title": "Attach passed verification evidence",
  110 |       "instruction": "Run the declared bounded validation gate and attach its structured receipt for the current subject and source snapshot.",
  111 |       "trigger_codes": ["gate.verification.unsatisfied", "receipt.stale", "receipt.failed"],
  112 |       "command_template_id": "evidence.run.v1",
  113 |       "effect": "satisfy_verification_gate"
  114 |     },
  115 |     {
  116 |       "registry_id": "finish.close@v1",
  117 |       "entry_version": 1,
  118 |       "family": "finish",
  119 |       "severity": "required",
  120 |       "kind": "finish",
  121 |       "title": "Finalize the verified work",
  122 |       "instruction": "Submit the durable close intent with the current attempt fence and accepted proof; the final transaction will release ownership and close the work.",
  123 |       "trigger_codes": ["finish.ready", "close_intent.pending"],
  124 |       "command_template_id": "agent.finish-close.v1",
  125 |       "effect": "close_work"
  126 |     },
  127 |     {
  128 |       "registry_id": "guidance.idle@v1",
  129 |       "entry_version": 1,
  130 |       "family": "guidance",
  131 |       "severity": "advisory",
  132 |       "kind": "idle",
  133 |       "title": "Remain idle",
  134 |       "instruction": "No safe action is available in this project snapshot; wait for a revision or operator intervention.",
  135 |       "trigger_codes": ["no_safe_action"],
  136 |       "command_template_id": null,
  137 |       "effect": "no_action"
  138 |     }
  139 |   ]
  140 | }
````
