# Contract mutation matrix

`run_matrix.py` performs deterministic mutation probes against temporary copies
of the specification and workflow fixtures. Every mutation must be rejected by
the validator that owns that boundary; a surviving mutation fails the command.

This complements, rather than replaces, Rust/TypeScript compiler-level
mutation testing. It is intentionally dependency-free and safe to run in CI.
