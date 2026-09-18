# TUI PTY smoke

`pty_smoke.py` starts the current v2 service, launches the compiled TUI entrypoint
inside a POSIX pseudo-terminal, verifies the dashboard renders, sends `q`, and
checks that the interactive process exits cleanly. It uses the real Unix-socket
service boundary and is included in the full aggregate suite.

Restricted runners that deny Unix-domain sockets emit an explicit validation
skip; strict aggregate validation rejects that skip.
