# PF-S00-T03 attempt 1 command record

## Execution identity

- Task: `PF-S00-T03`; attempt: `1`.
- Workspace/cwd for every command: `/Users/cybertron/Code/boreal-work`.
- Source subject: HEAD `784a41b3802c29a76721c55eef2e9493283396c2`, branch `codex/apply-responsive-terminal-overlay`, dirty; pre-task snapshot aggregate `7051bb14d9bdb283235b65e45e78bea9b485318998847173e79dbfc409ed7ea8`.
- Run window: `2026-09-21T22:10:49.803217Z` through `2026-09-21T22:14:42.575722Z`.
- Process policy: sequential process groups; 600-second ceiling per command; timeout action would be SIGTERM then SIGKILL after 10 seconds. No command timed out.
- Cargo network mode: default resolution; `--offline` was not supplied because the repository documents offline only as an explicit mode and does not authorize replacing the requested default run.
- The authoritative per-command record, timestamps, exit codes, stdout/stderr paths, and stdout/stderr SHA-256 values are in [`../../../baseline/checks.json`](../../../baseline/checks.json).

## Commands and observed result

| Label | Exact argv | Evidence class | Result | Raw logs |
| --- | --- | --- | --- | --- |
| `toolchain-identity` | `python3 -c <identity probe>` | environment/static | pass, 0 | `baseline/logs/toolchain-identity.{stdout,stderr}.log` |
| `git-diff-check` | `git diff --check` | static | pass, 0 | `baseline/logs/git-diff-check.{stdout,stderr}.log` |
| `cargo-fmt` | `cargo fmt --all -- --check` | static | pass, 0 | `baseline/logs/cargo-fmt.{stdout,stderr}.log` |
| `cargo-test-workspace` | `cargo test --workspace --locked` | workspace/unit-store-service integration | fail, 101 | `baseline/logs/cargo-test-workspace.{stdout,stderr}.log` |
| `cargo-build-cli-bwrk` | `cargo build --locked -p boreal-cli --bin bwrk` | CLI/service build artifact | pass, 0 | `baseline/logs/cargo-build-cli-bwrk.{stdout,stderr}.log` |
| `cargo-clippy-workspace` | `cargo clippy --locked --workspace --all-targets -- -D warnings` | workspace lint | fail, 101 | `baseline/logs/cargo-clippy-workspace.{stdout,stderr}.log` |
| `validate-contracts` | `python3 project/spec/validate_contracts.py` | contract/schema fixture | pass, 0 | `baseline/logs/validate-contracts.{stdout,stderr}.log` |
| `tui-typecheck` | `npm --prefix apps/tui run typecheck` | package/type | pass, 0 | `baseline/logs/tui-typecheck.{stdout,stderr}.log` |
| `tui-test` | `npm --prefix apps/tui test` | TUI fixture/presentation | fail, 1 | `baseline/logs/tui-test.{stdout,stderr}.log` |
| `installer-check` | `node scripts/build-installer.mjs --check` | package/installer identity | pass, 0 | `baseline/logs/installer-check.{stdout,stderr}.log` |
| `shell-syntax` | `sh -n install.sh` | static/package | pass, 0 | `baseline/logs/shell-syntax.{stdout,stderr}.log` |
| `zip-js-syntax` | `node --check create-zips.mjs` | static/package | pass, 0 | `baseline/logs/zip-js-syntax.{stdout,stderr}.log` |
| `wizard-js-syntax` | `node --check apps/tui/installer/wizard.cjs` | static/package | pass, 0 | `baseline/logs/wizard-js-syntax.{stdout,stderr}.log` |
| `wizard-body-js-syntax` | `node --check apps/tui/installer/wizard-body.cjs` | static/package | pass, 0 | `baseline/logs/wizard-body-js-syntax.{stdout,stderr}.log` |
| `source-archive-exercise` | `python3 scripts/validation/m02/source_archive_test.py --exercise` | package/TUI fixture | fail, 1 | `baseline/logs/source-archive-exercise.{stdout,stderr}.log` |
| `plan-validate` | `python3 project/build-plan/production-completion/tools/plan.py validate` | plan fixture/static | pass, 0 | `baseline/logs/plan-validate.{stdout,stderr}.log` |
| `plan-verify-package` | `python3 project/build-plan/production-completion/tools/plan.py verify-package` | plan package identity | fail, 1 | `baseline/logs/plan-verify-package.{stdout,stderr}.log` |
| `rust-domain-m02` | `cargo test --locked -p boreal-domain --test m02_status` | domain unit/property | pass, 0 | `baseline/logs/rust-domain-m02.{stdout,stderr}.log` |
| `rust-store-m02` | `cargo test --locked -p boreal-store --test m02_claim` | store transaction/concurrency | pass, 0 | `baseline/logs/rust-store-m02.{stdout,stderr}.log` |
| `rust-application-m02` | `cargo test --locked -p boreal-application --test m02_status_authority` | application/service-boundary test | pass, 0 | `baseline/logs/rust-application-m02.{stdout,stderr}.log` |
| `rust-protocol-m02` | `cargo test --locked -p boreal-protocol --test m02_status_wire` | protocol unit/DTO | pass, 0 | `baseline/logs/rust-protocol-m02.{stdout,stderr}.log` |
| `premium-validation` | `python3 scripts/validation/premium/validate_premium.py -v` | PTY/fake release-controller fixture | fail, 1 | `baseline/logs/premium-validation.{stdout,stderr}.log` |
| `responsive-validation` | `python3 scripts/validation/premium/validate_responsive.py -v` | PTY/fake service fixture | fail, 1 | `baseline/logs/responsive-validation.{stdout,stderr}.log` |

## Final counts

- `pass`: 16
- `fail`: 7
- `blocked_tool_unavailable`: 0
- `timeout`: 0
- `not_run`: 0
- Overall command result: fail (`all_commands_passed: false`).

No command result was promoted from the historical `project/validation/m02` evidence. No product or release acceptance claim is made.
