# Production-completion evidence contract

This contract applies to every `PF-` task and sprint. It supplements the
plan's task cards; it does not replace `plan.json`, `STATE.json`, the Rust
service, or Boreal's operational database.

## Source identity

Every handoff records the exact input and accepted source identity. A dirty
working tree is identified as dirty; a reported commit is never treated as a
complete snapshot. Evidence produced before integration does not validate the
combined tree. The coordinator reruns affected checks after integration.

Minimum identity fields:

- repository root, branch, and HEAD;
- dirty/clean state and a deterministic source aggregate or archive digest;
- schema/protocol/migration versions where relevant;
- tool/runtime/platform identity;
- package, binary, installer, or published-channel digests where relevant.

## Evidence layers

| Layer | May establish | Cannot establish by itself |
| --- | --- | --- |
| Static source/contract inspection | Declared invariants, route presence, links, schema shape | Runtime correctness or public behavior |
| Pure unit/property tests | Determinism, precedence, invalid combinations | Transaction, service, process, or release behavior |
| Store integration | Migrations, constraints, transactions, controlled corruption | Authenticated service, genuine verifier, or TUI behavior |
| Application/service integration | Real requests, transactions, readback, external execution | Native installed artifact or publication |
| CLI/TUI PTY | Actual public input, rendering, resize, service-authorized action | Fixture-only lifecycle or release identity |
| Native installed artifact | Installed binary/assets/runtime on that target | Other targets or published-channel identity |
| Published channel | Authorized download, verification, install, and readback | Unpublished local artifacts |
| Genuine agent/human workflow | Supported harness/operator behavior without hidden guidance | A scripted simulation |

An evidence record labels its layer and scope. Fixture or synthetic results are
never promoted to real service, native, publication, or unfamiliar-agent proof.

## Minimum task handoff

Each attempt supplies:

1. task ID, attempt number, worker, reviewer requirement, and bounded write set;
2. input and final source identities;
3. exact changed paths and migration/protocol/security impact;
4. commands with argv, cwd, timestamps, exit codes, raw stdout/stderr paths,
   tool versions, and artifact hashes;
5. positive, negative, boundary, and integration outcomes appropriate to the
   task;
6. unresolved findings, unavailable capabilities, and the next safe action;
7. handoff/evidence paths and explicit `not accepted` status until the
   coordinator records acceptance.

Secrets, credentials, cookies, live database contents, and private tokens do
not belong in evidence. Restricted inputs are named and classified, not copied.

## Task and gate states

`not_started`, `assigned`, `in_progress`, `blocked`, `awaiting_integration`,
`ready_for_review`, `accepted`, and `rejected` have the meanings in
`execution/STATE_MODEL.md`. A worker handoff is never sprint acceptance.

Every sprint requires the independent chain:

```text
implementation leaves → T90 independent review → T91 reconciliation → T92 exact-tree revalidation
```

T90 records findings even when there are none. T91 creates bounded corrective
tasks without making T90 depend on its own fixes. T92 validates the reconciled
combined tree and is the only sprint-entry unlock.

## Unknown and failed outcomes

An interrupted command, timeout, unavailable tool, missing platform, or
unknown mutation outcome remains unresolved. Read back the original operation
using its operation ID before retrying. Never convert a missing response into a
failed mutation or a successful state. Failed evidence, expired attempts, and
rejected reviews remain append-only history.
