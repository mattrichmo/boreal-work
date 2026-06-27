import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DAEMON_STATUS_SCHEMA_VERSION,
  daemonStatusPath,
  inspectDaemonStatus,
  runDaemonWatchOnce,
  writeDaemonRunningStatus,
  writeDaemonStoppedStatus
} from "@boreal/daemon";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("boreal daemon runtime", () => {
  it("handles missing or renamed projects without watching paths", async () => {
    const root = join(await makeTempDir(), "missing-project");
    const status = await inspectDaemonStatus({ workspaceRoot: root });
    const watch = await runDaemonWatchOnce({ workspaceRoot: root });

    expect(status.state).toBe("missing");
    expect(status.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "daemon.project_missing", severity: "error" })])
    );
    expect(watch).toEqual(expect.objectContaining({ action: "skipped", reason: "project_boundary_unhealthy" }));
    expect(watch.observedPaths).toEqual([]);
  });

  it("reports running, stopped, and stale PID daemon states", async () => {
    const root = await makeProjectWorkspace();
    await writeDaemonRunningStatus({ workspaceRoot: root, now: () => "2026-06-27T00:00:00.000Z" });

    const running = await inspectDaemonStatus({
      workspaceRoot: root,
      pidExists: (pid) => pid === process.pid,
      now: () => "2026-06-27T00:00:01.000Z"
    });
    expect(running.state).toBe("running");
    expect(running.processAlive).toBe(true);

    await writeDaemonStoppedStatus({ workspaceRoot: root, now: () => "2026-06-27T00:00:02.000Z" });
    const stopped = await inspectDaemonStatus({ workspaceRoot: root, pidExists: () => false });
    expect(stopped.state).toBe("stopped");

    await writeFile(
      daemonStatusPath(root),
      `${JSON.stringify(
        {
          schemaVersion: DAEMON_STATUS_SCHEMA_VERSION,
          workspaceRoot: root,
          projectRoot: root,
          memoryRoot: join(root, "memory"),
          memoryLayout: "in-repo",
          pid: 999_999,
          state: "running",
          startedAt: "2026-06-27T00:00:00.000Z",
          updatedAt: "2026-06-27T00:00:00.000Z"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const stale = await inspectDaemonStatus({ workspaceRoot: root, pidExists: () => false });
    expect(stale.state).toBe("stale");
    expect(stale.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "daemon.pid_stale" })]));
  });

  it("skips watch work while runtime locks are active and keeps repairs command-mediated", async () => {
    const root = await makeProjectWorkspace();
    const lockDir = join(root, ".boreal/runtime/state.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      join(lockDir, "owner.json"),
      `${JSON.stringify({
        token: "test-lock",
        pid: process.pid,
        hostname: "test-host",
        createdAt: new Date().toISOString()
      })}\n`,
      "utf8"
    );

    const watch = await runDaemonWatchOnce({ workspaceRoot: root, pidExists: () => false });

    expect(watch.action).toBe("skipped");
    expect(watch.reason).toBe("lock_conflict");
    expect(watch.status.locks.runtime.status).toBe("active");
    expect(watch.status.watch.writesTruth).toBe(false);
    expect(watch.status.watch.repairsAreCommandMediated).toBe(true);
  });

  it("observes bounded project paths when the project and locks are healthy", async () => {
    const root = await makeProjectWorkspace();
    const watch = await runDaemonWatchOnce({ workspaceRoot: root });

    expect(watch.action).toBe("observed");
    expect(watch.observedPaths).toEqual(
      expect.arrayContaining([
        join(root, ".boreal/runtime/state.json"),
        join(root, ".boreal/runtime/search-index.json"),
        join(root, ".boreal/ledgers/manifest.json"),
        join(root, "memory")
      ])
    );
  });
});

async function makeProjectWorkspace(): Promise<string> {
  const root = await makeTempDir();
  await mkdir(join(root, ".boreal/runtime"), { recursive: true });
  await mkdir(join(root, "memory"), { recursive: true });
  await writeFile(
    join(root, ".boreal/project.json"),
    `${JSON.stringify(
      {
        schemaVersion: "boreal.project-setup.v1",
        projectRoot: root,
        memoryRoot: join(root, "memory"),
        memoryLayout: "in-repo",
        memoryGitMode: "shared",
        installRoot: join(root, ".agents/skills"),
        skillTargets: ["codex"],
        folderScoped: false,
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return root;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-daemon-"));
  tempDirs.push(dir);
  return dir;
}
