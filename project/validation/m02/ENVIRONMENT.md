# Execution environment and source identity

Source ZIP SHA-256: `cc7353ea0bee23969982e47af54a4705fc2625df632c2ad818d6307d5dec7c39`.

Request SHA-256: `e521caa222c4f59ae732eb057419910824f3f00b66fb3bc32818d0b52d616795`.

Host: `Linux-6.18.44-x86_64-with-glibc2.41`. The uploaded archive was unpacked into an
isolated working tree. It contained no usable upstream Git history; local
baseline commit `7731b05` captures the supplied source, not an upstream SHA.
No original project database or user's globally installed binary was used.

Node: `v22.16.0`.
TypeScript: `Version 5.8.3`.
Python: `3.13.5`.

Cargo, rustc and rustfmt were not available on PATH or in the inspected
filesystem. Network/toolchain fetch attempts failed; no toolchain was
installed. The seven Cargo checks in `evidence/run-01/checks.json` each
record exit 127 / tool unavailable; no compiler diagnostic or passing Rust
test result is implied. Rust syntax, type correctness, formatting and runtime
behavior are therefore unverified. No claim is made about successful macOS,
BSD tar, signing, download, Linux ABI or production install compatibility.

No parallel code subagent, independent contract reviewer or separate service
operator was available. All source edits and the author review were serial.
An author review is not S00-T07, S01-T07 or any independent sprint gate.

No remote branch/tag/release was pushed or published. Real PTY tests use the
repository's explicitly local fake service/release fixtures. They do not
establish a genuine receipt, service lifecycle or release artifact success.
