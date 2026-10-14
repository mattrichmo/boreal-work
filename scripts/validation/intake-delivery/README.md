# Intake delivery compatibility validation

Run from a clean Boreal source checkout:

```sh
python3 scripts/validation/intake-delivery/validate.py --repo .
```

The harness builds the candidate CLI and a predecessor CLI from source commit
`f735a903fdc1470f29e98201aedbbb8b3c7d34df`, the parent of the commit that
introduced `intake_delivery`. It verifies each binary's reported build
revision. It then creates a disposable project root under the system temporary
directory, runs ordinary work and Intake operations before delivery, receives
and retries a receipt through the versioned project service, and exercises
promotion, archive, backup, and restore against that fixture. It removes the
disposable root when the run exits. The output records the candidate and
predecessor binary SHA-256 values, the tested host/Python/SQLite versions,
each CLI command and exit code, and the key delivery/restore readbacks.

On failure, the harness writes a mode-restricted `failure.json` under
`$TMPDIR/boreal-s08-t05-failures/`. It retains source/runtime and binary
identities, the failed scenario, command exit codes, and output byte counts
and hashes. It does not retain command output, paths, credentials, or payload
text. The disposable project database and service log are not retained.
Successful runs remove their temporary fixture.

The compatibility result covers ordinary work and Intake reads by this one
source-pinned predecessor against the receipt-bearing work-model/3 database.
It is not a claim about every earlier Boreal version. The harness uses Unix
domain sockets and reports only the host/runtime where it runs; it does not
qualify other operating systems or runtime versions.

There is currently no public Intake content-edit action. To cover the receipt
invariant through a mutable Intake-row edit, the harness updates that row with
SQLite only inside the disposable fixture. The receipt table itself is tested
through its immutable `UPDATE` and `DELETE` triggers, and the resulting
receipt-bearing snapshot is restored through the supported CLI backup/restore
path. The receipt-free snapshot is also checked for preservation of the
preexisting Intake content and lifecycle, with no fabricated receipt.

`--binary PATH` accepts a candidate binary only when `bwrk version --json`
reports the current checkout's `HEAD`. `--predecessor-binary PATH` accepts a
predecessor only when its reported build revision matches the pinned source
commit. `--skip-predecessor` is for environments that cannot build the
predecessor and prints compatibility as unqualified. The harness rejects
tracked source changes so the reported `HEAD` identifies the code under test;
the validation files themselves may be untracked while preparing a run.
