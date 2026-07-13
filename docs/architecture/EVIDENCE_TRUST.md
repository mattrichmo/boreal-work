# Evidence Trust And Attestation Contract

Boreal separates what an evidence record says from how strongly the system can trust that observation. `outcome: passed` is a result claim; `attestation.trustLevel` describes its provenance.

## Trust Levels

| Level | Meaning | May be inferred? |
| --- | --- | --- |
| `legacy_unattested` | A readable historical record created before attestations existed | Yes, only when `attestation` is absent |
| `self_reported` | A human, agent, or system submitted the observation; Boreal did not execute or independently verify it | New manual evidence defaults here |
| `boreal_witnessed` | A bounded Boreal execution boundary observed the command and outputs | Never; requires a Boreal witness record |
| `external_attested` | An external CI/human authority supplied an identity and result URI | Never; requires witness plus external identity |

Missing attestation data is never upgraded based on a passed outcome, command string, URI, actor kind, import source, or Git history. `evidenceTrustLevel(record)` derives missing legacy records as `legacy_unattested`; imports preserve their original shape.

## Published Record Contract

`schemas/records/evidence-record.schema.json` publishes optional `boreal.evidence-attestation.v1` data with:

- producer actor, optional tool/system name, and version;
- witness kind, identity, issuer, recorded and witnessed timestamps;
- subject revision content hash and update timestamp;
- platform, architecture, Node version, and hashed working directory;
- hashed command identity, timing, duration, exit/signal, timeout, cancellation, and observable-match state;
- stdout/stderr hashes, byte counts, bounded excerpts, and truncation state;
- Git branch, HEAD, dirty fingerprint, and dirty-file count;
- Boreal, Git, Node, and invoked-tool versions plus hashed artifact paths/content;
- external issuer, result URI, attestation ID, and verification status.

The attestation is optional only for backward compatibility. `recordEvidence` creates new ordinary evidence as `self_reported` with the submitting actor as producer. Later witnessed-execution and CI adapters must supply the stronger shape explicitly.

## Safety Invariants

- Trust level is independent of `kind` and `outcome`.
- `boreal_witnessed` requires `witness.kind: boreal`.
- `external_attested` requires both a witness and an external identity.
- Commands and filesystem paths are represented by hashes in the attestation; redacted display text remains separate.
- Producer and witness are distinct identities. An agent cannot call itself a Boreal witness merely by submitting evidence.
- Subject revision and output hashes are immutable inputs to the evidence content hash and deterministic ID.

Verification remains backward compatible until a gate explicitly configures `requiredTrustLevels`, `requireCurrentRevision`, or `requireCurrentGitHead`. Once configured, both `work verify` and closeout fail atomically when selected evidence is weak, failed/interrupted, externally unverified, tied to an older work revision, or tied to a different Git checkpoint. Typed gaps include a concrete `bwrk evidence run ...` rerun command.

## Witnessed And External Evidence

`bwrk evidence run <work-ref>` selects exactly one declared closeout gate and records a Boreal witness. Success and failure use the same durable record path: failed exit, timeout, cancellation, observable mismatch, or capture truncation remains inspectable with `outcome: failed` and cannot satisfy a passed gate. The runner records bounded excerpts for operators while hashes and total byte counts cover the observed streams.

`bwrk evidence add ... --attestation external-ci|human` imports external proof without relabeling it as Boreal-witnessed. Issuer, result URI, attestation identity, subject revision, and verification status are preserved. An external result satisfies a trust gate only when its status is `verified` and any configured revision policy matches.

CLI JSON returns the full attestation. Console gate details expose required trust/revision/Git freshness, Markdown evidence exports retain provenance and execution state, and `evidence.recorded` events carry trust level, subject revision, Git HEAD, and external verification status for the local operation trace.

The approved execution boundary is documented in [Tier 2 execute-at-close gates](../decisions/tier-2-execute-at-close-gates.md). It parses only a required gate's declared command, never invokes a shell, restricts executables and environment keys, confines cwd to the workspace, supports dry-run preview and cancellation, and delegates timeout/output enforcement to the bounded process runner.
