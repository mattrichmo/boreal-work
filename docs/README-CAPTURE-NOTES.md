# README dashboard captures

These are current application views captured for the README from the local PR #11 candidate source at commit `351e18c46ca753aa4b38e4a517b964a3a3e96e8d` (tree `3f8ba75c94b5cbb4b0b5f7f76c5b1b4e4d8b35ec`). The separately built `bwrk` binary reports that build revision, source identity `sha256:938d68d4a8b2968519a4a772642ead81452b5d4d482c44a35bb1a6d7ff8e2818`, API version 2, and SQLite 3.51.3. The binary's SHA-256 is `060915ccfe1254ce50e37fca82b4812063f26761de8ea03e84f9d71080791453`.

The project and portfolio TUI bundles were built from the same candidate checkout. Each view ran in a 160-column by 44-row pseudo-terminal with the product's dark theme. The terminal output was saved before quitting and rasterized as a terminal screen; the raster retains the emitted text, cursor positions, ANSI colors, and selection state. No interface text was added or changed. The `.ansi` files alongside the images preserve the terminal output used to make them.

## Project dashboard

- Image: [`boreal-project-dashboard-v10.png`](assets/boreal-project-dashboard-v10.png), SHA-256 `a2771e9c9c89c9f68a1905184432e6dd241ec872b3d0a5b67fdf4f252cc43faa`.
- Source terminal output: [`boreal-project-dashboard-v10.ansi`](assets/boreal-project-dashboard-v10.ansi), SHA-256 `25d1af509ac617644c9ffcd94a1a4f3e8225de40c2fe55f77ff85d648146a073`.
- Source: `bwrk` initialized a disposable `/tmp/boreal-readme-demo` project (`readme-demo`). The plan includes milestone `M-ROADMAP`, sprint `S-PILOT`, and the sample tasks `T-GUIDE` (“Prepare five interview questions”) and `T-INTERVIEW` (“Run five customer interviews”). Work was created through the CLI's planning operations. No task was claimed, finished, or otherwise changed during capture.
- Capture: from that project directory, run `bwrk dashboard` with `BOREAL_GLOBAL_ROOT` pointed at a separate disposable directory and `BOREAL_TUI_ENTRYPOINT` pointed at the built project dashboard entrypoint. Press `9` for Tasks, `]` to load the next service page, wait for the two task rows to render, capture the PTY output, then press `q`. `NO_COLOR` was unset so the normal dark palette was used.
- The displayed session is a local demo caller, not an Agent execution. The inspector visibly reports that the caller lacks the role required to claim work; no role was impersonated and no execution action was attempted.

## Global dashboard

- Image: [`boreal-global-dashboard-v10.png`](assets/boreal-global-dashboard-v10.png), SHA-256 `d461f7d57f48dc6e509297014f1aa4f32e1c0959112abae1a45938b361e5012d`.
- Source terminal output: [`boreal-global-dashboard-v10.ansi`](assets/boreal-global-dashboard-v10.ansi), SHA-256 `606866e0272765cbcce1f18ff482115e852339476c374fba5ab97c600f504ba7`.
- Source: the disposable global root contains the fictional project “Paper Birch Study” and three follow-ups (“Pack sample kit”, “Schedule greenhouse visit”, and “Review field notes”), created via the supported global-project and global-task CLI commands. No provider, network service, or user's project data was used.
- Capture: run `bwrk dashboard global` with `BOREAL_GLOBAL_ROOT` set to that disposable root and `BOREAL_GLOBAL_TUI_ENTRYPOINT` set to the built global dashboard entrypoint. The initial Home route is shown; the PTY output was saved before `q` exited the dashboard. `NO_COLOR` was unset.

Both images show candidate behavior and are not a claim that the candidate has been released. The README separately identifies the current `main` installation path and the candidate-only status.
