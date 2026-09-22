# Integration steward checklist

- [ ] Confirm the incoming patch is based on the accepted input identity.
- [ ] Inspect the complete diff, not only the worker's summary.
- [ ] Verify every changed path is in the task write set or has an approved
      integration request.
- [ ] Serialize changes to protected roots, schema order, protocol models,
      command registries, workflow manifests, generated assets, and release
      manifests.
- [ ] Confirm new modules are registered and reachable by the production path.
- [ ] Check migration checksums, protocol compatibility, and fixture versions.
- [ ] Reconcile overlapping changes without dropping failed evidence or
      silently changing contract semantics.
- [ ] Run focused checks for every affected stream.
- [ ] Run combined-tree format, compile, test, and structural checks required by
      the task or sprint gate.
- [ ] Record the integrated source identity, commands, outputs, and limitations.
- [ ] Send the exact combined tree to an independent reviewer.
- [ ] Do not update `STATE.json` to accepted until the gate evidence exists.
