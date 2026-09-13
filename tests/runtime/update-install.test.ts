import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installVerifiedBundle } from "../../apps/cli/src/commands/update-install.ts";
import type { BinaryIdentity } from "../../apps/cli/src/install-status.ts";

const tempDirs: string[] = [];
const identity: BinaryIdentity = {
  schemaVersion: "boreal.cli.binary.identity.v1",
  name: "boreal-work",
  version: "1.0.0",
  installChannel: "test",
  build: { buildSha: "a".repeat(40), artifactDigest: `sha256:${"b".repeat(64)}` }
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "boreal-update-install-"));
  tempDirs.push(root);
  const distDir = join(root, "source-dist");
  const binDir = join(root, "bin");
  const libDir = join(root, "lib");
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, "index.js"), "new bundle\n");
  return { distDir, binDir, libDir };
}

describe("installVerifiedBundle", () => {
  it("installs a bundle, shim, and legacy-shaped manifest", async () => {
    const paths = await fixture();
    const actual = await installVerifiedBundle({ ...paths, transactionId: "tx-1", identity, source: { repoUrl: "https://example.test/repo.git", ref: "main" }, verify: async () => identity });
    expect(actual).toEqual(identity);
    expect(await readFile(join(paths.libDir, "dist", "index.js"), "utf8")).toBe("new bundle\n");
    expect(await readFile(join(paths.binDir, "bwrk"), "utf8")).toContain(`exec '${process.execPath}'`);
    expect(JSON.parse(await readFile(join(paths.libDir, "install-manifest.json"), "utf8"))).toMatchObject({ schemaVersion: "boreal.install.manifest.v1", transactionId: "tx-1", status: "committed" });
  });

  it("restores every previous target when verification fails", async () => {
    const paths = await fixture();
    await mkdir(join(paths.libDir, "dist"), { recursive: true });
    await mkdir(paths.binDir, { recursive: true });
    await writeFile(join(paths.libDir, "dist", "index.js"), "old bundle\n");
    await writeFile(join(paths.binDir, "bwrk"), "old shim\n");
    await writeFile(join(paths.libDir, "install-manifest.json"), "old manifest\n");
    await expect(installVerifiedBundle({ ...paths, transactionId: "tx-2", identity, source: { repoUrl: "https://example.test/repo.git" }, verify: async () => ({ ...identity, build: { ...identity.build, buildSha: "c".repeat(40) } }) })).rejects.toThrow(/identity mismatch/u);
    expect(await readFile(join(paths.libDir, "dist", "index.js"), "utf8")).toBe("old bundle\n");
    expect(await readFile(join(paths.binDir, "bwrk"), "utf8")).toBe("old shim\n");
    expect(await readFile(join(paths.libDir, "install-manifest.json"), "utf8")).toBe("old manifest\n");
  });

  it("refuses an existing installation lock", async () => {
    const paths = await fixture();
    await mkdir(join(paths.libDir, ".install.lock"), { recursive: true });
    await expect(installVerifiedBundle({ ...paths, transactionId: "tx-3", identity, source: { repoUrl: "https://example.test/repo.git" }, verify: async () => identity })).rejects.toThrow(/already in progress/u);
  });

  it("rolls back when interrupted during verification", async () => {
    const paths = await fixture();
    await mkdir(join(paths.libDir, "dist"), { recursive: true });
    await mkdir(paths.binDir, { recursive: true });
    await writeFile(join(paths.libDir, "dist", "index.js"), "old bundle\n");
    await writeFile(join(paths.binDir, "bwrk"), "old shim\n");
    const error = await installVerifiedBundle({ ...paths, transactionId: "tx-4", identity, source: { repoUrl: "https://example.test/repo.git" }, verify: async () => {
      process.emit("SIGINT");
      return identity;
    } }).catch((failure: Error & { readonly exitCode?: number }) => failure);
    expect(error).toMatchObject({ code: "BOREAL_INSTALL_CANCELLED", exitCode: 130 });
    expect(await readFile(join(paths.libDir, "dist", "index.js"), "utf8")).toBe("old bundle\n");
    expect(await readFile(join(paths.binDir, "bwrk"), "utf8")).toBe("old shim\n");
  });
});
