import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DAEMON_STATUS_SCHEMA_VERSION,
  compileDaemonDirectiveObligations,
  daemonStatusPath,
  refreshGlobalRollupCache,
  inspectDaemonStatus,
  runDaemonCli,
  runDaemonWatchOnce,
  writeDaemonRunningStatus,
  writeDaemonStoppedStatus
} from "@boreal/daemon";
import {
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  PROJECT_ROLLUP_SCHEMA_VERSION,
  createAgentDirectiveSnapshot,
  deriveProjectRegistryIdentity,
  hashContent,
  projectRegistryEntryIdFromIdentity,
  resolveProjectRegistryPaths,
  type ContentHash,
  type IsoTimestamp,
  type ProjectRegistryEntry,
  type ProjectRollupDocument,
  type WorkId
} from "@boreal/core";
import { objectIndexPath } from "@boreal/storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("boreal daemon runtime", () => {
  it("fails closed on malformed project setup and returns a nonzero daemon status", async () => {
    const root = await makeProjectWorkspace();
    await writeFile(join(root, ".boreal/project.json"), "{\"token\":\"setup-secret\"\n", "utf8");

    const status = await inspectDaemonStatus({ workspaceRoot: root });
    expect(status.state).toBe("drift");
    expect(status.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "daemon.setup_invalid", severity: "error" })
      ])
    );
    expect(JSON.stringify(status)).not.toContain("setup-secret");

    const watch = await runDaemonWatchOnce({ workspaceRoot: root });
    expect(watch.action).toBe("skipped");
    expect(watch.reason).toBe("project_boundary_unhealthy");
    expect(watch.observedPaths).toEqual([]);

    let stdout = "";
    let stderr = "";
    const exitCode = await runDaemonCli(["status", "--workspace", root], {
      write(text) {
        stdout += text;
      },
      error(text) {
        stderr += text;
      }
    });
    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ state: "drift" });
  });

  it("fails closed on invalid project roots and skips daemon watch work", async () => {
    const root = await makeProjectWorkspace();
    await writeFile(
      join(root, ".boreal/project.json"),
      `${JSON.stringify(
        {
          schemaVersion: "boreal.project-setup.v1",
          projectRoot: join(root, "nested-project"),
          memoryRoot: join(root, "memory"),
          memoryLayout: "in-repo"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const status = await inspectDaemonStatus({ workspaceRoot: root });
    expect(status.state).toBe("drift");
    expect(status.projectRoot).toBeUndefined();
    expect(status.memoryRoot).toBeUndefined();
    expect(status.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "daemon.boundary", severity: "error" })])
    );

    const watch = await runDaemonWatchOnce({ workspaceRoot: root });
    expect(watch).toEqual(expect.objectContaining({ action: "skipped", reason: "project_boundary_unhealthy" }));
    expect(watch.reservationRenewals.renewed).toEqual([]);
    expect(watch.executionRuns.expired).toEqual([]);
    expect(watch.executionRuns.requeued).toEqual([]);
    expect(watch.observedPaths).toEqual([]);
  });

  it("returns a nonzero exit code and bounded JSON diagnostics for corrupt daemon status", async () => {
    const root = await makeProjectWorkspace();
    await mkdir(join(root, ".boreal/daemon"), { recursive: true });
    await writeFile(join(root, ".boreal/daemon/status.json"), "{\"password\":\"status-secret\"\n", "utf8");

    let stdout = "";
    let stderr = "";
    const exitCode = await runDaemonCli(["status", "--workspace", root], {
      write(text) {
        stdout += text;
      },
      error(text) {
        stderr += text;
      }
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toMatchObject({ ok: false, code: "BOREAL_INVALID_INPUT" });
    expect(stderr).not.toContain("status-secret");
  });

  it("handles missing or renamed projects without watching paths", async () => {
    const root = join(await makeTempDir(), "missing-project");
    const status = await inspectDaemonStatus({ workspaceRoot: root });
    const watch = await runDaemonWatchOnce({ workspaceRoot: root });

    expect(status.state).toBe("missing");
    expect(status.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "daemon.project_missing", severity: "error" })])
    );
    expect(status.directiveObligations.summary.emittedRegistryIds).toEqual([
      "doctor.recovery-required",
      "workflow_next.canonical-next-step"
    ]);
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
    expect(running.agentDirectives[0]?.directives.map((directive) => directive.registryId)).toEqual([
      "workflow_next.canonical-next-step"
    ]);

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
    expect(stale.directiveObligations.summary.emittedRegistryIds).toEqual([
      "doctor.recovery-required",
      "workflow_next.canonical-next-step"
    ]);
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
    expect(watch.status.directiveObligations.summary.emittedRegistryIds).toEqual(["workflow_next.canonical-next-step"]);
  });

  it("observes bounded project paths when the project and locks are healthy", async () => {
    const root = await makeProjectWorkspace();
    const registryRoot = await makeTempDir();
    const watch = await runDaemonWatchOnce({ workspaceRoot: root, registryRoot });

    expect(watch.action).toBe("observed");
    expect(watch.observedPaths).toEqual(
      expect.arrayContaining([
        join(root, ".boreal/runtime/state.json"),
        objectIndexPath(root),
        join(root, ".boreal/ledgers/manifest.json"),
        join(root, "memory")
      ])
    );
    expect(watch.status.directiveObligations.summary.emittedRegistryIds).toEqual([
      "workflow_next.canonical-next-step"
    ]);
  });

  it("refreshes linked project rollups into the global cache and degrades broken projects", async () => {
    const registryRoot = await makeTempDir();
    const linkedRoot = await makeProjectWorkspace();
    const pausedRoot = await makeProjectWorkspace();
    const brokenRoot = await makeProjectWorkspace();
    const linked = registryEntry(linkedRoot, "linked-project");
    const paused = registryEntry(pausedRoot, "paused-project", "paused");
    const broken = registryEntry(brokenRoot, "broken-project");
    await writeProjectRollup(linked, 3);
    await writeProjectRollup(paused, 9);
    await rm(brokenRoot, { recursive: true, force: true });
    await writeRegistry(registryRoot, [linked, paused, broken]);

    const watch = await runDaemonWatchOnce({
      workspaceRoot: linkedRoot,
      registryRoot,
      now: () => "2026-06-27T00:00:00.000Z"
    });

    expect(watch.action).toBe("observed");
    expect(watch.globalRollups).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.global-rollup-cache.v1",
        projectCount: 2,
        freshCount: 1,
        degradedCount: 1
      })
    );
    expect(watch.globalRollups.projects.map((project) => project.projectId)).not.toContain(paused.id);
    const linkedRow = watch.globalRollups.projects.find((project) => project.projectId === linked.id);
    expect(linkedRow).toEqual(
      expect.objectContaining({
        source: "daemon",
        status: "fresh",
        stale: false,
        sourceRollupPath: join(linkedRoot, ".boreal", "rollup.json")
      })
    );
    expect(linkedRow?.rollup?.counts.work.total).toBe(3);
    expect(parseJson<ProjectRollupDocument>(await readFile(linkedRow?.cachePath ?? "", "utf8")).projectId).toBe(linked.id);
    const brokenRow = watch.globalRollups.projects.find((project) => project.projectId === broken.id);
    expect(brokenRow).toEqual(expect.objectContaining({ source: "daemon", status: "degraded" }));
    expect(brokenRow?.error).toContain("Project rollup is missing");
  });

  it("serves lazy fresh-enough cache entries and marks stale cache beyond TTL when refresh fails", async () => {
    const registryRoot = await makeTempDir();
    const root = await makeProjectWorkspace();
    const entry = registryEntry(root, "lazy-project");
    await writeProjectRollup(entry, 2);
    await writeRegistry(registryRoot, [entry]);

    const warmed = await refreshGlobalRollupCache({
      registryRoot,
      source: "daemon",
      now: () => "2026-06-27T00:00:00.000Z"
    });
    const cachePath = warmed.projects[0]?.cachePath ?? "";
    await rm(join(root, ".boreal", "rollup.json"), { force: true });

    const freshEnough = await refreshGlobalRollupCache({
      registryRoot,
      source: "lazy",
      ttlMs: Number.MAX_SAFE_INTEGER,
      now: () => "2026-06-27T00:00:01.000Z"
    });
    expect(freshEnough.projects[0]).toEqual(expect.objectContaining({ source: "cache", status: "fresh", stale: false }));

    const old = new Date("2026-06-26T00:00:00.000Z");
    await utimes(cachePath, old, old);
    const stale = await refreshGlobalRollupCache({
      registryRoot,
      source: "lazy",
      ttlMs: 1,
      now: () => "2026-06-27T00:00:00.000Z"
    });
    expect(stale.projects[0]).toEqual(expect.objectContaining({ source: "cache", status: "stale", stale: true }));
    expect(stale.projects[0]?.error).toContain("Project rollup is missing");
  });

  it("lets daemon callers request bounded directive obligations for runtime contexts", async () => {
    const root = await makeProjectWorkspace();
    const result = await compileDaemonDirectiveObligations({
      workspaceRoot: root,
      context: "work",
      snapshot: daemonWorkSnapshot(root)
    });

    expect(result.workspaceRoot).toBe(root);
    expect(result.projectRoot).toBe(root);
    expect(result.memoryRoot).toBe(join(root, "memory"));
    expect(result.summary.emittedRegistryIds).toEqual([
      "blocked.resolve-blockers",
      "workflow_next.canonical-next-step"
    ]);
    expect(result.agentDirectives[0]?.conflicts).toEqual([
      expect.objectContaining({
        resolution: "blocking_wins",
        severity: "blocking"
      })
    ]);
  });

  it("reports stale directive data for daemon callers without hiding emitted blockers", async () => {
    const root = await makeProjectWorkspace();
    const result = await compileDaemonDirectiveObligations({
      workspaceRoot: root,
      context: "work",
      snapshot: daemonWorkSnapshot(root),
      dataByRegistryId: {
        "removed.directive-template": {}
      }
    });

    expect(result.ok).toBe(false);
    expect(result.summary.emittedRegistryIds).toEqual([
      "blocked.resolve-blockers",
      "workflow_next.canonical-next-step"
    ]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "data",
          path: "$.dataByRegistryId.removed.directive-template",
          message: "must reference a known registry entry"
        })
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

async function writeRegistry(registryRoot: string, entries: readonly ProjectRegistryEntry[]): Promise<void> {
  const storage = resolveProjectRegistryPaths({ rootDir: registryRoot });
  await mkdir(dirname(storage.registryFile), { recursive: true });
  await writeFile(
    storage.registryFile,
    `${JSON.stringify(
      {
        schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
        storage,
        entries,
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function registryEntry(
  root: string,
  name: string,
  lifecycle: ProjectRegistryEntry["lifecycle"] = "linked"
): ProjectRegistryEntry {
  const identity = deriveProjectRegistryIdentity({ projectRoot: root });
  return {
    id: projectRegistryEntryIdFromIdentity(identity),
    identity,
    lifecycle,
    display: {
      name,
      labels: []
    },
    projectRoot: root,
    borealDir: join(root, ".boreal"),
    runtimeDir: join(root, ".boreal", "runtime"),
    runtimeStateFile: join(root, ".boreal", "runtime", "state.json"),
    projectConfigPath: join(root, ".boreal", "project.json"),
    memoryRoot: join(root, "memory"),
    memoryBorealDir: join(root, "memory", ".boreal"),
    memoryLayout: "in-repo",
    memoryGitMode: "shared",
    installRoot: join(root, ".agents", "skills"),
    skillTargets: ["codex"],
    folderScoped: false,
    source: "project-setup",
    addedAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    lastSeenAt: "2026-06-27T00:00:00.000Z"
  };
}

async function writeProjectRollup(entry: ProjectRegistryEntry, totalWork: number): Promise<void> {
  await mkdir(entry.borealDir, { recursive: true });
  await writeFile(
    join(entry.borealDir, "rollup.json"),
    `${JSON.stringify(projectRollup(entry, totalWork), null, 2)}\n`,
    "utf8"
  );
}

function projectRollup(entry: ProjectRegistryEntry, totalWork: number): ProjectRollupDocument {
  return {
    schemaVersion: PROJECT_ROLLUP_SCHEMA_VERSION,
    projectId: entry.id,
    workspaceRoot: entry.projectRoot,
    generatedAt: "2026-06-27T00:00:00.000Z" as IsoTimestamp,
    stateContentHash: hashContent({ projectId: entry.id, totalWork }) as ContentHash,
    counts: {
      work: {
        total: totalWork,
        byStatus: {
          draft: 0,
          ready: totalWork,
          reserved: 0,
          in_progress: 0,
          blocked: 0,
          needs_verification: 0,
          verified: 0,
          closed: 0,
          cancelled: 0
        },
        byKind: {
          issue: 0,
          task: totalWork,
          sprint: 0,
          milestone: 0
        }
      },
      reservations: {
        total: 0,
        active: 0,
        expired: 0,
        released: 0
      }
    },
    limbo: {
      needsVerification: [],
      verified: []
    },
    reservations: {
      activeIds: [],
      expiredIds: []
    },
    enforcement: {
      blockingGaps: {
        openCount: 0,
        blockedWorkCount: 0,
        samples: []
      }
    },
    health: {
      doctorOk: null,
      syncOk: null
    },
    lastEvent: null,
    lastOperation: null,
    next: {
      limit: 10,
      work: []
    },
    workIndex: {
      limit: 10,
      total: totalWork,
      truncated: false,
      work: Array.from({ length: totalWork }, (_, index) => ({
        workId: `bw_work_${String(index + 1).padStart(12, "0")}` as WorkId,
        title: `Rollup work ${index + 1}`,
        kind: "task" as const,
        priority: "normal" as const,
        status: "ready" as const,
        updatedAt: "2026-06-27T00:00:00.000Z" as IsoTimestamp
      }))
    },
    aging: {
      ready: {
        count: 0,
        oldestAgeMs: 0,
        oldestAgeDays: 0,
        items: []
      },
      limbo: {
        count: 0,
        oldestAgeMs: 0,
        oldestAgeDays: 0,
        items: []
      },
      expiredReservations: {
        count: 0,
        oldestAgeMs: 0,
        oldestAgeDays: 0,
        items: []
      },
      maxima: {
        readyAgeMs: 0,
        limboAgeMs: 0,
        expiredReservationAgeMs: 0
      },
      approximation: {
        readySinceSource: "work.meta.updatedAt",
        limboSinceSource: "work.meta.updatedAt",
        expiredReservationSinceSource: "reservation.expiresAt_or_meta.updatedAt",
        eventHistoryScanned: false
      }
    }
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-daemon-"));
  tempDirs.push(dir);
  return dir;
}

function daemonWorkSnapshot(root: string) {
  const capturedAt = "2026-06-27T00:00:00.000Z" as IsoTimestamp;
  const workId = "bw_work_daemonblocked" as WorkId;
  const blockerId = "bw_work_daemonblocker" as WorkId;

  return createAgentDirectiveSnapshot({
    capturedAt,
    work: {
      subject: {
        type: "work",
        id: workId,
        title: "Daemon blocked work",
        kind: "task",
        status: "blocked",
        priority: "high"
      },
      labels: ["agent-directives", "daemon"],
      dependencyIds: [blockerId],
      activeBlockerIds: [blockerId],
      blockedByIds: [blockerId],
      childWorkIds: [],
      descendantWorkIds: [],
      openDescendantIds: []
    },
    summary: {
      summaryIds: [],
      finalSummaryIds: [],
      childSummaryIds: [],
      artifactUris: [],
      commitShas: [],
      dirtyPathNotes: []
    },
    gate: {
      requiredGates: [],
      openGateIds: [],
      satisfiedGateIds: [],
      forcedGateIds: []
    },
    evidence: {
      evidenceIds: [],
      verificationIds: [],
      evidence: [],
      verifications: []
    },
    git: {
      roots: [
        {
          root,
          detached: false,
          protectedBranch: false,
          clean: true,
          scopedChangedPaths: [],
          collaborationDirtyPaths: [],
          blockingDirtyPaths: [],
          untrackedPaths: []
        }
      ],
      checkpointCommitShas: [],
      dirtyPathNotes: []
    },
    workflow: {
      workflowRefs: ["workflows/40-work/link-dependencies.md"],
      skillRefs: ["boreal-work-execution"],
      requiredInputNames: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
      nextWorkflowRef: "workflows/40-work/link-dependencies.md",
      recommendedCommandPath: `bwrk dep tree ${workId} --json`,
      assetManifestHash: hashContent({ root, workId, blockerId }) as ContentHash
    },
    doctor: {
      ok: true,
      strict: true,
      diagnostics: []
    },
    sync: {
      ok: true,
      refreshed: false,
      ledgersFresh: true,
      searchIndexFresh: true,
      sqliteCacheFresh: true
    },
    command: {
      path: "work show",
      argv: ["work", "show", workId, "--json"],
      envelopeSchema: "boreal.cli.work.show.v1",
      json: true,
      mutatesState: false,
      resultOk: true
    },
    actor: {
      actor: {
        id: "daemon-test",
        kind: "system"
      },
      activeReservationIds: []
    }
  });
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}
