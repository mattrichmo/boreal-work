# PF-S02-T11 attempt 18 — protected integration requests

## 1. CLI update route — required coordinator/service owner

Protected callsite: `crates/cli/src/main.rs:606-607` currently dispatches
`update`/`upgrade` directly to `update::run(&parsed)` before the canonical
service/store context is available.

Required wiring:

1. Resolve the project/database, operation id, actor id, session id, source and
   config identities, target identity, request digest, creation time and
   deadline in the canonical service boundary.
2. Register the operation through the identity-bound durable external-job API
   (`ExternalJobKind::Update`) and implement `UpdateJobPort` with the store's
   register/acquire/readback/mark-readback/reconcile transitions.
3. Pass `update::execute_installer` only as the callback after the port returns
   `UpdateJobAcquisition::Won`. Never call it from the parser or direct route.
4. After the installer returns, read the installed manifest/binary from the
   target and construct `UpdateJobObservation::Reconciled` only when the
   operation, target, side-effect reference, result digest, version and
   observed timestamp match the admitted request. Otherwise retain pending or
   readback-required/unknown state.
5. Map every non-resolved adapter outcome to the protocol's pending/unknown
   response; do not convert it to `Changed` or another success outcome.

The current `run` implementation is deliberately fail-closed rather than
inventing this context or invoking the installer outside durable admission.

## 2. Memory publication module registration — required memory owner

Protected path: `crates/memory/src/lib.rs` is the monolithic memory root and is
outside this attempt's write set. Register `mod publisher;` there and expose
the adapter through the accepted memory API, preserving the existing
`Publisher::publish`, `publication_identity`, journal and
`publication_readback` boundaries.

Required wiring:

1. Build `PublicationJobRequest` from the canonical project/operation/request
   digest, entry id, content digest, publication manifest identity, memory-root
   identity, actor/session/source/config identities, deadline and creation
   timestamp.
2. Register/admit the job before any Git or journal mutation; provide a
   store-backed `PublicationJobPort` that binds every readback to the same
   operation and request digest.
3. Call `Publisher::publish` only in the `Won` callback. If the call can have
   committed before returning an error, preserve the original job as unknown
   and reconcile by `Publisher::publication_readback`, not by retrying Git.
4. Return `PublicationJobObservation::Reconciled` only after readback proves
   the same operation, manifest, entry/content bytes, memory root, Git
   revision and observed timestamp.

## 3. Shared application/store adapter — required external-job owner

Protected paths include the application/store runtime and job-port roots. Add
the concrete identity-bound implementation there, using the existing durable
external-effect admission/readback API and its canonical revision/fence rules.
The implementation must make the `Won` transition atomic, reject conflicting
request identities, preserve `Pending`/`ReadbackRequired`/unknown outcomes,
and never force-break a live lock or retry a side effect for an exact replay.

No source-path expansion was made in this attempt to satisfy these requests.
