# PF-S00-T08 attempt 3 — implementation evidence

## Scope implemented

- Application-owned `WorkflowRegistry` now preserves package schema identity and typed input/criterion metadata while retaining the existing embedded-package validation and exact reference lookup.
- Additive protocol DTOs describe workflow input, criterion, asset, package and show results without changing the envelope version or lifecycle authority.
- `workflows list` and `workflows show WORKFLOW_REF` are registered as direct/service read routes and are available before any project database is selected.
- The Unix service handler exposes the same read-only package and exact-reference query. Workflow service requests no longer require an unrelated project identifier.
- Focused application, CLI, service, registry/help and unknown-reference tests are present and passing.

## Exact changed paths in this attempt

- `crates/application/src/workflow_assets.rs`
- `crates/application/src/lib.rs`
- `crates/protocol/src/models.rs`
- `crates/cli/src/command_registry.rs`
- `crates/cli/src/main.rs`
- `crates/cli/src/service.rs`
- `crates/application/tests/workflow_queries.rs`
- `crates/cli/tests/workflow_discovery.rs`
- `crates/cli/tests/service_workflow_discovery.rs`

## Artifact identity

Rebuilt binary: `target/debug/bwrk`

Binary SHA-256: `48d7f6666515151cd96a8261c5f00c36d4f95ffdccea457817369e6704913abd`

Source file SHA-256 values:

```text
697b28fdae80df41eac872acfc7c4ed1e2ea7ad26466b0da6f424286ac0519a5  crates/application/src/workflow_assets.rs
6e924cf869b74e3df2fcd800e98fc6b8f6b4791f8021379395eb6fda8b96fd56  crates/application/src/lib.rs
73c2cf33a1ad97950963a919e6bc49015db1658109dddb321da9ceac097fea97  crates/protocol/src/models.rs
c0fd0fbadc83f5f305792f48407ea97b841c0b80805cd4492d36afea88268f17  crates/cli/src/command_registry.rs
9ffc4fdae1097d5dcccbf6f616084c6767427530f3067041520911907ed51f6f  crates/cli/src/main.rs
b542ea87a645ea2cfb4d6e5b9114edab92ba0170670fc1e4b1970c6ace92bb70  crates/cli/src/service.rs
55f0c6f55f731e4f5724966b9e96dcd076b73f8ee8b4752e2234bd7ba31dec12  crates/application/tests/workflow_queries.rs
5e7e2335cf7e5d7e58b307a7d3a9cfb826b518019164a1076429993ec40c15c7  crates/cli/tests/workflow_discovery.rs
84d1393a3d43a79d14572068133f9c7e0ac267cbba99aa2669569a43ac90d700  crates/cli/tests/service_workflow_discovery.rs
```

## Acceptance limits

This evidence establishes the bounded T08 implementation and focused checks only. It does not accept T08, reconcile T91, pass T92, authorize PF-S01, or claim genuine lifecycle/native-release acceptance. Independent review and the required T91/T92 chain remain mandatory.
