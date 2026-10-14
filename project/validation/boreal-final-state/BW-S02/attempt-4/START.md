# BW-S02-T90 acceptance rerun — attempt 4

- Acceptance source: `d1f8ae0b5d42c1886df5bba04930f3692d63e6ef`.
- Worktree: isolated Codex worktree `/Users/cybertron/.codex/worktrees/s02-t90-current-head/boreal-work`, detached at the exact source commit.
- Source parent: `d6ca9c457c96ec6f9e794567702d88de4a5032be`.
- Initial working tree: clean.
- Prior evidence preserved: attempt 1 in the parent report/logs, attempt 2, and attempt 3 are unchanged.
- Scope: run the BW-S02-T90 sprint acceptance matrix against this exact source, preserve raw outputs in this directory, and report unsupported/CI-only gates. No runtime plan state, CI/release workflow, push, or merge action is authorized.
- Production write boundary: only `crates/store/src/work_model_v3.rs` and `crates/store/tests/production_store_seams.rs` may be edited, and only if a validated S02 regression requires a focused fix. No fix is assumed.
