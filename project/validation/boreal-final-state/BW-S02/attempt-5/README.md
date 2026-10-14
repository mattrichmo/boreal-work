# BW-S02-T90 fixed-source package rerun — attempt 5

**Affected seam result: PASS on `32e46d19fac5f970388ff67c1234a2c19fa91ee8`.** The integrated package smoke now renders the production schema-v3 Global snapshot in its real framed TUI, so the exact Global schema failure from attempt 4 is resolved on this source.

## What changed and what passed

The source commit changes `validateSnapshot` to accept the supported schema versions 2 and 3, while continuing to reject unknown versions. The Global TUI test fixture now uses schema 3 and explicitly checks acceptance of both known versions and rejection of version 99.

- `LC_ALL=C LANG=C sh scripts/release/package-smoke.sh` — PASS, exit 0. It verified the release-style checksum fixture, package manifest and asset hashes, install, Project and Global flows, the real framed Global TUI, export/import, and reinstall preservation.
- `npm --prefix apps/global-tui run typecheck` — PASS on Node 26.8.2.
- `npm --prefix apps/global-tui test` — PASS, 99/99 on Node 26.8.2.
- A fresh `0.2.2` `aarch64-apple-darwin` archive built from the package-smoke release binary passed `package-target-smoke.sh` with Node unavailable. The check exercised installed Global JSON and verified failed-update rollback preserves the prior executable and Global database.

Commands and full outputs are recorded in [`COMMANDS.md`](COMMANDS.md) and [`logs/`](logs/). The compact package identity is in [`artifacts/native-release-identity.json`](artifacts/native-release-identity.json); the matching release manifest and `SHA256SUMS` are retained beside it. The generated archive and staging directory were removed after the native package-target smoke.

## Package identity

- Source revision: `32e46d19fac5f970388ff67c1234a2c19fa91ee8`.
- Embedded source ID: `sha256:23661ffca26ddeaeb83596fa1ad05e8f87091563012238d579422c8beabea9ad`.
- Version/target: `0.2.2`, `aarch64-apple-darwin`.
- Archive SHA256: `sha256:753fe0790601f0152a62ea87c0cfde77cc8531631abcf4f7c41687bc1fdbcfb3`.
- Artifact identity: `sha256:9870770241c143c7f8c1620ab81effdafcbf5ed5984f8f6b645a765547dc5a89`.
- Release manifest SHA256: `sha256:de342a486bd89d25f6f097be7e9fbe9e19d7c278c25754b35716c3a78297cfea`.
- Global TUI source ID: `sha256:e08e23c1f3184e19e239b3d0219c5237dafb9e5c8876b9aee0cc7163e7179f1b`.

## Limits and acceptance state

This is a focused rerun of the failed integrated Global/package seam, not a rerun of the complete S02 acceptance matrix. Only local macOS ARM64 was packaged and smoke-tested. Read-only workflow queries for this exact commit returned no CI or release runs. macOS x86-64 and Linux x86-64 therefore remain unqualified on this source; Linux ARM64 and Windows remain explicitly unsupported. No CI/release workflow was dispatched.

No production file changed in this attempt. No runtime plan state was changed and no T90 acceptance transition was recorded. The evidence shows the schema-v3 package failure is fixed; T90 remains operator-only and unaccepted until the coordinator completes the remaining acceptance decision.
