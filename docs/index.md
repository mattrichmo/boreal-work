---
title: Boreal Work
---

```
██████   ██████  ██████  ███████  █████  ██          ██     ██  ██████  ██████  ██   ██
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██     ██ ██    ██ ██   ██ ██  ██
██████  ██    ██ ██████  █████   ███████ ██          ██  █  ██ ██    ██ ██████  █████
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██ ███ ██ ██    ██ ██   ██ ██  ██
██████   ██████  ██   ██ ███████ ██   ██ ███████      ███ ███   ██████  ██   ██ ██   ██
```

**Local runtime for evidence-backed work, project memory, and agent handoff.**

Boreal turns tasks, sources, claims, decisions, verification, and workflow state into durable records with JSON-first command contracts and repairable Git-native artifacts. The runtime tracks operational truth; the memory vault preserves human-readable knowledge, ledgers, and handoff material that people can diff and agents can coordinate against.

> **Status:** v1 local runtime. `bwrk` (the CLI) is the canonical command surface; the MCP server, daemon, and browser console are built on the same JSON-first contracts.

## Start here

- **[Getting started](getting-started.md)** — install, initialize, and run your first work loop.
- **[Concepts](concepts.md)** — the mental model behind work, evidence, knowledge, and memory.
- **[CLI commands](cli/COMMANDS.md)** — the complete `bwrk` command contract.
- **[Documentation index](README.md)** — the full map of every doc.

## Why Boreal

- **Evidence-backed operational truth.** Work, evidence, verification, sources, claims, and decisions are records — not Slack threads.
- **Evidence-gated closure.** Work closes because a verification record points at evidence, not because someone said so.
- **Built for agents and humans equally.** Every command has a stable `--json` envelope.
- **Deterministic and fail-closed.** Collision-proof IDs, derived-and-repairable readiness, schema-drift rejection, and a `doctor` that repairs projections and indexes.

## Architecture & product

- [Runtime architecture](architecture/RUNTIME.md)
- [Skills & workflows](architecture/SKILLS_AND_WORKFLOWS.md)
- [Project setup](architecture/PROJECT_SETUP.md)
- [Prior art & originality](architecture/PRIOR_ART_ORIGINALITY.md)
- [V1 closeout & adoption guide](product/V1_CLOSEOUT_ADOPTION_GUIDE.md)

---

The source for this site lives in the [`boreal-work` repository](https://github.com/mattrichmo/boreal-work).
