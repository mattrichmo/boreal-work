# PF-S02-T09 attempt-1 — production schema path remediation

Date: 2026-09-22

## Scope

This bounded remediation addresses the independent-review finding that
shipped CLI, service-host, recovery, and dashboard paths opened stores with
the compatibility schema instead of the exact canonical production schema.

Owned source paths:

- `crates/cli/src/main.rs`
- `crates/cli/src/service.rs`
- `crates/cli/src/dashboard.rs`

Protected paths were not edited: store core, plan files, `STATE.json`,
acceptance ledgers, `memory/`, and the PF-S02-T04 worker write set.

The bootstrap identity-atomicity question is explicitly included as a
remaining integration issue. The production-schema regression is intentionally
ignored in the normal suite and is expected to fail until the shared
store/application boundary supplies an atomic “create project + bind
workspace + append project.init” primitive.
