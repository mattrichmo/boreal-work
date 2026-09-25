# Bounded evidence runner

`bwrk evidence run` runs a gate against an immutable workspace snapshot and a
project-published verifier policy. It never chooses policy from a live
`.boreal/gates` file.

## Capture and publish

An Operator captures the workspace directory as a bounded, immutable source
version:

```sh
bwrk source add PROJECT --input . --origin workspace --expected-revision REVISION
```

Directory capture produces the reserved media type
`application/vnd.boreal.workspace-snapshot.v1`. It contains sorted regular
files, preserves executable bits, excludes common generated directories and
credential files, rejects symlinks, and is limited to 100,000 files and
256 MiB. The returned source version ID is the snapshot identity used by an
attempt.

Create a reviewed policy JSON for that snapshot and publish it as a new
revision. Publication requires project Operator authority, `--yes`, and the
observed project revision; the revision is checked in the same transaction
that registers the immutable policy source.

```sh
bwrk gate policy publish --project PROJECT --gate verification \
  --input .boreal/gates/verification.json \
  --expected-revision REVISION --yes
```

The policy binds `policy_revision`, `gate_id`, the exact workspace source
version ID, a distinct `config_identity`, and the SHA-256 digest of the
verifier executable. A new revision must increment the gate's current
revision and use a new configuration identity. The publisher verifies the
snapshot archive and confirms that the pinned verifier bytes exist in that
snapshot or in the explicitly captured PATH before admitting the policy.
Generic `source add` cannot forge the reserved `gate-policy:` origin.

Evidence execution resolves the short gate key from the selected work item's
canonical gate ID, then selects exactly one published policy matching the
current attempt's configuration identity. It verifies the source catalog
against the project registration, unpacks the exact registered snapshot into
a private temporary directory, checks the verifier digest again, and runs
with that directory as the working tree. Wrong subject, gate, source,
configuration, revision, or verifier identity fails closed. The receipt
records the immutable policy version, policy revision, policy identity, and
verifier digest alongside the work, attempt, fence, profile, and output
identity.

## Policy shape

The following is a schema example only. Replace every placeholder with values
from the actual captured workspace and reviewed verifier; the all-zero digest
will not pass admission.

```json
{
  "gate_id": "verification",
  "policy_revision": 1,
  "kind": "verification",
  "executable": "./scripts/verify",
  "verifier_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "argv": ["./scripts/verify", "--ci"],
  "cwd": ".",
  "source_snapshot_hash": "SOURCE_VERSION_ID_FROM_SOURCE_ADD",
  "config_identity": "CONFIGURATION_IDENTITY",
  "environment_fingerprint": "computed-at-run-time",
  "environment_allowlist": ["PATH", "LANG", "LC_ALL", "TMPDIR", "CI"],
  "observables": ["verification"],
  "max_runtime_ms": 30000
}
```

The `--gate` argument may be the full canonical ID returned by status, such as
`TASK-17:verification`, or the short key `verification`. Canonical IDs are
matched to the selected work item exactly; they are never used as filenames.

The executable and argv are validated at the Rust application boundary. Shell
executables, shell metacharacters, parent-path arguments, oversized argv,
undeclared gates, unsafe environment variables, and verifier digest mismatch
fail closed. The CLI invokes the executable directly with `shell=false`, null
stdin, a captured workspace working directory, a bounded runtime, and bounded
combined output. Output is retained under `<db-parent>/evidence/` and
referenced by the structured receipt.

Timeout and failed execution facts remain failed receipts and cannot satisfy a
gate. A successful receipt is persisted through the normal application path;
when `--socket` is supplied, policy publication and evidence execution use
the versioned local service route. The bounded local output digest remains a
separate release-hardening concern from verifier identity.
