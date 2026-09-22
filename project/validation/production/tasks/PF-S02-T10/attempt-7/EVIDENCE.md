# PF-S02-T10 attempt 7 — independent review evidence

## 1. Bounded implementation result

**Observed: PASS as a bounded contribution.**

Attempt 6 converts the 17 inventoried paired operation/audit writes to the
existing `append_operation_audit_in_transaction` boundary:

- 16 root mutation paths in `crates/store/src/lib.rs`;
- one shared v3 mutation wrapper in `crates/store/src/work_model_v3.rs`.

The converted paths preserve their existing operation IDs, request digests,
commands, event types, subjects, payloads, revisions, transaction ownership,
and replay behavior. The v3 wrapper also uses the same boundary for its
hierarchy/intake mutations.

The operation-only initialization replay branch and operation-only knowledge
source-registration path were correctly not changed into fabricated audit
events.

## 2. Transaction and identity behavior

**Observed: PASS for the reviewed call-site conversion, with a documented
compatibility limitation.**

`SqliteStore::append_operation_audit_in_transaction` retains the caller-owned
transaction boundary. When the project identity tables exist and the project
is bound, it obtains the identity context and delegates to
`OperationJournal::append_in_transaction_with_identity`. That path validates
the operation/audit project, actor, session, fence, revision, and identity
context before appending the operation identity and redacted audit event.

When the identity seam is absent or the project is not bound, the helper falls
back to `append_operation` followed by `append_audit_event`. This preserves the
legacy fixture behavior used by the focused tests, but it means this bounded
conversion alone does not make every schema or project identity-bound. The
production opener and project-binding integration must close that boundary
before it can be treated as the universal authorization path.

## 3. Validation results

The five focused Boreal store suites passed with **55/55 tests**. The passing
coverage includes:

- identity-bound operation/audit pairing and mismatch rejection;
- rollback when the audit append fails;
- exact operation replay and pending/terminal outcome distinctions;
- recovery records, unresolved recovery claim blocking, and readback;
- claim/fence behavior and store lifecycle contracts;
- independent identity, entity revision, proof revision, and restore-epoch
  checks.

`cargo fmt --all -- --check` and `git diff --check` also passed.

These are valid store-level results. They do not establish application/service
integration, real-service lifecycle behavior, or release readiness.

## 4. Residual canonical operation gaps

The broader source scan still finds operation writers outside the bounded
conversion:

- `crates/cli/src/service.rs:2566`;
- `crates/cli/src/main.rs:5855`;
- `crates/store/src/lib.rs:1820` for the unchanged-project initialization
  replay branch;
- `crates/store/src/knowledge.rs:140` for operation-only source registration.

The first two are application/CLI paths and remain outside attempt 6. The
operation-only store paths require an explicit policy decision or a separate
canonical integration, not an invented audit event. The generic journal’s
compatibility method also still supports unbound fixture schemas.

Consequently, the reviewed slice improves root store coverage but does not
prove that every consequential store, application, and CLI writer is routed
through one identity-bound operation/audit/revision boundary.

## 5. Remaining PF-S02-T10 gaps

The following remain open and prevent full-task acceptance:

1. Project identity must be bound to the validated workspace through the real
   initialization and dashboard open paths, with moved-root, symlink, restore,
   and cross-project isolation evidence.
2. Recovery resolution still needs a canonical authenticated operation context,
   expected revisions/fence, project revision, durable audit/readback, and
   idempotent replay.
3. Recovery obligations and external jobs must be wired through the real
   verifier, update, backup, stop/recovery, and memory-publication adapters;
   store primitives and focused tests are not sufficient.
4. All consequential lifecycle/planning/application writers need the same
   identity-bound transaction boundary, or a reviewed compatibility exception.
5. The complete PF-S02-T10 migration, deletion, restart, concurrency,
   application-integration, and real-service acceptance checklist remains
   incomplete.

## 6. Review conclusion

Attempt 6 is technically sound and **acceptable as a bounded contribution**:
the scoped paired-write conversion is present, limited to the claimed files,
and passes the focused validation.

It is **not acceptance of PF-S02-T10** and must not mark that task complete,
certify the sprint, or be presented as release-ready behavior.
