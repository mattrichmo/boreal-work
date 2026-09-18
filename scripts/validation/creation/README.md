# Boreal creation and lifecycle suite

This is the black-box suite for the local `test-project` package. It creates
an isolated database under `test-project/.boreal/creation-suite-*`; it does
not reset or mutate `test-project/.boreal/boreal.sqlite`.

The suite covers:

- project initialization and command-registry discovery;
- milestone → sprint → task creation and hierarchy validation;
- operation replay, duplicate IDs, invalid parents, and JSON envelopes;
- planning edits, revision conflicts, and hard holds;
- configurable long dependency chains, queued/ready derivation, and cycle rejection;
- claim, accept, heartbeat, renewable lease, proof-gated finish rejection, release,
  reclaim, and stale-fence protection;
- source capture, checkpoint/verification/summary evidence, closeout, and evidence replay;
- service-routed status/claim reads, bounded request shutdown, and socket cleanup;
- structured command logs, per-scenario timings, route gaps, and JSON/Markdown reports.

The complete cross-layer coverage matrix is maintained in
[`scenario_matrix.json`](scenario_matrix.json). It distinguishes black-box
checks from native Rust/TUI/fault/concurrency/security checks and records
environment or public-route gaps explicitly.

Run the current checkout binary:

```sh
python3 scripts/validation/creation/run_suite.py \
  --bin target/debug/bwrk \
  --chain-length 100
```

Run the packaged test-project binary after refreshing it:

```sh
./scripts/prepare-test-project.sh
python3 scripts/validation/creation/run_suite.py \
  --bin test-project/.boreal/bin/bwrk-v2 \
  --chain-length 100
```

Reports are written to `scripts/validation/creation/results/` and the full
command log remains in the isolated run root. Route gaps advertised by
`bwrk commands --json` are retained in the report as explicit implementation
gaps; they are never counted as passing behavior.

Run the cross-layer smoke or full profile from the workspace root:

```sh
python3 scripts/validation/run_full_suite.py --profile smoke
python3 scripts/validation/run_full_suite.py --profile full
```

For CI or release gating, use strict mode. It builds/tests the current
`target/debug/bwrk`, runs the benchmark and SQLite floor check, and treats
contract mutation probes, a bounded process soak, and treats environment skips
as failures. `--online` is required on fresh runners that
do not already have every Cargo dependency cached:

```sh
python3 scripts/validation/run_full_suite.py \
  --profile full --strict --online
```

The aggregate runner writes JSON and Markdown reports plus per-check stdout and
stderr logs. A nonzero exit means at least one check failed. In the default
local profiles, environment-only socket or offline-lockfile limitations are
reported as skips; strict mode rejects all skips.
