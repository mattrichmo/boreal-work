# Packaged workflow assets

The checked-in package at `project/spec/workflows/` is the versioned guidance
boundary for Boreal v2's core route, context, planning, claim, finish, review,
audit, handoff, health, and memory workflows. It is package data, not a
second state machine.

## Validation

Run the standalone validator from the v2 package root:

```text
python3 project/spec/workflows/validator.py
python3 project/spec/workflows/validator.py --self-test
```

The validator is dependency-free and fail-closed. It checks:

- package and asset schema/version, identity, exact package membership, and a
  deterministic SHA-256 identity over the ordered asset metadata paths and
  exact asset bytes (metadata files are excluded to avoid a circular digest);
- unique, project-local workflow refs and resolvable `refs`/`next_refs`;
- strict object fields, typed input declarations, unique input names, and
  explicit required finish criteria;
- command strings without shell metacharacters, with `--json`, whose command
  family and flags are present in `project/spec/cli-contract.json`;
- the trusted `boreal.application.v2` state-authority boundary and the strict
  checked-in package policy; and
- unknown root JSON assets or malformed/unlisted package members.

It never executes an `allowed_commands` value. Those strings are safe command
shapes for guidance/rendering, not shell scripts.

## Authority and parity mapping

The package's `state_authority` and every asset's
`state_transition_owner` point to `boreal.application.v2`. The Rust
application workflow registry embeds these same package files, resolves the
metadata-to-asset identity, and exposes workflow data by ref. The domain and
application transition functions remain authoritative for lifecycle,
attempt/fence, dependency, evidence, review, and closeout decisions. A
workflow asset can describe the next safe action and its required inputs; it
cannot grant eligibility or write status.

The validator derives accepted command families and option names from the
versioned CLI parity contract. This keeps the package aligned with the
`bwrk` surface while retaining placeholders such as `<work_id>` as data. The
typed input and finish-criteria fields are the package's route metadata; the
application must still validate actual values, actor/session identity,
revision/fence, evidence, and policy at execution time.

## Honest limits

This is packaging groundwork, not proof of full workflow parity. The
validator does not prove that every command is implemented end-to-end, that a
client uses one application route, or that source/memory retrieval,
publication recovery, migration rollback, performance, fault, and security
acceptance are complete. The current package also does not replace the
independent parity review or unfamiliar-agent scripted acceptance. Those
remain release gates for P4-11 and the later validation work.
