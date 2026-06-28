import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  BorealError,
  hashContent,
  normalizeLabels,
  normalizeMachineString,
  nowIso,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  projectRegistryDocumentSchemaIssues,
  readJsonFile,
  resolveProjectRegistryPaths,
  type ProjectRegistryDocument,
  type ProjectRegistryEntry,
  type ProjectRegistryStorage
} from "@boreal/core";
import { DEFAULT_FILE_LOCK_OPTIONS, withFileLock, writeTextFileAtomic } from "@boreal/storage";

import { readProjectSetupConfig, skillInstallRootConfig, type ProjectSetupConfig } from "./project-setup.js";

export interface RegistryListResult {
  readonly storage: ProjectRegistryStorage;
  readonly entries: readonly ProjectRegistryEntry[];
  readonly entryCount: number;
}

export interface RegistryAddResult extends RegistryListResult {
  readonly added: boolean;
  readonly replaced: boolean;
  readonly entry: ProjectRegistryEntry;
}

export interface RegistryRemoveResult extends RegistryListResult {
  readonly removed: true;
  readonly entry: ProjectRegistryEntry;
}

export interface RegistryImportSetupResult extends RegistryListResult {
  readonly imported: true;
  readonly changed: boolean;
  readonly added: boolean;
  readonly replaced: boolean;
  readonly entry: ProjectRegistryEntry;
}

export type RegistryFindingSeverity = "ok" | "warning" | "error";

export interface RegistryDoctorFinding {
  readonly code: string;
  readonly severity: RegistryFindingSeverity;
  readonly message: string;
  readonly projectId?: string;
  readonly path?: string;
  readonly details?: unknown;
}

export interface RegistryDoctorResult {
  readonly ok: boolean;
  readonly storage: ProjectRegistryStorage;
  readonly entryCount: number;
  readonly findings: readonly RegistryDoctorFinding[];
}

export interface RegistryCommandOptions {
  readonly registryRoot?: string;
}

export interface RegistryAddOptions extends RegistryCommandOptions {
  readonly workspaceRoot: string;
  readonly name?: string;
  readonly labels?: readonly string[];
}

export async function listProjectRegistry(options: RegistryCommandOptions = {}): Promise<RegistryListResult> {
  const storage = registryStorage(options);
  const document = await readRegistryDocument(storage);
  return registryListResult({ ...document, storage });
}

export async function addProjectRegistryEntry(options: RegistryAddOptions): Promise<RegistryAddResult> {
  const storage = registryStorage(options);
  const workspaceRoot = resolve(options.workspaceRoot);
  const config = await readTargetProjectSetup(workspaceRoot);
  const entry = registryEntryFromConfig(config, {
    name: options.name,
    labels: options.labels ?? []
  });

  return mutateRegistry<RegistryAddResult>(storage, (document) => {
    const entries = document.entries.filter((candidate) => candidate.id !== entry.id);
    const replaced = entries.length !== document.entries.length;
    const nextDocument = withRegistryUpdate(storage, {
      ...document,
      entries: [...entries, entry].sort(compareRegistryEntries)
    });
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        added: !replaced,
        replaced,
        entry
      }
    };
  });
}

export async function importProjectSetupRegistryEntry(options: RegistryAddOptions): Promise<RegistryImportSetupResult> {
  const storage = registryStorage(options);
  const workspaceRoot = resolve(options.workspaceRoot);
  const config = await readTargetProjectSetup(workspaceRoot);
  const generatedEntry = registryEntryFromConfig(config, {
    name: options.name,
    labels: options.labels ?? []
  });

  return mutateRegistry<RegistryImportSetupResult>(storage, (document) => {
    const existing = document.entries.find((candidate) => candidate.id === generatedEntry.id);
    const entry = {
      ...generatedEntry,
      display: {
        name: options.name ? generatedEntry.display.name : existing?.display.name ?? generatedEntry.display.name,
        labels: options.labels && options.labels.length > 0 ? generatedEntry.display.labels : existing?.display.labels ?? generatedEntry.display.labels
      },
      addedAt: existing?.addedAt ?? generatedEntry.addedAt
    };

    if (existing && registryEntriesEquivalent(existing, entry)) {
      return {
        document,
        result: {
          ...registryListResult(document),
          imported: true,
          changed: false,
          added: false,
          replaced: false,
          entry: existing
        }
      };
    }

    const entries = document.entries.filter((candidate) => candidate.id !== entry.id);
    const replaced = entries.length !== document.entries.length;
    const nextDocument = withRegistryUpdate(storage, {
      ...document,
      entries: [...entries, entry].sort(compareRegistryEntries)
    });
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        imported: true,
        changed: true,
        added: !replaced,
        replaced,
        entry
      }
    };
  });
}

export async function removeProjectRegistryEntry(
  projectId: string,
  options: RegistryCommandOptions = {}
): Promise<RegistryRemoveResult> {
  const storage = registryStorage(options);
  return mutateRegistry(storage, (document) => {
    const entry = document.entries.find((candidate) => candidate.id === projectId);
    if (!entry) {
      throw new BorealError("BOREAL_NOT_FOUND", "Registry entry not found", { projectId });
    }
    const nextDocument = withRegistryUpdate(storage, {
      ...document,
      entries: document.entries.filter((candidate) => candidate.id !== projectId)
    });
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        removed: true,
        entry
      }
    };
  });
}

export async function doctorProjectRegistry(options: RegistryCommandOptions = {}): Promise<RegistryDoctorResult> {
  const storage = registryStorage(options);
  let document: ProjectRegistryDocument;
  try {
    document = await readRegistryDocument(storage);
  } catch (error) {
    const finding = registryReadErrorFinding(error, storage);
    return {
      ok: false,
      storage,
      entryCount: 0,
      findings: [finding]
    };
  }

  const findings: RegistryDoctorFinding[] = [];
  if (!existsSync(storage.registryFile)) {
    findings.push({
      code: "registry.empty",
      severity: "ok",
      message: "No project registry file exists yet",
      path: storage.registryFile
    });
  }
  if (document.storage.registryFile !== storage.registryFile) {
    findings.push({
      code: "registry.storage_mismatch",
      severity: "warning",
      message: "Registry storage metadata does not match the selected registry root",
      path: storage.registryFile,
      details: { expected: storage, actual: document.storage }
    });
  }

  for (const entry of document.entries) {
    findings.push(...await inspectRegistryEntry(entry));
  }

  return {
    ok: findings.every((finding) => finding.severity === "ok"),
    storage,
    entryCount: document.entries.length,
    findings
  };
}

function registryStorage(options: RegistryCommandOptions): ProjectRegistryStorage {
  return resolveProjectRegistryPaths({ rootDir: options.registryRoot });
}

async function mutateRegistry<T>(
  storage: ProjectRegistryStorage,
  mutation: (document: ProjectRegistryDocument) => { readonly document: ProjectRegistryDocument; readonly result: T }
): Promise<T> {
  return withFileLock(storage.lockDir, DEFAULT_FILE_LOCK_OPTIONS, async () => {
    const current = await readRegistryDocument(storage);
    const { document, result } = mutation(current);
    assertValidRegistryDocument(document, storage.registryFile);
    await writeTextFileAtomic(storage.registryFile, `${JSON.stringify(document, null, 2)}\n`);
    return result;
  });
}

async function readRegistryDocument(storage: ProjectRegistryStorage): Promise<ProjectRegistryDocument> {
  if (!existsSync(storage.registryFile)) {
    return emptyRegistryDocument(storage);
  }
  const parsed = await readJsonFile(storage.registryFile, {
    schemaName: PROJECT_REGISTRY_SCHEMA_VERSION,
    expectedObject: true,
    maxBytes: 2 * 1024 * 1024
  });
  assertValidRegistryDocument(parsed, storage.registryFile);
  return parsed as ProjectRegistryDocument;
}

function emptyRegistryDocument(storage: ProjectRegistryStorage): ProjectRegistryDocument {
  return {
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    storage,
    entries: []
  };
}

function withRegistryUpdate(storage: ProjectRegistryStorage, document: ProjectRegistryDocument): ProjectRegistryDocument {
  return {
    ...document,
    storage,
    updatedAt: nowIso()
  };
}

function assertValidRegistryDocument(value: unknown, registryFile: string): void {
  const issues = projectRegistryDocumentSchemaIssues(value);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Project registry file failed schema validation", {
      registryFile,
      issues
    });
  }
}

async function readTargetProjectSetup(workspaceRoot: string): Promise<ProjectSetupConfig> {
  const stateFile = join(workspaceRoot, ".boreal", "runtime", "state.json");
  if (!existsSync(stateFile)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Registry add requires an initialized Boreal workspace", {
      workspaceRoot,
      stateFile
    });
  }
  const config = await readProjectSetupConfig(workspaceRoot);
  if (!config) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Registry add requires .boreal/project.json project setup metadata", {
      workspaceRoot,
      configPath: join(workspaceRoot, ".boreal", "project.json")
    });
  }
  return config;
}

function registryEntryFromConfig(
  config: ProjectSetupConfig,
  options: { readonly name?: string; readonly labels: readonly string[] }
): ProjectRegistryEntry {
  const projectRoot = resolve(config.projectRoot);
  const memoryRoot = resolve(config.memoryRoot);
  const now = nowIso();
  return {
    id: registryEntryId(projectRoot),
    display: {
      name: normalizeMachineString(options.name ?? basename(projectRoot), "registry project name"),
      labels: normalizeLabels(options.labels)
    },
    projectRoot,
    borealDir: join(projectRoot, ".boreal"),
    runtimeDir: join(projectRoot, ".boreal", "runtime"),
    runtimeStateFile: join(projectRoot, ".boreal", "runtime", "state.json"),
    projectConfigPath: join(projectRoot, ".boreal", "project.json"),
    memoryRoot,
    memoryBorealDir: join(memoryRoot, ".boreal"),
    memoryLayout: config.memoryLayout,
    memoryGitMode: config.memoryGitMode,
    memoryRemote: config.memoryRemote,
    installRoot: resolve(config.installRoot),
    skillInstallRoots: config.skillInstallRoots ?? config.skillTargets.map((target) => skillInstallRootConfig(projectRoot, resolve(config.installRoot), target)),
    skillTargets: config.skillTargets,
    folderScoped: config.folderScoped,
    source: "project-setup",
    addedAt: now,
    updatedAt: now,
    lastSeenAt: now
  };
}

function registryEntryId(projectRoot: string): string {
  return `project_${hashContent({ projectRoot: resolve(projectRoot) }).replace("sha256:", "").slice(0, 16)}`;
}

async function inspectRegistryEntry(entry: ProjectRegistryEntry): Promise<readonly RegistryDoctorFinding[]> {
  const findings: RegistryDoctorFinding[] = [
    await pathFinding(entry, "registry.project_root", entry.projectRoot, "directory", "Project root exists"),
    await pathFinding(entry, "registry.boreal_dir", entry.borealDir, "directory", "Boreal metadata directory exists"),
    await pathFinding(entry, "registry.runtime_state", entry.runtimeStateFile, "file", "Runtime state file exists"),
    await pathFinding(entry, "registry.project_config", entry.projectConfigPath, "file", "Project setup config exists"),
    await pathFinding(entry, "registry.memory_root", entry.memoryRoot, "directory", "Memory root exists"),
    await pathFinding(entry, "registry.memory_boreal_dir", entry.memoryBorealDir, "directory", "Memory local runtime directory exists")
  ];

  const installRoot = await pathFinding(entry, "registry.install_root", entry.installRoot, "directory", "Install root exists");
  findings.push(installRoot.severity === "error" ? { ...installRoot, severity: "warning" } : installRoot);

  try {
    const config = await readProjectSetupConfig(entry.projectRoot);
    if (!config) {
      findings.push({
        code: "registry.project_setup_missing",
        severity: "error",
        message: "Project setup config is missing",
        projectId: entry.id,
        path: entry.projectConfigPath
      });
    } else {
      findings.push(...configMismatchFindings(entry, config));
    }
  } catch (error) {
    findings.push({
      code: "registry.project_setup_invalid",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
      projectId: entry.id,
      path: entry.projectConfigPath
    });
  }

  return findings;
}

function configMismatchFindings(entry: ProjectRegistryEntry, config: ProjectSetupConfig): readonly RegistryDoctorFinding[] {
  const findings: RegistryDoctorFinding[] = [];
  if (resolve(config.memoryRoot) !== resolve(entry.memoryRoot)) {
    findings.push({
      code: "registry.memory_root_mismatch",
      severity: "error",
      message: "Registered memory root does not match project setup config",
      projectId: entry.id,
      path: entry.memoryRoot,
      details: { expected: entry.memoryRoot, actual: config.memoryRoot }
    });
  }
  if (config.memoryLayout !== entry.memoryLayout) {
    findings.push({
      code: "registry.memory_layout_mismatch",
      severity: "error",
      message: "Registered memory layout does not match project setup config",
      projectId: entry.id,
      details: { expected: entry.memoryLayout, actual: config.memoryLayout }
    });
  }
  if (config.memoryGitMode !== entry.memoryGitMode) {
    findings.push({
      code: "registry.memory_git_mode_mismatch",
      severity: "error",
      message: "Registered memory Git mode does not match project setup config",
      projectId: entry.id,
      details: { expected: entry.memoryGitMode, actual: config.memoryGitMode }
    });
  }
  if (resolve(config.installRoot) !== resolve(entry.installRoot)) {
    findings.push({
      code: "registry.install_root_mismatch",
      severity: "warning",
      message: "Registered install root does not match project setup config",
      projectId: entry.id,
      path: entry.installRoot,
      details: { expected: entry.installRoot, actual: config.installRoot }
    });
  }
  const expectedSkillRoots = config.skillInstallRoots ?? config.skillTargets.map((target) => skillInstallRootConfig(entry.projectRoot, config.installRoot, target));
  const actualSkillRoots = entry.skillInstallRoots ?? [];
  for (const expected of expectedSkillRoots) {
    const actual = actualSkillRoots.find((root) => root.target === expected.target);
    if (!actual || resolve(actual.installRoot) !== resolve(expected.installRoot) || resolve(actual.skillRoot) !== resolve(expected.skillRoot)) {
      findings.push({
        code: "registry.skill_install_root_mismatch",
        severity: "warning",
        message: "Registered target-specific skill install root does not match project setup config",
        projectId: entry.id,
        path: actual?.installRoot ?? entry.installRoot,
        details: { target: expected.target, expected, actual }
      });
    }
  }
  return findings;
}

async function pathFinding(
  entry: ProjectRegistryEntry,
  code: string,
  path: string,
  kind: "file" | "directory",
  okMessage: string
): Promise<RegistryDoctorFinding> {
  const info = await stat(path).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!info) {
    return {
      code,
      severity: "error",
      message: `${kind === "file" ? "File" : "Directory"} is missing`,
      projectId: entry.id,
      path
    };
  }
  const valid = kind === "file" ? info.isFile() : info.isDirectory();
  return {
    code,
    severity: valid ? "ok" : "error",
    message: valid ? okMessage : `Path is not a ${kind}`,
    projectId: entry.id,
    path
  };
}

function registryReadErrorFinding(error: unknown, storage: ProjectRegistryStorage): RegistryDoctorFinding {
  return {
    code: "registry.invalid",
    severity: "error",
    message: error instanceof Error ? error.message : String(error),
    path: storage.registryFile,
    details: error instanceof BorealError ? error.details : undefined
  };
}

function registryListResult(document: ProjectRegistryDocument): RegistryListResult {
  const entries = [...document.entries].sort(compareRegistryEntries);
  return {
    storage: document.storage,
    entries,
    entryCount: entries.length
  };
}

function compareRegistryEntries(left: ProjectRegistryEntry, right: ProjectRegistryEntry): number {
  return left.display.name.localeCompare(right.display.name) || left.id.localeCompare(right.id);
}

function registryEntriesEquivalent(left: ProjectRegistryEntry, right: ProjectRegistryEntry): boolean {
  return JSON.stringify(registryEntryStableFields(left)) === JSON.stringify(registryEntryStableFields(right));
}

function registryEntryStableFields(entry: ProjectRegistryEntry): Omit<ProjectRegistryEntry, "addedAt" | "updatedAt" | "lastSeenAt"> {
  const { addedAt: _addedAt, updatedAt: _updatedAt, lastSeenAt: _lastSeenAt, ...stable } = entry;
  return stable;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
