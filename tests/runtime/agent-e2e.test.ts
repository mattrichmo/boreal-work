import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import { FileEventLog } from "../../packages/storage/src/event-log.ts";

const AGENT_ID = "agent-e2e";
const AGENT_LABEL = "agent-e2e";
const RESULT_ROOT = ".boreal/results/agent-e2e";

const AGENT_E2E_STEPS = [
  { id: "init", requires: [], title: "Initialize local project and memory vault" },
  { id: "agent-guide", requires: ["init"], title: "Read the machine-readable agent command guide" },
  { id: "session-start", requires: ["agent-guide"], title: "Start a scoped agent session" },
  { id: "prime", requires: ["session-start"], title: "Prime the agent with current sync and queue state" },
  { id: "raw-add", requires: ["prime"], title: "Add immutable raw source material" },
  { id: "raw-show", requires: ["raw-add"], title: "Retrieve the raw source before promotion" },
  { id: "wiki-create", requires: ["raw-show"], title: "Reconcile raw material into source-backed wiki memory" },
  { id: "sprint-create", requires: ["wiki-create"], title: "Create the sprint container" },
  { id: "task-create", requires: ["sprint-create"], title: "Create source-backed sprint work" },
  { id: "dep-add", requires: ["task-create"], title: "Attach the work to the sprint graph" },
  { id: "work-ready", requires: ["dep-add"], title: "Mark only claimable work ready" },
  { id: "sprint-activate", requires: ["work-ready"], title: "Activate the sprint explicitly" },
  { id: "sprint-board", requires: ["sprint-activate"], title: "Verify the sprint board projection" },
  { id: "agent-start", requires: ["sprint-board"], title: "Claim the next ready work through agent start" },
  { id: "agent-finish", requires: ["agent-start"], title: "Finish with evidence, verification, close, and release" },
  { id: "sync-refresh", requires: ["agent-finish"], title: "Refresh generated collaboration artifacts" },
  { id: "doctor-strict", requires: ["sync-refresh"], title: "Run strict health verification" },
  { id: "export-json", requires: ["doctor-strict"], title: "Export portable JSON project truth" },
  { id: "export-markdown", requires: ["export-json"], title: "Export Markdown project truth" },
  { id: "export-ledgers", requires: ["export-markdown"], title: "Export JSONL ledger artifacts" },
  { id: "session-end", requires: ["export-ledgers"], title: "End the agent session with operation summary" }
] as const;

type AgentE2eStepId = (typeof AGENT_E2E_STEPS)[number]["id"];
type AgentE2eStep = (typeof AGENT_E2E_STEPS)[number];

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent E2E fixture", () => {
  it("documents and runs the ordered local-project-safe agent workflow with JSON outputs", async () => {
    assertEncodedPrerequisiteOrder();
    await expectDocsMatchStepOrder();

    const rootDir = await makeTempWorkspace();
    await writeFile(
      join(rootDir, "agent-e2e-source.md"),
      "# Agent E2E Source\n\nFixture source for the ordered agent workflow.\n",
      "utf8"
    );
    const completed: AgentE2eStepId[] = [];

    const init = await runJsonStep<{
      readonly initialized: boolean;
      readonly projectSetup: { readonly config: { readonly projectRoot: string; readonly memoryRoot: string } };
    }>(rootDir, completed, "init", ["init", "--setup-memory", "--memory-root", "memory", "--json"]);
    expect(init.initialized).toBe(true);
    expect(init.projectSetup.config.projectRoot).toBe(rootDir);
    expect(init.projectSetup.config.memoryRoot).toBe(join(rootDir, "memory"));

    const guide = await runJsonStep<{
      readonly commands: { readonly start: string; readonly finish: string; readonly repair: string };
      readonly loop: Array<{ readonly step: string; readonly command: string }>;
    }>(rootDir, completed, "agent-guide", ["agent", "guide", "--agent", AGENT_ID, "--label", AGENT_LABEL, "--json"]);
    expect(guide.commands.start).toContain("--json");
    expect(guide.commands.finish).toContain("bwrk agent finish");
    expect(guide.commands.repair).toBe("bwrk doctor --fix --json");
    expect(guide.loop.map((step) => step.step)).toEqual([
      "Check coordination state",
      "Start or resume work",
      "Renew if work continues",
      "Finish with evidence",
      "Release if stopping"
    ]);

    const session = await runJsonStep<{ readonly sessionId: string; readonly commands: { readonly prime: string } }>(
      rootDir,
      completed,
      "session-start",
      ["session", "start", "--agent", AGENT_ID, "--label", AGENT_LABEL, "--actor", AGENT_ID, "--actor-kind", "agent", "--json"]
    );
    expect(session.sessionId).toMatch(/^session-[a-f0-9]{12}$/);
    expect(session.commands.prime).toContain(`--session ${session.sessionId}`);
    const sessionFlags = ["--session", session.sessionId, "--actor", AGENT_ID, "--actor-kind", "agent"] as const;
    const agentFlags = [...sessionFlags, "--agent", AGENT_ID, "--label", AGENT_LABEL] as const;

    const primed = await runJsonStep<{
      readonly sessionId: string;
      readonly sync: { readonly ok: boolean; readonly recommendedActions: readonly string[] };
      readonly commands: { readonly syncStatus: string; readonly doctor: string };
    }>(rootDir, completed, "prime", ["prime", ...agentFlags, "--json"]);
    expect(primed.sessionId).toBe(session.sessionId);
    expect(primed.sync.ok).toBe(false);
    expect(primed.sync.recommendedActions).toEqual(expect.arrayContaining(["bwrk sync refresh --json"]));
    expect(primed.commands.syncStatus).toContain("--json");
    expect(primed.commands.doctor).toContain("--json");

    const raw = await runJsonStep<{
      readonly added: true;
      readonly indexPath: string;
      readonly record: { readonly id: string; readonly uri: string; readonly tags: readonly string[] };
    }>(rootDir, completed, "raw-add", [
      "raw",
      "add",
      "--title",
      "Agent E2E Source",
      "--uri",
      "agent-e2e-source.md",
      "--summary",
      "Fixture source for the ordered agent workflow.",
      "--tag",
      AGENT_LABEL,
      ...sessionFlags,
      "--json"
    ]);
    expect(raw.added).toBe(true);
    expect(raw.record.id).toMatch(/^bw_source_/);
    expect(raw.record.uri).toBe("agent-e2e-source.md");
    expect(raw.record.tags).toEqual([AGENT_LABEL]);
    expectWorkspacePath(rootDir, raw.indexPath);

    const rawDetail = await runJsonStep<{
      readonly id: string;
      readonly processingStatus: string;
      readonly preview: { readonly status: string; readonly path?: string; readonly body?: string };
    }>(rootDir, completed, "raw-show", ["raw", "show", raw.record.id, "--preview-bytes", "2048", ...sessionFlags, "--json"]);
    expect(rawDetail.id).toBe(raw.record.id);
    expect(rawDetail.processingStatus).toBe("queued");
    expect(rawDetail.preview.status).toBe("available");
    expect(rawDetail.preview.body).toContain("Fixture source");
    expectWorkspacePath(rootDir, rawDetail.preview.path);

    const wiki = await runJsonStep<{
      readonly created: true;
      readonly path: string;
      readonly page: { readonly path: string; readonly sourceRefs: readonly string[] };
    }>(rootDir, completed, "wiki-create", [
      "wiki",
      "create",
      "Agent E2E Notes",
      "--slug",
      "agent-e2e-notes",
      "--summary",
      "Source-backed notes for the ordered agent fixture.",
      "--source",
      raw.record.id,
      "--tag",
      AGENT_LABEL,
      ...sessionFlags,
      "--json"
    ]);
    expect(wiki.created).toBe(true);
    expect(wiki.page.path).toBe("memory/wiki/agent-e2e-notes.md");
    expect(wiki.page.sourceRefs).toEqual([raw.record.id]);
    expectWorkspacePath(rootDir, wiki.path);

    const sprint = await runJsonStep<{ readonly meta: { readonly id: string }; readonly kind: string }>(
      rootDir,
      completed,
      "sprint-create",
      [
        "work",
        "create",
        "Agent E2E Sprint",
        "--kind",
        "sprint",
        "--label",
        AGENT_LABEL,
        "--acceptance",
        "Strict doctor passes after agent closeout.",
        ...sessionFlags,
        "--json"
      ]
    );
    expect(sprint.kind).toBe("sprint");

    const task = await runJsonStep<{
      readonly meta: { readonly id: string; readonly sourceRefs: readonly Array<{ readonly uri: string }> };
      readonly status: string;
    }>(rootDir, completed, "task-create", [
      "work",
      "create",
      "Agent E2E Implementation",
      "--kind",
      "task",
      "--priority",
      "high",
      "--label",
      AGENT_LABEL,
      "--acceptance",
      "Fixture command output stays JSON and local.",
      "--source",
      `raw:${raw.record.id}`,
      ...sessionFlags,
      "--json"
    ]);
    expect(task.status).toBe("draft");
    expect(task.meta.sourceRefs).toEqual([{ uri: `raw:${raw.record.id}` }]);

    await runJsonStep<{ readonly kind: string; readonly fromId: string; readonly toId: string }>(
      rootDir,
      completed,
      "dep-add",
      ["dep", "add", sprint.meta.id, task.meta.id, ...sessionFlags, "--json"]
    );

    const ready = await runJsonStep<{ readonly meta: { readonly id: string }; readonly status: string }>(
      rootDir,
      completed,
      "work-ready",
      ["work", "ready", task.meta.id, ...sessionFlags, "--json"]
    );
    expect(ready.meta.id).toBe(task.meta.id);
    expect(ready.status).toBe("ready");

    const activated = await runJsonStep<{ readonly activeSprintId: string; readonly workspaceRoot: string }>(
      rootDir,
      completed,
      "sprint-activate",
      ["sprint", "activate", sprint.meta.id, ...sessionFlags, "--json"]
    );
    expect(activated.activeSprintId).toBe(sprint.meta.id);
    expect(activated.workspaceRoot).toBe(rootDir);

    const board = await runJsonStep<{
      readonly active: boolean;
      readonly selectedSprintId: string;
      readonly board: { readonly summary: { readonly sprintId: string; readonly taskCount: number } };
    }>(rootDir, completed, "sprint-board", ["sprint", "board", ...sessionFlags, "--json"]);
    expect(board.active).toBe(true);
    expect(board.selectedSprintId).toBe(sprint.meta.id);
    expect(board.board.summary).toEqual(expect.objectContaining({ sprintId: sprint.meta.id, taskCount: 1 }));

    const started = await runJsonStep<{
      readonly started: true;
      readonly action: string;
      readonly work: { readonly id: string; readonly status: string };
      readonly reservation: { readonly meta: { readonly id: string } };
    }>(rootDir, completed, "agent-start", [
      "agent",
      "start",
      ...agentFlags,
      "--purpose",
      "run ordered fixture",
      "--json"
    ]);
    expect(started).toEqual(
      expect.objectContaining({
        started: true,
        action: "claimed_work",
        work: expect.objectContaining({ id: task.meta.id, status: "in_progress" })
      })
    );
    expect(started.reservation.meta.id).toMatch(/^bw_reservation_/);

    const finished = await runJsonStep<{
      readonly finished: true;
      readonly action: string;
      readonly work: { readonly id: string; readonly status: string; readonly contextSummary: string };
      readonly evidence: { readonly meta: { readonly id: string } };
      readonly verification: { readonly meta: { readonly id: string }; readonly verdict: string };
      readonly reservation: { readonly status: string };
    }>(rootDir, completed, "agent-finish", [
      "agent",
      "finish",
      "current",
      ...sessionFlags,
      "--agent",
      AGENT_ID,
      "--summary",
      "Ordered agent E2E fixture passed.",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--command",
      "agent-e2e fixture",
      "--verdict",
      "passed",
	      "--close",
	      "--reason",
	      "Verified by ordered fixture.",
	      "--dirty-path",
	      "no_repo_changes: agent e2e fixture",
	      "--json"
	    ]);
    expect(finished.action).toBe("verified_and_closed");
    expect(finished.work).toEqual(expect.objectContaining({ id: task.meta.id, status: "closed" }));
    expect(finished.work.contextSummary).toContain("is closed");
    expect(finished.evidence.meta.id).toMatch(/^bw_evidence_/);
    expect(finished.verification.verdict).toBe("passed");
    expect(finished.reservation.status).toBe("released");

    const refresh = await runJsonStep<{
      readonly refreshOk: boolean;
      readonly postRefreshStatusOk: boolean;
      readonly status: { readonly ok: boolean };
      readonly ledgers: { readonly manifestPath: string };
      readonly searchIndex: { readonly path: string };
    }>(rootDir, completed, "sync-refresh", ["sync", "refresh", ...sessionFlags, "--json"]);
    expect(refresh.refreshOk).toBe(true);
    expect(refresh.postRefreshStatusOk).toBe(true);
    expect(refresh.status.ok).toBe(true);
    expectWorkspacePath(rootDir, refresh.ledgers.manifestPath);
    expectWorkspacePath(rootDir, refresh.searchIndex.path);

    const doctor = await runJsonStep<{
      readonly ok: boolean;
      readonly diagnostics: Array<{ readonly code: string; readonly severity: string }>;
    }>(rootDir, completed, "doctor-strict", ["doctor", "--strict", ...sessionFlags, "--json"]);
    expect(doctor.ok).toBe(true);
    expect(doctor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "vault.health", severity: "ok" }),
        expect.objectContaining({ code: "ledger.export_drift", severity: "ok" }),
        expect.objectContaining({ code: "search.index", severity: "ok" })
      ])
    );

    const jsonExport = await runJsonStep<{
      readonly path: string;
      readonly contentHash: string;
      readonly recordCounts: { readonly workItems: number };
    }>(rootDir, completed, "export-json", [
      "export",
      "json",
      "--out",
      `${RESULT_ROOT}/export.json`,
      ...sessionFlags,
      "--json"
    ]);
    expect(jsonExport.contentHash).toMatch(/^sha256:/);
    expect(jsonExport.recordCounts.workItems).toBeGreaterThanOrEqual(2);
    expectWorkspacePath(rootDir, jsonExport.path);
    const exportDocument = parseJson<{
      readonly schemaVersion: string;
      readonly state: { readonly workItems: Array<{ readonly title: string }>; readonly operations?: unknown };
    }>(await readFile(jsonExport.path, "utf8"));
    expect(exportDocument.schemaVersion).toBe("boreal.export.v1");
    expect(exportDocument.state.workItems.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Agent E2E Sprint", "Agent E2E Implementation"])
    );
    expect(exportDocument.state.operations).toBeUndefined();

    const markdownExport = await runJsonStep<{ readonly outDir: string; readonly files: readonly string[] }>(
      rootDir,
      completed,
      "export-markdown",
      ["export", "markdown", "--out", `${RESULT_ROOT}/markdown`, ...sessionFlags, "--json"]
    );
    expectWorkspacePath(rootDir, markdownExport.outDir);
    expect(markdownExport.files.some((file) => file.endsWith(`/work/${task.meta.id}.md`))).toBe(true);
    for (const file of markdownExport.files) {
      expectWorkspacePath(rootDir, file);
    }

    const ledgerExport = await runJsonStep<{
      readonly outDir: string;
      readonly manifestPath: string;
      readonly files: Array<{ readonly section: string; readonly path: string }>;
    }>(rootDir, completed, "export-ledgers", [
      "export",
      "ledgers",
      "--out",
      `${RESULT_ROOT}/ledgers`,
      ...sessionFlags,
      "--json"
    ]);
    expectWorkspacePath(rootDir, ledgerExport.outDir);
    expectWorkspacePath(rootDir, ledgerExport.manifestPath);
    expect(ledgerExport.files.map((file) => file.section)).toEqual(expect.arrayContaining(["workItems", "events"]));
    expect(ledgerExport.files.map((file) => file.section)).not.toContain("operations");

    const ended = await runJsonStep<{
      readonly sessionId: string;
      readonly operations: { readonly failed: number; readonly recent: Array<{ readonly commandPath: string }> };
    }>(rootDir, completed, "session-end", ["session", "end", "--id", session.sessionId, "--agent", AGENT_ID, "--label", AGENT_LABEL, "--json"]);
    expect(ended.sessionId).toBe(session.sessionId);
    expect(ended.operations.failed).toBe(0);

    expect(completed).toEqual(AGENT_E2E_STEPS.map((step) => step.id));
    const operations = await readRuntimeOperations(rootDir);
    expectInOrder(
      operations.filter((operation) => operation.sessionId === session.sessionId).map((operation) => operation.commandPath),
      [
        "session start",
        "prime",
        "raw add",
        "raw show",
        "wiki create",
        "work create",
        "work create",
        "dep add",
        "work ready",
        "sprint activate",
        "sprint board",
        "agent start",
        "agent finish",
        "sync refresh",
        "export json",
        "export markdown",
        "export ledgers",
        "session end"
      ]
    );
  }, 60_000);
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "boreal-agent-e2e-")));
  tempDirs.push(dir);
  return dir;
}

async function readRuntimeOperations(
  rootDir: string
): Promise<Array<{ readonly sessionId: string; readonly commandPath: string }>> {
  const entries = await new FileEventLog({ path: join(rootDir, ".boreal/log/events.jsonl") }).readAll();
  const operations = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (entry.kind !== "operation") {
      continue;
    }
    const record = entry.record as unknown as Record<string, unknown>;
    const meta = record.meta as Record<string, unknown> | undefined;
    const id = typeof meta?.id === "string" ? meta.id : undefined;
    if (!id) {
      continue;
    }
    if (record.tombstone === true) {
      operations.delete(id);
      continue;
    }
    operations.delete(id);
    operations.set(id, record);
  }
  return [...operations.values()] as Array<{ readonly sessionId: string; readonly commandPath: string }>;
}

async function runJsonStep<T>(
  cwd: string,
  completed: AgentE2eStepId[],
  stepId: AgentE2eStepId,
  argv: readonly string[]
): Promise<T> {
  expect(argv, `${stepId} must request JSON output`).toContain("--json");
  expectStepReady(completed, stepId);
  const result = await runCli(cwd, argv);
  expect(result.stderr, `${stepId} stderr`).toBe("");
  expect(result.exitCode, `${stepId} exit stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
  const envelope = parseJson<{ readonly ok: true; readonly data: T }>(result.stdout);
  expect(envelope.ok, `${stepId} JSON envelope`).toBe(true);
  completed.push(stepId);
  return envelope.data;
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

function expectStepReady(completed: readonly AgentE2eStepId[], stepId: AgentE2eStepId): void {
  const step = stepDefinition(stepId);
  expect(completed, `${stepId} must run once`).not.toContain(stepId);
  for (const required of step.requires) {
    expect(completed, `${stepId} requires ${required}`).toContain(required);
  }
}

function assertEncodedPrerequisiteOrder(): void {
  const positions = new Map(AGENT_E2E_STEPS.map((step, index) => [step.id, index] as const));
  for (const [index, step] of AGENT_E2E_STEPS.entries()) {
    for (const required of step.requires) {
      const requiredIndex = positions.get(required);
      expect(requiredIndex, `${step.id} references an unknown prerequisite ${required}`).not.toBeUndefined();
      expect(requiredIndex ?? Number.POSITIVE_INFINITY, `${step.id} must come after ${required}`).toBeLessThan(index);
    }
  }
}

async function expectDocsMatchStepOrder(): Promise<void> {
  const doc = await readFile(new URL("../../docs/architecture/AGENT_E2E_FIXTURE.md", import.meta.url), "utf8");
  for (const step of AGENT_E2E_STEPS) {
    const requires = step.requires.length > 0 ? step.requires.join(", ") : "none";
    expect(doc).toContain(`| \`${step.id}\` | \`${requires}\` | ${step.title} |`);
  }
  expect(doc).toContain("Every automated command in the fixture uses `--json`.");
  expect(doc).toContain(RESULT_ROOT);
  expect(doc).toContain("workspace-relative raw URI");
}

function stepDefinition(stepId: AgentE2eStepId): AgentE2eStep {
  const step = AGENT_E2E_STEPS.find((entry) => entry.id === stepId);
  if (!step) {
    throw new Error(`Unknown agent E2E step: ${stepId}`);
  }
  return step;
}

function expectWorkspacePath(rootDir: string, path: string | undefined): void {
  expect(path, "path must be present").toBeTruthy();
  const resolved = isAbsolute(path ?? "") ? path ?? "" : join(rootDir, path ?? "");
  const workspaceRelative = relative(rootDir, resolved);
  expect(
    workspaceRelative === "" || (!workspaceRelative.startsWith("..") && !isAbsolute(workspaceRelative)),
    `${path} should resolve inside ${rootDir}`
  ).toBe(true);
}

function expectInOrder(actual: readonly string[], expected: readonly string[]): void {
  let searchFrom = 0;
  for (const command of expected) {
    const index = actual.indexOf(command, searchFrom);
    expect(index, `${command} should appear after index ${searchFrom - 1} in ${actual.join(" -> ")}`).toBeGreaterThanOrEqual(searchFrom);
    searchFrom = index + 1;
  }
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}
