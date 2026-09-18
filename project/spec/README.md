# P0-03 contract fixtures

Owner: S00 architecture steward; P0-01 choices D13–D29 are approved. This
directory will contain versioned transition, status/time, dependency,
schema, protocol, CLI, receipt, guidance, workflow, and memory-publication
fixtures. It is not permission to implement a second state machine in the
CLI or TUI.

Begin with [STATUS_MODEL.md](../STATUS_MODEL.md),
[AGENT_LIFECYCLE.md](../AGENT_LIFECYCLE.md),
[INTERFACES.md](../INTERFACES.md),
[CLI_COMMANDS.md](../CLI_COMMANDS.md), and the
[S00 sprint](../../milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md).
Turn approved close-only dependency, two-hour default hard claim budget versus
renewable lease, profile-gated review, and durable close-intent policy into
versioned fixtures before persisted schema or command grammar depends on them.
Resolve ambiguous `verified`/`cancelled` migration cases explicitly. Include legal and
illegal examples, exact typed errors, source revision, and virtual-clock
cases. P0-05 reviews; P0-06 reconciles; P0-07 revalidates.

## Fixture index and validation

`manifest.json` freezes the P0-03 revision and cross-fixture versions. The
checked-in fixture families are:

- `transition-table.md` and `schema-v2.sql` for lifecycle, dependency,
  deadline, fencing, gate, revision, audit, source, and publication rules;
- `protocol/` for bounded envelopes, DTOs, receipts, gate diagnostics, and
  the typed error registry;
- `guidance/` for conditional/no-goal states, the trusted directive and gap
  registries, and the exact safe-argv policy;
- `workflows/` for packaged core route/context/plan/claim/finish/handoff/
  health/memory refs and finish criteria;
- repository `skills/` for the harness-neutral Codex/Claude adapters bound to
  those trusted workflow refs;
- `source-version/` and `memory-manifest.json` for provenance and Git
  publication authority.

Run the dependency-free structural gate from the v2 root:

```sh
python3 project/spec/validate_contracts.py
```

It checks JSON syntax, required envelope fields and outcome/error pairing,
trusted directive references, `shell: false` safe actions, required fixture
families, and that SQLite accepts `schema-v2.sql`. It is a P0-03 structural
check, not the independent P0-05 review or P0-07 transition/property gate.
