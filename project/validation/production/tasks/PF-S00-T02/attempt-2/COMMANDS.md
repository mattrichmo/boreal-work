# PF-S00-T02 — Attempt 2 Command Log

This is an incremental log. Commands are run from `/Users/cybertron/Code/boreal-work` unless noted. Timestamps are UTC and come from the command wrapper where shown. No command in the initial inventory phase blocked; all completed in under one second.

## Initial workflow/context probes

| UTC | Exact argv | Exit/status | Result |
| --- | --- | --- | --- |
| 2026-09-21T21:53:17Z (outer timestamp) | `bwrk prime --json` | 0 / protocol response `outcome=rejected` | Missing explicit project identifier; no state change. |
| 2026-09-21T21:53:17Z (outer timestamp) | `bwrk workflows show boreal.workflow.claim-and-finish-work.v1 --json` | 0 / protocol response `outcome=busy` | Direct offline mode could not acquire `.boreal/boreal.sqlite`; owner process `68913` reported. No state change. |
| 2026-09-21T21:53:17Z (outer timestamp) | `bwrk workflows show boreal.workflow.closeout-work.v1 --json` | 0 / protocol response `outcome=busy` | Same existing database-owner blocker. No state change. |

## Toolchain and host inventory

| UTC start–end | Exact argv | Exit/status | Result |
| --- | --- | --- | --- |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v rustc` | 0 / pass | `/opt/homebrew/bin/rustc` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `rustc --version --verbose` | 0 / pass | `1.85.0`, host `aarch64-apple-darwin`, LLVM `19.1.7` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v cargo` | 0 / pass | `/opt/homebrew/bin/cargo` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `cargo --version --verbose` | 0 / pass | `cargo 1.85.0`, host `aarch64-apple-darwin` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v rustfmt` | 0 / pass | `/opt/homebrew/bin/rustfmt` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `rustfmt --version` | 0 / pass | `rustfmt 1.8.0` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v node` | 0 / pass | `/opt/homebrew/bin/node` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `node --version` | 0 / pass | `v26.8.2` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v npm` | 0 / pass | `/Users/cybertron/.npm-global/bin/npm` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `npm --version` | 0 / pass | `11.7.0` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v tsc` | 0 / pass | `/Users/cybertron/.npm-global/bin/tsc` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `tsc --version` | 0 / pass | `Version 5.4.5` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v python3` | 0 / pass | `/opt/homebrew/bin/python3` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `python3 --version` | 0 / pass | `Python 3.14.3` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v git` | 0 / pass | `/opt/homebrew/bin/git` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `git --version` | 0 / pass | `git version 2.47.0` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v zsh` / `zsh --version` | 0 / pass | `/bin/zsh`; `zsh 5.9 (arm64-apple-darwin24.0)` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v sh` / `sh --version` | 0 / pass | `/bin/sh`; Apple bash `3.2.57` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v tar` / `tar --version` | 0 / pass | `/usr/bin/tar`; bsdtar/libarchive `3.5.3`, emitted `Failed to set default locale` warning |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `command -v sqlite3` / `sqlite3 --version` | 0 / pass | `/usr/bin/sqlite3`; `3.43.2` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `python3 -c 'import sqlite3; ...'` | 1 / probe failure | Python reports SQLite `3.53.4`, then raises `AttributeError` because Python 3.14 removed `sqlite3.version`; version identity itself was printed before the failure. |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `node -p 'JSON.stringify(process.versions)'` | 0 / pass | Node includes SQLite `3.53.4`. |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `uname -a` / `arch` / `sw_vers` | 0 / pass | macOS `15.2` (`24C101`), Darwin `24.2.0`, arm64. |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `git rev-parse --show-toplevel` | 0 / pass | `/Users/cybertron/Code/boreal-work` |
| 2026-09-21T21:55:01.3Z–2026-09-21T21:55:01.3Z | `git status --short` | 0 / pass | Dirty working tree; full initial status is retained in the evidence notes. |

## Runtime, cache, lock and script probes

| UTC start–end | Exact argv | Exit/status | Result |
| --- | --- | --- | --- |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `sqlite3 :memory: 'select sqlite_version(); pragma compile_options;'` | 0 / pass | System CLI runtime `3.43.2`; compile options captured in `EVIDENCE.md`. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `otool -L /usr/bin/sqlite3` | 0 / pass | CLI does not directly list `libsqlite3`; linkage is through system/framework behavior. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `/opt/homebrew/opt/sqlite/bin/sqlite3 --version` | 0 / pass | Homebrew SQLite `3.53.4`. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `otool -L /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` | 0 / pass | Homebrew dylib present at `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `python3 -c 'import _sqlite3; print(_sqlite3.__file__)'` | 0 / pass | `_sqlite3` extension under Homebrew Python 3.14. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `node -p 'process.versions.sqlite'` | 0 / pass | Node-linked SQLite `3.53.4`. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `python3 -c 'socket.socketpair(socket.AF_UNIX, ...)'` | 0 / pass | `AF_UNIX` local socket pair available. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `cargo metadata --format-version 1 --no-deps --locked --offline` | 0 / pass | Workspace metadata resolves offline; target directory is `target`; no SQLite Cargo dependency. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `cargo tree --locked --offline` | 0 / pass | Locked dependency graph resolves offline; registry dependencies are cached. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `env CARGO_HOME` | 127 / missing variable | `CARGO_HOME` unset; Cargo default cache location is used. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `sh -c 'test -d "${CARGO_HOME:-$HOME/.cargo}/registry/cache" && find ... | wc -l || echo 0'` | 0 / pass | 11 cached registry files observed under the default Cargo cache. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `sh -c 'test -d apps/tui/node_modules; echo ...'` | 0 / probe result | `node_modules` absent. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `sh -c 'test -d apps/tui/dist; echo ...'` | 0 / probe result | `dist` present. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `npm --prefix apps/tui ls --depth=0` | 0 / pass | TUI package has no local npm dependencies. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `bwrk version --json` | 0 / pass | Installed `bwrk 0.2.0` reports linked SQLite `3.43.2`; release floor `3.51.3`; floor not enforced. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `python3 scripts/validation/run_full_suite.py --help` | 0 / pass | Full-suite options and strict/no-skip/current-binary/floor controls available. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `python3 scripts/validation/release_performance.py --help` | 0 / pass | Release runner supports offline default, `--online`, benchmark skip and SQLite-floor enforcement. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `python3 scripts/release/build_release.py --help` | 0 / pass | Release builder supports target/output and `--skip-build`; no build invoked yet. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `bash -n scripts/standalone-check.sh` | 0 / pass | Standalone script parses. |
| 2026-09-21T21:56:09.3Z–2026-09-21T21:56:09.3Z | `sh -n install.sh` | 0 / pass | Installer script parses. |

## Pending bounded checks

The next phase will run only selected baseline checks, each under the 30-second command bound: contract validation, Rust formatting, focused/offline Rust tests or a bounded compile probe, TUI typecheck/tests as available, installer identity, and any relevant SQLite/runtime probe. A command still running at 30 seconds will be interrupted and recorded with status `timeout`; the remaining independent checks will continue.

## Short baseline checks

| UTC start–end | Exact argv | Exit/status | Result |
| --- | --- | --- | --- |
| 2026-09-21T21:57:39.3Z–2026-09-21T21:57:39.3Z | `git diff --check` | 0 / pass | No whitespace errors reported. |
| 2026-09-21T21:57:39.3Z–2026-09-21T21:57:39.3Z | `python3 project/spec/validate_contracts.py` | 0 / pass | 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings and SQLite schema parsed. |
| 2026-09-21T21:57:39.3Z–2026-09-21T21:57:39.3Z | `cargo fmt --all -- --check` | 0 / pass | Rust formatting clean. |
| 2026-09-21T21:57:39.3Z–2026-09-21T21:57:39.3Z | `npm --prefix apps/tui run typecheck` | 0 / pass | TypeScript `tsc --noEmit` completed. |
| 2026-09-21T21:57:39.3Z–2026-09-21T21:57:39.3Z | `node scripts/build-installer.mjs --check` | 0 / pass | Installer bundles match source. |
| 2026-09-21T21:57:39.3Z–2026-09-21T21:57:39.3Z | `sh -n install.sh` | 0 / pass | Installer shell syntax valid. |
