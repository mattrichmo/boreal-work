# R-PROTOCOL — project/spec/protocol/protocol-manifest.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/protocol/protocol-manifest.json:L1–L80`  
**File SHA-256:** `f486ebbccd6b7c93275f19e7fe4e6d34adbbbf2cab5b8261a938f90e1a90e042`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Protocol version/identity negotiation and fixture compatibility authority.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,80p' 'project/spec/protocol/protocol-manifest.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "fixture_version": "p0-03.v2",
    3 |   "protocol_version": "2",
    4 |   "schemas": {
    5 |     "envelope": "boreal.protocol.envelope.v1",
    6 |     "status": "boreal.status.v1",
    7 |     "list": "boreal.list.v1",
    8 |     "agent_guide": "boreal.agent_guidance.v1",
    9 |     "agent_next": "boreal.agent_next.v1",
   10 |     "receipt": "boreal.receipt.v1",
   11 |     "gate_diagnostics": "boreal.gate_diagnostics.v1",
   12 |     "error_registry": "boreal.errors.v1"
   13 |   },
   14 |   "envelope": {
   15 |     "required_fields": [
   16 |       "api_version",
   17 |       "schema_version",
   18 |       "operation_id",
   19 |       "revision",
   20 |       "as_of",
   21 |       "next_status_change_at",
   22 |       "transport",
   23 |       "outcome",
   24 |       "data",
   25 |       "detail_ref",
   26 |       "error"
   27 |     ],
   28 |     "api_version": "2",
   29 |     "transport_values": ["ok", "error"],
   30 |     "outcome_values": ["changed", "unchanged", "rejected", "conflict", "busy", "failed", "unknown"],
   31 |     "revision_rule": "An integer committed project revision when a project snapshot is observed; null when no service revision was observed, including a transport-decoded validation rejection before project lookup.",
   32 |     "operation_id_pattern": "^op_[A-Za-z0-9._-]+$",
   33 |     "as_of": "Authoritative service/store clock in RFC3339 UTC.",
   34 |     "next_status_change_at": "RFC3339 UTC timestamp or null; derived from the same snapshot clock."
   35 |   },
   36 |   "identity_rules": {
   37 |     "project_revision_owner": "SQLite canonical project state",
   38 |     "clock_owner": "local Rust service or the same application in offline maintenance mode",
   39 |     "attempt_identity": ["work_id", "attempt_id", "fence", "session_id"],
   40 |     "mutation_identity": ["operation_id", "expected_revision", "attempt_fence"],
   41 |     "default_hard_time_limit": "2h from claimed_at",
   42 |     "default_lease_ttl": "30m renewable ownership lease fixture",
   43 |     "legacy_lease_alias": "--ttl is accepted only as an alias for --lease-ttl",
   44 |     "hard_budget_rule": "Heartbeats and lease renewal never extend max_attempt_deadline.",
   45 |     "dependency_satisfaction": "Only accepted closed results satisfy a default prerequisite edge.",
   46 |     "review_rule": "Independent review is required only when the versioned acceptance profile contains a review gate."
   47 |   },
   48 |   "bounds": {
   49 |     "routine_response_target_bytes": {
   50 |       "minimum": 2048,
   51 |       "maximum": 8192,
   52 |       "workload": "three active agents"
   53 |     },
   54 |     "max_inline_items": 100,
   55 |     "max_inline_requirements": 32,
   56 |     "max_inline_reason_codes": 32,
   57 |     "max_inline_argv_items": 32,
   58 |     "max_inline_output_bytes": 65536,
   59 |     "detail_reference_required_above_bytes": 65536,
   60 |     "unknown_fields": "ignored after validation and never interpreted as policy"
   61 |   },
   62 |   "fixture_index": [
   63 |     "envelope-success.json",
   64 |     "envelope-empty.json",
   65 |     "envelope-conflict.json",
   66 |     "envelope-busy.json",
   67 |     "envelope-stale.json",
   68 |     "envelope-invalid.json",
   69 |     "envelope-service-unavailable.json",
   70 |     "envelope-unknown-outcome.json",
   71 |     "status-dto.json",
   72 |     "list-dto.json",
   73 |     "guide-dto.json",
   74 |     "next-dto.json",
   75 |     "receipt-success.json",
   76 |     "receipt-failure.json",
   77 |     "gate-diagnostics.json",
   78 |     "error-registry.json"
   79 |   ]
   80 | }
````
