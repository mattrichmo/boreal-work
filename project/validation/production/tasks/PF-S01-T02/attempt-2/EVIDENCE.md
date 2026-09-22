# PF-S01-T02 attempt 2 — evidence

The contract separates project/workspace/database/service/principal/role,
session/delegation, operation, and attempt/fence identities. It defines
snapshot/entity/proof/attempt/restore/service revisions, role and credential
limits, operation digest and unknown-readback rules, and distinct wrong-
project, wrong-principal, stale revision, stale fence, and restore cases.

It preserves D20/D21/D22/D27 lease/budget/expiry/close-intent semantics and
states that same-user filesystem tampering is outside the claimed threat
boundary. The artifact remains a proposed contract; the current source and
full native/service matrix are not claimed complete.

Changed product path:

- `project/spec/production/identity-revisions-authority.md`

The first independent review rejected the initial draft for transport outcome
vocabulary drift, incomplete credential lifecycle authority/effects, and
partial decision/baseline traceability; that review is preserved in
`REVIEW-ANSCOMBE.md`. The artifact was amended to map durable outcomes to the
authoritative interface envelope, define enrollment/rotation/revocation and
their invalidation effects, and identify omitted decision impacts, owners, and
acceptance fixtures. Contract validation and the Markdown/whitespace checks
were rerun after the amendment.

The independent PF-S01 review/reconciliation/revalidation chain remains
required.
