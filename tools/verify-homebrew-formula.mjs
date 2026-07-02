#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { packNpmPackage } from "./smoke-npm-package.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const formulaPath = join(repoRoot, "homebrew-tap", "Formula", "boreal-work.rb");
const tapName = "boreal/bwrk-local";
const tappedFormulaName = `${tapName}/boreal-work`;

async function main() {
  const args = process.argv.slice(2);
  const keepInstalled = args.includes("--keep-installed");
  const packed = await packNpmPackage();
  await assertFormulaVersion(packed.version);

  const wasInstalled = await commandSucceeds("brew", ["list", "--formula", "boreal-work"]);
  if (wasInstalled && !keepInstalled) {
    throw new Error("Homebrew formula boreal-work is already installed; rerun with --keep-installed after checking local state.");
  }
  const tapAlreadyExists = await commandSucceeds("brew", ["tap-info", tapName]);
  if (tapAlreadyExists) {
    throw new Error(`Temporary Homebrew tap ${tapName} already exists; run brew untap ${tapName} after checking local state.`);
  }

  const env = {
    ...process.env,
    HOMEBREW_NO_AUTO_UPDATE: "1",
    HOMEBREW_NO_INSTALL_CLEANUP: "1",
    HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: "1",
    HOMEBREW_NO_ENV_HINTS: "1"
  };

  let installed = false;
  let tapCreated = false;
  try {
    await run("brew", ["tap-new", tapName], { cwd: repoRoot, env });
    tapCreated = true;
    const tapRoot = (await run("brew", ["--repo", tapName], { cwd: repoRoot, env })).stdout.trim();
    await writeLocalFormulaCopy(join(tapRoot, "Formula", "boreal-work.rb"), packed);
    await run("brew", ["install", "--build-from-source", tappedFormulaName], { cwd: repoRoot, env });
    installed = true;
    const prefix = (await run("brew", ["--prefix", "boreal-work"], { cwd: repoRoot, env })).stdout.trim();
    const version = await run(join(prefix, "bin", "bwrk"), ["--version"], { cwd: repoRoot, env: cleanBorealEnv(env) });
    const expected = `boreal-work ${packed.version} (brew)\n`;
    if (version.stdout !== expected) {
      throw new Error(`Unexpected Homebrew bwrk version probe. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(version.stdout)}`);
    }
    await run("brew", ["test", tappedFormulaName], { cwd: repoRoot, env });
    process.stdout.write(`Homebrew formula installed and tested from ${packed.tarballPath}\n`);
    process.stdout.write(`sha256: ${packed.sha256}\n`);
    process.stdout.write(`Smoke: ${version.stdout.trim()}\n`);
  } finally {
    if (installed && !keepInstalled && !wasInstalled) {
      await run("brew", ["uninstall", "--force", "boreal-work"], { cwd: repoRoot, env });
    }
    if (tapCreated) {
      await run("brew", ["untap", tapName], { cwd: repoRoot, env });
    }
  }
}

async function assertFormulaVersion(version) {
  const text = await readFile(formulaPath, "utf8");
  if (!text.includes(`version "${version}"`)) {
    throw new Error(`Homebrew formula version must match root package version ${version}`);
  }
}

async function writeLocalFormulaCopy(targetPath, packed) {
  const remoteUrl = `https://registry.npmjs.org/@boreal/cli/-/cli-${packed.version}.tgz`;
  const text = await readFile(formulaPath, "utf8");
  const localText = text
    .replace(`url "${remoteUrl}"`, `url "${pathToFileURL(packed.tarballPath).href}"`)
    .replace(/sha256 "[a-f0-9]{64}"/u, `sha256 "${packed.sha256}"`);
  await mkdir(join(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, localText, "utf8");
}

async function commandSucceeds(command, args) {
  try {
    await execFileAsync(command, args, { cwd: repoRoot, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, options) {
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

function cleanBorealEnv(env) {
  const clean = { ...env };
  delete clean.BOREAL_ASSET_ROOT;
  delete clean.BOREAL_INSTALL_CHANNEL;
  delete clean.BOREAL_BWRK_DELEGATED;
  return clean;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
