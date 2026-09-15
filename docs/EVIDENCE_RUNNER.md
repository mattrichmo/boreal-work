# Bounded evidence runner

`bwrk evidence run` executes only a project-local, policy-declared gate. The
declaration lives at `<db-parent>/gates/<gate-id>.json`; for the default
database this is `.boreal/gates/<gate-id>.json`.

```json
{
  "gate_id": "verification",
  "kind": "verification",
  "executable": "true",
  "argv": ["true"],
  "cwd": ".",
  "source_snapshot_hash": "sha256:source-v1",
  "config_identity": "sha256:config-v1",
  "environment_fingerprint": "env-v1",
  "observables": ["verification"],
  "max_runtime_ms": 30000
}
```

The executable and argv are validated by the Rust application boundary. Shell
executables, shell metacharacters, parent-path arguments, oversized argv, and
undeclared gates fail closed. The CLI invokes the executable directly with
`shell=false`, null stdin, a project-scoped working directory, a bounded
runtime, and bounded combined output. Output is retained under
`<db-parent>/evidence/` and referenced by the structured receipt.

The runner records the operation, work/attempt/fence, gate/profile, source and
config identities, command, cwd, timestamps, attestation, output digest/ref,
and typed execution result. Timeout and failed execution facts remain failed
receipts and cannot satisfy a gate. A successful receipt is then persisted by
the normal application path; when `--socket` is supplied, execution and
persistence use the versioned local service route.

This first implementation uses a deterministic `fnv1a64:` output digest as a
bounded local identity. Cryptographic output hashing and streaming subprocess
resource enforcement remain release-hardening work for P5.
