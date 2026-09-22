# PF-S01-T09 attempt 2 — independent contract re-review

Reviewer: independent review (Dirac)
Scope: registered T09 contract artifact, attempt-2 evidence, prior Dirac review, and the named T09/T08/release references
Decision: ACCEPTED at the contract boundary

## Prior finding closure

- **T09-2-R1 closed.** The contract fixes raw-source, intake-operation,
  receipt, stdout/stderr, artifact-reference, nesting, evidence-item,
  inline-detail, and authorized-detail limits. Oversize input retains its
  request/output digest and receives typed rejection or an explicitly marked
  untrusted overflow detail reference; truncation cannot become proof.
  Anchors: `release-support-and-budgets.md:138-149`.
- **T09-2-R2 closed.** Verifier ownership is limited to the admitted identity
  and recorded process group; root/group identity, descendants, command/cwd,
  signals, remaining descendants, resource disposition, and recovery state are
  observable. Graceful cleanup is 5 seconds, escalation is authorized only
  after that grace period, and the final deadline is 30 seconds. Unsupported
  process-group primitives are an `unsupported` result, not a pass; remaining
  descendants block reuse and create recovery work.
  Anchors: `release-support-and-budgets.md:150-160`.
- **T09-2-R3 closed.** Credential policy names macOS Keychain and Linux
  user-scoped Secret Service/libsecret, forbids plaintext and environment
  fallbacks, limits database storage to references, and constrains optional
  bootstrap files. `audit.read`, membership, redaction-before-persistence/
  transport, revocation revision, operation-ID readback, authorized/denied/
  revoked reads, and redaction scans are explicit.
  Anchors: `release-support-and-budgets.md:162-181`.
- **T09-2-R4 closed.** The new traceability table explicitly covers T08
  envelope use, protocol/error registry, schema/migration identities, release
  manifest/package impact, and evidence surfaces, with named owner/gate
  follow-up. It records that T09 makes no implementation change and states
  the baseline discrepancy without relabeling historical or fixture results.
  Anchors: `release-support-and-budgets.md:268-289`.

## T09 completeness check

- Supported targets and install modes match the existing release workflow:
  macOS 14 arm64, macOS 13 Intel, and Ubuntu 22.04 x86_64 GNU/Linux;
  `.github/workflows/release.yml:39-46` and
  `release-support-and-budgets.md:22-36`.
- Resource budgets are fixed and measurable for dashboard, bounded reads,
  queue admission, transaction hold, heartbeat fairness, reconnect, retained
  history, and offline view; workload, threshold, and observable are stated:
  `release-support-and-budgets.md:69-89`.
- Security, source/receipt, process, credential, path, secret, authority,
  proof, isolation, quarantine, workflow, and live-lock boundaries are
  explicit, with nonwaivable critical failures and unsupported dispositions:
  `release-support-and-budgets.md:91-181`.
- Artifact signing/authentication disposition, checksums, dependency audit,
  linked SQLite floor, reproducibility, backup consistency, RPO/RTO, restore
  identity, upgrade, rollback, and required evidence are specified:
  `release-support-and-budgets.md:183-251`.
- Thresholds are fixed before measurement and may change only through a
  reviewed DEC-11 amendment with rationale, migration/release impact, and a
  new baseline: `release-support-and-budgets.md:43-67,253-260`.
- Evidence correctly distinguishes `pass`, `fail`, `unsupported`,
  `unmeasured`, and `not_applicable`; the attempt records native,
  multi-process, signing, backup/restore, and supported-target checks as not
  run and makes no product or release claim:
  `release-support-and-budgets.md:50-60`; `COMMANDS.md:6-14`;
  `EVIDENCE.md:19-35`.
- The changed product path remains the registered T09 artifact only, and the
  prior attempt remains preserved: `EVIDENCE.md:28-35`; `HANDOFF.md:9-18`.

## Decision and boundary

The amended artifact is sufficient and internally coherent for PF-S01-T09’s
contract-authoring boundary. Accept this review as independent contract
review evidence, subject to the coordinator’s lifecycle recording and the
PF-S01 reconciliation/revalidation gates.

This decision does not claim implementation, service, native-platform,
backup/restore, package-installation, signing, performance, or production
release acceptance. Those remain governed by the named owner/gate rows and
the exact artifact-level evidence requirements.
