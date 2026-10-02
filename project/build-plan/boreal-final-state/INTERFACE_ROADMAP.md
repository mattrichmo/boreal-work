# Bounded agent-interface successor

**Status:** design direction, not required implementation in the local-core milestone. Recheck host/SDK capabilities when activating this work. S12 prepares the reusable contract; it does not claim a functioning MCP server or a published ChatGPT plugin.

## Required now: protocol-ready local product

S12 qualifies callable typed use cases, current-scope authorization, durable result/context references, bounded errors/readback, ordinary-agent onboarding and headless execution. CLI, TUI and skills remain clients. No need to rewrite Rust or replace the Unix socket to prove these boundaries.

## Successor A: local MCP and plugin pilot

Entry: S12-T90 is accepted and the operator explicitly activates a bounded pilot. Deliver a small adapter and reuse the existing skills. Choose Rust or a thin TypeScript/Python adapter from actual host/SDK needs; do not duplicate business rules or read SQLite directly.

Start with discovery/status/guide and bounded context reads, then a single complete authorized task journey: start/resume, checkpoint, changed-result/proof submission, finish-or-review wait and operation readback. Add planning/Global capture and Send only when the pilot demonstrates those needs and their authority boundaries. Prefer a coherent small tool set over exporting every maintenance command.

Acceptance requires actual named-client tests, correct read/write annotations, exact schema/version mapping, ordinary Agent scopes, confirmation boundaries for sensitive actions, malicious-input rejection, stale-fence/unknown-outcome tests and durable receipts. No arbitrary shell/SQL tools, implicit Operator credentials or per-client lifecycle implementation. A mock MCP client is not proof of ChatGPT availability.

## Successor B: authenticated remote access to one authority

Entry: a demonstrated remote-agent use case, successful local pilot and explicit deployment approval. Select one deployment topology: a secured bridge/tunnel to an owned local service, or a persistent hosted service. Do not begin with multi-tenant SaaS, distributed synchronization or ephemeral serverless SQLite.

Required design before writes: authentication and per-project authorization, credential lifecycle/revocation, TLS/transport limits, protocol compatibility, audit attribution, bounded artifact transfer, durable state/backup ownership, timeouts and cancellation semantics. Keep logical delivery idempotency distinct from physical destination fences and strict operation retries. Credentials and host paths are never inferred from a GitHub connection.

Prove one remote Agent can complete one task against the same authority as a local client, including lost-reply recovery and role isolation. A browser UI, billing, teams, remote provider spawning and universal host support are not part of that proof.

## Public integration references checked 2026-10-02

OpenAI's current documentation separates reusable skills from MCP-exposed tools and makes custom UI optional. Its help page distinguishes local MCP apps on Desktop from availability on web/mobile. These are integration facts, not evidence about Boreal's implementation or this user's enabled environment.

- https://developers.openai.com/plugins/quickstart
- https://developers.openai.com/plugins/build/app-quickstart
- https://help.openai.com/en/articles/20001256-plugins-in-chatgpt

Re-verify relevant platform documentation, account controls and client versions at pilot activation. Do not promise that a correct local adapter automatically works in every ChatGPT/Codex environment.
