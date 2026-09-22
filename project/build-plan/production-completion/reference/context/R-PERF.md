# R-PERF — docs/RELEASE_PERFORMANCE.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/RELEASE_PERFORMANCE.md:L1–L148`  
**File SHA-256:** `88d367becc9b75f4a73e28c908b847c5c69ed3a5a2131ebe6503a1f64a3f4f8e`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing backup/runtime/benchmark scaffolding and explicit native failure/scale gaps. Runtime floor is a repository policy to reverify at release.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,148p' 'docs/RELEASE_PERFORMANCE.md'
```

## Exact baseline excerpt

````text
    1 | # Release, doctor, and performance acceptance
    2 | 
    3 | This document defines the reproducible release/performance evidence for the
    4 | current v2 snapshot. It is deliberately explicit about what the checks prove
    5 | and what they do not prove. A green focused test is not a substitute for the
    6 | full native, crash, multi-process, and supported-platform release gates.
    7 | 
    8 | ## One command
    9 | 
   10 | From the repository root:
   11 | 
   12 | ```sh
   13 | python3 scripts/validation/release_performance.py \
   14 |   --output /tmp/boreal-release-performance.json
   15 | ```
   16 | 
   17 | The runner executes, in order:
   18 | 
   19 | 1. The focused store runtime/schema acceptance test.
   20 | 2. Schema-v3 migration/reopen tests, including rollback on a broken migration.
   21 | 3. Online backup/restore tests using SQLite's backup API.
   22 | 4. The public CLI doctor and bounded-status acceptance test.
   23 | 5. The ignored native status benchmark at 10,000 and 100,000 work items.
   24 | 
   25 | Use `--release` for release-mode native measurements. Use
   26 | `--skip-benchmark` for a quick doctor/schema/backup gate. The benchmark sizes
   27 | can be changed for a controlled experiment:
   28 | 
   29 | ```sh
   30 | python3 scripts/validation/release_performance.py \
   31 |   --release --sizes 10000,100000,250000 \
   32 |   --output /tmp/boreal-release-performance-release.json
   33 | ```
   34 | 
   35 | The output JSON is an evidence artifact and should be kept outside the
   36 | checkout unless intentionally captured as a release record.
   37 | 
   38 | Fresh CI runners can opt into normal Cargo dependency resolution with
   39 | `--online`; local runs remain offline by default for reproducibility:
   40 | 
   41 | ```sh
   42 | python3 scripts/validation/release_performance.py --online \
   43 |   --output /tmp/boreal-release-performance-online.json
   44 | ```
   45 | 
   46 | Release CI can make the floor fail closed:
   47 | 
   48 | ```sh
   49 | python3 scripts/validation/release_performance.py \
   50 |   --require-sqlite-floor --skip-benchmark \
   51 |   --output /tmp/boreal-release-floor.json
   52 | ```
   53 | 
   54 | This writes the evidence before returning a nonzero status when the linked
   55 | runtime is below the floor. Local diagnostic runs may omit the switch to
   56 | record an unsupported environment without confusing it with a failed test.
   57 | 
   58 | ## SQLite runtime floor
   59 | 
   60 | The release policy currently requires SQLite **3.51.3 or newer** for a release
   61 | claim. The native store reports the linked library version, source ID, and
   62 | compile options. The acceptance probe records whether the linked runtime meets
   63 | the floor; it does not rewrite, vendor, or pretend to upgrade a system
   64 | library.
   65 | 
   66 | The supported release gate is therefore:
   67 | 
   68 | ```text
   69 | runtime identity present
   70 |   + version >= 3.51.3
   71 |   + required compile/runtime features verified
   72 |   = release may claim supported SQLite runtime
   73 | ```
   74 | 
   75 | If the probe reports `meets_floor: false`, the result is useful diagnostic
   76 | evidence but the build must be marked unsupported for the release target. The
   77 | current development environment may legitimately fail this policy while the
   78 | tests still pass; that is an environment limitation, not evidence that the
   79 | floor is satisfied.
   80 | 
   81 | `bwrk version --json` and `bwrk doctor --json` expose the linked identity.
   82 | Future packaging work must enforce the same policy in the release builder and
   83 | supported-platform CI rather than relying on a human to inspect the field.
   84 | 
   85 | ## Schema-v3 and backup gate
   86 | 
   87 | The v3 model is an additive extension over schema-v2. The focused acceptance
   88 | tests prove:
   89 | 
   90 | - v2 opens and applies the v3 extension;
   91 | - the v3 database reopens with the v2 opener and retains schema-v2 rows;
   92 | - a failed v3 migration leaves no partial v3 contract or false version label;
   93 | - v3 contract verification runs on reopen;
   94 | - online backup and restore retain live rows and v3 tables;
   95 | - an existing backup is not silently overwritten.
   96 | 
   97 | This is not a power-failure proof. It does not test every filesystem, SQLite
   98 | build, interruption point, or cross-process backup race. Those remain native
   99 | fault-injection and supported-platform release work.
  100 | 
  101 | ## Doctor and bounded status
  102 | 
  103 | The CLI acceptance test initializes a fresh project, runs the public read-only
  104 | doctor, creates a small project through the public CLI, and verifies that a
  105 | status request with `--limit 7 --offset 3` returns no more than seven items.
  106 | It also checks that doctor reports database-open success, linked SQLite
  107 | identity, and that no repair is silently claimed.
  108 | 
  109 | This proves response-page bounding at the public adapter. It does **not** prove
  110 | that the database work, allocations, or graph computation are bounded by page
  111 | size. The release benchmark intentionally reports statements, rows, decoded
  112 | text bytes, and elapsed time so the remaining full-project scan is visible.
  113 | The performance gate stays open until set-based/page-bounded reads are
  114 | measured on the native implementation.
  115 | 
  116 | ## 10k/100k benchmark interpretation
  117 | 
  118 | The ignored Rust benchmark creates one in-memory SQLite project and measures
  119 | the canonical status read at the requested sizes. It records:
  120 | 
  121 | - linked SQLite runtime identity;
  122 | - elapsed milliseconds;
  123 | - prepared statements and batch calls;
  124 | - rows and decoded text bytes observed by the adapter;
  125 | - returned work and dependency counts.
  126 | 
  127 | It is a scaling baseline, not a target assertion or speedup claim. It uses one
  128 | process and one in-memory connection, excludes the TUI/service/protocol
  129 | serialization path, and has no concurrent writers. Compare runs only when
  130 | the machine, Rust profile, SQLite identity, source snapshot, and benchmark
  131 | sizes are recorded together.
  132 | 
  133 | ## Release evidence still required
  134 | 
  135 | The following are intentionally not claimed by this scaffolding:
  136 | 
  137 | - crash/power-failure recovery at every operation boundary;
  138 | - multi-process election and backup races;
  139 | - descendant cleanup on every supported OS;
  140 | - 10k/100k service/TUI concurrent workload;
  141 | - signed artifacts, clean install/upgrade/rollback on every target;
  142 | - an enforced SQLite floor in every packaging pipeline;
  143 | - live migration materialization of source/memory data.
  144 | 
  145 | Those require native binaries and supported-platform CI. Record each as
  146 | `pass`, `unsupported`, or `unmeasured` with the exact environment; do not turn
  147 | an unavailable toolchain or restricted socket/filesystem into a green release
  148 | claim.
````
