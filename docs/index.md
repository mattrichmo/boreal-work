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

**Git-native project memory and workflow control for humans and agents.**

Boreal turns the loose context that normally lives in chat logs, scratch notes, and people's heads into durable, queryable records that sit next to your code. Work items, the evidence that closes them, the decisions behind them, and the sources that back those decisions all become append-friendly records — readable by a person, diffable in Git, and stable enough for an agent to coordinate against.

> **Status:** v1 local runtime. `bwrk` (the CLI) is the canonical command surface; the MCP server, daemon, and browser console are built on the same JSON-first contracts.

## Start here

- **[Getting started](getting-started.md)** — install, initialize, and run your first work loop.
- **[Concepts](concepts.md)** — the mental model behind work, evidence, knowledge, and memory.
- **[CLI commands](cli/COMMANDS.md)** — the complete `bwrk` command contract.
- **[Documentation index](README.md)** — the full map of every doc.

## Why Boreal

- **One source of truth.** Work, evidence, knowledge, and decisions are records — not Slack threads. They live in the repo and diff cleanly.
- **Evidence-gated closure.** Work closes because a verification record points at evidence, not because someone said so.
- **Built for agents and humans equally.** Every command has a stable `--json` envelope.
- **Deterministic and fail-closed.** Collision-proof IDs, derived-and-repairable readiness, schema-drift rejection, and a `doctor` that repairs projections and indexes.

## Architecture & product

- [Runtime architecture](architecture/RUNTIME.md)
- [Skills & workflows](architecture/SKILLS_AND_WORKFLOWS.md)
- [Project setup](architecture/PROJECT_SETUP.md)
- [V1 closeout & adoption guide](product/V1_CLOSEOUT_ADOPTION_GUIDE.md)

---

The source for this site lives in the [`boreal-work` repository](https://github.com/mattrichmo/boreal-work).
