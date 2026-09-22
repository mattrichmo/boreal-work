# PF-S00-T02 environment baseline — attempt 3

Captured 2026-09-21 on `/Users/cybertron/Code/boreal-work`. This is current
executor evidence, not release acceptance. The full probe transcript is in
`project/validation/production/tasks/PF-S00-T02/attempt-3/COMMANDS.md`.

## Executor and source state

- Command cwd: `/Users/cybertron/Code/boreal-work`.
- `git rev-parse --show-toplevel`: exit 0, pass; repository root is the cwd.
- `git status --short --branch`: exit 0, pass; the tree is dirty with many
  pre-existing modified/untracked paths. `project/validation/` is also
  untracked because this attempt creates it. Those facts are not attributed
  to this worker beyond the exclusive files listed in the task assignment.
- Attempts 1 and 2 were read-only for this run and remain preserved.

## Direct tool probes

All entries below are direct commands with `LC_ALL=C LANG=C`; no failed wrapper
result is used as tool availability evidence.

| Tool | Command | Exit | Classification | Output |
|---|---|---:|---|---|
| Python | `python3 --version` | 0 | pass | `Python 3.14.3` |
| Node | `node --version` | 0 | pass | `v26.8.2` |
| npm | `npm --version` | 0 | pass | `11.7.0` |
| npx | `command -v npx` | 0 | pass | `/Users/cybertron/.npm-global/bin/npx` |
| TypeScript | `tsc --version` | 0 | pass | `Version 5.4.5` |
| Cargo | `cargo --version` | 0 | pass | `cargo 1.85.0` |
| rustc | `rustc --version` | 0 | pass | `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)` |
| rustfmt | `rustfmt --version` | 0 | pass | `rustfmt 1.8.0` |
| Git | `git --version` | 0 | pass | `git version 2.47.0` |
| zsh | `zsh --version` | 0 | pass | `zsh 5.9 (arm64-apple-darwin24.0)` |
| tar | `tar --version \\| sed -n '1p'` | 0 | pass | `bsdtar 3.5.3 - libarchive 3.5.3` |
| SQLite CLI | `sqlite3 --version` | 0 | pass | `3.43.2 ... (64-bit)` |

`npx --no-install tsc --version` was attempted directly, produced no output,
and was terminated after approximately 30 seconds by this worker. It is
classified `timeout`, not `missing`; direct `tsc` is independently recorded as
available.

## SQLite and socket facts

- `sqlite3 :memory: "pragma compile_options;"`: exit 0, pass. The CLI reports
  standard 64-bit SQLite compile options, including thread safety and extension
  support; see the raw transcript for the complete list.
- `python3 -c "import sqlite3; print(sqlite3.sqlite_version); ..."`: exit 0,
  pass; Python links SQLite `3.51.1` through
  `/opt/homebrew/Cellar/python@3.14/3.14.3_1/.../sqlite3/__init__.py`.
- The repository’s documented release-performance floor is `3.51.3`; the CLI
  (`3.43.2`) and Python runtime (`3.51.1`) are below that policy floor. This is
  an environment gap, not a product acceptance result.
- Binding and closing `/tmp/boreal-pf-s00-t02-3.sock` with Python’s
  `AF_UNIX` socket API: exit 0, pass; local Unix sockets are supported.

## Lockfiles, package policy, and bootstrap

The repository contains the root `Cargo.lock`, root `Cargo.toml`, TUI
`apps/tui/package.json`, nested protocol/service locks, and validation fixture
locks. No `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, or
`yarn.lock` was found by the bounded manifest scan. The TUI declares Node
`>=20 <27`. `docs/BUILD.md` and `scripts/prepare-test-project.sh` prescribe
offline Cargo and the existing offline TypeScript setup; no dependency install
was run.

The prescribed Rust/TUI build and test commands were intentionally skipped in
this attempt because they are potentially long and the assignment requested
quick bounded probes. Therefore this record does not establish compilation,
service behavior, test success, or release readiness.

## Wrapper correction record

The first transcript section records that `timeout` is not installed. A second
Perl wrapper attempt failed in locale initialization. Those are preserved as
wrapper failures only. The direct probes above supersede them for availability.
