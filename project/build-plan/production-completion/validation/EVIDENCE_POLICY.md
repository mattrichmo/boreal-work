# Evidence, findings and release acceptance policy

## Required record

Every accepted task provides exact input/integrated source identity, allowed/changed files, commands with argv/cwd, tool versions, raw outcomes and artifact digests, applicable operation/receipt/review IDs, handoff, reviewer and remaining risks. Source-inspection findings explicitly say not reproduced when no runtime check occurred. A retained old pass never proves changed source. A generated context excerpt is a navigation aid, not a test result.

Evidence directories are append-only attempts: `project/validation/production/tasks/<TASK-ID>/attempt-<N>/`. Sprint review, reconciliation and revalidation have distinct records under `project/validation/production/sprints/<SPRINT-ID>/`. Raw inputs containing secrets must be protected and exported through redaction, not copied into public archives. Preserve immutable hashes/reference identity for authorized audit.

## Outcome vocabulary

`passed`: the stated assertion was actually exercised at its required layer and met. `failed`: exercised and violated. `blocked`: necessary prerequisite/input/tool is missing. `unsupported`: declared environment cannot execute the required case. `not_run`: not attempted. `not_applicable`: outside accepted scope with a documented rationale. Only passed satisfies a mandatory acceptance case. Compilation, a fixture count or a plausible screenshot is not a substitute for the declared outcome.

## Findings and disposition

Critical findings threaten cross-project isolation, unauthorized mutation, false acceptance, stale execution safety, unrecoverable data/history loss or package substitution. High findings make mandatory workflow/recovery unreliable or unavailable. Medium/low findings still need disposition; their naming is not authority to defer a required requirement. Severity must include reproduction and impact, not inflated rhetoric.

Each finding is fixed, justified no_change, or explicitly deferred only when outside mandatory acceptance. Provide owner, bounded task, evidence and required reruns. No arbitrary `--force`, changed status field, rewritten receipt, deleted failure or reduced threshold makes a safety finding resolved.

## Review independence

Name the actual reviewer and their relationship to implementation. A separate process using the same unauthenticated principal does not by itself establish product review independence. For the development plan's independent gate, use a person/agent that did not implement the reviewed change and can inspect the real diff/evidence. For product review, enforce the frozen principal/delegation policy. Missing review capability blocks acceptance.

## Release binding

Release approval names exact source, contracts, schema/runtime, binary and asset/package hashes plus native and published-channel evidence. Changing qualified bytes invalidates that artifact's qualification until required reruns occur. Approval does not imply authorization to publish externally; publication tasks require the latter explicitly.
