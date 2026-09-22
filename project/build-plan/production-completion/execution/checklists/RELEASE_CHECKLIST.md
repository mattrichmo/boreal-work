# Release and handover checklist

## Qualification

- [ ] Freeze the exact source, schema, protocol, toolchain, package, and binary
      identities.
- [ ] Run the required real-service lifecycle and isolation matrix.
- [ ] Run corruption, unknown-outcome, expiry, stale-fence, migration, and
      backup/restore scenarios.
- [ ] Run supported platform, terminal, installer, upgrade, rollback, and clean
      install checks using the absolute built artifacts.
- [ ] Separate fixture results from genuine service and release evidence.

## Release control

- [ ] Independent review and reconciliation are complete.
- [ ] All critical findings are fixed or explicitly rejected by release policy.
- [ ] Package inventory includes the complete TUI, installer, Rust binary,
      schemas, workflows, and documentation.
- [ ] Generated and embedded assets are byte-consistent.
- [ ] Publication authority is explicit and separate from implementation.
- [ ] Published hashes and channel availability are read back after publish.

## Handover

- [ ] Install and upgrade instructions use the new package identity.
- [ ] Rollback and database-compatibility limits are documented.
- [ ] Support owner, incident path, recovery commands, and retention policy are
      documented.
- [ ] Final report names accepted limitations and remaining non-goals.
- [ ] The final state is recorded only after PF-S20 and PF-S21 gates pass.
