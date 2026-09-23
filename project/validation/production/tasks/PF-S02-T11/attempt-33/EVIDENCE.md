# PF-S02-T11 — attempt 33 evidence

## Result

**Bounded remediation passed.**

The close request digest now includes the complete typed receipt identity:
schema version, receipt and receipt-operation IDs, work/attempt/fence/gate
subject, executable and argv, working directory, exit code, start/end times,
source and configuration identity, environment fingerprint, output digest and
reference, coverage kind/profile/version/observables, attestation, and result.

Terminal result readback now requires:

- the parent operation to exist in the authenticated project;
- the result command and expected result-operation ID;
- matching project, actor, session, attempt, fence, and expected revision;
- a result request digest derived from the parent operation ID and digest; and
- matching parent operation ID and digest in the result payload.

## Validation

- Focused `finish_close` tests: **5 passed**.
- Full `boreal-cli` package suite: **81 passed, 1 ignored**.
- `cargo check --locked --offline -p boreal-cli`: **passed**.
- `rustfmt crates/cli/src/main.rs`: **passed**.
- `git diff --check -- crates/cli/src/main.rs`: **passed**.

Added regressions cover every proof-relevant receipt field and a corrupted
terminal result with mismatched attempt identity. Existing service replay and
closeout tests remain green.

## Source identity

- Git `HEAD`: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Owned working-tree file SHA-256:
  `99731ee0441b8012ed75240f60e269a1dc25f4a2347b554748fc44f61026f72d`

This evidence is source-bound to the file hash above; the file was dirty
relative to `HEAD` when the checks ran.

## Residual limitation

`finish_close` still uses a durable parent intent plus deterministic child
operations/result operation rather than one SQLite transaction spanning every
application-side child mutation. A crash between child effects remains a
recoverable unknown/readback state; it is not converted into success or a
fabricated proof result.
