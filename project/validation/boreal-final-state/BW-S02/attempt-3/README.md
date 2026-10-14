# BW-S02-T90 attempt 3 — final-candidate lightweight checks

**Candidate-local lightweight result: PASS on product source `bff07ab430db65d1eca26174ba9e059d82666db3`. Final T90 acceptance: PENDING.** This source descends from the required integrated commit `5762bfac71847dce27cdcc7fa7a48e8348116e55`. Evidence was recorded on local HEAD `299b5f5f4b41fcca29136bae1f656826fa9616b2`; its parent is the product source, and the commit only adds the prior attempt-2 evidence. No product files changed in this attempt.

## Checks completed

- Project TUI typecheck and tests passed on Node 26.8.2; tests passed 99/99.
- Global TUI typecheck and tests passed on Node 26.8.2; tests passed 92/92.
- Project and Global TUI tests also passed on Node 20.20.2: 99/99 and 92/92.
- Release identity tests passed 6/6, release builder tests 2/2, full-suite contract tests 14/14, and Global TUI identity tests 4/4.

Full command outputs are retained under [`logs/`](logs/); exact commands and exit statuses are in [`COMMANDS.md`](COMMANDS.md).

## Reconciliation and remaining work

The old Project receipt fixture and Global TUI fixture/assertion failures still do not reproduce in the final-candidate TypeScript suites. The `work_node_v3` unique-conflict fix is present in the integrated source, and its previous production-store/package acceptance passed on source `de8673e`; this attempt did not rerun Cargo or a package build, so the production-store regression and installed-package create path still need final-source confirmation.

The coordinator reported that its full smoke on this candidate had one unrelated stale service-projection test expectation for the `planning_contract` field added by S12-T02. That failure is outside the T90-owned integration/evidence boundary and is not included as a passing T90 gate.

No Cargo command, release build, package smoke, `bwrk` state mutation, CI dispatch, or release dispatch was run in this attempt. The attempt-2 native ARM64 package identity remains historical to its exact source (`de8673e`) and is preserved in [`attempt-2/`](../attempt-2/); it must not be attributed to `bff07ab`.

The working checkout had a 3.3 GiB `target/` directory and 5.3 GiB free before the lightweight run. The final exact-source native package/build gate remains pending the coordinator's focused Cargo run and explicit go-ahead. macOS x86-64 and Linux x86-64 remain CI-only/unqualified until an authorized PR CI/release-matrix run exists. No workflow was dispatched.

The prior attempt-1 failure report remains unchanged. No new leaf-owned fix or path grant was needed for the TypeScript findings; if they recur, use the existing bounded ownership paths recorded in attempt 2. Do not close T90 based on this candidate-local partial result.
