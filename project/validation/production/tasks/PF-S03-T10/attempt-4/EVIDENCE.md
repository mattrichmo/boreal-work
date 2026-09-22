# Evidence record — PF-S03-T10 / attempt 4

Record ID / task / attempt: `PF-S03-T10 / independent-validation / 4`

Evidence class: pure-domain source and contract validation.

Input source archive/commit/tree hash: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`; working tree dirty and contains unrelated in-progress changes.

Target source hash: `crates/domain/tests/production_properties.rs` SHA-256 `4455551dcad2120596fbb7d9edbcfb8c95edd6752792d1d1f7c1943e4fe8cb89`.

Oracle hash: `project/validation/production/domain/PF-S03-T10-ORACLE.md` SHA-256 `1701bc8596340bf85936619238071a8978de778815ca4afcb2560109e73f961b`.

Host/toolchain: macOS host; Cargo 1.85.0; rustc 1.85.0 (Homebrew); no terminal geometry or external service involved.

Setup: read-only inspection of the corrective test/oracle files, followed by locked local Rust and structural contract checks. No synthetic service receipt, operation, review, or closeout was used.

Expected assertion: the corrective pure-domain contribution binds an oracle identity, covers the normative T01–T18/I01–I15 crosswalk, exercises deterministic generation/order independence, scheduled boundaries, availability/integrity action safety, historical invariance, and reproducible shrinking without claiming service integration.

Observed result: the focused target passed 13/13 tests. The target includes the bound contract/source constants, deterministic generated status cases over four fixed seeds and 256 cases per seed, stable reason ordering, schedule boundaries, typed availability/integrity denial, action allow/deny vectors, foreign proof rejection, historical-attempt invariance, exhaustive transition-pair coverage, and a complete layered vector map. Full domain tests, strict clippy, formatting, diff hygiene, and structural contract validation also passed.

Outcome: `bounded contribution accepted for independent review`; `full PF-S03-T10 task not complete`.

Bounded acceptance rationale:

- The reviewed pure-domain files are internally coherent at the recorded source identity.
- The focused property suite is executable and passed without fixture-only service claims.
- The oracle explicitly marks T18, I07, and I14 as service-only boundaries instead of pretending pure-domain tests cover persistent expiry resolution, close-intent persistence, or operation replay/readback.
- The companion document records the same status/transition identities and coverage boundary.

Full-task limitations:

- The task requires the complete integration layer and exact combined-source evidence; this review did not validate store/application/service enforcement.
- Service-only vectors remain boundaries and are not acceptance evidence for persistent expiry disposition, close-intent persistence, or operation replay/different-payload conflict.
- The required real-service acceptance matrix, races, wrong-project/wrong-principal checks, deadline/retry/readback behavior, and genuine service lifecycle were not run as part of this pure-domain review.
- Passing domain tests do not establish that a store snapshot supplies all required canonical facts or that clients use one authoritative action policy.

Raw command details and exit codes are recorded in `COMMANDS.md`. No operation, receipt, source artifact, reviewer decision, or native package identity applies to this pure-domain review.

