# PF-S02-T11 — attempt 34 commands

Source-bound validation was run from `/Users/cybertron/Code/boreal-work`:

```text
cargo fmt --all
cargo fmt --all -- --check                         PASS
cargo test --locked --offline -p boreal-cli -- --nocapture  PASS
cargo test --locked --offline -p boreal-cli --test release_acceptance -- --nocapture PASS
git diff --check                                   PASS
```

The full CLI run reported 120 passed tests and 1 intentionally ignored test. The evidence-executor fixture printed `BOREAL_VALIDATION_SKIP: Unix socket creation is unavailable` but the test process remained successful.
