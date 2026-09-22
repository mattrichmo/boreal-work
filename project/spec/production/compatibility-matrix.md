# Protocol and compatibility evolution matrix

**Current baseline:** protocol 2, envelope/schema families from
`project/spec/protocol/protocol-manifest.json`.
**Target additions:** status/3, acceptance/2, work-model/3, cycle/1,
service/2, and external-job/readback fields.

| Client | Service | Reads | Mutations | Required behavior |
| --- | --- | --- | --- | --- |
| 2.x | 2.x | supported | supported for negotiated capabilities | authoritative application contract |
| 2.x | 3.x | supported through additive downgrade | only status/2-compatible actions | map `scheduled` to queued with reason; disable unknown action writes |
| 3.x | 2.x | legacy fields only | fail closed for cycle/status/3/profile/job writes | client cannot reconstruct omitted policy |
| 3.x | 3.x | full | full negotiated contract | exact capability/schema/enum checks |
| any | incompatible major/unknown required enum | bounded diagnostics only | none | `protocol_mismatch`, upgrade/downgrade as a unit |
| offline maintenance | compatible local binary/schema | same application snapshot rules | same Rust use cases under exclusive boundary | never a second state machine |

Compatibility is negotiated by API version, protocol/schema versions,
capability IDs, database schema version, restore epoch, and binary/assets
manifest. A client may use an older read projection only when the service
returns an explicit mapping and marks unsupported fields. It cannot claim
claimability, closeout, cycle assignment, review, or acceptance using fields it
does not understand.

## Additive field rules

- New optional response fields are ignored by older clients only when they do
  not alter old semantics; they are never interpreted as authority.
- New required request fields require a new capability/version and fail closed
  when absent.
- New enum values require a negotiated schema; otherwise the client maps only
  the documented safe read label and disables mutation.
- Removing or changing the meaning of an outcome/error/status is a major
  incompatibility, not a fixture update.
- Every downgrade mapping names loss of fidelity, action restrictions, and
  readback behavior. A status/3 `integrity=quarantined` maps to status/2
  `blocked` with `integrity_quarantined`; `scheduled` maps to queued with a
  scheduled reason; unknown availability disables mutations.

## Database and artifact evolution

Binary compatibility is separate from database migration. The installer
checks an assets/binary manifest and supported schema range before activation.
An old binary cannot open a newer incompatible database; rollback first
restores a compatible binary or completes a supported downgrade migration.
Changing protocol or TUI assets alone does not update the Rust embedded
installer payload. A package activation is atomic at the manifest level and
retains the prior package for rollback.

Attempts pin executable/protocol/schema identity. An upgrade pauses or safely
reconciles active operations, does not rebase current proof, and resumes only
after the compatibility matrix passes. A database restore changes restore
epoch and fences stale operations.

## Acceptance fixtures

The implementation/release gates must include envelope success/empty/conflict/
busy/stale/unavailable/unknown fixtures, unknown field/enum behavior,
status/2 and status/3 mapping, capability negotiation, N/N-1 read/mutation
denials, side-effect crash readback, package manifest mismatch, migration
rollback, active-attempt upgrade, and offline maintenance election. Fixture
success is not genuine service/release acceptance; the exact built binary,
service, database, and package identities are recorded separately.
