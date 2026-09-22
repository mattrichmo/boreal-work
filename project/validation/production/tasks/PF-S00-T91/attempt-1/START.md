# PF-S00-T91 reconciliation attempt 1

- Worker: bounded reconciliation worker, separate from the T90 reviewer.
- Fixed input identity: `working-tree-aggregate:316566184c6d1b025c375edc810a70b99c70b623473044dd959ac7cd558d372a; HEAD:784a41b3802c29a76721c55eef2e9493283396c2; dirty`.
- Write boundary: this attempt directory plus the PF-S00 reconciliation outputs named by the task dispatch.
- Required disposition: reconcile every T90 finding without rewriting prior findings or evidence; preserve unresolved blockers and failed history.
- Scope exclusion: no source, plan, execution state, T90 artifact, prior evidence, live database, or product acceptance changes.
- Start condition: created before reading the assigned reconciliation inputs.
