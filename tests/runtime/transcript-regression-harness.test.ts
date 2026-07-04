import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../apps/cli/src/index.ts";
import { createResultSpoolingOutput, formatRecord, type CliOutput } from "../../apps/cli/src/output.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CliResultForTest {
  readonly schemaVersion: string;
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly subjectId: string;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("audited transcript replay regression harness", () => {
  it("replays prefixed workflow references", async () => {
    const rootDir = await makeTempWorkspace();
    const shown = await runCli(rootDir, ["workflows", "show", "workflows/40-work/closeout-work.md", "--json"]);
    const payload = parseData<{ readonly path: string; readonly title: string }>(shown.stdout);

    expect(shown.exitCode).toBe(0);
    expect(payload).toEqual(expect.objectContaining({ path: "40-work/closeout-work.md", title: "Closeout Work" }));
  });

  it("replays --parent flag recovery as --container", async () => {
    const rootDir = await makeTempWorkspace();
    const parent = await runCli(rootDir, ["work", "list", "--parent", "--json"]);
    const payload = parseJson<{
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly details: { readonly flag: string; readonly didYouMean: string };
    }>(parent.stderr);

    expect(parent.exitCode).toBe(2);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.message).toContain("Did you mean --container?");
    expect(payload.details).toEqual(expect.objectContaining({ flag: "parent", didYouMean: "--container" }));
  });

  it("replays mutation result blocks, sync refresh exits, and zero mid-stream health directives", async () => {
    const rootDir = await makeTempWorkspace();
    await runCli(rootDir, ["init", "--setup-memory", "--json"]);
    const refresh = await runCli(rootDir, ["sync", "refresh", "--json"]);
    const refreshPayload = parseData<{ readonly refreshOk: boolean; readonly postRefreshStatusOk: boolean }>(refresh.stdout);

    expect(refresh.exitCode).toBe(0);
    expect(refreshPayload).toEqual(expect.objectContaining({ refreshOk: true, postRefreshStatusOk: true }));

    const createdRun = await runCli(rootDir, ["work", "create", "Transcript replay closeout", "--ready", "--json"]);
    const created = parseData<{ readonly meta: { readonly id: string }; readonly result: CliResultForTest }>(createdRun.stdout);
    expect(created.result).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.result.v1",
        id: created.meta.id,
        kind: "task",
        status: "ready"
      })
    );

    const evidenceRun = await runCli(rootDir, [
      "evidence",
      "add",
      created.meta.id,
      "--summary",
      "Transcript replay evidence.",
      "--kind",
      "test",
      "--outcome",
      "passed",
      "--json"
    ]);
    expectNoDoctorRecoveryDirective(evidenceRun);
    const evidence = parseData<{ readonly meta: { readonly id: string }; readonly result: CliResultForTest }>(evidenceRun.stdout);
    expect(evidence.result).toEqual(
      expect.objectContaining({ schemaVersion: "boreal.cli.result.v1", kind: "evidence", status: "passed" })
    );

    const verifiedRun = await runCli(rootDir, [
      "work",
      "verify",
      created.meta.id,
      "--evidence",
      evidence.meta.id,
      "--verdict",
      "passed",
      "--json"
    ]);
    expectNoDoctorRecoveryDirective(verifiedRun);
    const verified = parseData<{ readonly meta: { readonly id: string }; readonly result: CliResultForTest }>(verifiedRun.stdout);
    expect(verified.result).toEqual(
      expect.objectContaining({ schemaVersion: "boreal.cli.result.v1", kind: "verification", status: "passed" })
    );

    const summarizedRun = await runCli(rootDir, [
      "summary",
      "compose",
      created.meta.id,
      "--dirty-path",
      "git_unavailable: transcript replay fixture",
      "--json"
    ]);
    expectNoDoctorRecoveryDirective(summarizedRun);
    const summarized = parseData<{ readonly summary: { readonly meta: { readonly id: string } }; readonly result: CliResultForTest }>(
      summarizedRun.stdout
    );
    expect(summarized.result).toEqual(
      expect.objectContaining({ schemaVersion: "boreal.cli.result.v1", kind: "summary", status: "final" })
    );

    const closedRun = await runCli(rootDir, [
      "work",
      "close",
      created.meta.id,
      "--reason",
      "transcript replay closeout passed",
      "--dirty-path",
      "git_unavailable: transcript replay fixture",
      "--json"
    ]);
    expectNoDoctorRecoveryDirective(closedRun);
    const closed = parseData<{ readonly work: { readonly meta: { readonly id: string }; readonly status: string }; readonly result: CliResultForTest }>(
      closedRun.stdout
    );
    expect(closed.result).toEqual({
      schemaVersion: "boreal.cli.result.v1",
      id: closed.work.meta.id,
      kind: "task",
      status: "closed",
      subjectId: closed.work.meta.id
    });
  });

  it("replays truncated doctor verdict paths", async () => {
    const rootDir = await makeTempWorkspace();
    await mkdir(join(rootDir, ".boreal", "results"), { recursive: true });
    const truncated = await spoolVerdict(rootDir, "doctor", 100);

    expect(truncated.data.ok).toBe(false);
    expect(truncated.data.fixed).toBe(true);
    expect(truncated.data.blockingDiagnosticCodes).toEqual(["operation.volume"]);
    expect(truncated.data.truncated).toBe(true);
    expect(truncated.data.command).toBe("doctor");

    const fullResult = parseJson<{ readonly ok: true; readonly data: { readonly ok: boolean; readonly fixed: boolean } }>(
      await readFile(join(rootDir, truncated.data.fullResultPath), "utf8")
    );
    expect(fullResult.data).toEqual(expect.objectContaining({ ok: false, fixed: true }));
  });

  it("keeps the documented golden-path ceremony under invocation and JSON byte budgets", async () => {
    const rootDir = await makeTempWorkspace();
    const stats = { invocations: 0, stdoutBytes: 0 };
    const run = async (argv: readonly string[]) => {
      const result = await runCli(rootDir, argv);
      stats.invocations += 1;
      stats.stdoutBytes += Buffer.byteLength(result.stdout, "utf8");
      expect(result.exitCode, argv.join(" ")).toBe(0);
      expect(result.stderr, argv.join(" ")).toBe("");
      return result;
    };

    await run(["init", "--setup-memory", "--json"]);
    await run(["sync", "refresh", "--json"]);
    const sprint = parseData<{ readonly meta: { readonly id: string } }>(
      (await run(["work", "create", "Ceremony budget sprint", "--kind", "sprint", "--ready", "--json"])).stdout
    );

    for (let index = 1; index <= 3; index += 1) {
      const split = parseData<{ readonly child: { readonly meta: { readonly id: string } } }>(
        (
          await run([
            "work",
            "split",
            sprint.meta.id,
            "--title",
            `Ceremony budget task ${index}`,
            "--ready",
            "--json"
          ])
        ).stdout
      );
      await run([
        "agent",
        "finish",
        split.child.meta.id,
        "--agent",
        "ceremony-budget-agent",
        "--summary",
        `Ceremony budget task ${index} complete.`,
        "--kind",
        "test",
        "--command",
        "true",
        "--close",
        "--reason",
        `ceremony budget task ${index} complete`,
        "--dirty-path",
        "git_unavailable: ceremony budget fixture",
        "--json"
      ]);
    }

    const closed = parseData<{ readonly result: CliResultForTest }>(
      (
        await run([
          "sprint",
          "close",
          sprint.meta.id,
          "--reason",
          "ceremony budget sprint complete",
          "--auto-report",
          "--report-out",
          ".boreal/results/ceremony-budget.md",
          "--dirty-path",
          "git_unavailable: ceremony budget fixture",
          "--json"
        ])
      ).stdout
    );

    expect(closed.result).toEqual(
      expect.objectContaining({ schemaVersion: "boreal.cli.result.v1", id: sprint.meta.id, kind: "sprint", status: "closed" })
    );
    expect(stats.invocations).toBeLessThanOrEqual(10);
    expect(stats.stdoutBytes).toBeLessThanOrEqual(220_000);
  }, 45_000);
});

interface TruncatedVerdictPayload {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly blockingDiagnosticCodes: readonly string[];
  readonly truncated: true;
  readonly command: string;
  readonly fullResultPath: string;
}

async function spoolVerdict(workspaceRoot: string, command: "doctor", maxResultSizeChars: number): Promise<{
  readonly data: TruncatedVerdictPayload;
}> {
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
  const spoolingOutput = createResultSpoolingOutput(output, {
    workspaceRoot,
    command,
    maxResultSizeChars
  });

  spoolingOutput.write(formatRecord(verdictPayload(), true));
  await spoolingOutput.flush();

  expect(stderr).toBe("");
  return parseJson<{ readonly ok: true; readonly data: TruncatedVerdictPayload }>(stdout);
}

function verdictPayload(): {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly blockingDiagnosticCodes: readonly string[];
  readonly diagnostics: readonly Array<{ readonly code: string; readonly message: string }>;
} {
  return {
    ok: false,
    fixed: true,
    blockingDiagnosticCodes: ["operation.volume"],
    diagnostics: Array.from({ length: 20 }, (_, index) => ({
      code: index === 0 ? "operation.volume" : `diagnostic.${index}`,
      message: "x".repeat(250)
    }))
  };
}

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-transcript-regression-"));
  tempDirs.push(dir);
  return dir;
}

async function runCli(cwd: string, argv: readonly string[]): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  const output = {
    write(text: string) {
      stdout += text;
    },
    error(text: string) {
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

function expectNoDoctorRecoveryDirective(result: CommandRun): void {
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("doctor.recovery-required");
  expect(result.stdout).not.toContain("search.index-stale");
}
