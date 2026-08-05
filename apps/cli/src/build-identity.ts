import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const BOREAL_PROTOCOL_EPOCH = 1;
export const BOREAL_WRITER_EPOCH = 2;
export const BOREAL_READER_EPOCH = 2;
export const BOREAL_CACHE_EPOCH = 2;

declare const BOREAL_BUILD_SHA: string | undefined;
declare const BOREAL_BUILD_ARTIFACT_DIGEST: string | undefined;
declare const BOREAL_BUILD_AGENT_ASSET_DIGEST: string | undefined;
declare const BOREAL_BUILD_PACKAGE_VERSION: string | undefined;

export interface RuntimeBuildIdentity {
  readonly semanticVersion: string;
  readonly buildSha: string;
  readonly artifactDigest: string;
  readonly protocolEpoch: number;
  readonly writerEpoch: number;
  readonly readerEpoch: number;
  readonly cacheEpoch: number;
  readonly agentAssetDigest: string;
}

interface PackageJson {
  readonly version?: string;
}

interface SourceToolchainLock {
  readonly buildSha?: unknown;
}

const sourceRepoRoot = fileURLToPath(new URL("../../..", import.meta.url));
let cachedBuildIdentity: RuntimeBuildIdentity | undefined;

/**
 * Returns the identity of the code that is executing, not merely the package
 * semver. Bundled builds receive immutable values from build-cli-dist.mjs.
 * Source runs compute the same content digests and use the committed lock's
 * build SHA as their build provenance marker.
 */
export function getRuntimeBuildIdentity(): RuntimeBuildIdentity {
  if (cachedBuildIdentity) {
    return cachedBuildIdentity;
  }
  const semanticVersion = buildConstant("semanticVersion") ?? readPackageVersion(sourceRepoRoot);
  const sourceBuildSha = readSourceLockBuildSha(sourceRepoRoot);
  cachedBuildIdentity = {
    semanticVersion,
    buildSha: buildConstant("sha") ?? sourceBuildSha ?? "source-unpinned",
    artifactDigest: buildConstant("artifact") ?? digestArtifactInputs(sourceRepoRoot),
    protocolEpoch: BOREAL_PROTOCOL_EPOCH,
    writerEpoch: BOREAL_WRITER_EPOCH,
    readerEpoch: BOREAL_READER_EPOCH,
    cacheEpoch: BOREAL_CACHE_EPOCH,
    agentAssetDigest: buildConstant("assets") ?? digestAgentAssets(sourceRepoRoot)
  };
  return cachedBuildIdentity;
}

export function digestArtifactInputs(repoRoot: string): string {
  const roots = [
    join(repoRoot, "apps", "cli", "src"),
    join(repoRoot, "apps", "daemon", "src"),
    join(repoRoot, "apps", "tui", "src"),
    ...packageSourceRoots(repoRoot)
  ];
  const files = [
    ...collectFiles(roots),
    ...[
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.base.json",
      "tools/build-cli-dist.mjs"
    ].map((path) => join(repoRoot, path)).filter(existsSync)
  ];
  return digestFiles(repoRoot, files);
}

export function digestAgentAssets(repoRoot: string): string {
  return digestFiles(
    repoRoot,
    collectFiles(["workflows", "templates", "skills", "schemas"].map((path) => join(repoRoot, path)))
  );
}

function packageSourceRoots(repoRoot: string): readonly string[] {
  const packagesRoot = join(repoRoot, "packages");
  if (!existsSync(packagesRoot)) {
    return [];
  }
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name, "src"))
    .filter(existsSync);
}

function collectFiles(roots: readonly string[]): readonly string[] {
  const files: string[] = [];
  for (const root of roots) {
    visit(root, files);
  }
  return files;
}

function visit(path: string, files: string[]): void {
  if (!existsSync(path)) {
    return;
  }
  const stat = statSync(path);
  if (stat.isFile()) {
    files.push(resolve(path));
    return;
  }
  if (!stat.isDirectory()) {
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    visit(join(path, entry.name), files);
  }
}

function digestFiles(repoRoot: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of [...new Set(files.map((entry) => resolve(entry)))].sort()) {
    const relativePath = relative(repoRoot, path).split(sep).join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function readPackageVersion(repoRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageJson;
    return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readSourceLockBuildSha(repoRoot: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(repoRoot, ".boreal", "toolchain.lock.json"), "utf8")) as SourceToolchainLock;
    return typeof parsed.buildSha === "string" && parsed.buildSha.length > 0 ? parsed.buildSha : undefined;
  } catch {
    return undefined;
  }
}

function buildConstant(kind: "semanticVersion" | "sha" | "artifact" | "assets"): string | undefined {
  switch (kind) {
    case "semanticVersion":
      return typeof BOREAL_BUILD_PACKAGE_VERSION === "string" && BOREAL_BUILD_PACKAGE_VERSION.length > 0
        ? BOREAL_BUILD_PACKAGE_VERSION
        : undefined;
    case "sha":
      return typeof BOREAL_BUILD_SHA === "string" && BOREAL_BUILD_SHA.length > 0 ? BOREAL_BUILD_SHA : undefined;
    case "artifact":
      return typeof BOREAL_BUILD_ARTIFACT_DIGEST === "string" && BOREAL_BUILD_ARTIFACT_DIGEST.length > 0
        ? BOREAL_BUILD_ARTIFACT_DIGEST
        : undefined;
    case "assets":
      return typeof BOREAL_BUILD_AGENT_ASSET_DIGEST === "string" && BOREAL_BUILD_AGENT_ASSET_DIGEST.length > 0
        ? BOREAL_BUILD_AGENT_ASSET_DIGEST
        : undefined;
  }
}
