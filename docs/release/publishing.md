# Publishing Boreal Work

This guide covers the GitHub Release channel and its Homebrew tap. The source
repository is the development tree; published artifacts are staged from the
bundled CLI distribution and carry the repository's PolyForm Noncommercial
License 1.0.0.

## Version policy

The root package.json is the release version source of truth. apps/cli/package.json
must carry the same version. Releases use matching v<version> Git tags.

## Local gates

    pnpm release:brew:verify
    pnpm check
    node tools/audit-release-boundary.mjs --json

release:brew:verify builds a local release bundle, injects it into the
prepared Homebrew formula through local-only overrides, runs the formula smoke
test, and removes the temporary installation when appropriate.

## GitHub Release

Push a version tag after updating both package versions:

    git tag v0.1.1
    git push origin v0.1.1

The upgrade-release workflow builds the verified bundle, checks the release
identity, smoke-tests it on Linux and macOS, and publishes:

- bwrk-upgrade.tar.gz
- SHA256SUMS
- bwrk-release.json

The default install.sh path downloads and verifies this bundle, so users do not
need Git, pnpm, Corepack, or npm.

## Homebrew release

Homebrew does not require a separate account; the tap is a GitHub repository
named homebrew-boreal. After the GitHub Release is published:

1. Copy homebrew-tap/Formula/boreal-work.rb into the tap repository.
2. Keep the formula version aligned with root package.json.
3. Set the formula URL to the matching v<version> release asset.
4. Set sha256 to the SHA256 of bwrk-upgrade.tar.gz printed by the release.
5. Commit and push the tap repository.

Users then install Boreal with:

    brew tap mattrichmo/boreal
    brew install boreal-work

The formula wraps the GitHub Release bundle and depends on Homebrew node,
which is the supported route for this Node CLI. A node-free binary is a future
packaging option, not a prerequisite for either channel. Commercial use
remains subject to separate written permission under the PolyForm
Noncommercial License.
