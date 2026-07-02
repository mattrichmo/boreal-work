#!/usr/bin/env node
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { prepareNpmPackage } from "./prepare-npm-package.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function main() {
  const prepared = await prepareNpmPackage({ channel: "npm" });
  const result = await execFileAsync("npm", [
    "publish",
    prepared.packageRoot,
    "--dry-run",
    "--access",
    "public",
    "--provenance"
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_config_cache: join(repoRoot, ".boreal", "release", "npm-cache")
    },
    maxBuffer: 10 * 1024 * 1024
  });
  process.stdout.write(String(result.stdout));
  process.stderr.write(String(result.stderr));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    const failure = error;
    const lines = [
      "npm publish dry-run failed.",
      typeof failure.stdout === "string" && failure.stdout.trim() ? `stdout:\n${failure.stdout.trim()}` : undefined,
      typeof failure.stderr === "string" && failure.stderr.trim() ? `stderr:\n${failure.stderr.trim()}` : undefined,
      error instanceof Error ? error.message : String(error)
    ].filter(Boolean);
    process.stderr.write(`${lines.join("\n")}\n`);
    process.exitCode = 1;
  });
}
