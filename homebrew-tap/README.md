# Boreal Work Homebrew Tap

This directory is the prepared tap payload for the first owner-published Homebrew tap.

The formula wraps the npm package tarball for `@boreal/cli` and depends on Homebrew `node`. That is the supported v1 route for this Node CLI. A node-free single executable can be evaluated later without blocking this channel.

Owner publish flow:

```bash
pnpm release:npm:pack
pnpm release:brew:verify
```

After the npm package is published, copy this directory's contents to the tap repository, keep `Formula/boreal-work.rb` on the same version as root `package.json`, and update the formula SHA if the tarball changes.
