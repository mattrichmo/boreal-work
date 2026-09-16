# Installing Boreal Work v2

The supported release artifact is a platform-specific archive containing the
`bwrk` executable, compiled TUI files, release identity, and license. Project
databases are not part of the install and are never created as an install side
effect. The initial binary matrix is macOS ARM64, macOS Intel, and Linux
x86_64; Linux ARM64 and Windows remain unsupported until their transport and
SQLite runtime builds are verified.

## Homebrew

After the personal tap is published:

```sh
brew tap mattrichmo/tap
brew install boreal
```

The formula installs the CLI and TUI and supplies Node.js for
`bwrk dashboard`.

## Direct installer

The tagged installer downloads and verifies the matching GitHub Release:

```sh
curl -fsSL \
  https://raw.githubusercontent.com/mattrichmo/boreal-work/v0.2.0/install.sh \
  | BOREAL_VERSION=0.2.0 sh
```

The default prefix is `~/.local`. Use `BOREAL_PREFIX=/usr/local` or
`--prefix /usr/local` for a system prefix. Pin the tag in automation; do not
pipe an unpinned `main` branch script. The direct installer does not install
Node.js; install a supported Node 20–26 runtime separately for
`bwrk dashboard`.

## Manual archive install

Download the archive for the current OS/architecture from the
[GitHub Releases](https://github.com/mattrichmo/boreal-work/releases) page,
verify it against `SHA256SUMS`, and install `bin/bwrk` plus
`lib/boreal/tui` and `share/boreal` under the same prefix (or invoke
`install.sh --archive PATH --prefix PREFIX`). The CLI searches that layout
when it starts the private dashboard service.

## Source build

Rust developers can build from Git after the release tag is available:

```sh
cargo install --git https://github.com/mattrichmo/boreal-work.git \
  --path crates/cli --bin bwrk --locked
```

This builds only the Rust executable; use a release archive or Homebrew for a
complete CLI + TUI install.
