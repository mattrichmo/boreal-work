#!/usr/bin/env node

// Packages the already-built standalone CLI for the lightweight upgrade path.
// The archive deliberately contains no source checkout or package manager
// metadata: install.sh only needs apps/cli/dist and itself.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDist = join(repoRoot, "apps", "cli", "dist");
const defaultOutput = join(repoRoot, ".boreal", "release");
const artifactName = "bwrk-upgrade.tar.gz";

export async function packageUpgradeRelease(options = {}) {
  const distDir = resolve(options.dist ?? defaultDist);
  const outputDir = resolve(options.out ?? defaultOutput);
  const archivePath = join(outputDir, artifactName);
  const checksumPath = join(outputDir, "SHA256SUMS");
  const manifestPath = join(outputDir, "bwrk-release.json");
  const stageDir = join(outputDir, `.upgrade-stage-${process.pid}-${Date.now()}`);

  await assertFile(join(distDir, "index.js"), "built CLI dist (run pnpm build first)");
  await assertFile(join(repoRoot, "install.sh"), "install.sh");
  await assertSafeTree(distDir);
  const identity = await readBuildIdentity(distDir);
  if (options.buildSha && options.buildSha !== identity.buildSha) {
    throw new Error(`Built CLI SHA ${identity.buildSha} does not match requested release SHA ${options.buildSha}`);
  }
  await mkdir(outputDir, { recursive: true });
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(join(stageDir, "apps", "cli"), { recursive: true });

  try {
    await cp(distDir, join(stageDir, "apps", "cli", "dist"), { recursive: true, force: true });
    await cp(join(repoRoot, "install.sh"), join(stageDir, "install.sh"));
    await execFileAsync("tar", ["-czf", archivePath, "-C", stageDir, "apps/cli/dist", "install.sh"]);

    const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
    await writeFile(checksumPath, `${digest}  ${artifactName}\n`, "utf8");
    const rootPackage = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        schemaVersion: "boreal.upgrade.release.v1",
        buildSha: identity.buildSha,
        artifactDigest: identity.artifactDigest,
        version: identity.version ?? rootPackage.version,
        archive: artifactName,
        sha256: digest
      }, null, 2)}\n`,
      "utf8"
    );
    const archiveStat = await stat(archivePath);
    return { archivePath, checksumPath, manifestPath, artifactName, sha256: digest, size: archiveStat.size, buildSha: identity.buildSha, artifactDigest: identity.artifactDigest, version: identity.version ?? rootPackage.version };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

async function assertSafeTree(root) {
  const seenInodes = new Set();
  async function visit(path) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new Error(`Cannot package upgrade release: symlink is not allowed at ${path}`);
    if (!entry.isDirectory() && !entry.isFile()) throw new Error(`Cannot package upgrade release: unsupported file at ${path}`);
    if (entry.isFile()) {
      const inode = `${entry.dev}:${entry.ino}`;
      if (seenInodes.has(inode)) throw new Error(`Cannot package upgrade release: hard link is not allowed at ${path}`);
      seenInodes.add(inode);
      return;
    }
    for (const name of await readdir(path)) await visit(join(path, name));
  }
  await visit(root);
}

async function readBuildIdentity(distDir) {
  try {
    const result = await execFileAsync(process.execPath, [join(distDir, "index.js"), "--no-delegate", "--version", "--json"], { cwd: repoRoot });
    const envelope = JSON.parse(String(result.stdout));
    const data = envelope?.data;
    if (envelope?.ok !== true || typeof data?.build?.buildSha !== "string" || typeof data?.build?.artifactDigest !== "string") {
      throw new Error("missing build identity");
    }
    return { buildSha: data.build.buildSha, artifactDigest: data.build.artifactDigest, version: data.version };
  } catch (error) {
    throw new Error(`Cannot read built CLI identity: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertFile(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Cannot package upgrade release: missing ${label} at ${path}`);
  }
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const result = await packageUpgradeRelease({ dist: flagValue(args, "--dist"), out: flagValue(args, "--out"), buildSha: process.env.GITHUB_SHA });
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : `Packaged ${result.archivePath}\nSHA256: ${result.sha256}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
