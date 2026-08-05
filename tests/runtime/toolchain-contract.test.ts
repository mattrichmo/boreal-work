import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PUBLISHED_SCHEMA_CONTRACTS,
  projectManifestSchemaIssues,
  toolchainLockSchemaIssues
} from "@boreal/core";

import { parseArgs } from "../../apps/cli/src/args.ts";
import { getRuntimeBuildIdentity, type RuntimeBuildIdentity } from "../../apps/cli/src/build-identity.ts";
import { assertCommandToolchainCompatibility, createCliContext } from "../../apps/cli/src/context.ts";
import { readProjectStorage } from "../../apps/cli/src/project-setup.ts";
import {
  PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION,
  TOOLCHAIN_LOCK_SCHEMA_VERSION,
  assertCanonicalWritesAllowed,
  createPortableProjectManifest,
  createToolchainLock,
  inspectProjectToolchainSync
} from "../../apps/cli/src/toolchain.ts";
import { getVersionInfo } from "../../apps/cli/src/version.ts";

const tempDirs: string[] = [];
const projectId = "project_0123456789abcdef";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("portable project and toolchain contract", () => {
  it("selects the canonical backend in a fresh worktree without local absolute bindings", async () => {
    const root = await makeWorkspace();
    const identity = getRuntimeBuildIdentity();
    await writePortableContract(root, identity);
    await mkdir(join(root, ".boreal", "objects", "work"), { recursive: true });

    expect(await readProjectStorage(root)).toBe("objects-v1");
    await expect(readFile(join(root, ".boreal", "project.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const context = await createCliContext(parseArgs(["work", "list", "--json"]), root);
    expect(context.storage).toBe("objects-v1");
    expect(context.toolchain).toMatchObject({
      mode: "compatible",
      canonicalWritesAllowed: true,
      manifest: { projectId, storage: "objects-v1" }
    });
  });

  it("keeps reads and migration available but blocks canonical writes when the lock is missing", async () => {
    const root = await makeWorkspace();
    const identity = fixtureIdentity();
    await writeManifest(root);

    const status = inspectProjectToolchainSync(root, identity);
    expect(status).toMatchObject({
      mode: "compatibility-read",
      canonicalWritesAllowed: false,
      findings: ["toolchain_lock_missing"]
    });
    expect(() => assertCommandToolchainCompatibility(parseArgs(["work", "list"]), status)).not.toThrow();
    expect(() => assertCommandToolchainCompatibility(parseArgs(["storage", "migrate", "--to", "objects"]), status)).not.toThrow();
    expect(() => assertCommandToolchainCompatibility(parseArgs(["work", "create", "unsafe write"]), status)).toThrowError(
      /canonical writes are disabled/u
    );
  });

  it("treats a legacy workspace without a portable manifest as read/migration-only", async () => {
    const root = await makeWorkspace();
    const status = inspectProjectToolchainSync(root, fixtureIdentity());
    expect(status).toMatchObject({
      mode: "compatibility-read",
      canonicalWritesAllowed: false,
      findings: ["project_manifest_missing"]
    });
    expect(() => assertCommandToolchainCompatibility(parseArgs(["work", "list"]), status)).not.toThrow();
    expect(() => assertCommandToolchainCompatibility(parseArgs(["init"]), status)).not.toThrow();
    expect(() => assertCommandToolchainCompatibility(parseArgs(["work", "create", "unsafe write"]), status)).toThrow();
  });

  it("reports exact identity mismatches and fails closed for canonical writes", async () => {
    const root = await makeWorkspace();
    const identity = fixtureIdentity();
    await writePortableContract(root, { ...identity, buildSha: "b".repeat(40) });

    const status = inspectProjectToolchainSync(root, identity);
    expect(status.canonicalWritesAllowed).toBe(false);
    expect(status.findings).toContain("build_sha_mismatch");
    expect(() => assertCanonicalWritesAllowed(status, "work create")).toThrowError(/toolchain lock/u);
  });

  it("accepts only an exact build, protocol, cache, and asset identity", async () => {
    const root = await makeWorkspace();
    const identity = fixtureIdentity();
    await writePortableContract(root, identity);

    const exact = inspectProjectToolchainSync(root, identity);
    expect(exact).toMatchObject({ mode: "compatible", canonicalWritesAllowed: true, findings: [] });

    const changed = inspectProjectToolchainSync(root, {
      ...identity,
      artifactDigest: `sha256:${"e".repeat(64)}`,
      cacheEpoch: identity.cacheEpoch + 1,
      agentAssetDigest: `sha256:${"f".repeat(64)}`
    });
    expect(changed.findings).toEqual(
      expect.arrayContaining(["artifact_digest_mismatch", "cache_epoch_mismatch", "agent_asset_digest_mismatch"])
    );
  });

  it("exposes the exact runtime identity and portable schemas from version", () => {
    const info = getVersionInfo();
    expect(info.build).toEqual(getRuntimeBuildIdentity());
    expect(info.schemas.projectManifest).toBe(PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION);
    expect(info.schemas.toolchainLock).toBe(TOOLCHAIN_LOCK_SCHEMA_VERSION);
    expect(info.build.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(info.build.agentAssetDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("publishes validators for both committed project contracts", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), ".boreal", "project.manifest.json"), "utf8")) as unknown;
    const lock = JSON.parse(await readFile(join(process.cwd(), ".boreal", "toolchain.lock.json"), "utf8")) as unknown;
    expect(projectManifestSchemaIssues(manifest)).toEqual([]);
    expect(toolchainLockSchemaIssues(lock)).toEqual([]);
    expect(PUBLISHED_SCHEMA_CONTRACTS.map((contract) => contract.key)).toEqual(
      expect.arrayContaining(["projectManifest", "toolchainLock"])
    );
  });
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boreal-toolchain-contract-"));
  tempDirs.push(root);
  await mkdir(join(root, ".boreal"), { recursive: true });
  return root;
}

async function writeManifest(root: string): Promise<void> {
  const manifest = createPortableProjectManifest(projectId, "objects-v1");
  await writeFile(join(root, ".boreal", "project.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function writePortableContract(root: string, identity: RuntimeBuildIdentity): Promise<void> {
  await writeManifest(root);
  const lock = createToolchainLock(projectId, identity);
  await writeFile(join(root, ".boreal", "toolchain.lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

function fixtureIdentity(): RuntimeBuildIdentity {
  return {
    semanticVersion: "0.1.0",
    buildSha: "a".repeat(40),
    artifactDigest: `sha256:${"c".repeat(64)}`,
    protocolEpoch: 1,
    writerEpoch: 2,
    readerEpoch: 2,
    cacheEpoch: 2,
    agentAssetDigest: `sha256:${"d".repeat(64)}`
  };
}
