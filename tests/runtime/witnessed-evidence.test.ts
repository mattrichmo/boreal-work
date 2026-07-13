import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { hashContent, type ActorRef, type IsoTimestamp } from "@boreal/core";
import { recordWitnessedEvidence } from "@boreal/evidence-engine";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const actor: ActorRef = { id: "witness-test", kind: "agent" };
const now = "2026-07-12T12:00:00.000Z" as IsoTimestamp;

afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("witnessed evidence", () => {
  it("persists command, output, Git, tool, revision, and artifact provenance", async () => {
    const root = await gitWorkspace();

    const result = await recordWitnessedEvidence({
      subjectId: "bw_work_witness_success",
      subjectType: "work",
      subjectRevision: { contentHash: hashContent("revision-1"), updatedAt: now },
      declaredCommand: "node -e \"require('node:fs').writeFileSync('artifact.txt','artifact body'); process.stdout.write('witnessed ok')\"",
      expectedObservable: "witnessed ok",
      workspaceRoot: root,
      artifactPaths: ["artifact.txt"],
      policy: { enabled: true, allowedExecutables: ["node"], timeoutMs: 2_000, stdoutMaxBytes: 1_024, stderrMaxBytes: 1_024 },
      actor,
      now,
      borealVersion: "test-version"
    });

    expect(result.evidence).toMatchObject({
      outcome: "passed",
      command: "node -e \"require('node:fs').writeFileSync('artifact.txt','artifact body'); process.stdout.write('witnessed ok')\"",
      attestation: {
        trustLevel: "boreal_witnessed",
        witness: { kind: "boreal", issuer: "boreal-work" },
        subjectRevision: { contentHash: hashContent("revision-1") },
        command: { exitCode: 0, timedOut: false, cancelled: false, expectedObservableMatched: true },
        output: { stdoutBytes: 12, stderrBytes: 0, stdoutExcerpt: "witnessed ok", truncated: false },
        git: { branch: "main", dirty: true, dirtyFileCount: 1 },
        artifacts: [{ path: "artifact.txt", bytes: 13 }]
      }
    });
    expect(result.evidence.attestation?.command?.commandHash).toMatch(/^sha256:/u);
    expect(result.evidence.attestation?.output?.stdoutHash).toMatch(/^sha256:/u);
    expect(result.evidence.attestation?.git?.headSha).toMatch(/^[a-f0-9]{40}$/u);
    expect(result.evidence.attestation?.git?.dirtyFingerprint).toMatch(/^sha256:/u);
    expect(result.evidence.attestation?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "boreal-work", version: "test-version" }),
      expect.objectContaining({ name: "node" }),
      expect.objectContaining({ name: "git" })
    ]));
    expect(result.evidence.attestation?.artifacts?.[0]?.contentHash).toMatch(/^sha256:/u);
  });

  it("retains failed, timed-out, and truncated executions as non-passing evidence", async () => {
    const root = await gitWorkspace();
    const base = {
      subjectType: "work",
      subjectRevision: { contentHash: hashContent("revision-2") },
      workspaceRoot: root,
      actor,
      now
    } as const;

    const failed = await recordWitnessedEvidence({
      ...base,
      subjectId: "bw_work_witness_failed",
      declaredCommand: "node -e \"process.stderr.write('bad'); process.exit(7)\"",
      policy: { enabled: true, allowedExecutables: ["node"], timeoutMs: 2_000, stdoutMaxBytes: 1_024, stderrMaxBytes: 1_024 }
    });
    expect(failed.evidence).toMatchObject({
      outcome: "failed",
      attestation: { command: { exitCode: 7 }, output: { stderrExcerpt: "bad" } }
    });

    const timedOut = await recordWitnessedEvidence({
      ...base,
      subjectId: "bw_work_witness_timeout",
      declaredCommand: "node -e \"setTimeout(() => undefined, 10000)\"",
      policy: { enabled: true, allowedExecutables: ["node"], timeoutMs: 30, stdoutMaxBytes: 1_024, stderrMaxBytes: 1_024 }
    });
    expect(timedOut.evidence).toMatchObject({ outcome: "failed", attestation: { command: { timedOut: true } } });
    expect(timedOut.failureCode).toBe("BOREAL_COMMAND_TIMEOUT");

    const truncated = await recordWitnessedEvidence({
      ...base,
      subjectId: "bw_work_witness_truncated",
      declaredCommand: "node -e \"process.stdout.write('x'.repeat(4096))\"",
      policy: { enabled: true, allowedExecutables: ["node"], timeoutMs: 2_000, stdoutMaxBytes: 32, stderrMaxBytes: 1_024 }
    });
    expect(truncated.evidence).toMatchObject({
      outcome: "failed",
      attestation: { output: { stdoutBytes: 4096, truncated: true } }
    });
    expect(truncated.evidence.attestation?.output?.stdoutExcerpt).toHaveLength(32);
    expect(truncated.failureCode).toBe("BOREAL_COMMAND_OUTPUT_LIMIT");
  });
});

async function gitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boreal-witness-"));
  tempDirs.push(root);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "witness@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Witness Test"], { cwd: root });
  await writeFile(join(root, "tracked.txt"), "tracked\n", "utf8");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}
