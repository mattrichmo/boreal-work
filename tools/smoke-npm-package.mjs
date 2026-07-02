#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { prepareNpmPackage } from "./prepare-npm-package.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultReleaseDir = join(repoRoot, ".boreal", "release");

export async function packNpmPackage(options = {}) {
  const packDestination = resolve(options.packDestination ?? defaultReleaseDir);
  await mkdir(packDestination, { recursive: true });
  const prepared = await prepareNpmPackage({
    outDir: options.stageDir,
    channel: "npm"
  });
  const packed = await runCapture("npm", ["pack", prepared.packageRoot, "--pack-destination", packDestination, "--json"], {
    cwd: repoRoot,
    env: npmEnv({
      npm_config_cache: join(packDestination, "npm-cache"),
      ...options.env
    })
  });
  const records = JSON.parse(packed.stdout);
  const record = Array.isArray(records) ? records[0] : undefined;
  if (!record || typeof record.filename !== "string") {
    throw new Error(`npm pack did not return a tarball record:\n${packed.stdout}`);
  }
  const tarballPath = resolve(packDestination, record.filename);
  const tarball = await readFile(tarballPath);
  return {
    ...prepared,
    packDestination,
    tarballPath,
    tarballFile: record.filename,
    shasum: typeof record.shasum === "string" ? record.shasum : undefined,
    integrity: typeof record.integrity === "string" ? record.integrity : undefined,
    sha256: createHash("sha256").update(tarball).digest("hex"),
    size: tarball.byteLength,
    files: Array.isArray(record.files) ? record.files.map((file) => file.path) : []
  };
}

export async function smokeNpmPackage(options = {}) {
  const packed = await packNpmPackage(options);
  const tempRoot = await mkdtemp(join(tmpdir(), "boreal-npm-smoke-"));
  try {
    const prefix = join(tempRoot, "prefix");
    await mkdir(prefix, { recursive: true });
    await runCapture("npm", ["install", "--global", "--prefix", prefix, packed.tarballPath], {
      cwd: repoRoot,
      env: npmEnv({
        npm_config_cache: join(tempRoot, "npm-cache")
      })
    });
    const bin = join(prefix, "bin", "bwrk");
    const version = await runCapture(bin, ["--version"], {
      cwd: tempRoot,
      env: cleanBorealEnv()
    });
    const expected = `boreal-work ${packed.version} (npm)\n`;
    if (version.stdout !== expected) {
      throw new Error(`Unexpected bwrk version probe. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(version.stdout)}`);
    }
    return {
      ...packed,
      prefix,
      binary: bin,
      versionProbe: version.stdout.trim()
    };
  } finally {
    if (!options.keepTemp) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const packOnly = args.includes("--pack-only");
  const result = packOnly ? await packNpmPackage() : await smokeNpmPackage();
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Packed ${result.packageName}@${result.version}: ${result.tarballPath}\n`);
  process.stdout.write(`sha256: ${result.sha256}\n`);
  if (!packOnly) {
    process.stdout.write(`Smoke: ${result.versionProbe}\n`);
  }
}

async function runCapture(command, args, options) {
  try {
    const result = await execFileAsync(command, args, {
      ...options,
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      stdout: String(result.stdout),
      stderr: String(result.stderr)
    };
  } catch (error) {
    const failure = error;
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        typeof failure.stdout === "string" && failure.stdout.trim() ? `stdout:\n${failure.stdout.trim()}` : undefined,
        typeof failure.stderr === "string" && failure.stderr.trim() ? `stderr:\n${failure.stderr.trim()}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function npmEnv(overrides = {}) {
  return {
    ...process.env,
    ...overrides
  };
}

function cleanBorealEnv() {
  const env = { ...process.env };
  delete env.BOREAL_ASSET_ROOT;
  delete env.BOREAL_INSTALL_CHANNEL;
  delete env.BOREAL_BWRK_DELEGATED;
  return env;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
