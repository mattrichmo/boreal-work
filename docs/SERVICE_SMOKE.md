# Local service smoke proof

`bash scripts/service-smoke.sh` creates a fresh temporary SQLite project and
exercises the real CLI-owned Unix-socket service in two bounded lifetimes:

1. A reader sees three ready tasks and three independent
   actor/harness/session client processes claim one task each.
2. The first host exits cleanly at `--max-requests 4`.
3. A restarted host accepts two fenced releases and one fenced
   `agent finish --release`, and a reader sees all three tasks ready again,
   while the released attempts remain historical.

The script checks the service request counts and typed JSON outcomes, then
removes the exact temporary fixture. Unix-domain socket creation may require
an elevated runner in restricted sandboxes. This is a service/claim/release
proof; structured evidence execution and proof-gated closeout remain separate
release gates.
