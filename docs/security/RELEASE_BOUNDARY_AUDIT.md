# Security And Release Boundary

This page documents the checks that protect Boreal's source tree, package artifacts, local project data, and dependency boundary.

## License

Boreal Work is distributed under the [PolyForm Noncommercial License 1.0.0](../../LICENSE). The license permits noncommercial use under its terms; commercial use requires separate written permission. Release artifacts must include the same license notice and must not advertise commercial-use rights.

## Automated audit

Run the release-boundary audit from the repository root:

```bash
node tools/audit-release-boundary.mjs --json
```

The audit checks for likely committed secrets, unsupported dependency licenses, blocked local roots, and package-boundary drift. It reports paths and pattern classes without printing secret values. Run it after dependency or packaging changes and in release CI after installing from the frozen lockfile.

## Repository boundary

The public repository contains source code, reviewed documentation, schemas, tests, examples, and release configuration. The following data is local or generated and must remain uncommitted:

| Path | Role | Release rule |
| --- | --- | --- |
| `.boreal/` | Project records, events, caches, ledgers, locks, and result spools | Never commit runtime data or generated local history. |
| `memory/` | Human-readable project knowledge | Keep as a separate knowledge repository or publish only after independent review. |
| `.agents/` and `.claude/` | Installed local adapters | Regenerate from reviewed `skills/` and do not commit installations. |
| `dump/` and other local research directories | Temporary source or comparison material | Keep ignored and outside release artifacts. |
| `node_modules/`, `dist/`, and temporary package staging | Installed or generated build output | Rebuild from the lockfile and release scripts. |

The CLI package is staged from the bundled `dist` artifact and uses an explicit file allowlist. Source-only files, local project state, and ignored installs are not package payload.

## Provenance and attribution

Use category-level prior art without copying implementation source, distinctive prose, command help, fixtures, or UI assets. Keep third-party dependencies and their license notices reviewable. AI-assisted changes receive the same code review, dependency, test, and attribution checks as any other change.

## Release checklist

Before a release:

1. Confirm the version and license metadata are consistent across the root package, CLI package, `LICENSE`, README, and staged artifact.
2. Install dependencies with the frozen lockfile.
3. Run `pnpm check` and the relevant test and package-smoke commands.
4. Run `node tools/audit-release-boundary.mjs --json`.
5. Build the staged npm artifact, inspect its file list, and run the installed-binary smoke test.
6. Verify the Homebrew formula references the same version and tarball hash.
7. Review the final Git diff for secrets, machine paths, generated state, and accidental local files.

These checks protect the release boundary; they do not replace the license terms or the review required for a commercial distribution arrangement.
