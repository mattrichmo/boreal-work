import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
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
      "bwrk help [init|work|evidence|source|claim|decision|context|search|export|import|snapshot|doctor|lock|commands]"
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

  it("exposes the registered command surface as JSON", async () => {
    const rootDir = await makeTempWorkspace();

    const result = await runCli(rootDir, ["commands", "--json"]);
    const registry = parseData<{
      readonly commands: Array<{
        readonly path: readonly string[];
        readonly flags: Array<{ readonly name: string; readonly type: string }>;
      }>;
    }>(result.stdout);
    const reserve = registry.commands.find((command) => command.path.join(" ") === "work reserve");

    expect(result.exitCode).toBe(0);
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
    const imported = await runCli(targetDir, ["import", "json", "--from", exportPath, "--json"]);
    const importPayload = parseData<{ readonly imported: { readonly workItems: number }; readonly skipped: { readonly workItems: number } }>(
      imported.stdout
    );
    expect(importPayload.imported.workItems).toBe(1);
    expect(importPayload.skipped.workItems).toBe(0);

    const importedAgain = await runCli(targetDir, ["import", "json", "--from", exportPath, "--json"]);
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
    const danglingImport = await runCli(targetDir, ["import", "json", "--from", danglingPath, "--json"]);
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

async function writeLockOwner(rootDir: string, createdAt: string): Promise<void> {
  const lockDir = join(rootDir, ".boreal/runtime/state.lock");
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
