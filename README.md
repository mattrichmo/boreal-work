# Boreal Work

Boreal Work gives people and AI agents a shared local workspace to plan project work, coordinate execution, prove outcomes, and carry useful context into the next handoff.

> **Capture context:** The dashboard screenshots below were captured from a local pre-integration snapshot of PR #11 at `351e18c`. PR #11 is now merged into `main`; the screenshots show synthetic demo data and do not represent a release build.

![Boreal project dashboard showing a task queue and inspector for the readme-demo project](docs/assets/boreal-project-dashboard-v10.png)

**Project dashboard.** Task queue and inspector for the synthetic `readme-demo` project. The local demo session is not authorized to claim work; no task action was attempted.

![Boreal global dashboard showing a portfolio of tasks and project summaries](docs/assets/boreal-global-dashboard-v10.png)

**Global dashboard.** Portfolio view with the synthetic “Paper Birch Study” project and its sample follow-ups.

<p><em>Both captures use the local PR #11 candidate at commit <code>351e18c</code> (tree <code>3f8ba75</code>), not current <code>main</code> or a release. See the <a href="docs/README-CAPTURE-NOTES.md">capture provenance and reproduction notes</a>.</em></p>

## What Boreal does

Boreal keeps plans, tasks, dependencies, ownership, sources, evidence, reviews, and curated project knowledge in one project record. People and agents can use the CLI, terminal dashboard, and packaged workflow guidance against the same local state. Readiness and required next steps come from the work graph and project rules, so a task marked “done” is not automatically accepted.

## Get a safe first result

The latest published release is v0.1.0. Its `bwrk-upgrade.tar.gz` asset uses the legacy package layout; the v2 installer expects a matching platform archive and `SHA256SUMS`, and no compatible v2 archive is published yet. The default installer does not build from source automatically. Until those archives are available, explicitly install from source under the default `~/.local` prefix (requires Git, Rust, Node.js 20 through 26, npm, Python, and `tsc`):

```sh
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/refs/heads/main/install.sh | sh -s -- --from-source --yes
bwrk --version
```

Try project setup in a new temporary directory before using an existing project. The example initializes a local project, checks it, and opens its dashboard:

```sh
boreal_demo_dir="$(mktemp -d)"
export BOREAL_GLOBAL_ROOT="$boreal_demo_dir/global"
bwrk init "$boreal_demo_dir" --project boreal-demo --agents codex,claude --yes
printf 'Demo directory: %s\n' "$boreal_demo_dir"
cd "$boreal_demo_dir"
bwrk doctor
bwrk dashboard
```

The example keeps the separate global-manager database under the temporary directory too. The dashboard footer shows its keys: press `?` for help and `q` to quit. The example prints the temporary project path so you can remove that directory when finished. See the [installation guide](docs/INSTALL.md) for archive verification, pinned releases, updates, and setup details.

## Build from source

For a CLI-only Rust install:

```sh
git clone https://github.com/mattrichmo/boreal-work.git
cd boreal-work
cargo install --path crates/cli --bin bwrk --locked
```

This installs only `bwrk`; use the install command above to build and install the CLI with its compiled dashboard.

## Workflows

- **Plan a project:** organize milestones, sprints, tasks, and dependencies in the project work tree.
- **Find the next safe step:** use the dashboard or `bwrk next --project PROJECT --json`; `bwrk agent guide --project PROJECT --json` explains the current action and its requirements.
- **Complete work with a record:** claim one bounded attempt, record progress, attach required evidence, then finish or release it. Some work also needs review before it can close or unblock dependents.
- **Carry context forward:** register source material, search it later, and publish cited project knowledge for future work.

For command sequences and workflow detail, see [CLI workflows](docs/CLI_WORKFLOWS.md), [agent orchestration](docs/CLI_ORCHESTRATION.md), and [knowledge workflows](docs/CLI_KNOWLEDGE.md).

## CLI and dashboard

Check what your installed build supports and get command-specific syntax with:

```sh
bwrk commands
bwrk help PATH
```

For example, `bwrk help work claim` shows the current claim syntax. The project dashboard is interactive; use `?` for its key guide and `q` to exit. Open the global portfolio from any directory with:

```sh
bwrk dashboard global
```

Command availability can vary by build, so consult the installed CLI's command list.

## Local data and safety

- Project configuration, credentials, the operational database, sources, and runtime state live under the project's ignored `.boreal/` directory. Curated notes live under `memory/`; by default, that directory has its own Git repository.
- The dashboard connects to a managed local service over a Unix-domain socket; project records stay local. The documented workflow has no Boreal-hosted account or cloud-sync step. The installer downloads from GitHub; configured agent tools and evidence commands use whatever network access those tools require.
- Work claims are scoped to an attempt and fence. Finishing work follows its evidence and review requirements; Boreal keeps failed evidence and interrupted attempts in the record.
- Use `bwrk init --dry-run` to preview setup. For live commands, `bwrk help PATH` gives the syntax and flags for the installed build.

## Platforms and current limits

The installer supports macOS on Apple Silicon or Intel and Linux on x86-64. Compatible v2 release archives for those targets are not yet published; Linux ARM64 and Windows are not supported. The interactive dashboard requires Node.js 20 through 26. Boreal Work v2 is under active development; use `bwrk commands` to see which routes are available in your build.

## Further reading

- [Install and update](docs/INSTALL.md)
- [Packaged workflows](docs/WORKFLOWS.md)
- [CLI operations](docs/CLI_OPERATIONS.md) · [orchestration](docs/CLI_ORCHESTRATION.md) · [knowledge](docs/CLI_KNOWLEDGE.md)
- [Architecture](docs/ARCHITECTURE.md) · [security boundaries](docs/SECURITY.md)
- [Product and implementation overview](project/README.md)
- [Migration from the legacy workspace](docs/MIGRATION.md)
