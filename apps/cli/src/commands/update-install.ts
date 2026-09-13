import { randomUUID } from "node:crypto";
import { chmod, cp, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { BinaryIdentity } from "../install-status.js";

export interface VerifiedBundleInstallInput {
  readonly distDir: string;
  readonly binDir: string;
  readonly libDir: string;
  readonly transactionId: string;
  readonly identity: BinaryIdentity;
  readonly source: { readonly repoUrl: string; readonly ref?: string };
  readonly verify: (binPath: string) => Promise<BinaryIdentity>;
}

interface CancellationError extends Error {
  readonly code: "BOREAL_INSTALL_CANCELLED";
  readonly exitCode: 130;
}

/** Install a verified dist bundle without invoking the shell installer. */
export async function installVerifiedBundle(input: VerifiedBundleInstallInput): Promise<BinaryIdentity> {
  const target = validateTargets(input);
  const lockPath = join(target.libDir, ".install.lock");
  await mkdir(target.libDir, { recursive: true });
  try {
    await mkdir(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another bwrk installation is already in progress (${lockPath})`);
    }
    throw error;
  }

  let cancelled = false;
  const onSignal = () => { cancelled = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const checkCancelled = () => {
    if (cancelled) {
      const error = Object.assign(new Error("bwrk installation cancelled"), {
        code: "BOREAL_INSTALL_CANCELLED" as const,
        exitCode: 130 as const
      }) satisfies CancellationError;
      throw error;
    }
  };

  const token = `${input.transactionId}-${randomUUID()}`;
  const stageRoot = join(target.libDir, `.bwrk-install-${token}`);
  const stageDist = join(stageRoot, "dist");
  const stageShim = join(target.binDir, `.bwrk-install-${token}-shim`);
  const stageManifest = join(stageRoot, "install-manifest.json");
  const distPath = join(target.libDir, "dist");
  const binPath = join(target.binDir, "bwrk");
  const manifestPath = join(target.libDir, "install-manifest.json");
  const backups = {
    dist: join(target.libDir, `.bwrk-backup-${token}-dist`),
    shim: join(target.binDir, `.bwrk-backup-${token}-shim`),
    manifest: join(target.libDir, `.bwrk-backup-${token}-manifest`)
  };
  const moved: Array<keyof typeof backups> = [];
  const installed: string[] = [];

  try {
    await mkdir(stageRoot);
    await mkdir(target.binDir, { recursive: true });
    await cp(target.distDir, stageDist, { recursive: true });
    checkCancelled();
    await chmod(join(stageDist, "index.js"), 0o755);
    await writeFile(stageShim, makeShim(join(distPath, "index.js")), { mode: 0o755 });
    const manifest = {
      schemaVersion: "boreal.install.manifest.v1",
      transactionId: input.transactionId,
      operation: "update.self",
      status: "committed",
      installedAt: new Date().toISOString(),
      source: { repoUrl: input.source.repoUrl, ...(input.source.ref ? { ref: input.source.ref } : {}) },
      binaryPath: binPath,
      bundlePath: distPath,
      identity: {
        name: input.identity.name,
        version: input.identity.version,
        installChannel: input.identity.installChannel,
        build: input.identity.build
      }
    };
    await writeFile(stageManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

    for (const [key, path] of [["dist", distPath], ["shim", binPath], ["manifest", manifestPath]] as const) {
      checkCancelled();
      if (await exists(path)) {
        await rename(path, backups[key]);
        moved.push(key);
      }
    }
    await rename(stageDist, distPath);
    installed.push(distPath);
    checkCancelled();
    await rename(stageShim, binPath);
    installed.push(binPath);
    checkCancelled();
    await rename(stageManifest, manifestPath);
    installed.push(manifestPath);

    const actual = await input.verify(binPath);
    checkCancelled();
    if (!sameBuild(input.identity, actual)) {
      throw new Error(`Installed bwrk identity mismatch: expected build ${input.identity.build?.buildSha ?? "unknown"}/${input.identity.build?.artifactDigest ?? "unknown"}, got ${actual.build?.buildSha ?? "unknown"}/${actual.build?.artifactDigest ?? "unknown"}`);
    }
    // The commit is complete. Backup cleanup must never turn a successful
    // installation into a rollback (and may safely be retried next run).
    await Promise.all(Object.values(backups).map((path) => rm(path, { recursive: true, force: true })).map((promise) => promise.catch(() => undefined)));
    return actual;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const path of [...installed].reverse()) await rm(path, { recursive: true, force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    for (const key of [...moved].reverse()) {
      const destination = key === "shim" ? binPath : key === "dist" ? distPath : manifestPath;
      await rename(backups[key], destination).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `Installation failed and rollback was incomplete; recovery backups remain under ${target.libDir}`);
    }
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(stageShim, { force: true }).catch(() => undefined);
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

function sameBuild(expected: BinaryIdentity, actual: BinaryIdentity): boolean {
  return expected.name === actual.name && expected.version === actual.version &&
    expected.installChannel === actual.installChannel &&
    expected.build?.buildSha !== undefined && expected.build?.artifactDigest !== undefined &&
    actual.build?.buildSha === expected.build.buildSha && actual.build?.artifactDigest === expected.build.artifactDigest;
}

function makeShim(entrypoint: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `#!/bin/sh\n# Generated by Boreal.\nexec ${quote(process.execPath)} ${quote(entrypoint)} "$@"\n`;
}

function validateTargets(input: VerifiedBundleInstallInput): { distDir: string; binDir: string; libDir: string } {
  if (!input.transactionId || input.transactionId.includes("/") || input.transactionId.includes("\\")) throw new Error("Invalid installation transactionId");
  if (!input.source.repoUrl) throw new Error("Installation source repoUrl is required");
  const distDir = resolve(input.distDir);
  const binDir = resolve(input.binDir || join(homedir(), ".local", "bin"));
  const libDir = resolve(input.libDir || join(homedir(), ".local", "share", "boreal", "bwrk"));
  for (const [label, path] of [["distDir", distDir], ["binDir", binDir], ["libDir", libDir]] as const) {
    if (!isAbsolute(path) || path === sep || path.split(sep).filter(Boolean).length < 2) throw new Error(`Unsafe ${label}: ${path}`);
  }
  if (binDir === libDir || isWithin(binDir, libDir) || isWithin(libDir, binDir)) throw new Error("binDir and libDir must not contain one another");
  if (distDir === binDir || distDir === libDir || isWithin(distDir, binDir) || isWithin(binDir, distDir) || isWithin(distDir, libDir) || isWithin(libDir, distDir)) {
    throw new Error("distDir must not overlap binDir or libDir");
  }
  return { distDir, binDir, libDir };
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}
