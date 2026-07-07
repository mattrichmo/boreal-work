import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import { runDaemonWatchOnce } from "../../apps/daemon/src/runtime.ts";
import type { EvidenceRecord, GraphEdge, WorkId, WorkItem } from "../../packages/core/src/index.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
}

interface RegistryImportResult {
  readonly entry: {
    readonly id: string;
  };
}

interface ExternalDepAddResult {
  readonly work: WorkItem;
  readonly edge: GraphEdge;
  readonly externalDependency: {
    readonly referenceUri: string;
    readonly reason?: string;
    readonly status?: string;
  };
}

interface WorkShowResult {
  readonly status: WorkItem["status"];
  readonly gaps: readonly Array<{
    readonly code: string;
    readonly data?: {
      readonly externalBlockers?: readonly Array<{
        readonly uri: string;
        readonly reason: string;
        readonly status?: string;
      }>;
    };
  }>;
}

interface DependencyTreeNode {
  readonly id: string;
  readonly title?: string;
  readonly status?: string;
  readonly external?: boolean;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly workId?: string;
  readonly referenceUri?: string;
  readonly reason?: string;
  readonly resolutionState?: string;
  readonly stale?: boolean;
  readonly dependencies: readonly DependencyTreeNode[];
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("global cross-boundary readiness", () => {
  it("derives global blockers from project rollup work indexes", async () => {
    const callerRoot = await makeTempDir();
    const projectRoot = await makeTempDir();
    const registryRoot = await makeTempDir();
    const globalEnv = { BOREAL_PROJECT_REGISTRY_ROOT: registryRoot };

    await runJson(callerRoot, ["init", "--setup-memory", "--json"]);
    await runJson(projectRoot, ["init", "--setup-memory", "--json"]);
    const remote = await runJson<WorkItem>(projectRoot, ["work", "create", "Remote blocker", "--kind", "task", "--ready", "--json"]);
    const imported = await runJson<RegistryImportResult>(projectRoot, [
      "registry",
      "import-setup",
      "--registry-root",
      registryRoot,
      "--name",
      "Remote Project",
      "--json"
    ]);
    await runJson(projectRoot, ["sync", "refresh", "--json"]);

    const global = await runJson<WorkItem>(callerRoot, [
      "work",
      "create",
      "Global initiative",
      "--kind",
      "task",
      "--ready",
      "--global",
      "--json"
    ], { env: globalEnv });
    const referenceUri = `boreal://${imported.entry.id}/${remote.meta.id}`;
    const blocked = await runJson<ExternalDepAddResult>(callerRoot, [
      "dep",
      "add",
      global.meta.id,
      referenceUri,
      "--global",
      "--json"
    ], { env: globalEnv });

    expect(blocked.edge.fromProjectId).toBe(imported.entry.id);
    expect(blocked.externalDependency).toMatchObject({ reason: "open", status: "ready" });
    expect(blocked.work.status).toBe("blocked");
    expect(externalBlockerReasons(await showGlobalWork(callerRoot, registryRoot, global.meta.id, globalEnv))).toContain("open");
    expect(externalTreeNode(await globalDepTree(callerRoot, global.meta.id, globalEnv), referenceUri)).toMatchObject({
      external: true,
      projectId: imported.entry.id,
      projectName: "Remote Project",
      workId: remote.meta.id,
      status: "ready",
      reason: "open",
      resolutionState: "resolved-open"
    });

    const evidence = await runJson<EvidenceRecord>(projectRoot, [
      "evidence",
      "add",
      remote.meta.id,
      "--kind",
      "test",
      "--summary",
      "remote close passed",
      "--outcome",
      "passed",
      "--json"
    ]);
    await runJson(projectRoot, ["work", "verify", remote.meta.id, "--evidence", evidence.meta.id, "--verdict", "passed", "--json"]);
    await runJson(projectRoot, [
      "work",
      "close",
      remote.meta.id,
      "--reason",
      "remote done",
      "--dirty-path",
      "no_repo_changes: global readiness fixture",
      "--json"
    ]);
    await runJson(projectRoot, ["sync", "refresh", "--json"]);

    const watch = await runDaemonWatchOnce({ workspaceRoot: projectRoot, registryRoot });
    expect(watch.globalReadiness.changed).toBeGreaterThanOrEqual(1);
    expect((await showGlobalWork(callerRoot, registryRoot, global.meta.id, globalEnv)).status).toBe("ready");
    expect(externalTreeNode(await globalDepTree(callerRoot, global.meta.id, globalEnv), referenceUri)).toMatchObject({
      external: true,
      status: "closed",
      resolutionState: "resolved-terminal"
    });

    const unresolved = await runJson<WorkItem>(callerRoot, [
      "work",
      "create",
      "Missing-project initiative",
      "--kind",
      "task",
      "--ready",
      "--global",
      "--json"
    ], { env: globalEnv });
    const missingReferenceUri = "boreal://missing_project/bw_work_000000000001";
    await runJson<ExternalDepAddResult>(callerRoot, [
      "dep",
      "add",
      unresolved.meta.id,
      missingReferenceUri,
      "--global",
      "--json"
    ], { env: globalEnv });
    const unresolvedShow = await showGlobalWork(callerRoot, registryRoot, unresolved.meta.id, globalEnv);
    expect(unresolvedShow.status).toBe("blocked");
    expect(externalBlockerReasons(unresolvedShow)).toContain("unresolved");
    expect(externalTreeNode(await globalDepTree(callerRoot, unresolved.meta.id, globalEnv), missingReferenceUri)).toMatchObject({
      external: true,
      projectId: "missing_project",
      workId: "bw_work_000000000001",
      reason: "unresolved",
      resolutionState: "unresolved-unlinked"
    });

    const old = new Date("2026-06-26T00:00:00.000Z");
    await utimes(join(registryRoot, "cache", "rollups", `${imported.entry.id}.json`), old, old);
    await rm(join(projectRoot, ".boreal", "rollup.json"), { force: true });

    const staleWatch = await runDaemonWatchOnce({ workspaceRoot: projectRoot, registryRoot, liveCacheTtlMs: 1 });
    expect(staleWatch.globalReadiness.blocked).toBeGreaterThanOrEqual(1);
    const staleShow = await showGlobalWork(callerRoot, registryRoot, global.meta.id, globalEnv);
    expect(staleShow.status).toBe("blocked");
    expect(externalBlockerReasons(staleShow)).toContain("stale");
    expect(externalTreeNode(await globalDepTree(callerRoot, global.meta.id, globalEnv), referenceUri)).toMatchObject({
      external: true,
      reason: "stale",
      resolutionState: "stale",
      stale: true
    });
  });
});

async function showGlobalWork(
  cwd: string,
  _registryRoot: string,
  workId: WorkId,
  env: Readonly<Record<string, string>>
): Promise<WorkShowResult> {
  return runJson<WorkShowResult>(cwd, [
    "work",
    "show",
    workId,
    "--global",
    "--json"
  ], { env });
}

function externalBlockerReasons(show: WorkShowResult): readonly string[] {
  return show.gaps.flatMap((gap) => gap.data?.externalBlockers?.map((blocker) => blocker.reason) ?? []);
}

async function globalDepTree(
  cwd: string,
  workId: WorkId,
  env: Readonly<Record<string, string>>
): Promise<DependencyTreeNode> {
  return runJson<DependencyTreeNode>(cwd, [
    "dep",
    "tree",
    workId,
    "--global",
    "--json"
  ], { env });
}

function externalTreeNode(tree: DependencyTreeNode, referenceUri: string): DependencyTreeNode {
  const node = flattenTree(tree).find((candidate) => candidate.referenceUri === referenceUri);
  expect(node, `expected dep tree to contain ${referenceUri}`).toBeDefined();
  return node as DependencyTreeNode;
}

function flattenTree(tree: DependencyTreeNode): readonly DependencyTreeNode[] {
  return [tree, ...tree.dependencies.flatMap((dependency) => flattenTree(dependency))];
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-global-readiness-"));
  tempDirs.push(dir);
  return dir;
}

async function runJson<T>(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<T> {
  expect(argv).toContain("--json");
  const result = await runCli(cwd, argv, options);
  expect(result.stderr).toBe("");
  expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
  return parseJson<{ readonly ok: true; readonly data: T }>(result.stdout).data;
}

async function runCli(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<CommandRun> {
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
  const previousEnv = new Map(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(options.env ?? {})) {
      process.env[key] = value;
    }
    const exitCode = await main([...argv], output, cwd);
    return { exitCode, stdout, stderr };
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
