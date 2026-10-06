# Homebrew tap formula

`boreal.rb.template` is the formula source intended for the public tap
`mattrichmo/homebrew-tap`. `scripts/release/render_homebrew_formula.py` renders
it locally from the release archives used by the direct installer. There is no
checked-in workflow that publishes GitHub Releases or the formula; a
maintainer must publish the reviewed formula to the tap separately.

The tap repository must exist before publishing a formula. The publishing
identity needs write access to `mattrichmo/homebrew-tap`.

The formula template covers macOS ARM64, macOS Intel, and Linux x86_64. Linux
ARM64 remains an explicit future target until its SQLite linker/runtime build
is verified.

The formula consumes the same GitHub Release archives as the direct installer.
It installs `bwrk` under `bin`, the compiled project and global TUI runtimes
under `lib/boreal/tui` and `lib/boreal/global-tui`, and release metadata under
`share/boreal`. It declares Node.js because both dashboards execute packaged
JavaScript. Homebrew remains the owner of upgrades for formula installs.

Once the tap has its first formula commit, users install and update with:

```sh
brew tap mattrichmo/tap
brew install boreal
brew upgrade boreal
```
