# PF-S02-T11 — attempt 12 integration requests

These requests are intentionally bounded to protected paths outside this
worker's write set. They are not acceptance claims.

1. **Memory publication registration and call site**

   In protected `crates/application/src/knowledge.rs:645–680`, wrap
   `publish_memory` before it calls the publisher, and in protected
   `crates/memory/src/lib.rs`, connect the existing
   `Publisher::publish`/`publish_with_expected_base` path (around lines
   572–584) and `publication_readback` (around line 547) to the canonical
   identity-bound external-job adapter with `kind = memory_publication`.
   Register the project/operation/content/manifest identity before Git work;
   map journal readback to pending/readback-required/reconciled; never create a
   publication receipt from an interrupted or unverified Git effect. There is
   currently no `src/publisher.rs`, so adding a module without this root
   registration would be disconnected.

2. **CLI update registration and call site**

   In protected `crates/cli/src/main.rs:606–607`, `update::run` is invoked
   before the canonical database/store context is available. Resolve the
   project, database identity, operation identity, and request digest first;
   supply an identity-bound `UpdateJobPort` for `kind = update`; invoke the
   installer only after registration/start; and route installer/readback
   results through the pending/readback/reconciled/rejected states. The
   existing direct installer remains intentionally unchanged in this worker.

3. **Application runtime registration**

   In protected `crates/application/src/lib.rs:6,40`, re-export/register the
   recovery adapter types. In protected
   `crates/application/src/sqlite_adapter.rs:30–85` and its service callers,
   pass the current `IdentityContext` into `AttemptRecoveryAdapter`, expose
   durable recovery readback and resource acknowledgement, and ensure expiry,
   fail, release, and cancel routes return unresolved recovery rather than
   terminal success. The runtime seam currently records the release request
   when a recovery sidecar and live resource reservation are present.

4. **Verifier/evidence and backup call sites**

   The protected evidence routes are `crates/cli/src/main.rs:931–941`,
   `crates/cli/src/main.rs:4341+`, and
   `crates/cli/src/service.rs:2708–2735`; wrap their actual process/evidence
   execution in the identity-bound external-job adapter with `kind = evidence`
   or `verifier` before the side effect. No backup execution adapter/call site
   is present under `crates/`; when one is introduced, it must use
   `kind = backup` and the same pre-admission/readback contract. These paths
   are outside this worker set.
