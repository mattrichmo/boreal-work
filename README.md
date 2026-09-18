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

### Install `bwrk` globally from this checkout

From the repository root, install the current Rust CLI into Cargo's user bin
directory (`~/.cargo/bin`):

```sh
cargo install --path crates/cli --bin bwrk --locked
bwrk --version
```

Make sure `~/.cargo/bin` is on `PATH`. To replace an existing install with the
current checkout, add `--force`:

```sh
cargo install --path crates/cli --bin bwrk --locked --force
```

This installs the Rust CLI/service globally, but does not install the compiled
dashboard TUI. Use the complete package below when you want interactive
`bwrk dashboard` support.

### Install the complete local CLI + TUI package

With Rust, Node.js, npm, and `tsc` available, build and install the current
checkout into `~/.local`:

```sh
target="$(rustc -vV | sed -n 's/^host: //p')"
python3 scripts/release/build_release.py \
  --version 0.2.0 \
  --target "$target" \
  --output-dir /tmp/boreal-release
sh install.sh \
  --archive "/tmp/boreal-release/bwrk-v0.2.0-$target.tar.gz" \
  --prefix "$HOME/.local"
```

Add `~/.local/bin` to `PATH` if needed. For the normal release workflow,
[the installation guide](docs/INSTALL.md) covers Homebrew and the tagged
GitHub installer. No tagged v2 archive is published yet; pushing `v0.2.0`
will trigger the release workflow.

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
