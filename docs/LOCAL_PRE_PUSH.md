# Local pre-push validation

Run the local validator from a clean committed tree before asking for review:

```sh
python3 scripts/release/local_pre_push.py
```

When the repository provides a toolchain environment, load it first. To retain
the receipt in a chosen local directory, use `--receipt-dir /absolute/path`.
The validator refuses a dirty tree, writes a new receipt without overwriting
an earlier run, and records both the exact commit SHA and tree SHA. The receipt
includes each command, result, exit code, elapsed time, and bounded output
tail. It also records whether the tree remained unchanged during validation.
Per-check temporary directories are removed after each check.

The Rust workspace check generates the repository's source-bound oracle
manifest in a temporary directory, passes it only to the offline test process,
and records its digest in the receipt. This is a local fixture generated from
the checked-out source; approval-gated hosted or production oracles remain
separate requirements.

Cargo and npm are configured for offline operation. The entrypoint does not
install dependencies, call GitHub, run online/provider oracles, publish
artifacts, create tags, or push refs. The package/install smoke uses a
disposable temporary prefix and local database fixtures. Its report is local
evidence only.

For Cargo builds, the runner sets `BOREAL_BUILD_REVISION` to the committed
`HEAD`, so the locally built CLI reports the exact source commit under test.

## Result interpretation

`local_checks.status` is the pass/fail result for the listed local checks.
`release_qualification.status` remains `incomplete` until the required macOS
release matrix and separately approved oracles have evidence. Each unrun
requirement is explicitly marked `not_run`; a local pass is not a full release
qualification.

The V10 harness check runs when V10 test modules are present; otherwise its
receipt status is `not_applicable` instead of reporting an empty test run as a
pass.

The candidate removes `.github/workflows/ci.yml` and
`.github/workflows/release.yml`. This records the requested source change but
does not prove that repository or organization Actions settings are disabled.
The receipt therefore leaves `automation_disablement.status` as
`unverified` until a supported administrator readback confirms both settings.

## Manual release packaging

`scripts/release/build_release.py`, `scripts/release/verify_release_package.py`,
`scripts/release/render_homebrew_formula.py`, `install.sh`, and
`scripts/release/package-smoke.sh` remain available for an explicitly invoked
local release rehearsal. The local pre-push entrypoint checks the package and
installer through disposable fixtures; it does not publish a release or
Homebrew formula. Versioned release packaging and any later publication must
be requested and run as separate manual operations after review and platform
qualification.

For platform qualification, build and exercise the target on its supported
host. Cross-compilation alone does not count as macOS install coverage. This
entrypoint does not mark the arm64 or x86_64 macOS release matrix as passed.
