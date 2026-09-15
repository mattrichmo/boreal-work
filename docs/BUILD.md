# Standalone build check

The v2 package is intended to move out of the legacy checkout without reading
legacy code, caches, or `.boreal` state. From the v2 package root, run:

```sh
scripts/standalone-check.sh
```

The script creates a fresh checkout under `mktemp`, copies the package while
excluding only `target`, `node_modules`, and macOS metadata, then runs:

```text
python3 project/spec/validate_contracts.py
cargo fmt --all -- --check
cargo test --workspace --locked --offline
cargo clippy --workspace --all-targets --locked --offline -- -D warnings
npm run typecheck --prefix apps/tui
npm test --prefix apps/tui
```

No dependencies are installed and no legacy workspace state is consulted.
Cargo is explicitly offline; TUI checks use the package's existing TypeScript
toolchain. The temporary directory is removed on exit, including failures.
The script runs every check even if an earlier check fails and exits non-zero
with a summary of failed checks.

The application embeds and validates the checked-in core workflow package at
compile time; `boreal.application.v2` remains the state authority. Strict
clippy is part of the standalone gate and must pass on the copied snapshot.

This proves the copied source package is self-contained for the listed static,
contract, Rust, and TUI checks. It does not prove the still-gated P2 service
client, multi-process restart, migration rollback, load/fault/security, or
P5-08 cutover requirements.
