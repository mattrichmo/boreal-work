# Installing Boreal Work v2

The supported release artifact is a platform-specific archive containing the
`bwrk` executable, compiled TUI files, release identity, and license. Project
databases are not part of the install and are never created as an install side
effect. The initial binary matrix is macOS ARM64, macOS Intel, and Linux
x86_64; Linux ARM64 and Windows remain unsupported until their transport and
SQLite runtime builds are verified.

## Install or update from GitHub

The installer is idempotent: run the same command for a first install or to
update an existing installation. It installs the CLI and compiled dashboard
TUI under `~/.local`, and keeps project databases outside the install:

```sh
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/main/install.sh \
  | sh
bwrk --version
```

Before the first v2 release is published, this command builds the `main`
source ref. That fallback needs Git, Rust, Node.js, npm, Python, and `tsc`.
Once a release exists, it downloads and verifies the matching platform archive
without requiring the Rust toolchain. Run the command again to update.

To pin a release in automation:

```sh
curl -fsSL \
  https://raw.githubusercontent.com/mattrichmo/boreal-work/v0.2.0/install.sh \
  | BOREAL_VERSION=0.2.0 sh
```

The default prefix is `~/.local`. Use `BOREAL_PREFIX=/usr/local` or
`--prefix /usr/local` for a system prefix. The installer replaces the CLI,
TUI, and release metadata atomically; it does not modify a project database.

## Initialize a project

After installing `bwrk`, change into the repository that should use Boreal and
run the project setup wizard:

```sh
cd your-project
bwrk init
```

It asks which agent tools should receive the checked-in Boreal skills, then
creates `.boreal/project.json`, the `memory/` layout, Git-safe runtime ignores,
and the selected `.agents/skills` and/or `.claude/skills` adapters. The project
identifier defaults to the current folder name. `bwrk setup` and `bwrk install`
are equivalent aliases.

For noninteractive use:

```sh
bwrk init --yes
bwrk init --agents codex,claude --yes
bwrk init --dry-run
```

The setup is safe to repeat after updating the global binary. Existing memory
content is preserved while managed metadata and skill files are reconciled.

## Homebrew

After the personal tap is published:

```sh
brew tap mattrichmo/tap
brew install boreal
```

The formula installs the CLI and TUI and supplies Node.js for
`bwrk dashboard`.

## Advanced archive install

Download the archive for the current OS/architecture from the
[GitHub Releases](https://github.com/mattrichmo/boreal-work/releases) page,
verify it against `SHA256SUMS`, and install `bin/bwrk` plus
`lib/boreal/tui` and `share/boreal` under the same prefix (or invoke
`install.sh --archive PATH --prefix PREFIX`). The CLI searches that layout
when it starts the private dashboard service.

## Source build

Rust developers can install only the CLI from Git or from a checkout:

```sh
cargo install --git https://github.com/mattrichmo/boreal-work.git \
  --path crates/cli --bin bwrk --locked
```

This builds only the Rust executable; use a release archive or Homebrew for a
complete CLI + TUI install.

The current v2 binary does not yet expose v1's `bwrk upgrade --machine`
subcommand. Re-running the installer command above is the supported install
and update operation; project databases are intentionally left untouched by
that operation.
