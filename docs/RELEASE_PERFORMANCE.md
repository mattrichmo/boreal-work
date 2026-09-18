# Release, doctor, and performance acceptance

This document defines the reproducible release/performance evidence for the
current v2 snapshot. It is deliberately explicit about what the checks prove
and what they do not prove. A green focused test is not a substitute for the
full native, crash, multi-process, and supported-platform release gates.

## One command

From the repository root:

```sh
python3 scripts/validation/release_performance.py \
  --output /tmp/boreal-release-performance.json
```

The runner executes, in order:

1. The focused store runtime/schema acceptance test.
2. Schema-v3 migration/reopen tests, including rollback on a broken migration.
3. Online backup/restore tests using SQLite's backup API.
4. The public CLI doctor and bounded-status acceptance test.
5. The ignored native status benchmark at 10,000 and 100,000 work items.

Use `--release` for release-mode native measurements. Use
`--skip-benchmark` for a quick doctor/schema/backup gate. The benchmark sizes
can be changed for a controlled experiment:

```sh
python3 scripts/validation/release_performance.py \
  --release --sizes 10000,100000,250000 \
  --output /tmp/boreal-release-performance-release.json
```

The output JSON is an evidence artifact and should be kept outside the
checkout unless intentionally captured as a release record.

Fresh CI runners can opt into normal Cargo dependency resolution with
`--online`; local runs remain offline by default for reproducibility:

```sh
python3 scripts/validation/release_performance.py --online \
  --output /tmp/boreal-release-performance-online.json
```

Release CI can make the floor fail closed:

```sh
python3 scripts/validation/release_performance.py \
  --require-sqlite-floor --skip-benchmark \
  --output /tmp/boreal-release-floor.json
```

This writes the evidence before returning a nonzero status when the linked
runtime is below the floor. Local diagnostic runs may omit the switch to
record an unsupported environment without confusing it with a failed test.

## SQLite runtime floor

The release policy currently requires SQLite **3.51.3 or newer** for a release
claim. The native store reports the linked library version, source ID, and
compile options. The acceptance probe records whether the linked runtime meets
the floor; it does not rewrite, vendor, or pretend to upgrade a system
library.

The supported release gate is therefore:

```text
runtime identity present
  + version >= 3.51.3
  + required compile/runtime features verified
  = release may claim supported SQLite runtime
```

If the probe reports `meets_floor: false`, the result is useful diagnostic
evidence but the build must be marked unsupported for the release target. The
current development environment may legitimately fail this policy while the
tests still pass; that is an environment limitation, not evidence that the
floor is satisfied.

`bwrk version --json` and `bwrk doctor --json` expose the linked identity.
Future packaging work must enforce the same policy in the release builder and
supported-platform CI rather than relying on a human to inspect the field.

## Schema-v3 and backup gate

The v3 model is an additive extension over schema-v2. The focused acceptance
tests prove:

- v2 opens and applies the v3 extension;
- the v3 database reopens with the v2 opener and retains schema-v2 rows;
- a failed v3 migration leaves no partial v3 contract or false version label;
- v3 contract verification runs on reopen;
- online backup and restore retain live rows and v3 tables;
- an existing backup is not silently overwritten.

This is not a power-failure proof. It does not test every filesystem, SQLite
build, interruption point, or cross-process backup race. Those remain native
fault-injection and supported-platform release work.

## Doctor and bounded status

The CLI acceptance test initializes a fresh project, runs the public read-only
doctor, creates a small project through the public CLI, and verifies that a
status request with `--limit 7 --offset 3` returns no more than seven items.
It also checks that doctor reports database-open success, linked SQLite
identity, and that no repair is silently claimed.

This proves response-page bounding at the public adapter. It does **not** prove
that the database work, allocations, or graph computation are bounded by page
size. The release benchmark intentionally reports statements, rows, decoded
text bytes, and elapsed time so the remaining full-project scan is visible.
The performance gate stays open until set-based/page-bounded reads are
measured on the native implementation.

## 10k/100k benchmark interpretation

The ignored Rust benchmark creates one in-memory SQLite project and measures
the canonical status read at the requested sizes. It records:

- linked SQLite runtime identity;
- elapsed milliseconds;
- prepared statements and batch calls;
- rows and decoded text bytes observed by the adapter;
- returned work and dependency counts.

It is a scaling baseline, not a target assertion or speedup claim. It uses one
process and one in-memory connection, excludes the TUI/service/protocol
serialization path, and has no concurrent writers. Compare runs only when
the machine, Rust profile, SQLite identity, source snapshot, and benchmark
sizes are recorded together.

## Release evidence still required

The following are intentionally not claimed by this scaffolding:

- crash/power-failure recovery at every operation boundary;
- multi-process election and backup races;
- descendant cleanup on every supported OS;
- 10k/100k service/TUI concurrent workload;
- signed artifacts, clean install/upgrade/rollback on every target;
- an enforced SQLite floor in every packaging pipeline;
- live migration materialization of source/memory data.

Those require native binaries and supported-platform CI. Record each as
`pass`, `unsupported`, or `unmeasured` with the exact environment; do not turn
an unavailable toolchain or restricted socket/filesystem into a green release
claim.
