# Publishing Boreal Work

> Publication is not currently authorized. The repository remains private/unlicensed, and the technical portability workflow only packs, installs, hashes, and probes a temporary `UNLICENSED` artifact. See the [release boundary audit](../security/RELEASE_BOUNDARY_AUDIT.md). The commands below are retained as release-engineering documentation, not as approval to publish or change the license.

This is the owner handoff for the npm and Homebrew release channels. The source workspace stays private and workspace-shaped; the publishable npm package is staged from the bundled CLI dist artifact.

## Version policy

Root `package.json` is the release version source of truth. `apps/cli/package.json` must carry the same version, and `tools/prepare-npm-package.mjs` fails if they drift. The staged npm package under `.boreal/release/npm-package` gets its version from the root package and ships only `dist`, package metadata, and README.

## Local gates

```bash
pnpm release:npm:smoke
pnpm release:brew:verify
pnpm release:npm:dry-run
pnpm check
```

`release:npm:smoke` builds the bundled CLI, creates the npm tarball, installs it into a temporary global prefix, and runs `bwrk --version`.

`release:brew:verify` builds the same npm tarball, injects it into the prepared Homebrew formula through local-only environment overrides, runs `brew install --build-from-source`, runs the installed `bwrk --version`, runs `brew test boreal-work`, and uninstalls the formula when it did not already exist.

## Owner publish boundary

Publishing credentials and the actual first publication are owner actions.

```bash
pnpm release:npm:prepare
npm publish .boreal/release/npm-package --access public --provenance
```

After npm publish, copy `homebrew-tap/` into the tap repository and publish the formula. The formula wraps the npm tarball and depends on Homebrew `node`, which is the v1 standard route for this Node CLI. A node-free SEA binary is a future option and is not a blocker for npm or Homebrew.

The formula SHA must match the npm tarball for the root package version:

```bash
pnpm release:npm:pack
shasum -a 256 .boreal/release/boreal-cli-*.tgz
```
