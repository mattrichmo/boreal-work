# R-ERRORS — project/spec/protocol/error-registry.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/protocol/error-registry.json:L1–L70`  
**File SHA-256:** `f4691c118b37522d4857cc9ebd74bfa937ebcb1123538f7008d896bc97c34aef`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Typed application errors versus transport and unknown outcomes.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,70p' 'project/spec/protocol/error-registry.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "schema_version": "boreal.errors.v1",
    3 |   "protocol_version": "2",
    4 |   "unknown_code_policy": "A code outside this registry is a protocol failure and must fail closed as protocol_mismatch.",
    5 |   "entries": [
    6 |     {"code":"invalid_argument","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The command contains invalid arguments.","recovery":"help"},
    7 |     {"code":"invalid_parent","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The parent is not valid for this work kind or project.","recovery":"show_parent_or_help"},
    8 |     {"code":"derived_status_read_only","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"A derived status cannot be set directly.","recovery":"use_the_authoritative_transition"},
    9 |     {"code":"unknown_command_namespace","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The command namespace is not in the v2 CLI registry.","recovery":"commands_or_help"},
   10 |     {"code":"protocol_mismatch","outcome":"failed","exit_class":"invalid","retryable":false,"message":"The client and service protocol versions are incompatible.","recovery":"upgrade_or_downgrade_as_a_unit"},
   11 |     {"code":"unsupported_platform","outcome":"failed","exit_class":"service_unavailable","retryable":false,"message":"This platform is not supported by the local service contract.","recovery":"use_macos_or_linux_or_offline_maintenance"},
   12 |     {"code":"not_found","outcome":"rejected","exit_class":"not_found","retryable":false,"message":"The requested project record was not found.","recovery":"show_or_list_parent_scope"},
   13 |     {"code":"permission_denied","outcome":"rejected","exit_class":"permission","retryable":false,"message":"The actor is not authorized for this operation.","recovery":"request_the_required_role"},
   14 |     {"code":"revision_conflict","outcome":"conflict","exit_class":"conflict","retryable":true,"message":"The expected project revision is no longer current.","recovery":"resnapshot_then_reissue_with_new_revision"},
   15 |     {"code":"stale_context","outcome":"rejected","exit_class":"stale","retryable":true,"message":"The guidance or context snapshot is stale.","recovery":"request_next_again"},
   16 |     {"code":"stale_revision","outcome":"conflict","exit_class":"stale","retryable":true,"message":"The expected project revision is no longer current.","recovery":"resnapshot_then_reissue_with_new_revision"},
   17 |     {"code":"stale_fence","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The attempt fence is no longer current.","recovery":"read_current_attempt_before_any_new_claim"},
   18 |     {"code":"stale_receipt","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The receipt does not match the current attempt or source snapshot.","recovery":"attach_new_receipt_for_current_identity"},
   19 |     {"code":"already_claimed","outcome":"conflict","exit_class":"conflict","retryable":false,"message":"Another current attempt owns this work item.","recovery":"read_current_attempt"},
   20 |     {"code":"claim_conflict","outcome":"conflict","exit_class":"conflict","retryable":false,"message":"Another current attempt owns this work item.","recovery":"read_current_attempt"},
   21 |     {"code":"status_not_assignable","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"Derived status is owned by the evaluator.","recovery":"read_current_decision"},
   22 |     {"code":"work_not_published","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"Work is not published and cannot be claimed.","recovery":"publish_work"},
   23 |     {"code":"dependency_not_closed","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"The default prerequisite is not accepted closed.","recovery":"wait_for_closeout"},
   24 |     {"code":"not_claimable","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"Work is not claimable for this actor at this revision.","recovery":"follow_current_guidance"},
   25 |     {"code":"attempt_conflict","outcome":"conflict","exit_class":"conflict","retryable":false,"message":"The work or session already has a current attempt.","recovery":"read_current_attempt"},
   26 |     {"code":"attempt_unaccepted","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"The attempt must be accepted before this operation.","recovery":"accept_current_attempt"},
   27 |     {"code":"writer_queue_full","outcome":"busy","exit_class":"busy","retryable":true,"message":"The project writer queue is at capacity.","recovery":"retry_same_operation_id_after_retry_after_ms"},
   28 |     {"code":"service_busy","outcome":"busy","exit_class":"busy","retryable":true,"message":"The local service is busy with bounded work.","recovery":"retry_same_operation_id"},
   29 |     {"code":"service_unavailable","outcome":"failed","exit_class":"service_unavailable","retryable":true,"message":"No compatible local project service is available.","recovery":"retry_or_enter_supported_offline_mode"},
   30 |     {"code":"unknown_outcome","outcome":"unknown","exit_class":"unknown_outcome","retryable":false,"message":"The mutation result was not observed after transport interruption.","recovery":"read_operation_by_id_before_retry"},
   31 |     {"code":"attempt_expired","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"The attempt expired and requires fenced review.","recovery":"confirm_stop_and_review_expired_attempt"},
   32 |     {"code":"expired_review","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"The open attempt expired and requires fenced review.","recovery":"confirm_stop_and_review_expired_attempt"},
   33 |     {"code":"dependency_cycle","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The dependency change would create a cycle.","recovery":"inspect_dependency_cycles"},
   34 |     {"code":"prerequisite_open","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"A normal prerequisite is not accepted closed.","recovery":"wait_for_or_inspect_prerequisite_closeout"},
   35 |     {"code":"dependency_open","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"A normal prerequisite is not accepted closed.","recovery":"wait_for_or_inspect_prerequisite_closeout"},
   36 |     {"code":"blocked_work","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"A hard intervention reason prevents progress.","recovery":"resolve_named_blocker_with_authority"},
   37 |     {"code":"hard_blocked","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"A hard intervention reason prevents progress.","recovery":"resolve_named_blocker_with_authority"},
   38 |     {"code":"operator_required","outcome":"rejected","exit_class":"permission","retryable":false,"message":"This work requires an authorized operator.","recovery":"request_operator_action"},
   39 |     {"code":"paused","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"Dispatch is paused by policy.","recovery":"obtain_authorized_resume"},
   40 |     {"code":"retry_wait","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"Retry is not allowed before retry_not_before.","recovery":"wait_until_retry_not_before"},
   41 |     {"code":"verification_required","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"Required verification evidence is missing or failed.","recovery":"inspect_gate_diagnostics"},
   42 |     {"code":"review_required","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"The acceptance profile requires independent review that is not present.","recovery":"obtain_authorized_independent_review"},
   43 |     {"code":"close_intent_missing","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"A durable close intent is required.","recovery":"send_finish_close"},
   44 |     {"code":"expiry_stop_unconfirmed","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"The expired worker or shared worktree is not safely stopped.","recovery":"confirm_stop_or_operator_recovery"},
   45 |     {"code":"lease_expired","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"The renewable lease has elapsed.","recovery":"review_expiry"},
   46 |     {"code":"hard_deadline_immutable","outcome":"rejected","exit_class":"blocked","retryable":false,"message":"A hard attempt deadline cannot be extended by liveness.","recovery":"review_expiry"},
   47 |     {"code":"role_denied","outcome":"rejected","exit_class":"permission","retryable":false,"message":"The actor role cannot perform this operation.","recovery":"request_authorized_actor"},
   48 |     {"code":"reviewer_cannot_review_own_attempt","outcome":"rejected","exit_class":"permission","retryable":false,"message":"An attempt actor cannot independently review the same attempt.","recovery":"request_an_independent_reviewer"},
   49 |     {"code":"operation_conflict","outcome":"conflict","exit_class":"conflict","retryable":false,"message":"The operation ID was reused with a different request.","recovery":"use_a_new_operation_id"},
   50 |     {"code":"operation_unknown","outcome":"unknown","exit_class":"unknown_outcome","retryable":false,"message":"The mutation outcome is unknown until readback.","recovery":"read_operation_by_id"},
   51 |     {"code":"receipt_invalid","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The receipt is missing a required typed field or has invalid provenance.","recovery":"submit_a_structured_receipt"},
   52 |     {"code":"receipt_subject_mismatch","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The receipt subject does not match the current attempt.","recovery":"attach_new_receipt_for_current_identity"},
   53 |     {"code":"receipt_command_mismatch","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The receipt command is not the declared bounded gate command.","recovery":"run_the_declared_gate"},
   54 |     {"code":"receipt_source_mismatch","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The receipt source snapshot does not match the attempt.","recovery":"rerun_against_current_source"},
   55 |     {"code":"receipt_config_mismatch","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The receipt configuration identity does not match the attempt.","recovery":"rerun_with_current_configuration"},
   56 |     {"code":"receipt_policy_mismatch","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The receipt acceptance policy does not match the work profile.","recovery":"rerun_under_current_profile"},
   57 |     {"code":"receipt_attestation_missing","outcome":"rejected","exit_class":"permission","retryable":false,"message":"The receipt lacks the required executor attestation.","recovery":"use_a_witnessed_gate_runner"},
   58 |     {"code":"receipt_exit_nonzero","outcome":"failed","exit_class":"failed","retryable":true,"message":"The declared gate command exited nonzero.","recovery":"fix_and_rerun_declared_gate"},
   59 |     {"code":"receipt_observable_missing","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"The receipt does not contain the required observable coverage.","recovery":"submit_complete_structured_receipt"},
   60 |     {"code":"receipt_command_nonzero","outcome":"failed","exit_class":"failed","retryable":true,"message":"The declared gate command exited nonzero.","recovery":"fix_and_rerun_declared_gate"},
   61 |     {"code":"gate_unsatisfied","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"One or more required acceptance gates remain unsatisfied.","recovery":"inspect_gate_diagnostics"},
   62 |     {"code":"audit_scope_missing","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"Required audit scope evidence is missing.","recovery":"attach_audit_receipt"},
   63 |     {"code":"not_closed","outcome":"rejected","exit_class":"blocked","retryable":true,"message":"Closeout is not permitted while required diagnostics remain.","recovery":"follow_the_next_gate_action"},
   64 |     {"code":"close_intent_invalidated","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The durable close intent no longer matches the current attempt or policy snapshot.","recovery":"issue_a_new_finish_close_intent"},
   65 |     {"code":"close_intent_invalid","outcome":"rejected","exit_class":"stale","retryable":false,"message":"The durable close intent no longer matches the current attempt or policy snapshot.","recovery":"issue_a_new_finish_close_intent"},
   66 |     {"code":"already_terminal","outcome":"unchanged","exit_class":"ok","retryable":false,"message":"The requested terminal result is already committed.","recovery":"read_the_existing_result"},
   67 |     {"code":"guidance_unavailable","outcome":"failed","exit_class":"failed","retryable":false,"message":"Trusted guidance could not be compiled safely.","recovery":"repair_registry_or_context_then_request_next"},
   68 |     {"code":"unsafe_command","outcome":"rejected","exit_class":"invalid","retryable":false,"message":"The command or path is not allowed by the trusted runner policy.","recovery":"use_the_registry_generated_safe_action"}
   69 |   ]
   70 | }
````
