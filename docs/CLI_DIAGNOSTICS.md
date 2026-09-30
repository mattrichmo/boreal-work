# Installation and project diagnostics

These commands report the installation and current project state. Diagnostics
are read-only; `integrations add` only creates missing embedded skill files and
preserves files that have been edited locally.

## Commands

- `bwrk install status` reports the running binary, its version, and matching
  executables found on `PATH`.
- `bwrk integrations [--agent codex|claude] [--scope project|user]` and
  `bwrk integrations status [--agent codex|claude] [--scope project|user]`
  compares installed skill files and package identity with the embedded
  package. Project scope is the default and uses the initialized current
  folder. User scope must be selected explicitly.
- `bwrk integrations add [--agent codex|claude] [--scope project|user] --yes`
  installs missing skills for the selected harness. It never replaces a
  customized skill file. The default scope is project-local; user-wide
  installation is explicit.
- `bwrk doctor skills [--agent codex|claude] [--scope project|user]` checks
  embedded package identity, file presence, exact file digests, and unsafe
  symbolic-link paths without repairing anything.
- `bwrk schema validate [--db PATH]` opens an existing database read-only,
  validates the store's actual schema contract, and runs bounded SQLite quick
  and foreign-key checks.
- `bwrk docs check` checks the diagnostics documentation and embedded skill
  package availability.
- `bwrk gate` (also `bwrk gate closeout`) combines database/schema health,
  embedded documentation/workflow validity, and installed project skills. It
  reports each result and performs no cleanup or pruning.

Use `--json` for structured output. A failed check is reported as a failure;
diagnostics do not create proof or alter work state.
