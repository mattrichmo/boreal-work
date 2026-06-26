import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { flagValue, parseArgs } from "../../apps/cli/src/args.ts";
import { registryValueFlagNames, validateCommandBehaviorMetadata } from "../../apps/cli/src/command-registry.ts";
import { installJsonStdoutGuard, main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bwrk cli", () => {
  it("documents every current command group", async () => {
    const commands = await readFile(new URL("../../docs/cli/COMMANDS.md", import.meta.url), "utf8");

    for (const heading of [
      "## Help",
      "## `init`",
      "## `commands`",
      "## `work create`",
      "## `work ready`",
      "## `work list`",
      "## `work next`",
      "## `work show`",
      "## `work block`",
      "## `work reserve`",
      "## `work claim`",
      "## `work release`",
      "## `work renew`",
      "## `reservation list`",
      "## `agent guide`",
      "## `agent finish`",
      "## `agent start`",
      "## `agent status`",
      "## `evidence add`",
      "## `work verify`",
      "## `work close`",
      "## `source add`",
      "## `source list`",
      "## `source show`",
      "## `claim create`",
      "## `claim list`",
      "## `claim show`",
      "## `decision create`",
      "## `decision list`",
      "## `decision show`",
      "## `context rebuild`",
      "## `context show`",
      "## `context search`",
      "## `search index`",
      "## `search query`",
      "## `export json`",
      "## `export markdown`",
      "## `import json`",
      "## `snapshot create`",
      "## `snapshot list`",
      "## `snapshot show`",
      "## `doctor`",
      "## `lock inspect`",
      "## `lock break`"
    ]) {
      expect(commands).toContain(heading);
    }
  });

  it("prints root and grouped help without a workspace", async () => {
    const rootDir = await makeTempWorkspace();

    const root = await runCli(rootDir, ["help"]);
    const work = await runCli(rootDir, ["help", "work"]);
    const workWithFlag = await runCli(rootDir, ["help", "work", "--help"]);
    const doctor = await runCli(rootDir, ["doctor", "--help"]);

    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("bwrk - Boreal Work CLI");
    expect(root.stdout).toContain(
      "bwrk help [init|work|evidence|source|claim|decision|context|search|reservation|agent|export|import|snapshot|doctor|lock|commands]"
    );
    expect(work.exitCode).toBe(0);
    expect(work.stdout).toContain("bwrk work create");
    expect(work.stdout).toContain("--force --reason");
    expect(workWithFlag.exitCode).toBe(0);
    expect(workWithFlag.stdout).toContain("bwrk work create");
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("bwrk doctor");

    const missing = await runCli(rootDir, ["help", "missing", "--json"]);
    const payload = parseJson<{ readonly ok: false; readonly code: string }>(missing.stderr);
    expect(missing.exitCode).toBe(2);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
  });

  it("fails closed before init", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["work", "list", "--json"]);
    const payload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(result.stderr);

    expect(result.exitCode).toBe(2);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.message).toContain("not initialized");
  });

  it("prints the agent guide without an initialized workspace", async () => {
    const rootDir = await makeTempWorkspace();

    const jsonGuide = await runCli(rootDir, ["agent", "guide", "--agent", "agent $one's", "--label", "cli label", "--json"]);
    const payload = parseData<{
      readonly agentId: string;
      readonly labels: readonly string[];
      readonly commands: {
        readonly status: string;
        readonly start: string;
        readonly finish: string;
        readonly evidence: string;
        readonly verify: string;
        readonly release: string;
        readonly repair: string;
      };
      readonly loop: Array<{ readonly step: string; readonly command: string }>;
      readonly recovery: Array<{ readonly command: string }>;
    }>(jsonGuide.stdout);

    expect(jsonGuide.exitCode).toBe(0);
    expect(payload.agentId).toBe("agent $one's");
    expect(payload.labels).toEqual(["cli label"]);
    expect(payload.commands.status).toBe("bwrk agent status --agent 'agent $one'\\''s' --label 'cli label' --json");
    expect(payload.commands.start).toBe(
      "bwrk agent start --agent 'agent $one'\\''s' --label 'cli label' --purpose 'start implementation' --json"
    );
    expect(payload.commands.finish).toBe(
      "bwrk agent finish <work-id> --agent 'agent $one'\\''s' --summary 'implemented and tested' --command 'pnpm test' --close --reason 'verified by evidence' --json"
    );
    expect(payload.commands.evidence).toContain("bwrk evidence add <work-id>");
    expect(payload.commands.verify).toContain("bwrk work verify <work-id>");
    expect(payload.commands.release).toBe("bwrk work release <work-id> --json");
    expect(payload.commands.repair).toBe("bwrk doctor --fix --json");
    expect(payload.loop.map((step) => step.step)).toEqual([
      "Check coordination state",
      "Start or resume work",
      "Renew if work continues",
      "Finish with evidence",
      "Release if stopping"
    ]);
    expect(payload.recovery.map((step) => step.command)).toContain("bwrk doctor --fix --json");

    const textGuide = await runCli(rootDir, ["agent", "guide", "--agent", "agent-a", "--label", "cli"]);
    expect(textGuide.exitCode).toBe(0);
    expect(textGuide.stdout).toContain("Boreal agent guide");
    expect(textGuide.stdout).toContain("bwrk agent start --agent agent-a --label cli --purpose 'start implementation' --json");
    expect(textGuide.stdout).toContain(
      "bwrk agent finish <work-id> --agent agent-a --summary 'implemented and tested' --command 'pnpm test' --close --reason 'verified by evidence' --json"
    );
    expect(textGuide.stdout).toContain("bwrk doctor --fix --json");
  });

  it("exposes the registered command surface as JSON", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["commands", "--json"]);
    const registry = parseData<{
      readonly commands: Array<{
        readonly path: readonly string[];
        readonly flags: Array<{ readonly name: string; readonly type: string }>;
        readonly behavior: {
          readonly readOnly: boolean;
          readonly writesState: boolean;
          readonly writesGeneratedArtifacts: boolean;
          readonly requiresFreshIndex: boolean;
          readonly requiresLock: string;
          readonly maxResultSizeChars: number;
          readonly jsonOutputSchema: string;
          readonly examples: readonly string[];
        };
      }>;
    }>(result.stdout);
    const reserve = registry.commands.find((command) => command.path.join(" ") === "work reserve");
    const commands = registry.commands.find((command) => command.path.join(" ") === "commands");
    const searchQuery = registry.commands.find((command) => command.path.join(" ") === "search query");
    const searchIndex = registry.commands.find((command) => command.path.join(" ") === "search index");

    expect(result.exitCode).toBe(0);
    expect(() => validateCommandBehaviorMetadata()).not.toThrow();
    expect(registry.commands.map((command) => command.path.join(" "))).toContain("commands");
    expect(registry.commands.map((command) => command.path.join(" "))).toEqual(
      expect.arrayContaining([
        "source add",
        "claim create",
        "decision create",
        "context rebuild",
        "context show",
        "context search",
        "search index",
        "search query",
        "work claim",
        "work release",
        "work renew",
        "reservation list",
        "agent guide",
        "agent finish",
        "agent start",
        "agent status",
        "export json",
        "export markdown",
        "import json",
        "snapshot create",
        "snapshot list",
        "snapshot show"
      ])
    );
    expect(reserve?.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "force", type: "boolean" }),
        expect.objectContaining({ name: "reason", type: "value" })
      ])
    );
    expect(registry.commands.every((command) => command.behavior.examples.length > 0)).toBe(true);
    expect(registry.commands.every((command) => command.behavior.jsonOutputSchema.startsWith("boreal.cli."))).toBe(true);
    expect(registry.commands.every((command) => command.behavior.maxResultSizeChars > 0)).toBe(true);
    expect(commands?.behavior.readOnly).toBe(true);
    expect(reserve?.behavior).toEqual(expect.objectContaining({ writesState: true, requiresLock: "state" }));
    expect(searchIndex?.behavior).toEqual(
      expect.objectContaining({ writesGeneratedArtifacts: true, requiresLock: "index" })
    );
    expect(searchQuery?.behavior).toEqual(expect.objectContaining({ readOnly: true, requiresFreshIndex: true }));
  });

  it("rejects unknown flags and honors explicit false booleans", async () => {
    const rootDir = await makeTempWorkspace();

    const invalid = await runCli(rootDir, ["work", "create", "Invalid flag", "--prio", "critical", "--json"]);
    const invalidPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      invalid.stderr
    );
    expect(invalid.exitCode).toBe(2);
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidPayload.message).toContain("Unknown flag --prio");

    await runCli(rootDir, ["init", "--json"]);
    const created = await runCli(rootDir, ["work", "create", "Draft via false flag", "--ready=false", "--json"]);
    expect(created.exitCode).toBe(0);
    expect(parseData<{ readonly status: string }>(created.stdout).status).toBe("draft");
  });

  it("parses value flags from the command registry and honors json=true errors", async () => {
    const rootDir = await makeTempWorkspace();
    const parsed = parseArgs(["agent", "finish", "bw_work_example", "--summary", "done", "--release", "--json=true"]);

    expect(registryValueFlagNames()).toContain("summary");
    expect(flagValue(parsed, "summary")).toBe("done");
    expect(flagValue(parsed, "json")).toBe("true");

    const jsonError = await runCli(rootDir, ["unknown", "--json=true"]);
    const jsonPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(jsonError.stderr);
    expect(jsonError.exitCode).toBe(2);
    expect(jsonError.stdout).toBe("");
    expect(jsonPayload.ok).toBe(false);
    expect(jsonPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(jsonPayload.message).toContain("Unknown command");

    const humanError = await runCli(rootDir, ["unknown", "--json=false"]);
    expect(humanError.exitCode).toBe(2);
    expect(humanError.stderr).toContain("BOREAL_INVALID_INPUT: Unknown command");
  });

  it("redirects unexpected stdout while a json stdout guard is active", () => {
    let redirected = "";
    const guard = installJsonStdoutGuard({
      enabled: true,
      stderrWrite(text) {
        redirected += text;
      }
    });
    try {
      process.stdout.write("accidental stdout\n");
    } finally {
      guard.release();
    }

    expect(redirected).toBe("accidental stdout\n");
  });

  it("runs the work lifecycle through file-backed commands", async () => {
    const rootDir = await makeTempWorkspace();
    const childDir = join(rootDir, "nested");
    await mkdir(childDir);

    const init = await runCli(rootDir, ["init", "--json"]);
    expect(init.exitCode).toBe(0);
    expect(parseData<{ readonly initialized: boolean }>(init.stdout).initialized).toBe(true);

    const created = await runCli(childDir, [
      "work",
      "create",
      "Build CLI surface",
      "--description",
      "Create a hardened command surface.",
      "--label",
      "cli",
      "--acceptance",
      "doctor stays clean",
      "--ready",
      "--json"
    ]);
    const work = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(created.stdout);
    expect(created.exitCode).toBe(0);
    expect(work.status).toBe("ready");

    const ready = await runCli(rootDir, ["work", "list", "--ready", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(ready.stdout).map((item) => item.id)).toContain(work.meta.id);

    const evidence = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "CLI lifecycle test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--command",
      "pnpm test",
      "--json"
    ]);
    const evidenceRecord = parseData<{ readonly meta: { readonly id: string } }>(evidence.stdout);
    expect(evidence.exitCode).toBe(0);

    const verification = await runCli(rootDir, [
      "work",
      "verify",
      work.meta.id,
      "--evidence",
      evidenceRecord.meta.id,
      "--notes",
      "Verified by CLI integration test.",
      "--json"
    ]);
    expect(parseData<{ readonly verdict: string }>(verification.stdout).verdict).toBe("passed");

    const closed = await runCli(rootDir, ["work", "close", work.meta.id, "--reason", "verified", "--json"]);
    expect(parseData<{ readonly status: string }>(closed.stdout).status).toBe("closed");

    const repaired = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{ readonly ok: boolean; readonly fixed: boolean }>(repaired.stdout);
    expect(repaired.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);

    const doctor = await runCli(rootDir, ["doctor", "--json"]);
    expect(doctor.exitCode).toBe(0);
    expect(parseData<{ readonly ok: boolean }>(doctor.stdout).ok).toBe(true);
  });

  it("runs the knowledge context lifecycle through file-backed commands", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const sourceResult = await runCli(rootDir, [
      "source",
      "add",
      "--title",
      "Context design note",
      "--uri",
      "file://context-design.md",
      "--kind",
      "document",
      "--summary",
      "Knowledge context must be visible to agents.",
      "--json"
    ]);
    const source = parseData<{ readonly meta: { readonly id: string }; readonly title: string }>(sourceResult.stdout);
    expect(sourceResult.exitCode).toBe(0);

    const sourceShow = await runCli(rootDir, ["source", "show", source.meta.id, "--json"]);
    expect(parseData<{ readonly title: string }>(sourceShow.stdout).title).toBe("Context design note");

    const sourceList = await runCli(rootDir, ["source", "list", "--kind", "document", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(sourceList.stdout).map((row) => row.id)).toContain(source.meta.id);

    const claimResult = await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Context packs include accepted claims.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    const claim = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(claimResult.stdout);
    expect(claim.status).toBe("accepted");

    const claimShow = await runCli(rootDir, ["claim", "show", claim.meta.id, "--json"]);
    expect(parseData<{ readonly statement: string }>(claimShow.stdout).statement).toContain("accepted claims");

    const claimList = await runCli(rootDir, ["claim", "list", "--status", "accepted", "--source", source.meta.id, "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(claimList.stdout).map((row) => row.id)).toContain(claim.meta.id);

    const decisionResult = await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Expose context packs",
      "--context",
      "Agents need compact project memory.",
      "--decision",
      "Expose context packs through the runtime and CLI.",
      "--status",
      "accepted",
      "--consequence",
      "CLI users can inspect rebuilt context packs.",
      "--source",
      source.meta.id,
      "--json"
    ]);
    const decision = parseData<{ readonly meta: { readonly id: string }; readonly status: string }>(decisionResult.stdout);
    expect(decision.status).toBe("accepted");

    const decisionShow = await runCli(rootDir, ["decision", "show", decision.meta.id, "--json"]);
    expect(parseData<{ readonly decision: string }>(decisionShow.stdout).decision).toContain("runtime and CLI");

    const decisionList = await runCli(rootDir, ["decision", "list", "--status", "accepted", "--source", source.meta.id, "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(decisionList.stdout).map((row) => row.id)).toContain(
      decision.meta.id
    );

    const workResult = await runCli(rootDir, ["work", "create", "Build context commands", "--ready", "--json"]);
    const work = parseData<{ readonly meta: { readonly id: string } }>(workResult.stdout);

    const evidenceResult = await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "context command test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    expect(evidenceResult.exitCode).toBe(0);

    const rebuild = await runCli(rootDir, ["context", "rebuild", "--json"]);
    expect(parseData<{ readonly rebuilt: number }>(rebuild.stdout).rebuilt).toBe(1);

    const contextPack = await runCli(rootDir, ["context", "show", work.meta.id, "--json"]);
    const pack = parseData<{ readonly facts: readonly string[]; readonly evidence: readonly string[] }>(contextPack.stdout);
    expect(pack.facts).toContain("claim: Context packs include accepted claims.");
    expect(pack.facts).toContain("decision: Expose context packs through the runtime and CLI.");
    expect(pack.evidence).toContain("passed: context command test passed");
  });

  it("builds a fresh search index, searches context, and rejects stale reads", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Ship search runtime",
          "--description",
          "Search must rank context facts.",
          "--priority",
          "high",
          "--label",
          "cli",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "create", "Write search docs", "--label", "docs", "--ready", "--json"]);

    const next = await runCli(rootDir, ["work", "next", "--label", "cli", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(next.stdout).map((row) => row.id)).toEqual([work.meta.id]);

    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Search hardening note",
          "--uri",
          "file://search-hardening.md",
          "--summary",
          "Search index freshness is part of runtime policy.",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Search index must fail closed when stale.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Use content hash search",
      "--context",
      "Agents need reliable retrieval.",
      "--decision",
      "Search query uses a fresh content hash.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "search integration test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    await runCli(rootDir, ["context", "rebuild", "--json"]);

    const missing = await runCli(rootDir, ["search", "query", "content hash", "--json"]);
    const missingPayload = parseJson<{ readonly ok: false; readonly code: string }>(missing.stderr);
    expect(missing.exitCode).toBe(1);
    expect(missingPayload.code).toBe("BOREAL_POLICY_VIOLATION");

    const indexed = await runCli(rootDir, ["search", "index", "--json"]);
    expect(parseData<{ readonly documentCount: number; readonly tokenCount: number }>(indexed.stdout)).toMatchObject({
      documentCount: 8
    });

    const concurrentIndexes = await Promise.all([
      runCli(rootDir, ["search", "index", "--json"]),
      runCli(rootDir, ["search", "index", "--json"]),
      runCli(rootDir, ["search", "index", "--json"])
    ]);
    expect(concurrentIndexes.map((result) => result.exitCode)).toEqual([0, 0, 0]);
    for (const result of concurrentIndexes) {
      expect(parseData<{ readonly documentCount: number }>(result.stdout).documentCount).toBe(8);
    }

    const searchIndexDocument = parseJson<{ readonly schemaVersion: string; readonly documentCount: number }>(
      await readFile(join(rootDir, ".boreal/runtime/search-index.json"), "utf8")
    );
    expect(searchIndexDocument.schemaVersion).toBe("boreal.search-index.v1");
    expect(searchIndexDocument.documentCount).toBe(8);

    const query = await runCli(rootDir, ["search", "query", "content hash", "--json"]);
    const searchResults = parseData<Array<{ readonly type: string; readonly title: string }>>(query.stdout);
    expect(searchResults.map((result) => result.type)).toEqual(expect.arrayContaining(["decision", "context_pack"]));
    expect(searchResults.map((result) => result.title)).toContain("Use content hash search");

    const contextSearch = await runCli(rootDir, ["context", "search", "fail closed stale", "--json"]);
    const contextResults = parseData<Array<{ readonly type: string; readonly summary: string }>>(contextSearch.stdout);
    expect(contextResults.every((result) => result.type === "context_pack")).toBe(true);
    expect(contextResults.some((result) => result.summary.includes("Ship search runtime"))).toBe(true);

    await runCli(rootDir, [
      "source",
      "add",
      "--title",
      "Stale search note",
      "--uri",
      "file://stale-search.md",
      "--json"
    ]);
    const stale = await runCli(rootDir, ["search", "query", "content hash", "--json"]);
    const stalePayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(stale.stderr);
    expect(stale.exitCode).toBe(1);
    expect(stalePayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(stalePayload.message).toContain("stale");

    const repaired = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly fixed: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repaired.stdout);
    expect(repaired.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "search.index", severity: "fixed" })])
    );

    const repairedSearch = await runCli(rootDir, ["search", "query", "Stale search note", "--json"]);
    expect(parseData<Array<{ readonly type: string; readonly title: string }>>(repairedSearch.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "source", title: "Stale search note" })])
    );
  });

  it("claims next work and returns a refreshed handoff bundle", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Claim handoff runtime",
          "--description",
          "Return context and retrieval hits after reservation.",
          "--priority",
          "critical",
          "--label",
          "cli",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, ["work", "create", "Unrelated docs work", "--label", "docs", "--ready", "--json"]);

    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Claim handoff note",
          "--uri",
          "file://claim-handoff.md",
          "--summary",
          "Claim commands must return enough context to start safely.",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Claim handoff includes refreshed context.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);
    await runCli(rootDir, [
      "decision",
      "create",
      "--title",
      "Return claim handoff bundle",
      "--context",
      "Agents need a single starting payload.",
      "--decision",
      "Return claimed work, reservation, context, and focused search results.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);

    const claimed = await runCli(rootDir, [
      "work",
      "claim",
      "--label",
      "cli",
      "--agent",
      "agent-a",
      "--purpose",
      "start implementation",
      "--json"
    ]);
    const payload = parseData<{
      readonly claimed: boolean;
      readonly work: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation: { readonly meta: { readonly id: string }; readonly status: string; readonly purpose?: string };
      readonly contextPack: { readonly subjectId: string; readonly facts: readonly string[] };
      readonly search: { readonly query: string; readonly results: Array<{ readonly type: string; readonly title: string }> };
    }>(claimed.stdout);

    expect(claimed.exitCode).toBe(0);
    expect(payload.claimed).toBe(true);
    expect(payload.work.id).toBe(work.meta.id);
    expect(payload.work.status).toBe("reserved");
    expect(payload.work.activeReservationId).toBe(payload.reservation.meta.id);
    expect(payload.reservation.status).toBe("active");
    expect(payload.reservation.purpose).toBe("start implementation");
    expect(payload.contextPack.subjectId).toBe(work.meta.id);
    expect(payload.contextPack.facts).toContain("claim: Claim handoff includes refreshed context.");
    expect(payload.contextPack.facts).toContain(
      "decision: Return claimed work, reservation, context, and focused search results."
    );
    expect(payload.search.query).toContain("Claim handoff runtime");
    expect(payload.search.results.map((result) => result.type)).toEqual(
      expect.arrayContaining(["work", "context_pack", "decision"])
    );

    const searchAfterClaim = await runCli(rootDir, ["search", "query", "focused search results", "--json"]);
    expect(parseData<Array<{ readonly type: string; readonly title: string }>>(searchAfterClaim.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "decision", title: "Return claim handoff bundle" })])
    );

    const missing = await runCli(rootDir, ["work", "claim", "--label", "missing", "--json"]);
    expect(parseData<{ readonly claimed: boolean; readonly reason: string }>(missing.stdout)).toEqual({
      claimed: false,
      reason: "no_ready_work",
      agentId: expect.any(String),
      labels: ["missing"]
    });
  });

  it("starts agents by claiming or resuming with a handoff bundle", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Agent start CLI work",
          "--description",
          "Agents should receive context before changing files.",
          "--priority",
          "high",
          "--label",
          "cli",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    const source = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "source",
          "add",
          "--title",
          "Agent start note",
          "--uri",
          "file://agent-start.md",
          "--summary",
          "Agent start should claim or resume with a handoff bundle.",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "claim",
      "create",
      "--statement",
      "Agent start includes context.",
      "--status",
      "accepted",
      "--source",
      source.meta.id,
      "--json"
    ]);

    const started = await runCli(rootDir, [
      "agent",
      "start",
      "--agent",
      "agent-a",
      "--label",
      "cli",
      "--purpose",
      "begin safe work",
      "--json"
    ]);
    const startedPayload = parseData<{
      readonly started: boolean;
      readonly action?: string;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string }; readonly status: string; readonly purpose?: string };
      readonly contextPack?: { readonly subjectId: string; readonly facts: readonly string[] };
      readonly search?: { readonly query: string; readonly results: Array<{ readonly type: string }> };
      readonly status: {
        readonly reservations: { readonly activeCount: number; readonly capacityRemaining: number };
        readonly readyWork: { readonly claimableCount: number };
        readonly recommendedAction: { readonly kind: string };
      };
    }>(started.stdout);

    expect(started.exitCode).toBe(0);
    expect(startedPayload.started).toBe(true);
    expect(startedPayload.action).toBe("claimed_work");
    expect(startedPayload.handoffComplete).toBe(true);
    expect(startedPayload.work?.id).toBe(work.meta.id);
    expect(startedPayload.work?.status).toBe("reserved");
    expect(startedPayload.work?.activeReservationId).toBe(startedPayload.reservation?.meta.id);
    expect(startedPayload.reservation?.status).toBe("active");
    expect(startedPayload.reservation?.purpose).toBe("begin safe work");
    expect(startedPayload.contextPack?.subjectId).toBe(work.meta.id);
    expect(startedPayload.contextPack?.facts).toContain("claim: Agent start includes context.");
    expect(startedPayload.search?.query).toContain("Agent start CLI work");
    expect(startedPayload.search?.results.map((result) => result.type)).toContain("context_pack");
    expect(startedPayload.status.reservations.activeCount).toBe(1);
    expect(startedPayload.status.reservations.capacityRemaining).toBe(2);
    expect(startedPayload.status.readyWork.claimableCount).toBe(0);
    expect(startedPayload.status.recommendedAction.kind).toBe("continue_reserved_work");

    const resumed = await runCli(rootDir, ["agent", "start", "--agent", "agent-a", "--label", "cli", "--json"]);
    const resumedPayload = parseData<{
      readonly started: boolean;
      readonly action?: string;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string } };
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(resumed.stdout);
    expect(resumed.exitCode).toBe(0);
    expect(resumedPayload.started).toBe(true);
    expect(resumedPayload.action).toBe("continue_reserved_work");
    expect(resumedPayload.handoffComplete).toBe(true);
    expect(resumedPayload.work?.id).toBe(work.meta.id);
    expect(resumedPayload.reservation?.meta.id).toBe(startedPayload.reservation?.meta.id);
    expect(resumedPayload.status.reservations.activeCount).toBe(1);

    const activeList = await runCli(rootDir, ["reservation", "list", "--agent", "agent-a", "--status", "active", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(activeList.stdout).map((row) => row.id)).toEqual([
      startedPayload.reservation?.meta.id
    ]);

    const missing = await runCli(rootDir, ["agent", "start", "--agent", "agent-b", "--label", "missing", "--json"]);
    const missingPayload = parseData<{
      readonly started: boolean;
      readonly reason: string;
      readonly recommendedAction: { readonly kind: string };
      readonly status: { readonly readyWork: { readonly claimableCount: number } };
    }>(missing.stdout);
    expect(missing.exitCode).toBe(0);
    expect(missingPayload.started).toBe(false);
    expect(missingPayload.reason).toBe("no_ready_work");
    expect(missingPayload.status.readyWork.claimableCount).toBe(0);
    expect(missingPayload.recommendedAction.kind).toBe("wait_for_ready_work");
  });

  it("keeps claimed reservations when agent start handoff generation fails", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Degraded handoff work", "--label", "degraded", "--ready", "--json"])).stdout
    );
    await mkdir(join(rootDir, ".boreal/runtime/search-index.json"), { recursive: true });

    const started = await runCli(rootDir, ["agent", "start", "--agent", "agent-degraded", "--label", "degraded", "--json"]);
    const payload = parseData<{
      readonly started: boolean;
      readonly action?: string;
      readonly handoffComplete: boolean;
      readonly work?: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly reservation?: { readonly meta: { readonly id: string }; readonly status: string };
      readonly warnings: Array<{ readonly code: string; readonly message: string }>;
      readonly repairCommand?: string;
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(started.stdout);

    expect(started.exitCode).toBe(0);
    expect(payload.started).toBe(true);
    expect(payload.action).toBe("claimed_work");
    expect(payload.handoffComplete).toBe(false);
    expect(payload.work?.id).toBe(work.meta.id);
    expect(payload.work?.status).toBe("reserved");
    expect(payload.work?.activeReservationId).toBe(payload.reservation?.meta.id);
    expect(payload.reservation?.status).toBe("active");
    expect(payload.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "handoff.failed" })])
    );
    expect(payload.repairCommand).toBe("bwrk doctor --fix --json");
    expect(payload.status.reservations.activeCount).toBe(1);

    const shown = await runCli(rootDir, ["work", "show", work.meta.id, "--json"]);
    expect(parseData<{ readonly status: string; readonly activeReservationId?: string }>(shown.stdout)).toEqual(
      expect.objectContaining({ status: "reserved", activeReservationId: payload.reservation?.meta.id })
    );
  });

  it("finishes reserved agent work with guarded evidence, verification, and cleanup", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const closeWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Finish and close", "--label", "finish", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["agent", "start", "--agent", "agent-a", "--label", "finish", "--json"]);

    const missingMode = await runCli(rootDir, [
      "agent",
      "finish",
      closeWork.meta.id,
      "--agent",
      "agent-a",
      "--summary",
      "missing exit mode",
      "--json"
    ]);
    const missingModePayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      missingMode.stderr
    );
    expect(missingMode.exitCode).toBe(2);
    expect(missingModePayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(missingModePayload.message).toContain("requires --close or --release");

    const wrongAgent = await runCli(rootDir, [
      "agent",
      "finish",
      closeWork.meta.id,
      "--agent",
      "agent-b",
      "--summary",
      "wrong agent attempt",
      "--release",
      "--json"
    ]);
    const wrongAgentPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      wrongAgent.stderr
    );
    expect(wrongAgent.exitCode).toBe(1);
    expect(wrongAgentPayload.ok).toBe(false);
    expect(wrongAgentPayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(wrongAgentPayload.message).toContain("does not own");

    const finishedClosed = await runCli(rootDir, [
      "agent",
      "finish",
      closeWork.meta.id,
      "--agent",
      "agent-a",
      "--summary",
      "Implemented and tested finish close.",
      "--command",
      "pnpm test",
      "--close",
      "--reason",
      "verified by finish evidence",
      "--json"
    ]);
    const closedPayload = parseData<{
      readonly finished: boolean;
      readonly action: string;
      readonly work: { readonly id: string; readonly status: string; readonly activeReservationId?: string };
      readonly evidence: { readonly outcome: string; readonly command?: string };
      readonly verification: { readonly verdict: string };
      readonly reservation: { readonly status: string };
      readonly closedWork?: { readonly status: string; readonly closedReason?: string };
      readonly release?: { readonly reservation: { readonly status: string } };
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(finishedClosed.stdout);

    expect(finishedClosed.exitCode).toBe(0);
    expect(closedPayload.finished).toBe(true);
    expect(closedPayload.action).toBe("verified_and_closed");
    expect(closedPayload.work.id).toBe(closeWork.meta.id);
    expect(closedPayload.work.status).toBe("closed");
    expect(closedPayload.work.activeReservationId).toBeUndefined();
    expect(closedPayload.evidence).toEqual(expect.objectContaining({ outcome: "passed", command: "pnpm test" }));
    expect(closedPayload.verification.verdict).toBe("passed");
    expect(closedPayload.reservation.status).toBe("released");
    expect(closedPayload.closedWork).toEqual(
      expect.objectContaining({ status: "closed", closedReason: "verified by finish evidence" })
    );
    expect(closedPayload.release?.reservation.status).toBe("released");
    expect(closedPayload.status.reservations.activeCount).toBe(0);

    const releaseWork = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Finish and release", "--label", "release", "--ready", "--json"])).stdout
    );
    await runCli(rootDir, ["agent", "start", "--agent", "agent-c", "--label", "release", "--json"]);
    const finishedReleased = await runCli(rootDir, [
      "agent",
      "finish",
      releaseWork.meta.id,
      "--agent",
      "agent-c",
      "--summary",
      "Blocked by a failing check.",
      "--verdict",
      "failed",
      "--release",
      "--json"
    ]);
    const releasedPayload = parseData<{
      readonly action: string;
      readonly work: { readonly status: string; readonly activeReservationId?: string };
      readonly evidence: { readonly outcome: string };
      readonly verification: { readonly verdict: string };
      readonly release?: { readonly reservation: { readonly status: string } };
      readonly status: { readonly reservations: { readonly activeCount: number } };
    }>(finishedReleased.stdout);

    expect(finishedReleased.exitCode).toBe(0);
    expect(releasedPayload.action).toBe("verified_and_released");
    expect(releasedPayload.work.status).toBe("needs_verification");
    expect(releasedPayload.work.activeReservationId).toBeUndefined();
    expect(releasedPayload.evidence.outcome).toBe("failed");
    expect(releasedPayload.verification.verdict).toBe("failed");
    expect(releasedPayload.release?.reservation.status).toBe("released");
    expect(releasedPayload.status.reservations.activeCount).toBe(0);

    const invalidMode = await runCli(rootDir, [
      "agent",
      "finish",
      releaseWork.meta.id,
      "--agent",
      "agent-c",
      "--summary",
      "invalid mode",
      "--close",
      "--release",
      "--json"
    ]);
    const invalidPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(invalidMode.stderr);
    expect(invalidMode.exitCode).toBe(2);
    expect(invalidPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(invalidPayload.message).toContain("cannot be used together");
  });

  it("renews, releases, and repairs expired reservations through the CLI", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const claimLabel = "coord $label's";
    const shellSensitiveAgent = "agent $one's";
    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Reservation CLI lifecycle", "--label", claimLabel, "--ready", "--json"])).stdout
    );
    const readyStatus = await runCli(rootDir, ["agent", "status", "--agent", shellSensitiveAgent, "--label", claimLabel, "--json"]);
    const readyStatusPayload = parseData<{
      readonly reservations: { readonly activeCount: number; readonly capacityRemaining: number };
      readonly readyWork: { readonly claimableCount: number; readonly next?: { readonly id: string } };
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
    }>(readyStatus.stdout);
    expect(readyStatusPayload.reservations.activeCount).toBe(0);
    expect(readyStatusPayload.reservations.capacityRemaining).toBe(3);
    expect(readyStatusPayload.readyWork.claimableCount).toBe(1);
    expect(readyStatusPayload.readyWork.next?.id).toBe(work.meta.id);
    expect(readyStatusPayload.recommendedAction.kind).toBe("claim_work");
    expect(readyStatusPayload.recommendedAction.command).toBe(
      "bwrk work claim --agent 'agent $one'\\''s' --label 'coord $label'\\''s'"
    );

    const reserved = await runCli(rootDir, ["work", "reserve", work.meta.id, "--agent", "agent-a", "--ttl", "1h", "--json"]);
    const reservedWork = parseData<{ readonly status: string; readonly reservationId: string }>(reserved.stdout);
    expect(reservedWork.status).toBe("reserved");
    expect(reservedWork.reservationId).toMatch(/^bw_reservation_/);

    const activeList = await runCli(rootDir, ["reservation", "list", "--agent", "agent-a", "--work", work.meta.id, "--json"]);
    const activeRows = parseData<
      Array<{
        readonly id: string;
        readonly status: string;
        readonly expired: boolean;
        readonly agentId: string;
        readonly workId: string;
        readonly workTitle?: string;
      }>
    >(activeList.stdout);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]).toEqual(
      expect.objectContaining({
        id: reservedWork.reservationId,
        status: "active",
        expired: false,
        agentId: "agent-a",
        workId: work.meta.id,
        workTitle: "Reservation CLI lifecycle"
      })
    );
    const activeStatus = await runCli(rootDir, ["agent", "status", "--agent", "agent-a", "--json"]);
    const activeStatusPayload = parseData<{
      readonly reservations: { readonly activeCount: number; readonly expiredActiveCount: number; readonly capacityRemaining: number };
      readonly readyWork: { readonly claimableCount: number };
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
    }>(activeStatus.stdout);
    expect(activeStatusPayload.reservations.activeCount).toBe(1);
    expect(activeStatusPayload.reservations.expiredActiveCount).toBe(0);
    expect(activeStatusPayload.reservations.capacityRemaining).toBe(2);
    expect(activeStatusPayload.readyWork.claimableCount).toBe(0);
    expect(activeStatusPayload.recommendedAction.kind).toBe("continue_reserved_work");
    expect(activeStatusPayload.recommendedAction.command).toContain(`bwrk work show ${work.meta.id}`);

    const renewed = await runCli(rootDir, ["work", "renew", work.meta.id, "--ttl", "2h", "--json"]);
    const renewedPayload = parseData<{
      readonly work: { readonly meta: { readonly id: string }; readonly status: string };
      readonly reservation: { readonly meta: { readonly id: string }; readonly status: string; readonly expiresAt: string };
    }>(renewed.stdout);
    expect(renewedPayload.work.meta.id).toBe(work.meta.id);
    expect(renewedPayload.reservation.status).toBe("active");
    expect(renewedPayload.reservation.expiresAt).toMatch(/T/);

    const released = await runCli(rootDir, ["work", "release", work.meta.id, "--json"]);
    const releasedPayload = parseData<{
      readonly work: { readonly status: string; readonly reservationId?: string };
      readonly reservation: { readonly status: string };
    }>(released.stdout);
    expect(releasedPayload.reservation.status).toBe("released");
    expect(releasedPayload.work.status).toBe("ready");
    expect(releasedPayload.work.reservationId).toBeUndefined();

    const releasedList = await runCli(rootDir, ["reservation", "list", "--status", "released", "--work", work.meta.id, "--json"]);
    expect(parseData<Array<{ readonly status: string }>>(releasedList.stdout)).toEqual([
      expect.objectContaining({ status: "released" })
    ]);

    const reservedAgain = await runCli(rootDir, ["work", "reserve", work.meta.id, "--agent", "agent-b", "--ttl", "1h", "--json"]);
    const staleReservationId = parseData<{ readonly reservationId: string }>(reservedAgain.stdout).reservationId;
    await setReservationExpiresAt(rootDir, staleReservationId, "2000-01-01T00:00:00.000Z");

    const expiredActiveList = await runCli(rootDir, ["reservation", "list", "--agent", "agent-b", "--expired", "--json"]);
    expect(parseData<Array<{ readonly id: string; readonly status: string; readonly expired: boolean }>>(expiredActiveList.stdout)).toEqual([
      expect.objectContaining({ id: staleReservationId, status: "active", expired: true })
    ]);
    const expiredStatus = await runCli(rootDir, ["agent", "status", "--agent", "agent-b", "--json"]);
    const expiredStatusPayload = parseData<{
      readonly reservations: { readonly activeCount: number; readonly expiredActiveCount: number };
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
    }>(expiredStatus.stdout);
    expect(expiredStatusPayload.reservations.activeCount).toBe(1);
    expect(expiredStatusPayload.reservations.expiredActiveCount).toBe(1);
    expect(expiredStatusPayload.recommendedAction).toEqual(
      expect.objectContaining({
        kind: "repair_expired_reservations",
        command: "bwrk doctor --fix"
      })
    );
    const blockedStart = await runCli(rootDir, ["agent", "start", "--agent", "agent-b", "--json"]);
    const blockedStartPayload = parseData<{
      readonly started: boolean;
      readonly reason: string;
      readonly recommendedAction: { readonly kind: string; readonly command?: string };
      readonly status: { readonly reservations: { readonly expiredActiveCount: number } };
    }>(blockedStart.stdout);
    expect(blockedStart.exitCode).toBe(1);
    expect(blockedStartPayload.started).toBe(false);
    expect(blockedStartPayload.reason).toBe("expired_active_reservations");
    expect(blockedStartPayload.status.reservations.expiredActiveCount).toBe(1);
    expect(blockedStartPayload.recommendedAction).toEqual(
      expect.objectContaining({
        kind: "repair_expired_reservations",
        command: "bwrk doctor --fix"
      })
    );

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(failingDoctor.stdout);
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "reservation.expired", severity: "error" })])
    );

    const repairedDoctor = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly fixed: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repairedDoctor.stdout);
    expect(repairedDoctor.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "reservation.expired", severity: "fixed" })])
    );

    const shown = await runCli(rootDir, ["work", "show", work.meta.id, "--json"]);
    const shownWork = parseData<{ readonly status: string; readonly activeReservationId?: string }>(shown.stdout);
    expect(shownWork.status).toBe("ready");
    expect(shownWork.activeReservationId).toBeUndefined();

    const expiredList = await runCli(rootDir, ["reservation", "list", "--status", "expired", "--work", work.meta.id, "--json"]);
    expect(parseData<Array<{ readonly id: string; readonly status: string; readonly expired: boolean }>>(expiredList.stdout)).toEqual([
      expect.objectContaining({ id: staleReservationId, status: "expired", expired: true })
    ]);
  });

  it("exports, snapshots, imports, and rejects conflicting JSON snapshots", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);

    const work = parseData<{ readonly meta: { readonly id: string } }>(
      (
        await runCli(rootDir, [
          "work",
          "create",
          "Exportable work",
          "--description",
          "This record should round-trip through import.",
          "--ready",
          "--json"
        ])
      ).stdout
    );
    await runCli(rootDir, [
      "evidence",
      "add",
      work.meta.id,
      "--summary",
      "export import test passed",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    await runCli(rootDir, [
      "source",
      "add",
      "--title",
      "Export source",
      "--uri",
      "file://export-source.md",
      "--json"
    ]);
    await runCli(rootDir, ["context", "rebuild", "--json"]);

    const exportPath = join(rootDir, "boreal-export.json");
    const exported = await runCli(rootDir, ["export", "json", "--out", "boreal-export.json", "--json"]);
    const exportPayload = parseData<{ readonly path: string; readonly contentHash: string }>(exported.stdout);
    expect(exported.exitCode).toBe(0);
    expect(exportPayload.path).toBe(exportPath);
    expect(exportPayload.contentHash).toMatch(/^sha256:/);

    const exportDocument = parseJson<{
      readonly schemaVersion: string;
      readonly contentHash: string;
      readonly state: { readonly workItems: Array<{ readonly meta: { readonly id: string }; readonly title: string }> };
    }>(await readFile(exportPath, "utf8"));
    expect(exportDocument.schemaVersion).toBe("boreal.export.v1");
    expect(exportDocument.state.workItems.map((item) => item.meta.id)).toContain(work.meta.id);

    const markdown = await runCli(rootDir, ["export", "markdown", "--out", "markdown-export", "--json"]);
    const markdownPayload = parseData<{ readonly outDir: string; readonly files: readonly string[] }>(markdown.stdout);
    expect(markdownPayload.outDir).toBe(join(rootDir, "markdown-export"));
    expect(markdownPayload.files.some((file) => file.endsWith(`/work/${work.meta.id}.md`))).toBe(true);

    const outsideDir = await makeTempWorkspace();
    await symlink(outsideDir, join(rootDir, "linked-out"), "dir");
    const symlinkedExport = await runCli(rootDir, ["export", "markdown", "--out", "linked-out/markdown", "--json"]);
    const symlinkedExportPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      symlinkedExport.stderr
    );
    expect(symlinkedExport.exitCode).toBe(2);
    expect(symlinkedExportPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(symlinkedExportPayload.message).toContain("Path escapes Boreal workspace");

    const snapshot = await runCli(rootDir, ["snapshot", "create", "--name", "baseline", "--json"]);
    const snapshotPayload = parseData<{ readonly id: string; readonly contentHash: string }>(snapshot.stdout);
    expect(snapshotPayload.id).toContain("baseline");
    expect(snapshotPayload.contentHash).toBe(exportPayload.contentHash);

    const snapshots = await runCli(rootDir, ["snapshot", "list", "--json"]);
    expect(parseData<Array<{ readonly id: string }>>(snapshots.stdout).map((entry) => entry.id)).toContain(
      snapshotPayload.id
    );

    const shown = await runCli(rootDir, ["snapshot", "show", snapshotPayload.id, "--json"]);
    expect(parseData<{ readonly contentHash: string }>(shown.stdout).contentHash).toBe(exportPayload.contentHash);

    const targetDir = await makeTempWorkspace();
    await runCli(targetDir, ["init", "--json"]);
    const blockedExternalImport = await runCli(targetDir, ["import", "json", "--from", exportPath, "--json"]);
    const blockedExternalPayload = parseJson<{ readonly ok: false; readonly code: string; readonly message: string }>(
      blockedExternalImport.stderr
    );
    expect(blockedExternalImport.exitCode).toBe(2);
    expect(blockedExternalPayload.code).toBe("BOREAL_INVALID_INPUT");
    expect(blockedExternalPayload.message).toContain("Path escapes Boreal workspace");

    const imported = await runCli(targetDir, ["import", "json", "--from", exportPath, "--allow-external-read", "--json"]);
    const importPayload = parseData<{ readonly imported: { readonly workItems: number }; readonly skipped: { readonly workItems: number } }>(
      imported.stdout
    );
    expect(importPayload.imported.workItems).toBe(1);
    expect(importPayload.skipped.workItems).toBe(0);

    const importedAgain = await runCli(targetDir, ["import", "json", "--from", exportPath, "--allow-external-read", "--json"]);
    expect(parseData<{ readonly skipped: { readonly workItems: number } }>(importedAgain.stdout).skipped.workItems).toBe(1);

    const importedDoctor = await runCli(targetDir, ["doctor", "--json"]);
    expect(importedDoctor.exitCode).toBe(0);
    expect(parseData<{ readonly ok: boolean }>(importedDoctor.stdout).ok).toBe(true);

    const importedIndex = await runCli(targetDir, ["search", "index", "--json"]);
    expect(parseData<{ readonly documentCount: number }>(importedIndex.stdout).documentCount).toBeGreaterThan(0);
    const importedSearch = await runCli(targetDir, ["search", "query", "Export source", "--json"]);
    expect(parseData<Array<{ readonly type: string; readonly title: string }>>(importedSearch.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "source", title: "Export source" })])
    );
    const importedContextSearch = await runCli(targetDir, ["context", "search", "export import test passed", "--json"]);
    expect(parseData<Array<{ readonly type: string }>>(importedContextSearch.stdout).map((result) => result.type)).toContain(
      "context_pack"
    );

    const conflictingPath = join(rootDir, "conflicting-export.json");
    const conflicting = {
      schemaVersion: "boreal.file-store.v1",
      ...exportDocument.state,
      workItems: exportDocument.state.workItems.map((item) =>
        item.meta.id === work.meta.id ? { ...item, title: "Conflicting title" } : item
      )
    };
    await writeFile(conflictingPath, `${JSON.stringify(conflicting, null, 2)}\n`, "utf8");
    const conflict = await runCli(rootDir, ["import", "json", "--from", conflictingPath, "--json"]);
    const conflictPayload = parseJson<{ readonly ok: false; readonly code: string }>(conflict.stderr);
    expect(conflict.exitCode).toBe(1);
    expect(conflictPayload.code).toBe("BOREAL_CONFLICT");

    const danglingPath = join(rootDir, "dangling-export.json");
    const dangling = {
      schemaVersion: "boreal.file-store.v1",
      ...exportDocument.state,
      workItems: exportDocument.state.workItems.map((item) =>
        item.meta.id === work.meta.id ? { ...item, dependencyIds: ["bw_work_deadbeefdead"] } : item
      )
    };
    await writeFile(danglingPath, `${JSON.stringify(dangling, null, 2)}\n`, "utf8");
    const danglingImport = await runCli(targetDir, ["import", "json", "--from", danglingPath, "--allow-external-read", "--json"]);
    const danglingPayload = parseJson<{ readonly ok: false; readonly code: string }>(danglingImport.stderr);
    expect(danglingImport.exitCode).toBe(2);
    expect(danglingPayload.code).toBe("BOREAL_INVALID_INPUT");
  });

  it("keeps explicit workspace paths exact while cwd discovery walks upward", async () => {
    const rootDir = await makeTempWorkspace();
    const childDir = join(rootDir, "nested");
    await mkdir(childDir);
    await runCli(rootDir, ["init", "--json"]);

    const discovered = await runCli(childDir, ["work", "list", "--json"]);
    expect(discovered.exitCode).toBe(0);

    const explicit = await runCli(rootDir, ["work", "list", "--workspace", childDir, "--json"]);
    const payload = parseJson<{ readonly code: string; readonly details: { readonly workspaceRoot: string } }>(
      explicit.stderr
    );
    expect(explicit.exitCode).toBe(2);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.details.workspaceRoot).toBe(childDir);
  });

  it("initializes idempotently under concurrent commands", async () => {
    const rootDir = await makeTempWorkspace();

    const results = await Promise.all([
      runCli(rootDir, ["init", "--json"]),
      runCli(rootDir, ["init", "--json"]),
      runCli(rootDir, ["init", "--json"])
    ]);
    const payloads = results.map((result) => parseData<{ readonly initialized: boolean }>(result.stdout));
    const state = parseJson<{ readonly events: Array<{ readonly type: string }> }>(
      await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8")
    );

    expect(results.map((result) => result.exitCode)).toEqual([0, 0, 0]);
    expect(payloads.filter((payload) => payload.initialized)).toHaveLength(1);
    expect(state.events.filter((event) => event.type === "workspace.initialized")).toHaveLength(1);
  });

  it("supports bounded and filtered work lists", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Ready CLI work", "--label", "cli", "--ready", "--json"]);
    await runCli(rootDir, ["work", "create", "Draft CLI work", "--label", "cli", "--json"]);
    await runCli(rootDir, ["work", "create", "Ready docs work", "--label", "docs", "--ready", "--json"]);

    const listed = await runCli(rootDir, [
      "work",
      "list",
      "--status",
      "ready",
      "--label",
      "cli",
      "--limit",
      "1",
      "--json"
    ]);
    const rows = parseData<Array<{ readonly status: string; readonly labels: readonly string[] }>>(listed.stdout);

    expect(listed.exitCode).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.labels).toContain("cli");
  });

  it("repairs stale runtime locks explicitly", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await writeLockOwner(rootDir, new Date(Date.now() - 120_000).toISOString());

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{ readonly ok: boolean; readonly diagnostics: Array<{ readonly code: string }> }>(
      failingDoctor.stdout
    );
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics.map((diagnostic) => diagnostic.code)).toContain("lock.stale");

    const repaired = await runCli(rootDir, ["lock", "break", "--stale-only", "--json"]);
    expect(repaired.exitCode).toBe(0);
    expect(parseData<{ readonly removed: boolean }>(repaired.stdout).removed).toBe(true);

    const inspection = await runCli(rootDir, ["lock", "inspect", "--json"]);
    expect(parseData<{ readonly exists: boolean }>(inspection.stdout).exists).toBe(false);
  });

  it("repairs stale generated search index locks through doctor", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await writeLockOwner(rootDir, new Date(Date.now() - 120_000).toISOString(), "search-index.lock");

    const failingDoctor = await runCli(rootDir, ["doctor", "--json"]);
    const failingPayload = parseData<{ readonly ok: boolean; readonly diagnostics: Array<{ readonly code: string }> }>(
      failingDoctor.stdout
    );
    expect(failingDoctor.exitCode).toBe(1);
    expect(failingPayload.ok).toBe(false);
    expect(failingPayload.diagnostics.map((diagnostic) => diagnostic.code)).toContain("lock.search_index.stale");

    const repairedDoctor = await runCli(rootDir, ["doctor", "--fix", "--json"]);
    const repairedPayload = parseData<{
      readonly ok: boolean;
      readonly fixed: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(repairedDoctor.stdout);
    expect(repairedDoctor.exitCode).toBe(0);
    expect(repairedPayload.ok).toBe(true);
    expect(repairedPayload.fixed).toBe(true);
    expect(repairedPayload.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "lock.search_index.stale", severity: "fixed" })])
    );

    const searchIndexDocument = parseJson<{ readonly schemaVersion: string }>(
      await readFile(join(rootDir, ".boreal/runtime/search-index.json"), "utf8")
    );
    expect(searchIndexDocument.schemaVersion).toBe("boreal.search-index.v1");
  });
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function runCli(cwd: string, argv: readonly string[]): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  const output: CliOutput = {
    write(text) {
      stdout += text;
    },
    error(text) {
      stderr += text;
    }
  };
  const exitCode = await main([...argv], output, cwd);
  return { exitCode, stdout, stderr };
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function parseData<T>(text: string): T {
  const envelope = parseJson<{ readonly ok: true; readonly data: T }>(text);
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function writeLockOwner(rootDir: string, createdAt: string, lockName = "state.lock"): Promise<void> {
  const lockDir = join(rootDir, ".boreal/runtime", lockName);
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    join(lockDir, "owner.json"),
    `${JSON.stringify(
      {
        token: "external-lock",
        pid: 999_999,
        hostname: "test-host",
        createdAt
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function setReservationExpiresAt(rootDir: string, reservationId: string, expiresAt: string): Promise<void> {
  const statePath = join(rootDir, ".boreal/runtime/state.json");
  const state = parseJson<{
    readonly reservations: Array<{ readonly meta: { readonly id: string }; readonly [key: string]: unknown }>;
    readonly [key: string]: unknown;
  }>(await readFile(statePath, "utf8"));
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        ...state,
        reservations: state.reservations.map((reservation) =>
          reservation.meta.id === reservationId ? { ...reservation, expiresAt } : reservation
        )
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
