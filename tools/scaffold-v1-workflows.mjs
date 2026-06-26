import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const workflows = [
  ["00-agent", "agent-session", "boreal.workflow.agent-session.v1", "Agent Session", "Start, guide, and close a scoped Boreal agent session.", ["prime", "agent guide", "session start", "session end", "operation list", "sync status", "doctor"], ["session-closeout"]],
  ["00-agent", "install-skills", "boreal.workflow.install-skills.v1", "Install Skills", "Install or refresh scoped Codex and Claude skills for one project.", ["init", "vault init", "doctor"], []],
  ["00-agent", "route-request", "boreal.workflow.route-request.v1", "Route Request", "Classify the user ask and select the narrowest workflow before acting.", ["commands", "prime", "work list", "context search", "search query"], []],
  ["10-context", "retrieve-project-context", "boreal.workflow.retrieve-project-context.v1", "Retrieve Project Context", "Collect current project state without mutating memory.", ["prime", "sync status", "work list", "context search", "search query", "decision list", "claim list"], []],
  ["10-context", "retrieve-raw-source", "boreal.workflow.retrieve-raw-source.v1", "Retrieve Raw Source", "Find immutable raw/source material before summarizing or reconciling it.", ["vault status", "source list", "source show", "search query"], ["raw-source-summary"]],
  ["10-context", "retrieve-work-state", "boreal.workflow.retrieve-work-state.v1", "Retrieve Work State", "Inspect tasks, issues, sprints, milestones, reservations, and blockers.", ["work list", "work show", "work next", "dep tree", "dep cycles", "reservation list"], []],
  ["10-context", "retrieve-decision-history", "boreal.workflow.retrieve-decision-history.v1", "Retrieve Decision History", "Find prior decisions, accepted claims, and evidence before proposing changes.", ["decision list", "decision show", "claim list", "claim show", "context search", "search query"], ["decision-record"]],
  ["20-memory", "add-raw-source", "boreal.workflow.add-raw-source.v1", "Add Raw Source", "Add immutable source material into the project inbox without rewriting memory.", ["vault init", "raw add", "source add", "search index", "doctor"], ["raw-source-summary"]],
  ["20-memory", "triage-raw-inbox", "boreal.workflow.triage-raw-inbox.v1", "Triage Raw Inbox", "Review raw inbox items and decide whether to reconcile, defer, or reject.", ["vault status", "search query", "context search", "work create", "claim create"], ["raw-source-summary", "discovery-report"]],
  ["20-memory", "reconcile-raw-to-memory", "boreal.workflow.reconcile-raw-to-memory.v1", "Reconcile Raw To Memory", "Promote raw source material into stable wiki, claim, decision, or work records.", ["raw add", "source add", "wiki create", "claim create", "decision create", "evidence add", "context rebuild", "search index", "doctor"], ["memory-reconciliation", "wiki-page", "claim-review", "decision-record"]],
  ["20-memory", "add-memory", "boreal.workflow.add-memory.v1", "Add Memory", "Create new durable memory when no existing record already covers the fact.", ["source add", "wiki create", "claim create", "decision create", "evidence add", "context rebuild", "search index", "doctor"], ["memory-reconciliation", "wiki-page"]],
  ["20-memory", "update-memory", "boreal.workflow.update-memory.v1", "Update Memory", "Revise existing memory by checking old truth, source support, and conflicts first.", ["context search", "search query", "duplicate scan", "merge plan", "merge apply", "wiki create", "decision create", "doctor"], ["memory-reconciliation"]],
  ["20-memory", "reconcile-chat-thread", "boreal.workflow.reconcile-chat-thread.v1", "Reconcile Chat Thread", "Extract durable project facts, decisions, and work from the current conversation.", ["raw add", "wiki create", "claim create", "decision create", "work create", "evidence add", "doctor"], ["thread-reconciliation", "memory-reconciliation"]],
  ["20-memory", "stale-truth-audit", "boreal.workflow.stale-truth-audit.v1", "Stale Truth Audit", "Find memory that may be outdated, unsupported, or contradicted by repo truth.", ["context search", "search query", "claim list", "decision list", "doctor", "work create"], ["claim-review", "discovery-report"]],
  ["20-memory", "contradiction-resolution", "boreal.workflow.contradiction-resolution.v1", "Contradiction Resolution", "Resolve conflicting claims or decisions without deleting source-backed history.", ["claim list", "claim show", "decision list", "decision show", "decision create", "wiki create", "evidence add", "doctor"], ["claim-review", "decision-record"]],
  ["30-knowledge", "create-wiki-page", "boreal.workflow.create-wiki-page.v1", "Create Wiki Page", "Write a new stable wiki page from source-backed project truth.", ["wiki create", "source show", "claim create", "context rebuild", "search index", "doctor"], ["wiki-page"]],
  ["30-knowledge", "update-wiki-page", "boreal.workflow.update-wiki-page.v1", "Update Wiki Page", "Update wiki truth after checking existing pages, source refs, and backlinks.", ["context search", "search query", "wiki create", "claim create", "decision create", "doctor"], ["wiki-page", "memory-reconciliation"]],
  ["30-knowledge", "create-claim", "boreal.workflow.create-claim.v1", "Create Claim", "Capture a source-backed assertion that should be reviewable later.", ["source show", "evidence add", "claim create", "doctor"], ["claim-review"]],
  ["30-knowledge", "review-claim", "boreal.workflow.review-claim.v1", "Review Claim", "Accept, reject, or mark claims stale based on current evidence.", ["claim list", "claim show", "evidence add", "work create", "doctor"], ["claim-review"]],
  ["30-knowledge", "capture-decision", "boreal.workflow.capture-decision.v1", "Capture Decision", "Record an architectural or product decision with context and consequences.", ["decision create", "source add", "evidence add", "wiki create", "doctor"], ["decision-record"]],
  ["30-knowledge", "supersede-decision", "boreal.workflow.supersede-decision.v1", "Supersede Decision", "Record a replacement decision without erasing the older rationale.", ["decision list", "decision show", "decision create", "wiki create", "evidence add", "doctor"], ["decision-record"]],
  ["30-knowledge", "attach-evidence", "boreal.workflow.attach-evidence.v1", "Attach Evidence", "Attach command, test, diff, review, artifact, or note evidence to work or knowledge.", ["evidence add", "work verify", "agent finish", "doctor"], ["evidence-note", "verification-note"]],
  ["40-work", "create-work-structure", "boreal.workflow.create-work-structure.v1", "Create Work Structure", "Create issues, tasks, sprints, milestones, and dependencies from a plan.", ["work create", "work ready", "dep add", "dep tree", "doctor"], ["work-structure"]],
  ["40-work", "update-work-structure", "boreal.workflow.update-work-structure.v1", "Update Work Structure", "Revise tasks, phases, dependencies, and readiness as reality changes.", ["work show", "work list", "dep add", "dep remove", "merge plan", "compact analyze", "doctor"], ["work-structure"]],
  ["40-work", "discovery-to-work", "boreal.workflow.discovery-to-work.v1", "Discovery To Work", "Convert verified discoveries or audit findings into actionable work.", ["raw add", "claim create", "work create", "dep add", "work ready", "doctor"], ["discovery-report", "work-item"]],
  ["40-work", "launch-sprint", "boreal.workflow.launch-sprint.v1", "Launch Sprint", "Create a scoped sprint with tasks, dependencies, gates, and session context.", ["session start", "prime", "work create", "dep add", "work ready", "doctor"], ["sprint-plan", "work-structure"]],
  ["40-work", "split-work", "boreal.workflow.split-work.v1", "Split Work", "Break oversized work into smaller tasks while preserving evidence and dependencies.", ["work show", "work create", "dep add", "dep remove", "evidence add", "doctor"], ["work-structure"]],
  ["40-work", "link-dependencies", "boreal.workflow.link-dependencies.v1", "Link Dependencies", "Add, remove, and audit dependency edges between work items.", ["dep add", "dep remove", "dep tree", "dep cycles", "work show", "doctor"], []],
  ["40-work", "claim-and-finish-work", "boreal.workflow.claim-and-finish-work.v1", "Claim And Finish Work", "Claim work, gather evidence, verify, and close or release it safely.", ["agent start", "work claim", "agent finish", "evidence add", "work verify", "work close", "doctor"], ["evidence-note", "verification-note", "session-closeout"]],
  ["40-work", "closeout-work", "boreal.workflow.closeout-work.v1", "Closeout Work", "Close completed work with evidence, verification, and next-action capture.", ["work show", "evidence add", "work verify", "work close", "session end", "doctor"], ["verification-note", "session-closeout"]],
  ["50-handoff", "build-handoff", "boreal.workflow.build-handoff.v1", "Build Handoff", "Create a compact handoff for another agent or human.", ["prime", "work list", "operation list", "context search", "sync status"], ["handoff-summary"]],
  ["50-handoff", "session-closeout", "boreal.workflow.session-closeout.v1", "Session Closeout", "Summarize a session, active reservations, failures, and next actions.", ["session end", "operation list", "reservation list", "sync status", "doctor"], ["session-closeout"]],
  ["50-handoff", "project-closeout", "boreal.workflow.project-closeout.v1", "Project Closeout", "Summarize project status, memory health, ledgers, and remaining risks.", ["sync status", "doctor", "export ledgers", "work list", "decision list"], ["project-closeout"]],
  ["60-health", "sync-and-doctor", "boreal.workflow.sync-and-doctor.v1", "Sync And Doctor", "Check workspace health and run safe repairs only when explicit.", ["sync status", "doctor", "search index", "context rebuild", "lock inspect"], []],
  ["60-health", "ledger-export-import", "boreal.workflow.ledger-export-import.v1", "Ledger Export Import", "Export, inspect, import, and verify JSONL ledgers for collaboration.", ["export ledgers", "import ledgers", "ledger status", "sync status", "doctor"], []],
  ["60-health", "duplicate-merge", "boreal.workflow.duplicate-merge.v1", "Duplicate Merge", "Detect duplicates and apply reviewed merge plans without source loss.", ["duplicate scan", "merge plan", "merge apply", "doctor"], []],
  ["60-health", "compact-memory", "boreal.workflow.compact-memory.v1", "Compact Memory", "Compact old closed work or vault pages while preserving evidence and source refs.", ["compact analyze", "compact apply", "export ledgers", "doctor"], ["handoff-summary"]],
  ["60-health", "recover-from-failure", "boreal.workflow.recover-from-failure.v1", "Recover From Failure", "Recover from stale locks, stale indexes, failed imports, or partial local artifacts.", ["doctor", "lock inspect", "lock break", "search index", "context rebuild", "sync status"], ["discovery-report"]]
];

const templates = [
  ["raw-source-summary", "Raw Source Summary"],
  ["memory-reconciliation", "Memory Reconciliation"],
  ["wiki-page", "Wiki Page"],
  ["claim-review", "Claim Review"],
  ["decision-record", "Decision Record"],
  ["discovery-report", "Discovery Report"],
  ["work-structure", "Work Structure"],
  ["work-item", "Work Item"],
  ["sprint-plan", "Sprint Plan"],
  ["evidence-note", "Evidence Note"],
  ["verification-note", "Verification Note"],
  ["handoff-summary", "Handoff Summary"],
  ["session-closeout", "Session Closeout"],
  ["project-closeout", "Project Closeout"],
  ["thread-reconciliation", "Thread Reconciliation"]
];

const skills = [
  ["router", "Boreal Router", ["00-agent/route-request.md"]],
  ["agent-session", "Boreal Agent Session", ["00-agent/agent-session.md"]],
  ["project-context", "Boreal Project Context", ["10-context/retrieve-project-context.md", "10-context/retrieve-work-state.md", "10-context/retrieve-decision-history.md"]],
  ["raw-inbox", "Boreal Raw Inbox", ["20-memory/add-raw-source.md", "20-memory/triage-raw-inbox.md", "10-context/retrieve-raw-source.md"]],
  ["memory-reconcile", "Boreal Memory Reconcile", ["20-memory/reconcile-raw-to-memory.md", "20-memory/update-memory.md", "20-memory/reconcile-chat-thread.md"]],
  ["wiki-claim-decision", "Boreal Wiki Claim Decision", ["30-knowledge/create-wiki-page.md", "30-knowledge/create-claim.md", "30-knowledge/capture-decision.md", "30-knowledge/supersede-decision.md"]],
  ["work-planning", "Boreal Work Planning", ["40-work/create-work-structure.md", "40-work/update-work-structure.md", "40-work/discovery-to-work.md"]],
  ["sprint-launch", "Boreal Sprint Launch", ["40-work/launch-sprint.md"]],
  ["work-execution", "Boreal Work Execution", ["40-work/claim-and-finish-work.md", "40-work/closeout-work.md", "40-work/link-dependencies.md"]],
  ["handoff-builder", "Boreal Handoff Builder", ["50-handoff/build-handoff.md", "50-handoff/session-closeout.md", "50-handoff/project-closeout.md"]],
  ["health-doctor", "Boreal Health Doctor", ["60-health/sync-and-doctor.md", "60-health/ledger-export-import.md", "60-health/recover-from-failure.md"]]
];

const docs = new Map([
  ["docs/product/V1_WORKFLOWS.md", productDoc()],
  ["docs/architecture/PROJECT_SETUP.md", projectSetupDoc()],
  ["docs/architecture/SKILLS_AND_WORKFLOWS.md", skillsArchitectureDoc()],
  ["workflows/README.md", workflowsReadme()],
  ["workflows/_workflow-template.md", workflowTemplate()],
  ["templates/README.md", templatesReadme()]
]);

for (const [group, slug, id, title, purpose, commands, templateIds] of workflows) {
  docs.set(join("workflows", group, `${slug}.md`), workflowDoc({ group, slug, id, title, purpose, commands, templateIds }));
}

for (const [slug, title] of templates) {
  docs.set(join("templates", `${slug}.md`), templateDoc(slug, title));
}

for (const [slug, title, workflowRefs] of skills) {
  docs.set(join("skills", slug, "SKILL.md"), skillDoc(slug, title, workflowRefs));
}

for (const [path, content] of docs) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content.trimEnd()}\n`, "utf8");
}

function workflowDoc({ group, slug, id, title, purpose, commands, templateIds }) {
  return `---
id: ${id}
title: ${title}
group: ${group}
status: v1
risk: ${commands.some((command) => mutatingCommand(command)) ? "medium" : "low"}
writes_state: ${commands.some((command) => mutatingCommand(command))}
requires_workspace: true
allowed_commands:
${commands.map((command) => `  - ${command}`).join("\n")}
templates:
${templateIds.length > 0 ? templateIds.map((template) => `  - ${template}`).join("\n") : "  - none"}
---

# ${title}

## Purpose

${purpose}

## When To Use

Use this workflow when the user's request requires ${purpose.charAt(0).toLowerCase()}${purpose.slice(1)} Do not use it for adjacent work when a narrower workflow exists.

## Inputs Required

- Current project root or explicit \`--workspace\`.
- Actor or agent ID when the workflow writes state.
- Relevant labels, work IDs, source IDs, or session ID if the user supplied them.
- Clear statement of whether the workflow may mutate memory or work records.

## Safety Constraints

- Never read or write a sibling repository's memory unless the user explicitly names that repository and workspace.
- Run read-only retrieval before creating or updating records.
- Prefer source-backed claims, decisions, and wiki edits.
- Use \`--json\` for commands that feed later automation.
- Stop and ask when candidate records conflict or the workflow would overwrite user-authored truth.

## Steps

1. Confirm the workspace with \`bwrk prime --json\` or \`bwrk sync status --json\`.
2. Gather current context using only the allowed commands listed in frontmatter.
3. Execute the smallest state-changing command set required by the user request.
4. Attach evidence or source references for any durable claim, decision, or closed work.
5. Rebuild derived artifacts when the workflow changes memory, context, or search.
6. Run \`bwrk doctor --strict --json\` unless the workflow is explicitly read-only and no generated artifacts changed.

## CLI Commands

${commands.map((command) => `- \`bwrk ${command}\``).join("\n")}

## Evidence And Checkpoints

- Record command/test/diff evidence before verification or closeout.
- Keep raw source material immutable; reconcile into wiki, claims, decisions, or work instead of rewriting raw records.
- For work changes, confirm dependency and readiness state after mutation.

## Failure And Repair

- If workspace health fails, switch to \`workflows/60-health/sync-and-doctor.md\`.
- If search or context is stale, run \`bwrk search index --json\` and \`bwrk context rebuild --json\` after memory, work, context, or search-affecting changes.
- If locks are stale, inspect before breaking them.

## Finish Criteria

- The requested outcome is represented in Boreal records or the workflow has returned a clear read-only answer.
- Any new or updated durable memory has source/evidence support.
- \`bwrk doctor --strict --json\` passes or the remaining diagnostic is explicitly reported.

## Next Suggested Workflow

- Use \`workflows/50-handoff/session-closeout.md\` after long agent sessions.
- Use \`workflows/60-health/sync-and-doctor.md\` when state, ledger, or generated-artifact health is uncertain.
`;
}

function templateDoc(slug, title) {
  return `---
id: boreal.template.${slug}.v1
title: ${title}
status: v1
---

# ${title}

## Purpose

Use this template as an output contract for workflows that need a human-readable ${title.toLowerCase()} artifact. Templates shape prose and summaries; CLI commands remain the canonical state writers.

## Required Fields

- Scope
- Source or evidence references
- Current state
- Decision or action taken
- Risks and unknowns
- Next action

## Template

### Scope

Describe the bounded project, work item, source, or memory page.

### Source And Evidence

- Source IDs:
- Evidence IDs:
- Commands run:

### Summary

Write the smallest truthful summary that preserves uncertainty.

### Details

Record material facts, decisions, task structure, or handoff instructions.

### Risks And Open Questions

List unresolved conflicts, stale truth, missing evidence, or follow-up checks.

### Next Action

Name the next Boreal workflow or CLI command to run.
`;
}

function skillDoc(slug, title, workflowRefs) {
  return `---
name: ${slug}
description: ${title} skill for Boreal project-scoped workflows.
workflows:
${workflowRefs.map((workflow) => `  - ${workflow}`).join("\n")}
---

# ${title}

## When To Use

Use this skill when the user asks for work covered by:

${workflowRefs.map((workflow) => `- \`workflows/${workflow}\``).join("\n")}

## Required First Step

Confirm the current project context. Prefer \`bwrk prime --json\` when the workspace is initialized, or ask for the explicit project root before reading or writing memory.

## Routing Rules

- Read the referenced workflow file before executing steps.
- Follow the workflow's allowed commands and finish criteria.
- Keep this skill as a thin adapter; do not invent steps that belong in the workflow file.
- If the request crosses repositories, stop and ask for the explicit workspace and memory root.

## No-Leak Rules

- Do not read sibling \`memory/\`, \`.boreal/\`, \`.agents/\`, or \`.claude/\` folders unless the user explicitly scopes the request there.
- Do not use global memory as a fallback for a missing workspace.
- Do not install or refresh skills outside the selected install root.

## Completion

End with the workflow result, verification status, and the next suggested workflow.
`;
}

function productDoc() {
  return `# Boreal V1 Workflows

Boreal v1.0 is the project-scoped memory and work runtime for humans and agents. It must support raw intake, retrieval, reconciliation, durable memory, task structure, agent execution, handoff, and health checks without leaking memory across repositories.

## Core Concepts

- Raw source: immutable inbox/source material captured before interpretation.
- Memory: reconciled durable project truth in wiki pages, claims, decisions, evidence, and context.
- Work: issues, tasks, sprints, milestones, dependencies, reservations, verification, and closeout.
- Workflow: canonical procedure with allowed commands, safety constraints, and finish criteria.
- Template: human-readable artifact shape used by workflows.
- Skill: agent-facing adapter that routes requests to canonical workflows.

## Raw To Memory

Raw material is captured first, then triaged, then reconciled into durable memory. Reconciliation may create wiki pages, claims, decisions, evidence, or work. Raw records are not rewritten to hide uncertainty.

## V1 Success Criteria

- Every common user ask routes to a workflow.
- Every skill references existing workflow files.
- Every workflow lists allowed commands, templates, safety constraints, failure handling, and finish criteria.
- Skill installs are project/folder scoped and never fall back to another repository.
- Doctor checks can validate workflow/skill references and install state.
`;
}

function projectSetupDoc() {
  return `# Project Setup

Boreal setup has three roots:

- Project root: the repository whose work and memory are being managed.
- Memory root: the \`memory/\` vault, either in-repo, child repo, or sibling repo.
- Install root: where agent skills are written, such as \`.agents/skills\` or \`.claude\`.

## Supported Layouts

- In-repo memory: \`<project>/memory\`.
- Child memory repo: \`<project>/memory\` with its own Git repository.
- Sibling memory repo: \`../<project>-memory\` with explicit config.
- Folder-scoped skills: install generated skills under the folder where agent sessions are opened.

## No-Leak Rules

- Init and install must use explicit project, memory, and install roots.
- Workspace-bound commands fail closed when no Boreal workspace is resolved.
- Skill installs must not read or write sibling repositories unless the user explicitly selects them.
- Future MCP adapters must bind to one workspace root and must not expose global memory by default.

## Init Direction

\`bwrk init --interactive\` should ask for project root, memory layout, separate Git preference, install root, target agents, and folder-scope. Non-interactive flags should provide the same data for automation.
`;
}

function skillsArchitectureDoc() {
  return `# Skills And Workflows

Workflows are canonical. Skills are thin adapters. Templates shape output artifacts.

## Directory Layout

\`\`\`text
workflows/
templates/
skills/
\`\`\`

## Workflow Metadata

Each workflow uses frontmatter with \`id\`, \`title\`, \`group\`, \`status\`, \`risk\`, \`writes_state\`, \`requires_workspace\`, \`allowed_commands\`, and \`templates\`.

## Skill Metadata

Each skill declares the workflow files it can route to. Skill text must reference workflow files and must not duplicate detailed workflow steps.

## Installer Behavior

The installer should render skills for Codex and Claude into a selected install root. Dry-run mode reports target files and source workflow references without writing.
`;
}

function workflowsReadme() {
  return `# Workflows

This directory contains Boreal v1 canonical workflows. Workflows are the source of truth for agent procedures. Skills route to workflows; templates shape workflow outputs.

Run validation tests after editing workflow frontmatter or command references.
`;
}

function workflowTemplate() {
  return workflowDoc({
    group: "template",
    slug: "_workflow-template",
    id: "boreal.workflow.template.v1",
    title: "Workflow Template",
    purpose: "Template for new Boreal workflows.",
    commands: ["prime", "doctor"],
    templateIds: []
  });
}

function templatesReadme() {
  return `# Templates

Templates are human-readable output contracts used by workflows. They do not write canonical state. Use CLI commands for state, then use templates for summaries, plans, handoffs, or reports.
`;
}

function mutatingCommand(command) {
  return /^(init|work create|work ready|work reserve|work claim|work release|work renew|work block|dep add|dep remove|evidence add|work verify|work close|source add|claim create|decision create|context rebuild|search index|export|import|vault init|raw add|wiki create|merge apply|compact apply|ledger delete|snapshot create|lock break|agent start|agent finish|session start|session end)/u.test(command);
}
