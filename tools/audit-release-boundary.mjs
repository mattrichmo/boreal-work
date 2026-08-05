#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const json = process.argv.includes("--json");
const allowedLicenses = new Set(["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "(MIT OR CC0-1.0)"]);
const forbiddenLicensePattern = /(?:^|\W)(?:AGPL|GPL|LGPL|SSPL|BUSL|Commons Clause)(?:\W|$)/iu;
const secretPatterns = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { id: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/u },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{24,}\b/u },
  { id: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/u }
];

const tracked = gitFiles(["ls-files", "-z"]);
const candidates = gitFiles(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
const secretFindings = [];
const machinePathFiles = [];

for (const path of candidates) {
  const absolute = join(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile() || statSync(absolute).size > 2_000_000) continue;
  let fileText;
  try {
    fileText = readFileSync(absolute, "utf8");
  } catch {
    continue;
  }
  if (fileText.includes("\0")) continue;
  if (/\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/u.test(fileText)) {
    machinePathFiles.push(path);
  }
  for (const entry of secretPatterns) {
    const match = fileText.match(entry.pattern)?.[0];
    if (!match || isKnownExample(match, fileText)) continue;
    secretFindings.push({ path, pattern: entry.id });
  }
}

const dependencyRows = installedDependencyLicenses(join(root, "node_modules", ".pnpm"));
const dependencyIssues = dependencyRows
  .filter((row) => !row.license || !allowedLicenses.has(row.license) || forbiddenLicensePattern.test(row.license))
  .map((row) => ({ name: row.name, version: row.version, license: row.license ?? "missing" }));
const licenseCounts = Object.fromEntries(
  [...new Set(dependencyRows.map((row) => row.license ?? "missing"))]
    .sort()
    .map((license) => [license, dependencyRows.filter((row) => (row.license ?? "missing") === license).length])
);

const rootPackage = readJson(join(root, "package.json"));
const cliPackage = readJson(join(root, "apps", "cli", "package.json"));
const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].find((path) => existsSync(join(root, path)));
const trackerFiles = tracked.filter((path) => path.startsWith(".boreal/"));
const blockedTrackedRoots = ["memory/", "dump/", ".agents/", ".claude/", "claude-code-sourcemap-main/"];
const blockedTrackedFiles = tracked.filter((path) => blockedTrackedRoots.some((prefix) => path.startsWith(prefix)));
const packageBoundaryOk =
  rootPackage.private === true &&
  cliPackage.private === true &&
  Array.isArray(cliPackage.files) &&
  cliPackage.files.length === 1 &&
  cliPackage.files[0] === "dist";

const result = {
  schemaVersion: "boreal.release-boundary-audit.v1",
  ok: secretFindings.length === 0 && dependencyIssues.length === 0 && blockedTrackedFiles.length === 0 && packageBoundaryOk,
  secrets: {
    scannedFileCount: candidates.length,
    findingCount: secretFindings.length,
    findings: secretFindings
  },
  dependencies: {
    scannedPackageCount: dependencyRows.length,
    licenseCounts,
    issueCount: dependencyIssues.length,
    issues: dependencyIssues
  },
  licenseState: {
    rootPackagePrivate: rootPackage.private === true,
    cliPackagePrivate: cliPackage.private === true,
    rootLicenseField: rootPackage.license ?? null,
    cliLicenseField: cliPackage.license ?? null,
    licenseFile: licenseFile ?? null,
    classification: licenseFile || rootPackage.license || cliPackage.license ? "declared" : "private-unlicensed",
    changedByAudit: false
  },
  repositoryBoundary: {
    trackedFileCount: tracked.length,
    trackerFileCount: trackerFiles.length,
    machinePathFileCount: machinePathFiles.length,
    machinePathSourceFiles: machinePathFiles.filter((path) => !path.startsWith(".boreal/")),
    blockedTrackedFileCount: blockedTrackedFiles.length,
    blockedTrackedFiles,
    npmFiles: cliPackage.files ?? [],
    packageBoundaryOk,
    publicRepositoryRequiresTrackerSanitization: trackerFiles.length > 0
  }
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      `[${result.ok ? "ok" : "error"}] release boundary audit`,
      `secrets: ${result.secrets.findingCount} findings across ${result.secrets.scannedFileCount} files`,
      `dependencies: ${result.dependencies.issueCount} license issues across ${result.dependencies.scannedPackageCount} packages`,
      `license: ${result.licenseState.classification} (unchanged)`,
      `tracker: ${result.repositoryBoundary.trackerFileCount} tracked files; sanitize before publishing repository history`,
      `package: ${result.repositoryBoundary.packageBoundaryOk ? "private dist-only boundary" : "invalid boundary"}`
    ].join("\n") + "\n"
  );
}

process.exitCode = result.ok ? 0 : 1;

function gitFiles(args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout.split("\0").filter(Boolean).sort();
}

function isKnownExample(match, fileText) {
  const awsExampleAccessKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
  if (match === awsExampleAccessKey) return true;
  const index = fileText.indexOf(match);
  const nearby = fileText.slice(Math.max(0, index - 120), index + match.length + 120);
  return /fixture|example|placeholder|redact|fake|test token/iu.test(nearby);
}

function installedDependencyLicenses(pnpmRoot) {
  if (!existsSync(pnpmRoot)) return [];
  const rows = new Map();
  for (const packageDir of readdirSync(pnpmRoot)) {
    const modulesRoot = join(pnpmRoot, packageDir, "node_modules");
    if (!existsSync(modulesRoot)) continue;
    for (const manifest of packageManifests(modulesRoot)) {
      const value = readJson(manifest);
      if (!value.name || !value.version) continue;
      const license = typeof value.license === "string" ? value.license.trim() : undefined;
      rows.set(`${value.name}@${value.version}`, { name: value.name, version: value.version, license });
    }
  }
  return [...rows.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function packageManifests(modulesRoot) {
  const paths = [];
  for (const name of readdirSync(modulesRoot)) {
    const path = join(modulesRoot, name);
    if (name.startsWith("@")) {
      for (const scoped of readdirSync(path)) {
        const manifest = join(path, scoped, "package.json");
        if (existsSync(manifest)) paths.push(manifest);
      }
    } else {
      const manifest = join(path, "package.json");
      if (existsSync(manifest)) paths.push(manifest);
    }
  }
  return paths;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
