# BW-S08-T05 qualification evidence

Run date: 2026-10-14

Scope: disposable project fixture on the current macOS host; this does not
close BW-S08-T90.

## Source and binaries

The product candidate was built from clean source commit
`fa303eafa1517ac07ce588620d4e3a2a813cf303`. `bwrk version --json` reported
build source ID `sha256:ad766ca8f9a94181624ab8d4a2151943774ba92ddd2a764a244e0c127e6e6ffe`,
package version `0.2.2`, and linked SQLite `3.51.3`. Candidate binary:
`/private/tmp/boreal-s08-t05-candidate-target/debug/bwrk`; SHA-256:
`1ab70649cbaf23a6322b35ae19c8733166c0ffe1aaca289d05815fcdec2c54c8`.
The script used an identical copy at
`/var/folders/hm/p8b2n4p900q3vn5qtvdtg0hw0000gn/T/boreal-s08-t05-gf9dumds/candidate-bwrk`
for restores after predecessor qualification.

The predecessor was built from source commit
`f735a903fdc1470f29e98201aedbbb8b3c7d34df`, immediately before the
`intake_delivery` feature. `bwrk version --json` reported build source ID
`sha256:8dd8620c99adcd6683d743c9001df77d665e07ddc0580f009463101280a97654`,
package version `0.2.1`, and linked SQLite `3.51.3`. Predecessor binary SHA-256:
`b8c2b1fc073d887234888a79a39d269df4753ed9d6e480b69be0c07b4b73b58c` at
`/var/folders/hm/p8b2n4p900q3vn5qtvdtg0hw0000gn/T/boreal-s08-t05-gf9dumds/predecessor-target/debug/bwrk`.

The exact validated harness file has SHA-256
`fe048c0f81ec0ce11f3afdc9aac2ab834c0f8e176cb64a828cc74822da655ed7`.

Host/runtime: Darwin `24.2.0`, Python `3.14.3`, Python SQLite `3.53.4`.

## Commands and results

The exact successful harness invocation was:

```sh
PYTHONUNBUFFERED=1 python3 scripts/validation/intake-delivery/validate.py --repo /tmp/boreal-s08-t05-clean.yl7Byw/source --binary /tmp/boreal-s08-t05-candidate-target/debug/bwrk
```

Working directory:
`/Users/cybertron/.codex/worktrees/v4-s08-t05-qualification/boreal-work`.
The candidate build command was
`CARGO_BUILD_JOBS=2 CARGO_PROFILE_DEV_DEBUG=0 CARGO_TARGET_DIR=/tmp/boreal-s08-t05-candidate-target cargo build --offline --manifest-path /tmp/boreal-s08-t05-clean.yl7Byw/source/Cargo.toml -p boreal-cli`.
The harness archived and built the predecessor with `cargo build --offline`
from the pinned predecessor source commit and verified its reported build
revision before using it.

The harness returned exit `0`. Candidate identity, fixture setup, active
session start/readback, ordinary work and Intake commands, service startup and
shutdown, predecessor identity/reads, and both restores succeeded. It recorded
the following behavior:

- A preexisting Intake row read back with no fabricated receipt.
- First receive returned `changed` at project revision `7`.
- Same-key/same-payload retry returned `unchanged` at revision `7`.
- Same-key/changed-payload returned `conflict`; retrying the original payload
  remained `unchanged` at revision `7`.
- Disposable SQL edit of mutable Intake content preserved the original
  receipt. Receipt `UPDATE` and `DELETE` both failed with the immutable-trigger
  diagnostic.
- Promotion and archive preserved the receipt.
- The predecessor passed ordinary `work list`, `work show`, `intake list`, and
  `intake show` reads against the receipt-bearing work-model/3 database.
- Restore without a receipt preserved the original Intake content and
  `triaged` lifecycle without adding a receipt. Restore with a receipt
  preserved the receipt, edited content, and `archived` lifecycle.
- Restore activations had distinct database instance IDs and advanced epochs
  from `1` to `2` and then `3`.

The mutable-content edit uses SQLite only inside the disposable fixture because
there is no public Intake content-edit command. This run qualifies predecessor
ordinary reads only; it makes no claim about predecessor writes or versions
other than the pinned source. It qualifies only this host/runtime.

## Failed harness attempts preserved

The harness wrote bounded, mode-restricted failure metadata under
`$TMPDIR/boreal-s08-t05-failures/`. These records contain command labels,
exit codes, output sizes/digests, and source/runtime identity; they do not
contain fixture databases or command output.

| Run directory | Observed failure | Resolution |
| --- | --- | --- |
| `run-u7hb0zm6` | Fixture work creation lacked an active operator session. | Start the session explicitly and verify it by readback. |
| `run-sb08o0lq` | Nested Unix socket path exceeded macOS `sun_path`. | Use a short socket name under the project root. |
| `run-e1p0z3c5` | Socket was outside the selected project scope. | Keep the short socket under the disposable project root. |
| `run-j5zlbv2v` | Harness expected a string but the versioned service returned an object envelope. | Accept the object envelope and retain string decoding compatibility. |
| `run-7_utgs_9` | A direct service request failed after the preexisting Intake read; bounded failure metadata has no per-request event or raw error. | Preserved as unresolved early-run metadata; the complete final service scenario passed. |
| `run-x3ngjv9l` | Receive referenced an uncreated bucket. | Reuse the fixture's existing `baseline-inbox`. |
| `run-366yloi9`, `run-j_ng7qrn` | Restore reported `database is locked`, with and without predecessor reads. | Explicitly close fixture SQLite connections; Python's connection context manager alone does not close them. |

These were harness defects exposed while qualifying the run. The final full run
passed; no production-path changes were needed.
