# Agent onboarding and the guided work loop

This guide connects a project Operator, enrolled workers, and the first
source-bound attempt. The Rust application remains the authority for project
scope, eligibility, revisions, roles, proof, and lifecycle changes. Commands
below are examples; use the current revision and exact action inputs returned
by Boreal for the selected project.

## Initialize and identify the operator

In the repository that should use Boreal, initialize the project and install
the project-local Codex and Claude skill adapters:

```sh
bwrk init --agents codex,claude --yes --json
bwrk status --json
```

Initialization creates or reuses the project Operator identity and its local
session. Use the project-local `boreal-route` skill as the supported agent's
entry point. Its short instruction is: **Use Boreal in this project and follow
its next eligible work until it returns idle or a concrete intervention.**
The agent calls `agent next` or `agent guide` without a bespoke goal prompt,
then follows one returned action and asks again after each transition.

Prefer the project's `.agents/skills/boreal-*` or `.claude/skills/boreal-*`
v2 adapters over global or legacy adapters. If a global adapter names an
unknown workflow ref or incompatible command schema, report that adapter and
continue only through the project-local v2 workflow. Do not remove unrelated
global skills.

## Enroll workers and reviewers

Create a separate Agent principal for each worker. `auth key` writes a private
enrollment file and does not grant authority. The saved Operator grants that
credential under the latest project revision:

```sh
bwrk auth key --actor WORKER_ID --actor-role agent --json
bwrk auth grant --input ENROLLMENT_PATH \
  --expected-revision REVISION --reason "Enroll project worker" --yes --json
```

Repeat for a Reviewer when the work's pinned acceptance profile requires
independent review. Use the `reviewer` role and a different actor from the
worker. Enroll a Publisher separately when project-memory publication is
delegated. Only the Operator issues grants; guidance and skills never grant
permissions. Refresh `bwrk status --json` after each mutation and use the
revision from its latest canonical result.

## Capture initial source and choose verifier configuration

An empty source bank requires Operator input. The Operator captures the exact
workspace snapshot through the public source route; do not keep listing an
empty bank or ask a worker to perform the Operator-only directory capture:

```sh
bwrk source add PROJECT_ID --input . --origin workspace \
  --expected-revision REVISION --json
bwrk source show PROJECT_ID SOURCE_VERSION_ID --json
```

Use the returned immutable `source_version_id` when preparing the verifier
policy for the work's pinned acceptance profile. The policy must reference
that exact snapshot, the required gate, a verifier whose digest is available
in the snapshot or explicitly captured `PATH`, and a new configuration
identity. Publish it as the Operator under the current project revision:

```sh
bwrk gate policy publish --project PROJECT_ID --gate GATE_ID \
  --input POLICY_JSON --expected-revision REVISION --yes --json
```

Keep the exact `config_identity` returned by policy publication. It is selected
from authoritative work/attempt policy state at claim and verification time;
the worker cannot replace it. If no eligible policy matches a required gate,
return an actionable Operator configuration request rather than claiming with
an arbitrary identity.

## Start the first worker attempt

Start a unique worker session for its supported harness, then request current
guidance. The actor uses its own enrollment and session, while the Operator's
source and configuration identities remain project-scoped:

```sh
bwrk session start --project PROJECT_ID --session SESSION_ID \
  --harness codex --actor WORKER_ID --json
bwrk agent next --project PROJECT_ID --actor WORKER_ID \
  --session SESSION_ID --harness codex --json
```

When Boreal selects new work, start it with the exact source version,
configuration identity, and project revision returned by the current
Operator/project setup and guidance:

```sh
bwrk agent start WORK_ID --project PROJECT_ID \
  --source-version SOURCE_VERSION_ID --config-identity CONFIG_ID \
  --expected-revision REVISION --session SESSION_ID \
  --actor WORKER_ID --harness codex --json
```

The claim pins immutable input provenance. After start, preserve the returned
work ID, attempt ID, fence, project/entity/proof revisions, actor, harness,
session, and transport on every guide, next, resume, and mutation request. A
restarted client calls `agent resume` for the existing session/current attempt;
it does not silently claim replacement work.

## Keep liveness and progress separate

The harness schedules two independent background operations at the cadence
returned by the current attempt/service:

- **Heartbeat** records process liveness.
- **Lease renewal** extends the renewable lease and is not implied by heartbeat.

Both timers continue while the agent is in a long tool call. The agent records
semantic progress through checkpoint operations. The harness confirms the
owned process has stopped before recovery releases its resources. An elapsed
heartbeat or lease alone is not proof that a process is dead; there is no
normal force-break path for live locks.

## Bind the produced result, verify, and finish

When implementation is ready for verification, leave the produced artifact
in its declared workspace/output. An authorized Operator captures that exact
artifact with public `source add` in the same project. The worker then binds
the registered source version and digest to its current attempt/fence using
the proof revision and operation identity returned by current guidance:

```sh
bwrk evidence bind-result --project PROJECT_ID --work WORK_ID \
  --attempt ATTEMPT_ID --fence FENCE --source-version RESULT_SOURCE_ID \
  --content-digest CONTENT_DIGEST \
  --expected-entity-revision ENTITY_REVISION \
  --expected-proof-revision PROOF_REVISION --operation OPERATION_ID \
  --actor WORKER_ID --session SESSION_ID --json
```

The binding revalidates the registered bytes and pinned configuration. It
preserves the original claim source while superseding proof tied to a previous
result. Run required gates against the bound result source, retain failed
receipts, and follow the selected review/wait/finish/release action. If a
mutation response is lost, read the durable operation receipt before retrying.
Close only after current proof, required independent review, immutable summary,
and the canonical finish action all read back as satisfied.

