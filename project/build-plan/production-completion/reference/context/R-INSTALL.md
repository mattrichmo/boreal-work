# R-INSTALL — docs/INSTALL.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/INSTALL.md:L1–L115`  
**File SHA-256:** `5062239f3088dd19ae1ac7c6dcf36c09121d432aef94f4702e8cc9b5b78e5747`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Public install/update commands and installer interaction; verify rather than assume current production availability.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,115p' 'docs/INSTALL.md'
```

## Exact baseline excerpt

````text
    1 | # Installing Boreal Work v2
    2 | 
    3 | The supported release artifact is a platform-specific archive containing the
    4 | `bwrk` executable, compiled TUI files, release identity, and license. Project
    5 | databases are not part of the install and are never created as an install side
    6 | effect. The initial binary matrix is macOS ARM64, macOS Intel, and Linux
    7 | x86_64; Linux ARM64 and Windows remain unsupported until their transport and
    8 | SQLite runtime builds are verified.
    9 | 
   10 | ## Install or update from GitHub
   11 | 
   12 | The installer is idempotent: run the same command for a first install or to
   13 | update an existing installation. It installs the CLI and compiled dashboard
   14 | TUI under `~/.local`, and keeps project databases outside the install:
   15 | 
   16 | ```sh
   17 | curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/refs/heads/main/install.sh | sh
   18 | bwrk --version
   19 | ```
   20 | 
   21 | The final `| sh` is required. Without it, `curl` only prints the installer
   22 | script to the terminal.
   23 | 
   24 | If GitHub's latest release is an older incompatible package, the installer
   25 | automatically falls back to the `main` source ref rather than failing on a
   26 | missing v2 archive. That fallback needs Git, Rust, Node.js, npm, Python, and
   27 | `tsc`. Once a v2 release exists, it downloads and verifies the matching
   28 | platform archive without requiring the Rust toolchain. Run the command again
   29 | to update.
   30 | 
   31 | After the first v2 release, installed release builds also support the shorter
   32 | update commands:
   33 | 
   34 | ```sh
   35 | bwrk update
   36 | bwrk upgrade --machine
   37 | ```
   38 | 
   39 | To pin a release in automation:
   40 | 
   41 | ```sh
   42 | curl -fsSL \
   43 |   https://raw.githubusercontent.com/mattrichmo/boreal-work/v0.2.0/install.sh \
   44 |   | BOREAL_VERSION=0.2.0 sh
   45 | ```
   46 | 
   47 | The default prefix is `~/.local`. Use `BOREAL_PREFIX=/usr/local` or
   48 | `--prefix /usr/local` for a system prefix. The installer replaces the CLI,
   49 | TUI, and release metadata atomically; it does not modify a project database.
   50 | 
   51 | ## Initialize a project
   52 | 
   53 | After installing `bwrk`, change into the repository that should use Boreal and
   54 | run the project setup wizard:
   55 | 
   56 | ```sh
   57 | cd your-project
   58 | bwrk init
   59 | ```
   60 | 
   61 | It asks which agent tools should receive the checked-in Boreal skills, then
   62 | creates `.boreal/project.json`, the `memory/` layout, Git-safe runtime ignores,
   63 | and the selected `.agents/skills` and/or `.claude/skills` adapters. The project
   64 | identifier defaults to the current folder name. `bwrk setup` and `bwrk install`
   65 | are equivalent aliases.
   66 | 
   67 | For noninteractive use:
   68 | 
   69 | ```sh
   70 | bwrk init --yes
   71 | bwrk init --agents codex,claude --yes
   72 | bwrk init --dry-run
   73 | ```
   74 | 
   75 | The setup is safe to repeat after updating the global binary. Existing memory
   76 | content is preserved while managed metadata and skill files are reconciled.
   77 | 
   78 | ## Homebrew
   79 | 
   80 | After the public tap is published:
   81 | 
   82 | ```sh
   83 | brew tap mattrichmo/tap
   84 | brew install boreal
   85 | brew upgrade boreal
   86 | ```
   87 | 
   88 | The formula installs the CLI and TUI and supplies Node.js for
   89 | `bwrk dashboard`.
   90 | 
   91 | ## Advanced archive install
   92 | 
   93 | Download the archive for the current OS/architecture from the
   94 | [GitHub Releases](https://github.com/mattrichmo/boreal-work/releases) page,
   95 | verify it against `SHA256SUMS`, and install `bin/bwrk` plus
   96 | `lib/boreal/tui` and `share/boreal` under the same prefix (or invoke
   97 | `install.sh --archive PATH --prefix PREFIX`). The CLI searches that layout
   98 | when it starts the private dashboard service.
   99 | 
  100 | ## Source build
  101 | 
  102 | Rust developers can install only the CLI from Git or from a checkout:
  103 | 
  104 | ```sh
  105 | cargo install --git https://github.com/mattrichmo/boreal-work.git \
  106 |   --path crates/cli --bin bwrk --locked
  107 | ```
  108 | 
  109 | This builds only the Rust executable; use a release archive or Homebrew for a
  110 | complete CLI + TUI install.
  111 | 
  112 | Older v2 archives may not contain the updater. Run the official installer once
  113 | to replace one of those archives; subsequent `bwrk update` and
  114 | `bwrk upgrade --machine` calls use the packaged, verified installer. Project
  115 | databases are intentionally left untouched by machine updates.
````
