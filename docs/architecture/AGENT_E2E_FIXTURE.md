# Agent E2E Fixture

This fixture is the source-controlled agent workflow smoke test for a clean local project. It is intentionally narrower than a live multi-repo audit: it proves that a single agent can initialize a project, promote raw material into memory, launch sprint work, claim and finish that work, refresh health artifacts, and export portable results without writing outside the selected workspace.

Every automated command in the fixture uses `--json`. Commands that produce files write under `.boreal/results/agent-e2e` or the configured local `memory/` vault. Raw source preview uses a workspace-relative raw URI so the exported project truth does not depend on another machine's absolute paths.

## Ordered Steps

| Step | Requires | Purpose |
| --- | --- | --- |
| `init` | `none` | Initialize local project and memory vault |
| `agent-guide` | `init` | Read the machine-readable agent command guide |
| `session-start` | `agent-guide` | Start a scoped agent session |
| `prime` | `session-start` | Prime the agent with current sync and queue state |
| `raw-add` | `prime` | Add immutable raw source material |
| `raw-show` | `raw-add` | Retrieve the raw source before promotion |
| `wiki-create` | `raw-show` | Reconcile raw material into source-backed wiki memory |
| `sprint-create` | `wiki-create` | Create the sprint container |
| `task-create` | `sprint-create` | Create source-backed sprint work |
| `dep-add` | `task-create` | Attach the work to the sprint graph |
| `work-ready` | `dep-add` | Mark only claimable work ready |
| `sprint-activate` | `work-ready` | Activate the sprint explicitly |
| `sprint-board` | `sprint-activate` | Verify the sprint board projection |
| `agent-start` | `sprint-board` | Claim the next ready work through agent start |
| `agent-finish` | `agent-start` | Finish with evidence, verification, close, and release |
| `sync-refresh` | `agent-finish` | Refresh generated collaboration artifacts |
| `doctor-strict` | `sync-refresh` | Run strict health verification |
| `export-json` | `doctor-strict` | Export portable JSON project truth |
| `export-markdown` | `export-json` | Export Markdown project truth |
| `export-ledgers` | `export-markdown` | Export JSONL ledger artifacts |
| `session-end` | `export-ledgers` | End the agent session with operation summary |

## Safety Contract

- Run the fixture only in a fresh temporary workspace or an explicitly selected disposable project.
- Use JSON responses as the only source of IDs for later commands.
- Keep generated export artifacts under `.boreal/results/agent-e2e`.
- Keep raw source URIs workspace-relative unless the test is explicitly about absolute path handling.
- Treat `sync refresh --json` followed by `doctor --strict --json` as the closeout health gate before exports.

## Verification

```bash
pnpm test -- tests/runtime/agent-e2e.test.ts
```

The test validates the step prerequisites, the Markdown instructions above, parsed JSON envelopes for every command, workspace-local generated paths, session operation order, strict doctor health, and portable exports that exclude local operation history.
