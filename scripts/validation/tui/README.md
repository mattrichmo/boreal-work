# TUI PTY smoke

`pty_smoke.py` starts the current v2 service, launches the compiled TUI entrypoint
inside a POSIX pseudo-terminal, verifies the dashboard renders, sends `q`, and
checks that the interactive process exits cleanly. It uses the real Unix-socket
service boundary and is included in the full aggregate suite.

Restricted runners that deny Unix-domain sockets emit an explicit validation
skip; strict aggregate validation rejects that skip.

## Forensic V04/V06/V07 fixture

`forensic_closeout.mjs` is the production-composition fixture for the TUI-owned
forensic gates. It creates an isolated SQLite fixture, starts the real
`target/debug/bwrk service run` host, validates live status DTOs through the
compiled TypeScript client, injects the three debug evidence failpoints,
restarts and reads back each operation, and drives the compiled full-screen
controller through a typed closeout followed by a deliberate refresh failure.

Run it from the repository root with Unix-socket/process permission:

```sh
node scripts/validation/tui/forensic_closeout.mjs
```

The fixture writes `results/forensic-closeout.latest.json` and
`results/forensic-closeout.latest.md`. The closeout readback currently needs a
validation-side DTO normalization because `operation_show` exposes the stored
`Verification` enum and canonical `WORK:verification` gate spelling, while the
`ReceiptDto` ingress accepts lowercase `verification` and the short gate name.
The raw spelling is retained in the report; this is evidence of a remaining
service/protocol compatibility gap, not a skipped environment check.
