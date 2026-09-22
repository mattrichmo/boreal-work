# Workflow 01 — foundation and canonical store

## Scope

Primary sprint: PF-S02 — Canonical persistence, revisions and migration
foundations.

This stream makes requirements, project identity, revisions, operations,
durable jobs, recovery facts, and schema constraints survive independently of
derived projections or UI labels.

## Entry and exit

- Entry: PF-S01 exit/revalidation is accepted and the selected PF-S02 task is
  graph-ready.
- Exit: all selected PF-S02 leaves are integrated, independently reviewed,
  reconciled, and PF-S02-T92 is accepted.

## Worker boundary

- [ ] Read the PF-S02 sprint card and exact task card before editing.
- [ ] Treat `crates/store/src/lib.rs`, schema manifests, migration ordering,
      and operation roots as protected integration resources.
- [ ] Develop new store modules and focused tests in the task's declared scope.
- [ ] Submit root/schema/registry changes as integration requests.
- [ ] Preserve existing failed attempts, rejected reviews, and recovery facts.
- [ ] Prove that deleting an observation cannot delete a requirement or erase a
      recovery obligation.

## Parallelization

This stream may run concurrently with Workflow 02. Within this stream, tasks
that touch the same store root, migration order, profile tables, or operation
identity must be serialized by the store steward.

## Handoff checklist

- [ ] Schema and migration impact is listed.
- [ ] Transaction boundaries and revision checks are named.
- [ ] Fresh database and upgrade-path checks are recorded.
- [ ] Unknown outcome/readback behavior is covered where applicable.
- [ ] The handoff identifies any contract needed by PF-S04/PF-S05.
