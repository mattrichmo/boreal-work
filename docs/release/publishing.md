# Publishing Boreal Work

This guide covers the npm and Homebrew release channels. The source repository is the development tree; the npm package is staged from the bundled CLI distribution and carries the repository's PolyForm Noncommercial License 1.0.0.

## Version policy

The root `package.json` is the release version source of truth. `apps/cli/package.json` must carry the same version, and `tools/prepare-npm-package.mjs` fails if they drift. The staged package under `.boreal/release/npm-package` receives its version from the root package and contains only the distributable CLI payload, package metadata, license, and README.

## Local gates

```bash
pnpm release:npm:smoke
pnpm release:brew:verify
pnpm release:npm:dry-run
pnpm check
node tools/audit-release-boundary.mjs --json
```

`release:npm:smoke` builds the bundled CLI, creates the npm tarball, installs it into a temporary prefix, and runs `bwrk --version`.

`release:brew:verify` builds the same tarball, injects it into the prepared Homebrew formula through local-only overrides, runs the formula smoke test, and removes the temporary installation when appropriate.

## npm release

Prepare and inspect the package before publishing:

```bash
pnpm release:npm:prepare
pnpm release:npm:pack
```

Review the staged file list and license metadata, then publish the prepared package with the appropriate registry credentials:

```bash
npm publish .boreal/release/npm-package --access public --provenance
```

Publishing the package does not change the license. Commercial use remains subject to separate written permission under the PolyForm Noncommercial License.

## Homebrew release

After the npm package is published, copy the reviewed contents of `homebrew-tap/` into the tap repository. Keep `Formula/boreal-work.rb` on the same version as the root package and update the formula SHA when the tarball changes.

```bash
shasum -a 256 .boreal/release/boreal-cli-*.tgz
pnpm release:brew:verify
```

The formula wraps the npm tarball and depends on Homebrew `node`, which is the supported route for this Node CLI. A node-free binary is a future packaging option, not a prerequisite for npm or Homebrew.
