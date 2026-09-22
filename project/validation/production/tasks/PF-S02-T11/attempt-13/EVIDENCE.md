# PF-S02-T11 — attempt 13 bounded evidence

## Disposition

**Ready for independent review; not task acceptance.** This attempt repairs a
real idempotency defect in the application external-effect adapter and proves
the focused behavior. Protected production call-site integration and one
combined application failure remain open.

## Concrete change

`ExternalEffectAdapter::execute` now retains the store registration replay
flag. A replayed job already in `running` is returned as pending/readback-
required without invoking the external callback again. A replayed job still at
the adapter's `admitted` boundary may resume once, because the adapter has not
yet crossed its external-effect start boundary. The new regression test
`external_effect_replay_does_not_invoke_running_side_effect_twice` confirms a
second request does not run the side effect callback twice.

This preserves operation/request identity and avoids duplicate verifier,
installer, backup, or memory-publication side effects after restart. It does
not manufacture success: the replayed running job remains pending until
attributable readback.

## What is proven

- Admission precedes the external callback.
- Operation/request/project identity and digest drift are rejected.
- Pending, readback-required, reconciled, rejected, and failed outcomes remain
  distinct.
- A running external effect survives restart and is readable without rerunning
  the callback.
- Focused application, CLI update, memory, store recovery/external-job,
  contract, owned-format, and diff checks pass.

## What is not proven

- The verifier/evidence process, memory publisher, backup adapter, or update
  installer is not yet registered at its canonical production call site.
- Identity-bound recovery readback/resource release acknowledgement is not
  fully wired: the store exposes identity-bound resolution but not equivalent
  identity-bound recovery/resource read APIs, and protected application callers
  still use the legacy constructor/path.
- The full application package is not green because the protected lifecycle
  test attempts a duplicate live resource key and fails with the SQLite unique
  constraint recorded in `COMMANDS.md`.
- Full workspace formatting is not green because of unrelated drift outside
  the worker set.
- No genuine service-backed verifier, release update, or production cutover
  claim is made.
