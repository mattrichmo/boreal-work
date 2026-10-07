# Installing Boreal Work v2

The supported release artifact is a platform-specific archive containing the
`bwrk` executable, compiled TUI files, release identity, and license. Project
databases are not part of the install and are never created as an install side
effect. Installation automatically provisions a separate per-user global
manager SQLite database, including CLI-only installations. The global manager
is independent of the installation prefix and any project folder. The initial binary matrix is macOS ARM64, macOS Intel, and Linux
x86_64; Linux ARM64 and Windows remain unsupported until their transport and
SQLite runtime builds are verified.

## Install or update from GitHub

Use the GitHub source installer for the current v2 code. It fetches the installer from `main`, downloads Boreal source from GitHub, builds the CLI and dashboards for this machine, verifies the package, and installs it under `~/.local`. It does not use GitHub Actions or modify project databases.

```sh
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/refs/heads/main/install.sh | sh -s -- --from-source --yes
bwrk --version
```

The source build requires Git, Rust/Cargo, Node.js 20 through 26, npm, Python 3, and `tsc`. Run the command again to build and install a newer source version. Use `--ref REF` to pin a source branch or tag.

Without `--from-source`, the installer uses a prebuilt GitHub release archive. The latest published release is v0.1.0 and has the legacy package layout; it does not contain a compatible v2 archive. The installer reports that mismatch without starting a source build. When a compatible v2 archive is published for your platform, the ordinary installer command can use it without building from source.

## Global project manager

Open the global manager from any directory:

```sh
bwrk dashboard global
bwrk global project add --name Life --json
```

Global projects can exist without folders. They can also have folder
associations or links to existing Boreal code projects, while keeping personal
and business tasks, configurable workflow statuses, milestones and notes in
the separate global store. `bwrk dashboard` inside an initialized code project
continues to open that project's dashboard.

The default global database is `~/Library/Application Support/Boreal/global.sqlite`
on macOS and `${XDG_STATE_HOME:-~/.local/state}/boreal/global.sqlite` on Linux.
`BOREAL_GLOBAL_ROOT` selects an explicit alternative data directory, useful for
isolated tests or portable use. Reinstallation preserves this data; do not
store it beneath the binary prefix or delete it when removing installed files.
The global dashboard is packaged separately at
`lib/boreal/global-tui/entrypoint.js` and uses the versioned Rust service API.

## Initialize a project

After installing `bwrk`, change into the repository that should use Boreal and
run the project setup wizard:

```sh
cd your-project
bwrk init
```

Or pass the project folder directly:

```sh
bwrk init /path/to/your-project
```

It asks which agent tools should receive the checked-in Boreal skills, then
creates `.boreal/project.json`, the `memory/` layout, Git-safe runtime ignores,
and the selected `.agents/skills` and/or `.claude/skills` adapters. The project
identifier defaults to the selected folder name. The local database, memory,
and assistant skills are all installed under that selected folder. Use
`--project ID` only when the project identifier must differ from the folder
name. `bwrk setup` and `bwrk install` are equivalent aliases.

For noninteractive use:

```sh
bwrk init --yes
bwrk init --agents codex,claude --yes
bwrk init --dry-run
```

The setup is safe to repeat after updating the global binary. Omitted options
reuse the saved identity, database, operator, memory layout, and skill targets.
Local skill edits are preserved and reported; unchanged managed skills can be
upgraded using the saved package digests. Identity and memory-layout changes
require migration rather than another init.

`.boreal/` contains ignored machine-local configuration, credentials, the
transactional database, sources, and runtime state. `memory/` contains published
curated notes in `notes/` and their `manifest.json`. The default memory layout
has its own Git repository and a clean initial scaffold commit. With
`--memory-layout in-repo`, an existing enclosing Git repository is required;
memory is committed under that repository without creating a nested `.git`.
Existing user changes remain yours to commit before memory publication.

The saved operator is used for subsequent commands in this project. Enroll
separate worker actors with `bwrk auth key` and `bwrk auth grant`, and use distinct `--actor` and
`--session` values for each worker. An empty project has no claimable work until
you create and launch its plan. Run `bwrk doctor` after initialization.

`auth key --actor WORKER --actor-role agent --json` returns an
`enrollment_path` to a private file; it does not grant authority or print the
secret. As the saved operator, pass that path to `auth grant --input PATH
--expected-revision REVISION --reason TEXT --yes`, using the current revision
from `bwrk status --json`. The worker can then run `session start --actor WORKER
--session UNIQUE_SESSION`. Keep the enrollment file inside the ignored
`.boreal/credentials/` directory.

Interrupted setup keeps `.boreal/setup-pending.json`; running init again resumes
the saved choices. A project-wide setup lock prevents simultaneous initializers
from binding different databases to the same folder. Destination collisions and symlinks are rejected before
credentials or database creation. `bwrk version --json` reports the build
revision and source fingerprint so installations with the same package version
can be distinguished. Fresh projects use an `operator` identity and an operator
session; existing projects retain their saved identity and session.

## Homebrew

After the public tap is published:

```sh
brew tap mattrichmo/tap
brew install boreal
brew upgrade boreal
```

The formula installs the CLI and TUI and supplies Node.js for
`bwrk dashboard`.

## Advanced archive install

Download the archive for the current OS/architecture from the
[GitHub Releases](https://github.com/mattrichmo/boreal-work/releases) page,
verify it against `SHA256SUMS`, and install `bin/bwrk` plus
`lib/boreal/tui`, `lib/boreal/global-tui`, and `share/boreal` under the same
prefix (or invoke `install.sh --archive PATH --prefix PREFIX`). The project
dashboard uses `lib/boreal/tui`; the global dashboard uses
`lib/boreal/global-tui` through the versioned service API.

## Source build

Rust developers can install only the CLI from Git or from a checkout:

```sh
cargo install --git https://github.com/mattrichmo/boreal-work.git \
  --path crates/cli --bin bwrk --locked
```

This builds only the Rust executable; use a release archive or Homebrew for a
complete CLI + TUI install.

Older v2 archives may not contain the updater. Run the official installer once
to replace one of those archives; subsequent `bwrk update` and
`bwrk upgrade --machine` calls use the packaged, verified installer. Project
databases are intentionally left untouched by machine updates.
