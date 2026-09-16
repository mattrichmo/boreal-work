# Boreal v2 test project

This is the official local sandbox for exercising the packaged Boreal v2
workflow from a nested agent or a human terminal. The global v1 `bwrk`
installation is intentionally left untouched.

## Prepare or refresh

From the v2 workspace root:

```bash
./scripts/prepare-test-project.sh
```

The script builds the locked offline Rust workspace and the TypeScript TUI,
installs the current v2 CLI into `.boreal/bin`, and installs the complete
compiled dashboard tree into `.boreal/lib/boreal/tui`. It creates the database
only when it does not exist and never resets an existing database. The user's
global v1 `bwrk` installation is not modified.

## Enter the sandbox

From this directory:

```bash
source .boreal/activate.sh
command -v bwrk
bwrk --version
```

The command must resolve to `.boreal/bin/bwrk` and report `bwrk 0.2.0 (api 2)`.

The database path is available as `$BOREAL_TEST_DB`. The service socket path
`$BOREAL_TEST_SOCKET` is only for the advanced shared-service/debug workflow
below; ordinary dashboard use does not need it.

## Open the dashboard

Normal dashboard use is one command in one terminal:

```bash
bwrk dashboard
```

The default resolves `.boreal/boreal.sqlite` from the current directory. This
database has one project, so the launcher can select `test-project` without an
extra flag. Equivalent explicit forms are:

```bash
bwrk dashboard --project test-project
bwrk dashboard test-project --db "$BOREAL_TEST_DB"
```

The launcher starts its private Rust service boundary, launches the packaged
TUI, and attempts to clean up that managed runtime when the dashboard exits.
Normal-exit cleanup is covered by the launcher smoke test. Do not start a
separate service against this database while using the dashboard: it owns a
private service and does not attach to an existing endpoint. The TUI remains
service-backed and never reads SQLite directly. `bwrk dashboard --json` is a
one-shot status read and does not start the TUI or a private service.

If the dashboard reports that its TUI is not bundled, rerun
`./scripts/prepare-test-project.sh` from the workspace root and verify that
`.boreal/lib/boreal/tui/entrypoint.js` exists and is non-empty.

`bwrk view --project test-project` is the current exact compatibility alias for
the dashboard. Use `--project` with this alias; `view test-project` is not a
supported spelling in the current parser.

## Advanced shared-agent/debug service

Run `service run` manually only when multiple clients need to share one
long-lived service or while debugging the service protocol:

```bash
bwrk service run \
  --db "$BOREAL_TEST_DB" \
  --socket "$BOREAL_TEST_SOCKET" \
  --json
```

Clients used in that advanced mode must connect to `$BOREAL_TEST_SOCKET` using
the versioned service protocol. This is not required by `bwrk dashboard`.

## Developer TUI seam

When changing the TypeScript TUI itself, it can be run directly against the
advanced service socket. This is intentionally a development/debug workflow
and uses two terminals:

```bash
# terminal 1
bwrk service run \
  --db "$BOREAL_TEST_DB" \
  --socket "$BOREAL_TEST_SOCKET" \
  --json

# terminal 2
npm --prefix ../apps/tui run start -- \
  --socket "$BOREAL_TEST_SOCKET" \
  --project test-project \
  --actor tui-developer \
  --harness tui \
  --session tui-developer-1 \
  --interactive
```

This direct TUI path does not discover or open the database, manage the Rust
service, or provide the cleanup guarantees of `bwrk dashboard`. Use the
one-command launcher for normal use.

## Basic checks

```bash
bwrk dashboard test-project --db "$BOREAL_TEST_DB" --json
bwrk view --project test-project --db "$BOREAL_TEST_DB" --json
bwrk status test-project --db "$BOREAL_TEST_DB" --json
bwrk work list test-project --db "$BOREAL_TEST_DB" --json
```

Use the explicit `.boreal/bin/bwrk-v2` path whenever command resolution is in
doubt.
