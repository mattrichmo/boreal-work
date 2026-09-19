# C4-B production-client status evidence

Run the V11 boundary probe with:

```sh
python3 production_client.py --bin ../../../../target/debug/bwrk
```

The fixture is seeded before service election. The target reads use separate
`bwrk status` clients over the elected Unix-socket service and reach the 101st
and 1001st ordered work items with `limit=1`/offset evidence. The service is
launched with `BOREAL_QUERY_METRICS=1`, so each target response includes
store-boundary prepared-statement, row, and text-byte counters. This avoids
dynamic-library interposition and measures the actual elected service without
altering its SQLite dependency.

The gate also requires each status request to stay within the declared
service-boundary query-count budget: at most 16 prepared statements and 4
batch calls. Row and text-byte counters remain reported because the current
canonical status projection reads the full work graph; they are not presented
as bounded database work.

The public service registry exposes `work show`; the harness verifies that the
route returns the target item through the elected service and never falls
back to direct database access. The generated result is written to
`results/production-client.latest.json`.
