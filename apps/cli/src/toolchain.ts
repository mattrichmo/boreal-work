import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { BorealError } from "@boreal/core";

import { getRuntimeBuildIdentity, type RuntimeBuildIdentity } from "./build-identity.js";

export const PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION = "boreal.project-manifest.v1";
export const TOOLCHAIN_LOCK_SCHEMA_VERSION = "boreal.toolchain-lock.v1";
export const PORTABLE_PROJECT_MANIFEST_PATH = ".boreal/project.manifest.json";
export const TOOLCHAIN_LOCK_PATH = ".boreal/toolchain.lock.json";
export const LOCAL_PROJECT_CONFIG_PATH = ".boreal/project.json";

const PORTABLE_PROJECT_MANIFEST_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "storage",
  "toolchainLock",
  "localConfig"
]);
const TOOLCHAIN_LOCK_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "semanticVersion",
  "buildSha",
  "artifactDigest",
  "protocolEpoch",
  "writerEpoch",
  "readerEpoch",
  "cacheEpoch",
  "agentAssetDigest"
]);

export type PortableStorageKind = "file-v2" | "objects-v1";

export interface PortableProjectManifest {
  readonly schemaVersion: typeof PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION;
  readonly projectId: string;
  readonly storage: PortableStorageKind;
  readonly toolchainLock: string;
  readonly localConfig: string;
}

export interface ToolchainLock {
  readonly schemaVersion: typeof TOOLCHAIN_LOCK_SCHEMA_VERSION;
  readonly projectId: string;
  readonly semanticVersion: string;
  readonly buildSha: string;
  readonly artifactDigest: string;
  readonly protocolEpoch: number;
  readonly writerEpoch: number;
  readonly readerEpoch: number;
  readonly cacheEpoch: number;
  readonly agentAssetDigest: string;
}

export type ProjectToolchainMode = "legacy" | "compatible" | "compatibility-read";

export interface ProjectToolchainStatus {
  readonly mode: ProjectToolchainMode;
  readonly manifestPath: string;
  readonly lockPath: string;
  readonly manifest?: PortableProjectManifest;
  readonly lock?: ToolchainLock;
  readonly runtime: RuntimeBuildIdentity;
  readonly canonicalWritesAllowed: boolean;
  readonly findings: readonly string[];
}

export function createPortableProjectManifest(
  projectId: string,
  storage: PortableStorageKind
): PortableProjectManifest {
  const manifest = {
    schemaVersion: PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION,
    projectId,
    storage,
    toolchainLock: TOOLCHAIN_LOCK_PATH,
    localConfig: LOCAL_PROJECT_CONFIG_PATH
  } satisfies PortableProjectManifest;
  assertPortableProjectManifest(manifest);
  return manifest;
}

export function createToolchainLock(
  projectId: string,
  runtime: RuntimeBuildIdentity = getRuntimeBuildIdentity()
): ToolchainLock {
  const lock = {
    schemaVersion: TOOLCHAIN_LOCK_SCHEMA_VERSION,
    projectId,
    ...runtime
  } satisfies ToolchainLock;
  assertToolchainLock(lock);
  return lock;
}

export function createStableProjectId(): string {
  return `project_${randomBytes(8).toString("hex")}`;
}

export function readPortableProjectManifestSync(projectRoot: string): PortableProjectManifest | undefined {
  const path = join(resolve(projectRoot), PORTABLE_PROJECT_MANIFEST_PATH);
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = parseJsonFile(path, PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION);
  assertPortableProjectManifest(parsed, path);
  return parsed;
}

export function readToolchainLockSync(projectRoot: string, manifest?: PortableProjectManifest): ToolchainLock | undefined {
  const root = resolve(projectRoot);
  const lockRelativePath = manifest?.toolchainLock ?? TOOLCHAIN_LOCK_PATH;
  const path = resolvePortablePath(root, lockRelativePath, "toolchainLock");
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = parseJsonFile(path, TOOLCHAIN_LOCK_SCHEMA_VERSION);
  assertToolchainLock(parsed, path);
  return parsed;
}

export function inspectProjectToolchainSync(
  projectRoot: string,
  runtime: RuntimeBuildIdentity = getRuntimeBuildIdentity()
): ProjectToolchainStatus {
  const root = resolve(projectRoot);
  const manifestPath = join(root, PORTABLE_PROJECT_MANIFEST_PATH);
  const defaultLockPath = join(root, TOOLCHAIN_LOCK_PATH);
  let manifest: PortableProjectManifest | undefined;
  try {
    manifest = readPortableProjectManifestSync(root);
  } catch (error) {
    return incompatibleStatus(runtime, manifestPath, defaultLockPath, [finding("project_manifest_invalid", error)]);
  }
  if (!manifest) {
    return {
      mode: "compatibility-read",
      manifestPath,
      lockPath: defaultLockPath,
      runtime,
      canonicalWritesAllowed: false,
      findings: ["project_manifest_missing"]
    };
  }

  let lockPath: string;
  try {
    lockPath = resolvePortablePath(root, manifest.toolchainLock, "toolchainLock");
  } catch (error) {
    return incompatibleStatus(runtime, manifestPath, defaultLockPath, [finding("toolchain_lock_path_invalid", error)], manifest);
  }

  let lock: ToolchainLock | undefined;
  try {
    lock = readToolchainLockSync(root, manifest);
  } catch (error) {
    return incompatibleStatus(runtime, manifestPath, lockPath, [finding("toolchain_lock_invalid", error)], manifest);
  }
  if (!lock) {
    return incompatibleStatus(runtime, manifestPath, lockPath, ["toolchain_lock_missing"], manifest);
  }

  const findings = compareToolchain(manifest, lock, runtime);
  if (findings.length > 0) {
    return incompatibleStatus(runtime, manifestPath, lockPath, findings, manifest, lock);
  }
  return {
    mode: "compatible",
    manifestPath,
    lockPath,
    manifest,
    lock,
    runtime,
    canonicalWritesAllowed: true,
    findings: []
  };
}

export function assertCanonicalWritesAllowed(status: ProjectToolchainStatus, command: string): void {
  if (status.canonicalWritesAllowed) {
    return;
  }
  throw new BorealError(
    "BOREAL_POLICY_VIOLATION",
    "The executing Boreal build does not match this project's committed toolchain lock; canonical writes are disabled",
    {
      command,
      mode: status.mode,
      manifestPath: status.manifestPath,
      lockPath: status.lockPath,
      findings: status.findings,
      expected: status.lock,
      actual: status.runtime,
      recovery: "Run a compatible repo-pinned bwrk build or refresh the lock through an explicit migration/update workflow."
    }
  );
}

export function isToolchainRecoveryCommand(command: string): boolean {
  return (
    command === "init" ||
    command === "storage migrate" ||
    command === "update repo" ||
    command === "install" ||
    command === "setup" ||
    command === "upgrade" ||
    command === "install status" ||
    command === "doctor" ||
    command === "doctor skills" ||
    command === "schema validate" ||
    command === "sync status"
  );
}

function compareToolchain(
  manifest: PortableProjectManifest,
  lock: ToolchainLock,
  runtime: RuntimeBuildIdentity
): readonly string[] {
  const findings: string[] = [];
  mismatch(findings, "project_id_mismatch", lock.projectId, manifest.projectId);
  mismatch(findings, "semantic_version_mismatch", lock.semanticVersion, runtime.semanticVersion);
  mismatch(findings, "build_sha_mismatch", lock.buildSha, runtime.buildSha);
  mismatch(findings, "artifact_digest_mismatch", lock.artifactDigest, runtime.artifactDigest);
  mismatch(findings, "protocol_epoch_mismatch", lock.protocolEpoch, runtime.protocolEpoch);
  mismatch(findings, "writer_epoch_mismatch", lock.writerEpoch, runtime.writerEpoch);
  mismatch(findings, "cache_epoch_mismatch", lock.cacheEpoch, runtime.cacheEpoch);
  mismatch(findings, "agent_asset_digest_mismatch", lock.agentAssetDigest, runtime.agentAssetDigest);
  if (runtime.readerEpoch < lock.writerEpoch) {
    findings.push("runtime_reader_epoch_too_old");
  }
  if (lock.readerEpoch < runtime.writerEpoch) {
    findings.push("project_reader_epoch_too_old");
  }
  return findings;
}

function mismatch(findings: string[], code: string, expected: string | number, actual: string | number): void {
  if (expected !== actual) {
    findings.push(code);
  }
}

function incompatibleStatus(
  runtime: RuntimeBuildIdentity,
  manifestPath: string,
  lockPath: string,
  findings: readonly string[],
  manifest?: PortableProjectManifest,
  lock?: ToolchainLock
): ProjectToolchainStatus {
  return {
    mode: "compatibility-read",
    manifestPath,
    lockPath,
    manifest,
    lock,
    runtime,
    canonicalWritesAllowed: false,
    findings
  };
}

function assertPortableProjectManifest(value: unknown, path?: string): asserts value is PortableProjectManifest {
  if (!isRecord(value)) {
    invalid("Portable project manifest must be an object", path);
  }
  assertOnlyKeys(value, PORTABLE_PROJECT_MANIFEST_KEYS, "Portable project manifest", path);
  if (value.schemaVersion !== PORTABLE_PROJECT_MANIFEST_SCHEMA_VERSION) {
    invalid("Portable project manifest schemaVersion is unsupported", path);
  }
  if (typeof value.projectId !== "string" || !/^project_[a-z0-9]{16,64}$/u.test(value.projectId)) {
    invalid("Portable project manifest projectId is invalid", path);
  }
  if (value.storage !== "file-v2" && value.storage !== "objects-v1") {
    invalid("Portable project manifest storage is invalid", path);
  }
  if (value.toolchainLock !== TOOLCHAIN_LOCK_PATH) {
    invalid(`Portable project manifest toolchainLock must be ${TOOLCHAIN_LOCK_PATH}`, path);
  }
  if (value.localConfig !== LOCAL_PROJECT_CONFIG_PATH) {
    invalid(`Portable project manifest localConfig must be ${LOCAL_PROJECT_CONFIG_PATH}`, path);
  }
}

function assertToolchainLock(value: unknown, path?: string): asserts value is ToolchainLock {
  if (!isRecord(value)) {
    invalid("Toolchain lock must be an object", path);
  }
  assertOnlyKeys(value, TOOLCHAIN_LOCK_KEYS, "Toolchain lock", path);
  if (value.schemaVersion !== TOOLCHAIN_LOCK_SCHEMA_VERSION) {
    invalid("Toolchain lock schemaVersion is unsupported", path);
  }
  if (typeof value.projectId !== "string" || !/^project_[a-z0-9]{16,64}$/u.test(value.projectId)) {
    invalid("Toolchain lock projectId is invalid", path);
  }
  if (typeof value.semanticVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value.semanticVersion)) {
    invalid("Toolchain lock semanticVersion is invalid", path);
  }
  if (typeof value.buildSha !== "string" || !/^[a-f0-9]{40,64}$/u.test(value.buildSha)) {
    invalid("Toolchain lock buildSha is invalid", path);
  }
  for (const field of ["artifactDigest", "agentAssetDigest"] as const) {
    if (typeof value[field] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value[field])) {
      invalid(`Toolchain lock ${field} is invalid`, path);
    }
  }
  for (const field of ["protocolEpoch", "writerEpoch", "readerEpoch", "cacheEpoch"] as const) {
    if (!Number.isSafeInteger(value[field]) || (value[field] as number) < 1) {
      invalid(`Toolchain lock ${field} is invalid`, path);
    }
  }
}

function resolvePortablePath(projectRoot: string, candidate: string, field: string): string {
  if (isAbsolute(candidate)) {
    throw new BorealError("BOREAL_CONFLICT", `${field} must be project-relative`, { field, candidate });
  }
  const root = resolve(projectRoot);
  const path = resolve(root, candidate);
  const relativePath = relative(root, path);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new BorealError("BOREAL_CONFLICT", `${field} escapes the project root`, { field, candidate });
  }
  return path;
}

function parseJsonFile(path: string, schemaName: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new BorealError("BOREAL_CONFLICT", `Unable to parse ${schemaName}`, {
      path,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function finding(code: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${code}:${message}`;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, path?: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    invalid(`${label} contains unsupported properties: ${unexpected.sort().join(", ")}`, path);
  }
}

function invalid(message: string, path?: string): never {
  throw new BorealError("BOREAL_CONFLICT", message, path ? { path } : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
