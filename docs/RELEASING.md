# Preparing a Boreal release

Release artifacts are built from one selected candidate revision. The checked-in
workflow **Release artifact preparation** builds native archives for macOS
ARM64 (`aarch64-apple-darwin`), macOS Intel (`x86_64-apple-darwin`), and Linux
x86_64 (`x86_64-unknown-linux-gnu`). It verifies generated installer bundles,
compiles each TUI into a clean temporary output directory, packages only
source-backed runtime JavaScript, and records the CLI and TUI source identities
in each release manifest. Each native job installs and smokes its own packaged
CLI/TUI archive before upload. The workflow retains artifacts for review; it
does not publish a GitHub Release or activate an installation.

## Candidate procedure

1. Freeze the reviewed candidate commit and choose its release version. Keep
the workspace package version and release tag identical; the archive builder
rejects a mismatch. Version changes belong to the integration owner.
2. Dispatch `.github/workflows/release-artifacts.yml` against that candidate
revision. Do not dispatch different refs for different target builds.
3. Retain the `boreal-release-bundle-<commit>` artifact. Confirm its
`release-bundle.json` records the candidate revision, source identity,
contract identity, all three targets, per-archive checksums, per-package
manifest checksums, and a bundle identity.
4. Preserve the three archive manifests and `SHA256SUMS` alongside release
notes. Release notes should name the source revision, user-visible changes,
upgrade or migration considerations, known unsupported imports, and the
rollback artifact/version.
5. Run final qualification against these exact archives before publication.
The preparation workflow does not qualify a release or prove installed
behavior.

The bundle contains one archive per supported target and a SHA-256 checksum
file suitable for the installer publication layout. Do not rebuild a target
from a different commit to replace a failed artifact; dispatch the workflow
again for one frozen revision so all target manifests share a source and
contract identity.

## Upgrade and rollback

Machine updates replace the installed package and do not intentionally modify
project databases or the Global database. Preserve the previous release
archive and its checksum file until the new installation has been accepted.
For a binary-only rollback, install the previous verified archive into the
same prefix with its packaged installer:

```sh
sh /path/to/previous/share/boreal/install.sh \
  --archive /path/to/previous-archive.tar.gz \
  --prefix "$HOME/.local"
```

If the new version has already migrated a database schema or written new
canonical state, first stop all Boreal processes and restore a verified
pre-upgrade backup using the matching Boreal recovery command. Then reinstall
the prior package. A package rollback alone does not reverse database writes.
Keep source blobs and published memory backups with the database package when
those artifacts are part of the project; the current project database restore
format reports external source and Git-memory artifacts as unsupported until
their bundle is supplied. Never delete those artifacts to make rollback pass.

Do not use a release candidate against the real installation or project until
its platform archive has passed the integrated qualification and the operator
has selected the intended project binding. Actual installation activation and
publication are handled by the coordinator after qualification.
