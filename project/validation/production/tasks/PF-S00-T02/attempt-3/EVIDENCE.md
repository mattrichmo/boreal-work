# PF-S00-T02 attempt 3 evidence

- command: `touch .../attempt-3/START.md`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:58:49-06:00
- exit status: 0
- classification: pass
- relevant output: Attempt 3 initialized; attempts 1 and 2 were not edited.

- command: `python3 --version`, `node --version`, `npm --version`, `tsc --version`, `cargo --version`, `rustc --version`, `rustfmt --version`, `git --version`, `zsh --version`, `tar --version`, `sqlite3 --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T15:59:57–16:00:18-06:00
- exit status: 0 for each direct probe
- classification: pass
- relevant output: Current versions are recorded in `baseline/environment.md` and `baseline/toolchain-lock.json`.

- command: `npx --no-install tsc --version`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:46-06:00
- exit status: operator termination after approximately 30 seconds
- classification: timeout
- relevant output: No output. This does not override direct `tsc --version` pass evidence.

- command: `sqlite3 :memory: "pragma compile_options;"`; `python3 -c "import sqlite3; ..."`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit status: 0 for each
- classification: pass
- relevant output: CLI SQLite 3.43.2; Python SQLite 3.51.1; repository release floor observed in scripts is 3.51.3.

- command: disposable Python `AF_UNIX` bind at `/tmp/boreal-pf-s00-t02-3.sock`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit status: 0
- classification: pass
- relevant output: Local Unix socket bind succeeded and the path was removed.

- command: `cargo test --locked --workspace`; `npm --prefix apps/tui test`; `node scripts/build-installer.mjs --check`
- cwd: `/Users/cybertron/Code/boreal-work`
- timestamp: 2026-09-21T16:01:47-06:00
- exit status: not run
- classification: skipped
- relevant output: Deliberately not attempted because these may exceed the worker’s quick-probe bound.

## Interpretation

Tool availability is established by direct probes. The earlier missing `timeout`
and Perl locale failures are preserved in `COMMANDS.md` as wrapper failures,
not tool failures. The environment baseline identifies a SQLite policy gap and
does not claim compilation, service, acceptance, or release readiness.
