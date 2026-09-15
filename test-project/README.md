# Boreal v2 test project

This is the official local sandbox for exercising the packaged Boreal v2
workflow from a nested agent or a human terminal. The global v1 `bwrk`
installation is intentionally left untouched.

## Prepare or refresh

From the v2 workspace root:

```bash
./scripts/prepare-test-project.sh
```

The script builds the locked offline Rust workspace, installs the current v2
CLI into `.boreal/bin`, creates the database only when it does not exist, and
checks the local status projection. It never resets an existing database.

## Enter the sandbox

From this directory:

```bash
source .boreal/activate.sh
command -v bwrk
bwrk --version
```

The command must resolve to `.boreal/bin/bwrk` and report `bwrk 2`.

The database path is available as `$BOREAL_TEST_DB`; the service socket path
is available as `$BOREAL_TEST_SOCKET`.

## Start the service and TUI

Terminal one:

```bash
bwrk service run \
  --db "$BOREAL_TEST_DB" \
  --socket "$BOREAL_TEST_SOCKET" \
  --json
```

Terminal two, from `apps/tui`:

```bash
npm run start -- \
  --socket "$BOREAL_TEST_SOCKET" \
  --project test-project \
  --interactive
```

The current TUI is a plain-text interactive shell. It is service-backed and
does not read SQLite directly.

## Basic checks

```bash
bwrk dashboard test-project --db "$BOREAL_TEST_DB" --json
bwrk status test-project --db "$BOREAL_TEST_DB" --json
bwrk work list test-project --db "$BOREAL_TEST_DB" --json
```

Use the explicit `.boreal/bin/bwrk-v2` path whenever command resolution is in
doubt.
