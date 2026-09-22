# PF-S02-T11 — attempt 17 integration requests

These are bounded follow-ups, not acceptance claims. They require the named
protected-path stewards and must not be applied by this worker.

1. **Versioned service/application route** — Re-export or otherwise register
   the typed identity-bound recovery request/result boundary through the
   versioned service API. The route must carry database/project/workspace
   identity, operation ID, request digest, attempt/fence context, and the
   canonical recovery input; do not reintroduce project-id-only released
   resolution.
2. **Canonical external-effect callers** — Wire genuine verifier/evidence
   execution, memory publication, backup, update, and stop/recovery callers
   through their durable identity-bound job/readback adapters. Record actual
   process/readback identities; do not infer success from a timeout or process
   return alone.
3. **Store API hardening** — The application currently invokes the existing
   resource request primitive only through
   `AttemptRecoveryAdapter::new_with_identity`, which performs current identity
   validation. If the store steward exposes a distinct identity-bound resource
   request API, migrate this adapter without weakening the canonical event or
   acknowledgement contract. Store files are outside this attempt’s write set.
4. **Independent review/revalidation** — Review the exact final hashes in
   `COMMANDS.md`, preserve the coordinator checkpoint provenance, and rerun
   the bounded application plus required combined-tree gates before recording
   any acceptance or successor authorization.

No shared-file patch is requested from this attempt, and no plan/state,
acceptance, ledger, commit, or push action is authorized here.
