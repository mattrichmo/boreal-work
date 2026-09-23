# PF-S03-T09 — attempt 3 evidence

## Source binding

- `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Working tree: dirty; this bounded attempt is file-bound and uncommitted.
- Current scoped hashes:

| File | SHA-256 |
| --- | --- |
| `crates/cli/src/main.rs` | `a32057edec4e9e4a548ad0441f320b245a1c4a14630105f342e16d0ba49528cd` |
| `crates/cli/src/service.rs` | `c562b0b48bbbfb763a24af334756b8e31c2e039a39ee4e9e2dde0e87563d67de` |

## Regression coverage

The compatibility bridge now lets the CLI discover work that is ready under the legacy status projection while the v3 action context is unavailable. The candidate is still submitted to the canonical claim/start mutation path; the compatibility hint does not authorize a mutation.

The status JSON retains action descriptors and denial reasons from the domain action evaluator. Only the terminal-consumed subset is serialized inline, preventing a multi-item status page from being rejected for exceeding the protocol limit.

Results:

- Four reported CLI regressions: passed.
- Full CLI package and integration suite: 120 passed, 1 ignored.
- Release acceptance bounded status payload: passed.
- Formatting and diff checks: passed.

## Review boundary

The legacy status read still lacks durable v3 entity/proof/session facts. Therefore this attempt does not claim complete PF-S03 action authorization, authenticated principal binding, or store/application identity integration. Those remain required independent-review findings.
