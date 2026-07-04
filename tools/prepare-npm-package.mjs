#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutDir = join(repoRoot, ".boreal", "release", "npm-package");
const defaultHomepage = "https://github.com/mattrichmo/boreal-work#readme";
const defaultRepository = "git+https://github.com/mattrichmo/boreal-work.git";

export async function prepareNpmPackage(options = {}) {
  const outDir = resolve(options.outDir ?? defaultOutDir);
  const channel = options.channel ?? "npm";
  if (channel !== "npm" && channel !== "brew") {
    throw new Error(`Unsupported package build channel: ${channel}`);
  }

  const rootPackage = await readJson(join(repoRoot, "package.json"));
  const cliPackage = await readJson(join(repoRoot, "apps", "cli", "package.json"));
  const version = requiredString(rootPackage.version, "root package version");
  const cliVersion = requiredString(cliPackage.version, "CLI package version");
  if (cliVersion !== version) {
    throw new Error(`CLI package version ${cliVersion} must match root package version ${version}`);
  }

  const snapshotDistDir = resolve(`${outDir}.dist-${process.pid}-${Date.now()}`);
  await run(process.execPath, [join(repoRoot, "tools", "build-cli-dist.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BOREAL_INSTALL_CHANNEL: channel,
      BOREAL_BUILD_DIST_SNAPSHOT_DIR: snapshotDistDir
    }
  });

  await stat(join(snapshotDistDir, "index.js"));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  try {
    await cp(snapshotDistDir, join(outDir, "dist"), { recursive: true, force: true });
  } finally {
    await rm(snapshotDistDir, { recursive: true, force: true });
  }
  await cp(join(repoRoot, "README.md"), join(outDir, "README.md"));

  const packageJson = {
    name: requiredString(cliPackage.name, "CLI package name"),
    version,
    description: stringField(rootPackage.description) ?? "Boreal Work CLI.",
    type: "module",
    license: stringField(rootPackage.license) ?? "UNLICENSED",
    bin: {
      bwrk: "dist/index.js"
    },
    files: ["dist"],
    engines: rootPackage.engines ?? { node: ">=22.0.0" },
    keywords: ["boreal", "work", "agent", "cli", "memory"],
    homepage: stringField(rootPackage.homepage) ?? defaultHomepage,
    repository: rootPackage.repository ?? {
      type: "git",
      url: defaultRepository,
      directory: "apps/cli"
    },
    bugs: rootPackage.bugs ?? {
      url: "https://github.com/mattrichmo/boreal-work/issues"
    },
    publishConfig: {
      access: "public",
      provenance: true
    }
  };
  await writeFile(join(outDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  return {
    packageRoot: outDir,
    version,
    packageName: packageJson.name,
    channel,
    files: packageJson.files
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = flagValue(args, "--out") ?? defaultOutDir;
  const channel = flagValue(args, "--channel") ?? "npm";
  const json = args.includes("--json");
  const result = await prepareNpmPackage({ outDir, channel });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Prepared ${result.packageName}@${result.version} in ${result.packageRoot}\n`);
  process.stdout.write(`Install channel: ${result.channel}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function stringField(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function run(command, args, options) {
  try {
    await execFileAsync(command, args, {
      ...options,
      maxBuffer: 10 * 1024 * 1024
    });
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
