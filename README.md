# Boreal Work v2

Clean, authoritative project/work tracking core. The currently implemented
compatibility hierarchy is:

```text
milestone -> sprint -> task -> claim/release -> complete -> dashboard
```

The next work-model boundary separates decomposition from scheduling:
projects own milestone/task trees, while sprints become scheduled cycle
instances and notes/discoveries/revisit reminders live in a distinct intake
pipeline. See [the reviewed work-model contract](project/spec/WORK_MODEL_V2.md)
for invariants, migration rules, and phased acceptance tests. That contract is
not a claim that schema version 3 has already shipped.

This repository is now the canonical v2 workspace. The legacy implementation
is preserved in Git history under the `v1-archive-pre-v2-cutover` tag and the
`archive/v1-pre-v2-cutover` branch; it is not part of the active runtime.

## Quick start

Install `bwrk` and its dashboard TUI globally for your user:

```sh
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/refs/heads/main/install.sh | sh
```

Keep the `| sh` at the end: without it, `curl` only prints the installer
script and does not install anything.

The same command is both the install and update command. Release-installed v2
builds also support `bwrk update` and the v1-compatible
`bwrk upgrade --machine`. After installation, run the project setup wizard
from the repository you want Boreal to manage:

```sh
cd your-project
bwrk init
```

Choose Codex, Claude, or both in the wizard. To set up or update a project
without prompts, use `bwrk init --yes`; existing memory content is preserved.
See [Installation](#installation) for pinned releases, source installs, and
prefix options.

## Structure

```text
crates/
  domain/       Pure records and invariants
  store/        Persistence ports and transaction boundary
  application/  Authoritative use cases and read models
  cli/          CLI adapter and versioned JSON contract
  protocol/     Versioned request/response/error envelopes
  service/      Local queue/election/read-write runtime primitives
  source/       Immutable scoped source/citation groundwork
  memory/       Cited draft and deterministic publication groundwork
  migration/    Explicit reduced legacy import/export boundary
apps/
  tui/          TypeScript protocol/status client groundwork
project/        Architecture packet for implementation agents
docs/           v2 architecture and migration notes
tests/          Cross-crate and fixture tests
```

The workspace contains tested domain/store/application, protocol, service,
source, memory, migration, CLI, TUI, workflow, and packaging slices. P2-09 has
bounded application plus real local-socket multi-harness/restart proof, and the
service route now carries structured evidence/finish-close payloads, but the
release gate still requires guided evidence execution and a successful
end-to-end finish transcript;
see the [revalidation record](project/build-plan/P2-09-REVALIDATION.md) before
calling this a release build. The workspace has no dependency on legacy TypeScript
packages. Legacy data crosses only through the explicit reduced migration
format; it is not silently imported into the v2 store.
To build the product, start with the [master milestone plan](MASTER_PLAN.md),
the [sprint folders](milestones/M01-v2-product/README.md), and the
[agent handoff](AGENT_HANDOFF.md). The [project packet](project/README.md)
holds architecture and behavior contracts. These are file-based assignments;
do not instantiate them in the legacy `bwrk` workspace.

## Design principles

- One lifecycle across work, reservation, assignment, and runtime attempt.
- One canonical dependency representation.
- One consistent snapshot per read.
- Short, measurable write critical sections.
- Structured evidence and deterministic gate results.
- Git-published project memory without using Git as the work transaction
  engine.
- Small product surface before optional integrations.

## Installation

### Install or update `bwrk`

The installer installs the CLI and compiled dashboard TUI into `~/.local`.
Rerun the same command whenever you want to update an existing installation;
project databases and memory are kept in their project folders:

```bash
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/refs/heads/main/install.sh | sh
bwrk --version
```

Add `~/.local/bin` to `PATH` if the installer reports that it is missing. Before
the first v2 release is published, the command automatically builds the `main`
source ref; that fallback requires Git, Rust, Node.js, npm, Python, and `tsc`.
After a release is published, it downloads and verifies the platform archive
instead.

To install a specific published version, pin both the installer script and
release version:

```bash
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/v0.2.0/install.sh \
  | BOREAL_VERSION=0.2.0 sh
```

For a source checkout, install/update the current checkout with:

```sh
./install.sh --from-source
```

### Developer-only Rust CLI install

If you only need the Rust executable and not the dashboard TUI, Cargo can
install it into `~/.cargo/bin`:

```sh
cargo install --path crates/cli --bin bwrk --locked
```

This developer path does not install the compiled dashboard TUI. See
[the installation guide](docs/INSTALL.md) for pinned releases, Homebrew, and
packaging details.

### Set up a project

From the repository you want Boreal to manage, run:

```sh
cd your-project
bwrk init
```

The setup screen asks whether to install the project skills for Codex, Claude,
or both, then creates the local `.boreal/` project binding, `memory/` tree,
Git-safe runtime files, and selected agent skills. The project name defaults to
the current folder name; pass one explicitly when needed:

```sh
bwrk init my-project
```

For scripts and CI, use setup without prompts. Repeat it after installing a
newer `bwrk`; managed files and skills are reconciled without replacing your
existing memory notes:

```sh
bwrk init --yes
bwrk init --agents codex,claude --yes
```

`bwrk setup` and `bwrk install` are compatibility aliases. Use `--dry-run` to
review the plan without writing files, or `--json` for automation.

## Build

```sh
cargo check
```

For the packaged local sandbox, run `./scripts/prepare-test-project.sh`, enter
`test-project`, source `.boreal/activate.sh`, and launch the composed dashboard
with one command:

```sh
bwrk dashboard test-project --db "$BOREAL_TEST_DB"
```

The command privately supervises the Rust service and packaged TypeScript TUI;
normal dashboard use does not require a second terminal or a user-managed
server. `bwrk service run` remains available for shared-agent and diagnostic
operation.

The crates are deliberately dependency-light at this stage. Runtime and UI
dependencies should be added only when their boundary is settled.
