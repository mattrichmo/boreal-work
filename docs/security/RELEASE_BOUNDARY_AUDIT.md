# Release Boundary, Provenance, And License Audit

Last verified: 2026-07-10

This is the current technical boundary for dependency provenance, secret scanning, repository history, and distributable artifacts. It does not authorize publication and it does not change Boreal's license.

## Current License State

- The repository has no root `LICENSE`, `COPYING`, or package `license` field.
- The root package and `@boreal/cli` package are both marked `private: true`.
- Therefore the current state is **private and unlicensed for external reuse**. Copyright defaults remain with the author; this audit does not choose or apply a license.
- A future open-source or commercial distribution decision must be explicit. Until then, release automation must not infer a license from dependency licenses or from public visibility.

## Automated Audit

Run:

```bash
node tools/audit-release-boundary.mjs --json
```

The audit fails when it finds a likely committed secret, an installed dependency with a missing, unapproved, or copyleft/source-available license, a blocked local root tracked by Git, or a package boundary that is no longer private and dist-only. It reports paths and pattern classes, never secret values.

The 2026-07-10 baseline scanned 93 installed third-party package versions: 85 MIT, 4 ISC, 2 Apache-2.0, 1 BSD-3-Clause, and 1 `(MIT OR CC0-1.0)`. No dependency-license exception is currently required. Re-run after every lockfile change; this is an installed-tree audit, so CI must install with the frozen lockfile first.

## Repository And Publication Boundary

| Path | Current role | Package boundary | Public-repository boundary |
| --- | --- | --- | --- |
| `apps/cli/dist/` | Built CLI artifact | The only `@boreal/cli` package payload | Scan and smoke-test before any distribution |
| `.boreal/objects/`, `.boreal/log/`, `.boreal/rollup.json` | Project tracker, evidence, summaries, operations, and historical machine paths | Excluded by the CLI package's `files: ["dist"]` allowlist | Do not publish current history without a deliberate tracker scrub or a clean export repository |
| `memory/` | Separate child knowledge repository | Excluded | Keep separate; review and publish independently if ever authorized |
| `dump/` | Local research/import material | Ignored and excluded | Never publish |
| `.agents/`, `.claude/` | Installed/local agent adapters | Ignored and excluded from the CLI package | Regenerate from reviewed source skills; do not ship local installs |
| `.boreal/runtime/`, `.boreal/cache/`, `.boreal/results/`, `.boreal/tmp/`, `.boreal/release/` | Machine-local locks, indexes, spools, and staging | Ignored and excluded | Never publish |
| `claude-code-sourcemap-main/` | Prior-art research artifact | Ignored and excluded | Never publish or copy from it |

Machine-specific absolute paths remain in the tracked Boreal ledger and historical audit fixtures. That is acceptable for the private working repository and unacceptable for a public-history push. The safe future route is a clean export repository containing reviewed source/docs and generated release artifacts, not rewriting or casually pushing the current tracker history.

## Prior Art And AI-Assisted Authorship

The originality boundary in [PRIOR_ART_ORIGINALITY.md](../architecture/PRIOR_ART_ORIGINALITY.md) remains authoritative:

- Boreal may use category-level ideas from local-first, Git-native, and agent workflow systems.
- Do not copy implementation source, distinctive prose, command help, fixtures, or UI assets from researched projects.
- Research dumps and sourcemaps are evidence for comparison only and are excluded from distribution.
- AI-assisted code is not automatically provenance-safe. Every generated change remains subject to repository review, dependency attribution, tests, and similarity review when it touches a known competing design.
- Claims of independent implementation must be based on inspected source history and concrete similarity checks, not the model's assurance.

The main residual risk is not an identified copied file; it is accidental reproduction of distinctive competitor text or structure during later AI-assisted feature work. Mitigation is to write Boreal's contract first, retain source references for research, review suspiciously close output, and keep dependency/license scans separate from originality review.

## Release Preconditions Not Yet Met

- No external distribution license has been selected.
- The current Git history contains private tracker records and machine paths.
- Public repository security/support policy is deferred to technical release readiness work.
- External user validation is deferred and is not required for the technical-hardening milestone.

These are deliberate boundaries, not failures of the current private development workflow.
