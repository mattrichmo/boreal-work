# Homebrew tap formula

`boreal.rb.template` is the formula source for the public tap
`mattrichmo/homebrew-tap`. The release workflow renders the formula from the
same archives used by the curl installer and publishes it to
`Formula/boreal.rb` when the repository has a `HOMEBREW_TAP_TOKEN` secret.

The tap repository must exist before enabling that workflow step. Give the
token write access to `mattrichmo/homebrew-tap`, then add it to this
repository's Actions secrets as `HOMEBREW_TAP_TOKEN`.

The initial release matrix covers macOS ARM64, macOS Intel, and Linux x86_64.
Linux ARM64 remains an explicit future target until its SQLite linker/runtime
build is verified.

The formula consumes the same GitHub Release archives as the direct installer.
It installs `bwrk` under `bin`, the compiled TUI and release metadata under
`lib/boreal/tui` and `share/boreal`, and declares Node.js because the dashboard
executes the packaged JavaScript TUI. Homebrew remains the owner of upgrades
for formula installs.

Once the tap has its first formula commit, users install and update with:

```sh
brew tap mattrichmo/tap
brew install boreal
brew upgrade boreal
```
