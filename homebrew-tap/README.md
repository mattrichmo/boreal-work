# Boreal Work Homebrew Tap

This directory contains the prepared Homebrew tap payload for Boreal Work.

The formula downloads the same verified GitHub Release bundle used by the
curl installer and depends on Homebrew `node`. It does not require an npm
publication or npm account. A node-free single executable can be evaluated
later without blocking this channel.

Verification flow:

```bash
pnpm release:brew:verify
```

After a GitHub Release is published, copy this directory's contents to the tap
repository, keep `Formula/boreal-work.rb` on the same version as root
`package.json`, and update the formula SHA to the SHA256 printed by the
release workflow. Users install it with:

```bash
brew tap mattrichmo/boreal
brew install boreal-work
```
