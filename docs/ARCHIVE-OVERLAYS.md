# Safe source archive overlays

Use the archive overlay tool when another workspace returns a source ZIP that
must be reviewed before it is merged into this repository. The tool is
read-only during `--check` and never deletes files implicitly.

## Build an archive

From the repository root:

```sh
node create-zips.mjs --output-dir /absolute/path/to/reference-zips
```

The archive contains `ARCHIVE_MANIFEST.json` with file hashes, source Git
identity, modes, protected paths, and the explicit source allowlist.

## Run the preflight

```sh
python3 scripts/apply_overlay.py \
  /absolute/path/to/incoming.zip \
  --target /absolute/path/to/boreal-work \
  --base /absolute/path/to/original-baseline.zip \
  --check \
  --json
```

The baseline is optional. If omitted, the tool uses the incoming manifest's
source commit when that commit exists in the target Git repository. If no
baseline is available, the tool uses conservative two-way mode: any differing
existing file is a conflict.

The preflight classifies files as `unchanged`, `add`, `safe_replace`,
`local_preserved`, `mode_change`, `conflict`, `protected`, or `unsafe`.
Conflicts include a local file changed from the baseline and an incoming file
that also changed from the baseline.

## Apply after review

```sh
python3 scripts/apply_overlay.py \
  /absolute/path/to/incoming.zip \
  --target /absolute/path/to/boreal-work \
  --base /absolute/path/to/original-baseline.zip \
  --apply \
  --backup /absolute/path/to/boreal-overlay-backup \
  --report /absolute/path/to/boreal-overlay-report.json
```

`--apply` refuses to continue if the preflight contains conflicts, protected
paths, unsafe entries, manifest mismatches, or undeclared deletions. The backup
directory must be separate and new or empty. It receives the original files,
`OVERLAY_JOURNAL.json`, and the final report.

## Protected boundaries

Archives cannot replace or delete `.git`, `.boreal`, `memory`, `target`,
`node_modules`, or `test-project`. Symlink targets, path traversal, arbitrary
archive members, and implicit deletions are rejected or reported as blocking.

## After applying

Inspect the generated report and local diff before running the normal gates:

```sh
git diff --check
git status --short
cargo fmt --all -- --check
cargo test --workspace --locked
cargo build --locked -p boreal-cli --bin bwrk
npm --prefix apps/tui run typecheck
npm --prefix apps/tui test
```

The report and the returned agent mini-log are evidence, not substitutes for
the actual local diff and tests. A ZIP without `ARCHIVE_MANIFEST.json` is
rejected by default; use `--allow-legacy` only for an older archive and expect
conservative conflict behavior.
