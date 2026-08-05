# Boreal Work Homebrew Tap

This directory contains the prepared Homebrew tap payload for Boreal Work.

The formula wraps the npm package tarball for `@boreal/cli` and depends on Homebrew `node`. That is the supported v1 route for this Node CLI. A node-free single executable can be evaluated later without blocking this channel.

Verification flow:

```bash
pnpm release:npm:pack
pnpm release:brew:verify
```

After the npm package is published, copy this directory's contents to the tap repository, keep `Formula/boreal-work.rb` on the same version as root `package.json`, and update the formula SHA if the tarball changes.
