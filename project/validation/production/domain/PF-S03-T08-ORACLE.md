# PF-S03-T08 pure-domain oracle

The focused target `production_properties.rs` is deliberately dependency-free.
It uses four fixed LCG seeds and 256 generated status cases per seed. The
generator is local and deterministic; a failure prints the seed and case index,
which is the smallest replay key needed to reproduce and shrink the case.

The test target compares the public implementation against explicit transition
tables for every `AttemptPhase × AttemptOperation` and
`PersistedLifecycle × WorkOperation` pair. It also checks permutation
invariance, idempotence, exact deadline equality, close-only dependency
satisfaction, graph-cycle and project-scope rejection, terminal stability with
explicit reopen, proof/receipt subject fail-closed behavior, and total actor
action descriptor partitioning.

This is pure-domain evidence only. It does not claim store transactions,
authenticated service behavior, genuine verifier execution, TUI behavior,
installation, native targets, or release qualification. Those remain separate
acceptance layers.
