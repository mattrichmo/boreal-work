import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import { projectRollupSchemaIssues, type ProjectRollupDocument } from "../../packages/core/src/index.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface JsonEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generated artifacts after mutation", () => {
  it("writes a fresh schema-valid project rollup after mutations", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Rollup ready work", "--kind", "task", "--ready", "--json"]);
    await runCli(rootDir, ["work", "create", "Rollup draft work", "--kind", "issue", "--json"]);

    const rollupPath = join(rootDir, ".boreal", "rollup.json");
    const rollup = JSON.parse(await readFile(rollupPath, "utf8")) as ProjectRollupDocument;
    const rows = parseData<Array<{ readonly kind: string; readonly status: string }>>(
      (await runCli(rootDir, ["work", "list", "--limit", "10", "--json"])).stdout
    );
    const freshReadyCount = rows.filter((row) => row.status === "ready").length;
    const freshDraftCount = rows.filter((row) => row.status === "draft").length;

    expect(projectRollupSchemaIssues(rollup)).toEqual([]);
    expect(rollup.counts.work.total).toBe(rows.length);
    expect(rollup.counts.work.byStatus.ready).toBe(freshReadyCount);
    expect(rollup.counts.work.byStatus.draft).toBe(freshDraftCount);
    expect(rollup.counts.work.byKind.task).toBe(rows.filter((row) => row.kind === "task").length);

    const shown = parseData<{
      readonly ok: boolean;
      readonly inspection: { readonly exists: boolean; readonly stale: boolean };
      readonly rollup: ProjectRollupDocument;
    }>((await runCli(rootDir, ["rollup", "show", "--json"])).stdout);
    expect(shown.ok).toBe(true);
    expect(shown.inspection).toEqual(expect.objectContaining({ exists: true, stale: false }));
    expect(shown.rollup.stateContentHash).toBe(rollup.stateContentHash);

    const status = parseData<{ readonly projectRollup: { readonly ok: boolean; readonly stale: boolean } }>(
      (await runCli(rootDir, ["sync", "status", "--json"])).stdout
    );
    expect(status.projectRollup).toEqual(expect.objectContaining({ ok: true, stale: false }));
  });

  it("flags stale project rollups in doctor", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    await runCli(rootDir, ["work", "create", "Rollup stale doctor work", "--ready", "--json"]);

    const rollupPath = join(rootDir, ".boreal", "rollup.json");
    const rollup = JSON.parse(await readFile(rollupPath, "utf8")) as ProjectRollupDocument;
    await writeFile(rollupPath, `${JSON.stringify({ ...rollup, stateContentHash: `sha256:${"0".repeat(64)}` }, null, 2)}\n`);

    const doctor = parseData<{
      readonly diagnostics: readonly Array<{ readonly code: string; readonly severity: string; readonly details?: { readonly stale?: boolean } }>;
    }>((await runCli(rootDir, ["doctor", "--json"])).stdout);

    expect(doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "project.rollup",
          severity: "info",
          details: expect.objectContaining({ stale: true })
        })
      ])
    );
  });

  it("does not rewrite the search index inline on work close", async () => {
    const rootDir = await createTestWorkspace();
    await runCli(rootDir, ["init", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string } }>(
      (await runCli(rootDir, ["work", "create", "Generated artifact staleness target", "--kind", "task", "--ready", "--json"]))
        .stdout
    );

    await runCli(rootDir, ["sync", "refresh", "--json"]);
    const indexPath = join(rootDir, ".boreal", "runtime", "search-index.json");

    await runCli(rootDir, ["agent", "start", created.meta.id, "--agent", "a1", "--json"]);
    const before = statSync(indexPath).mtimeMs;
    await waitForDistinctMtime();
    await runCli(rootDir, [
      "agent",
      "finish",
      created.meta.id,
      "--agent",
      "a1",
      "--summary",
      "Generated artifact staleness closeout.",
      "--kind",
      "command",
      "--outcome",
      "passed",
      "--command",
      "pnpm test",
      "--verdict",
      "passed",
      "--notes",
      "Generated artifact staleness evidence.",
      "--close",
      "--reason",
      "generated artifact staleness test",
      "--dirty-path",
      "no_repo_changes: generated artifact staleness test",
      "--json"
    ]);

    expect(statSync(indexPath).mtimeMs).toBe(before);
    const status = parseData<{
      readonly searchIndex: { readonly ok: boolean; readonly stale: boolean };
    }>((await runCli(rootDir, ["sync", "status", "--json"])).stdout);
    expect(status.searchIndex).toEqual(expect.objectContaining({ ok: false, stale: true }));

    const doctor = parseData<{
      readonly diagnostics: readonly Array<{ readonly code: string; readonly severity: string }>;
    }>((await runCli(rootDir, ["doctor", "--json"])).stdout);
    expect(doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "search.index", severity: "info" }),
        expect.objectContaining({ code: "ledger.export_drift", severity: "info" }),
        expect.objectContaining({ code: "cache.sqlite", severity: "ok" }),
        expect.objectContaining({ code: "cache.sqlite.retired", severity: "ok" })
      ])
    );
  });
});

async function createTestWorkspace(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "boreal-generated-artifacts-"));
  tempDirs.push(rootDir);
  return rootDir;
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

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as JsonEnvelope<T>;
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

async function waitForDistinctMtime(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
