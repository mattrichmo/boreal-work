# Homebrew tap formula

`boreal.rb.template` is the formula source for the personal tap
`mattrichmo/homebrew-tap`. Replace the `{{...}}` values with the version and
archive SHA-256 values produced by `scripts/release/build_release.py`, then
copy the rendered file to `Formula/boreal.rb` in the tap repository.

The initial release matrix covers macOS ARM64, macOS Intel, and Linux x86_64.
Linux ARM64 remains an explicit future target until its SQLite linker/runtime
build is verified.

The formula consumes the same GitHub Release archives as the direct installer.
It installs `bwrk` under `bin`, the compiled TUI under `lib/boreal/tui`, and
declares Node.js because the dashboard executes the packaged JavaScript TUI.
