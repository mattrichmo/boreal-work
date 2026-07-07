import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import {
  BorealError,
  deriveProjectRegistryIdentity,
  LEGACY_PROJECT_REGISTRY_SCHEMA_VERSIONS,
  normalizeLabels,
  normalizeMachineString,
  nowIso,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  projectRegistryEntryIdFromIdentity,
  projectRegistryIdentitiesEquivalent,
  projectRegistryDocumentSchemaIssues,
  readJsonFile,
  resolveProjectRegistryPaths,
  resolveWorkspacePaths,
  type ProjectRegistryDocument,
  type ProjectRegistryEntry,
  type ProjectRegistryIdentity,
  type ProjectRegistryLifecycleState,
  type ProjectRegistryStorage
} from "@boreal/core";
import { DEFAULT_FILE_LOCK_OPTIONS, withFileLock, writeTextFileAtomic } from "@boreal/storage";

import { readProjectSetupConfigFile, readProjectStorage, skillInstallRootConfig, type ProjectSetupConfig } from "./project-setup.js";
import { resolveRepoBwrkPin } from "./repo-binary-pin.js";

const execFileAsync = promisify(execFile);

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
  readonly archived: boolean;
  readonly purged: boolean;
  readonly entry: ProjectRegistryEntry;
}

export interface RegistryLifecycleUpdate {
  readonly projectId: string;
  readonly from: ProjectRegistryLifecycleState;
  readonly to: ProjectRegistryLifecycleState;
  readonly reason: string;
}

export interface RegistrySetLifecycleResult extends RegistryListResult {
  readonly changed: boolean;
  readonly previousLifecycle: ProjectRegistryLifecycleState;
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
  readonly changed: boolean;
  readonly lifecycleUpdates: readonly RegistryLifecycleUpdate[];
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

export interface RegistryRemoveOptions extends RegistryCommandOptions {
  readonly purge?: boolean;
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
  const generatedEntry = await registryEntryFromConfig(config, workspaceRoot, {
    name: options.name,
    labels: options.labels ?? []
  });

  return mutateRegistry<RegistryAddResult>(storage, (document) => {
    const existing = findReusableRegistryEntry(document.entries, generatedEntry);
    const entry = linkedRegistryEntry(generatedEntry, existing, {
      preserveDisplay: false,
      nameProvided: Boolean(options.name),
      labelsProvided: Boolean(options.labels && options.labels.length > 0)
    });
    const entries = document.entries.filter((candidate) => candidate.id !== entry.id);
    const replaced = existing !== undefined || entries.length !== document.entries.length;
    const collisionSafeEntry = existing ? entry : withCollisionSafeId(entry, entries);
    const nextDocument = withRegistryUpdate(storage, {
      ...document,
      entries: [...entries, collisionSafeEntry].sort(compareRegistryEntries)
    });
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        added: !replaced,
        replaced,
        entry: collisionSafeEntry
      }
    };
  });
}

export async function importProjectSetupRegistryEntry(options: RegistryAddOptions): Promise<RegistryImportSetupResult> {
  const storage = registryStorage(options);
  const workspaceRoot = resolve(options.workspaceRoot);
  const config = await readTargetProjectSetup(workspaceRoot);
  const generatedEntry = await registryEntryFromConfig(config, workspaceRoot, {
    name: options.name,
    labels: options.labels ?? []
  });

  return mutateRegistry<RegistryImportSetupResult>(storage, (document) => {
    const existing = findReusableRegistryEntry(document.entries, generatedEntry);
    const entry = linkedRegistryEntry(generatedEntry, existing, {
      preserveDisplay: true,
      nameProvided: Boolean(options.name),
      labelsProvided: Boolean(options.labels && options.labels.length > 0)
    });

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
    const replaced = existing !== undefined || entries.length !== document.entries.length;
    const collisionSafeEntry = existing ? entry : withCollisionSafeId(entry, entries);
    const nextDocument = withRegistryUpdate(storage, {
      ...document,
      entries: [...entries, collisionSafeEntry].sort(compareRegistryEntries)
    });
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        imported: true,
        changed: true,
        added: !replaced,
        replaced,
        entry: collisionSafeEntry
      }
    };
  });
}

export async function removeProjectRegistryEntry(
  projectId: string,
  options: RegistryRemoveOptions = {}
): Promise<RegistryRemoveResult> {
  const storage = registryStorage(options);
  return mutateRegistry(storage, (document) => {
    const entry = document.entries.find((candidate) => candidate.id === projectId);
    if (!entry) {
      throw new BorealError("BOREAL_NOT_FOUND", "Registry entry not found", { projectId, domain: "workflow" });
    }
    const archivedEntry = {
      ...entry,
      lifecycle: "archived" as const,
      updatedAt: nowIso()
    };
    const nextEntries = options.purge
      ? document.entries.filter((candidate) => candidate.id !== projectId)
      : document.entries.map((candidate) => candidate.id === projectId ? archivedEntry : candidate);
    const nextDocument = withRegistryUpdate(storage, {
      ...document,
      entries: nextEntries.sort(compareRegistryEntries)
    });
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        removed: true,
        archived: !options.purge,
        purged: Boolean(options.purge),
        entry: options.purge ? entry : archivedEntry
      }
    };
  });
}

export async function setProjectRegistryLifecycle(
  projectId: string,
  lifecycle: ProjectRegistryLifecycleState,
  options: RegistryCommandOptions = {}
): Promise<RegistrySetLifecycleResult> {
  const storage = registryStorage(options);
  return mutateRegistry(storage, (document) => {
    const entry = document.entries.find((candidate) => candidate.id === projectId);
    if (!entry) {
      throw new BorealError("BOREAL_NOT_FOUND", "Registry entry not found", { projectId, domain: "workflow" });
    }
    const changed = entry.lifecycle !== lifecycle;
    const updatedAt = nowIso();
    const updatedEntry = changed
      ? {
          ...entry,
          lifecycle,
          updatedAt,
          ...(lifecycle === "linked" ? { lastSeenAt: updatedAt } : {})
        }
      : entry;
    const nextDocument = changed
      ? withRegistryUpdate(storage, {
          ...document,
          entries: document.entries.map((candidate) => candidate.id === projectId ? updatedEntry : candidate).sort(compareRegistryEntries)
        })
      : document;
    return {
      document: nextDocument,
      result: {
        ...registryListResult(nextDocument),
        changed,
        previousLifecycle: entry.lifecycle,
        entry: updatedEntry
      }
    };
  });
}

export async function doctorProjectRegistry(options: RegistryCommandOptions = {}): Promise<RegistryDoctorResult> {
  const storage = registryStorage(options);
  return withFileLock(storage.lockDir, DEFAULT_FILE_LOCK_OPTIONS, async () => {
    let document: ProjectRegistryDocument;
    try {
      document = await readRegistryDocument(storage);
    } catch (error) {
      const finding = registryReadErrorFinding(error, storage);
      return {
        ok: false,
        storage,
        entryCount: 0,
        changed: false,
        lifecycleUpdates: [],
        findings: [finding]
      };
    }

    const findings: RegistryDoctorFinding[] = [];
    const lifecycleUpdates: RegistryLifecycleUpdate[] = [];
    let entriesChanged = false;
    const nextEntries: ProjectRegistryEntry[] = [];

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
      const inspected = await inspectAndReconcileRegistryEntry(entry);
      nextEntries.push(inspected.entry);
      findings.push(...inspected.findings);
      if (inspected.update) {
        entriesChanged = true;
        lifecycleUpdates.push(inspected.update);
      }
    }

    const nextDocument = entriesChanged
      ? withRegistryUpdate(storage, {
          ...document,
          entries: nextEntries.sort(compareRegistryEntries)
        })
      : document;
    if (entriesChanged) {
      assertValidRegistryDocument(nextDocument, storage.registryFile);
      await writeTextFileAtomic(storage.registryFile, `${JSON.stringify(nextDocument, null, 2)}\n`);
    }

    return {
      ok: findings.every((finding) => finding.severity === "ok"),
      storage,
      entryCount: nextDocument.entries.length,
      changed: entriesChanged,
      lifecycleUpdates,
      findings
    };
  });
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
  const migrated = migrateRegistryDocument(parsed, storage);
  assertValidRegistryDocument(migrated, storage.registryFile);
  return migrated;
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

function migrateRegistryDocument(value: unknown, storage: ProjectRegistryStorage): ProjectRegistryDocument {
  if (!isRecord(value)) {
    return value as ProjectRegistryDocument;
  }

  if (value.schemaVersion === PROJECT_REGISTRY_SCHEMA_VERSION) {
    return value as unknown as ProjectRegistryDocument;
  }

  if (!LEGACY_PROJECT_REGISTRY_SCHEMA_VERSIONS.includes(value.schemaVersion as (typeof LEGACY_PROJECT_REGISTRY_SCHEMA_VERSIONS)[number])) {
    return value as unknown as ProjectRegistryDocument;
  }

  const entries = Array.isArray(value.entries)
    ? value.entries.map((entry) => migrateRegistryEntry(entry))
    : value.entries;
  return {
    ...value,
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    storage: isRecord(value.storage) ? value.storage : storage,
    entries
  } as ProjectRegistryDocument;
}

function migrateRegistryEntry(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const projectRoot = typeof value.projectRoot === "string" ? value.projectRoot : "";
  const identity = isProjectRegistryIdentity(value.identity)
    ? value.identity
    : deriveProjectRegistryIdentity({ projectRoot });
  const lifecycle = isProjectRegistryLifecycle(value.lifecycle) ? value.lifecycle : "linked";
  return {
    ...value,
    id: typeof value.id === "string" && value.id.length > 0 ? value.id : projectRegistryEntryIdFromIdentity(identity),
    identity,
    lifecycle
  };
}

async function readTargetProjectSetup(workspaceRoot: string): Promise<ProjectSetupConfig> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  const storage = (await readProjectStorage(workspaceRoot)) ?? "file-v2";
  const initialized =
    storage === "objects-v1"
      ? existsSync(paths.eventLogFile) || existsSync(paths.objectsDir)
      : existsSync(paths.stateFile);
  if (!initialized) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Registry add requires an initialized Boreal workspace", {
      workspaceRoot,
      storage,
      stateFile: paths.stateFile,
      eventLogFile: paths.eventLogFile
    });
  }
  const config = await readProjectSetupConfigFile(workspaceRoot);
  if (!config) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Registry add requires .boreal/project.json project setup metadata", {
      workspaceRoot,
      configPath: join(workspaceRoot, ".boreal", "project.json")
    });
  }
  return config;
}

async function registryEntryFromConfig(
  config: ProjectSetupConfig,
  workspaceRoot: string,
  options: { readonly name?: string; readonly labels: readonly string[] }
): Promise<ProjectRegistryEntry> {
  const projectRoot = resolve(workspaceRoot);
  const configuredProjectRoot = resolve(config.projectRoot);
  const memoryRoot = rebaseConfiguredPath(configuredProjectRoot, projectRoot, config.memoryRoot);
  const installRoot = rebaseConfiguredPath(configuredProjectRoot, projectRoot, config.installRoot);
  const bwrkPin = resolveRepoBwrkPin(projectRoot, { requireExisting: true });
  const identity = deriveProjectRegistryIdentity({
    projectRoot,
    projectConfig: config as unknown as Readonly<Record<string, unknown>>,
    gitRemote: await readProjectGitRemote(projectRoot)
  });
  const now = nowIso();
  return {
    id: projectRegistryEntryIdFromIdentity(identity),
    identity,
    lifecycle: "linked",
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
    installRoot,
    bwrkPin,
    skillInstallRoots: registrySkillInstallRoots(config, configuredProjectRoot, projectRoot, installRoot),
    skillTargets: config.skillTargets,
    folderScoped: config.folderScoped,
    source: "project-setup",
    addedAt: now,
    updatedAt: now,
    lastSeenAt: now
  };
}

function registrySkillInstallRoots(
  config: ProjectSetupConfig,
  configuredProjectRoot: string,
  projectRoot: string,
  installRoot: string
): ProjectRegistryEntry["skillInstallRoots"] {
  if (!config.skillInstallRoots) {
    return config.skillTargets.map((target) => skillInstallRootConfig(projectRoot, installRoot, target));
  }
  return config.skillInstallRoots.map((root) => ({
    target: root.target,
    installRoot: rebaseConfiguredPath(configuredProjectRoot, projectRoot, root.installRoot),
    skillRoot: rebaseConfiguredPath(configuredProjectRoot, projectRoot, root.skillRoot)
  }));
}

function rebaseConfiguredPath(configuredProjectRoot: string, projectRoot: string, path: string): string {
  const absolute = resolve(path);
  const relativePath = relative(configuredProjectRoot, absolute);
  if (relativePath === "") {
    return projectRoot;
  }
  if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return resolve(projectRoot, relativePath);
  }
  return absolute;
}

async function readProjectGitRemote(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, "config", "--get", "remote.origin.url"], { timeout: 5_000 });
    const remote = stdout.trim();
    return remote.length > 0 ? remote : undefined;
  } catch {
    return undefined;
  }
}

function linkedRegistryEntry(
  generatedEntry: ProjectRegistryEntry,
  existing: ProjectRegistryEntry | undefined,
  options: {
    readonly preserveDisplay: boolean;
    readonly nameProvided: boolean;
    readonly labelsProvided: boolean;
  }
): ProjectRegistryEntry {
  const now = nowIso();
  return {
    ...generatedEntry,
    id: existing?.id ?? generatedEntry.id,
    display: {
      name: options.preserveDisplay && !options.nameProvided ? existing?.display.name ?? generatedEntry.display.name : generatedEntry.display.name,
      labels: options.preserveDisplay && !options.labelsProvided ? existing?.display.labels ?? generatedEntry.display.labels : generatedEntry.display.labels
    },
    lifecycle: "linked",
    addedAt: existing?.addedAt ?? generatedEntry.addedAt,
    updatedAt: now,
    lastSeenAt: now
  };
}

function findReusableRegistryEntry(
  entries: readonly ProjectRegistryEntry[],
  generatedEntry: ProjectRegistryEntry
): ProjectRegistryEntry | undefined {
  return entries.find((entry) => projectRegistryIdentitiesEquivalent(entry.identity, generatedEntry.identity))
    ?? entries.find((entry) => resolve(entry.projectRoot) === resolve(generatedEntry.projectRoot));
}

function withCollisionSafeId(entry: ProjectRegistryEntry, existingEntries: readonly ProjectRegistryEntry[]): ProjectRegistryEntry {
  let next = entry;
  let salt = 1;
  while (
    existingEntries.some((candidate) =>
      candidate.id === next.id && !projectRegistryIdentitiesEquivalent(candidate.identity, next.identity)
    )
  ) {
    next = {
      ...entry,
      id: projectRegistryEntryIdFromIdentity(entry.identity, `collision-${salt}`)
    };
    salt += 1;
  }
  return next;
}

interface RegistryEntryInspection {
  readonly entry: ProjectRegistryEntry;
  readonly findings: readonly RegistryDoctorFinding[];
  readonly update?: RegistryLifecycleUpdate;
}

async function inspectAndReconcileRegistryEntry(entry: ProjectRegistryEntry): Promise<RegistryEntryInspection> {
  if (entry.lifecycle === "archived") {
    return { entry, findings: await inspectRegistryEntry(entry) };
  }

  const projectRootState = await pathState(entry.projectRoot);
  if (projectRootState === "missing") {
    if (entry.lifecycle === "missing") {
      return {
        entry,
        findings: [{
          code: "registry.lifecycle_missing",
          severity: "ok",
          message: "Registry entry remains marked missing because the project root is absent",
          projectId: entry.id,
          path: entry.projectRoot
        }]
      };
    }
    const updatedAt = nowIso();
    const updatedEntry = {
      ...entry,
      lifecycle: "missing" as const,
      updatedAt
    };
    return {
      entry: updatedEntry,
      findings: [{
        code: "registry.lifecycle_missing",
        severity: "ok",
        message: "Project root is absent; registry lifecycle was marked missing",
        projectId: entry.id,
        path: entry.projectRoot
      }],
      update: {
        projectId: entry.id,
        from: entry.lifecycle,
        to: "missing",
        reason: "project_root_absent"
      }
    };
  }

  if (entry.lifecycle === "missing") {
    const updatedAt = nowIso();
    const updatedEntry = {
      ...entry,
      lifecycle: "linked" as const,
      updatedAt,
      lastSeenAt: updatedAt
    };
    return {
      entry: updatedEntry,
      findings: [
        {
          code: "registry.lifecycle_restored",
          severity: "ok",
          message: "Project root is present again; registry lifecycle was restored to linked",
          projectId: entry.id,
          path: entry.projectRoot
        },
        ...await inspectRegistryEntry(updatedEntry)
      ],
      update: {
        projectId: entry.id,
        from: "missing",
        to: "linked",
        reason: "project_root_present"
      }
    };
  }

  return { entry, findings: await inspectRegistryEntry(entry) };
}

async function inspectRegistryEntry(entry: ProjectRegistryEntry): Promise<readonly RegistryDoctorFinding[]> {
  if (entry.lifecycle === "archived") {
    return [{
      code: "registry.lifecycle_archived",
      severity: "ok",
      message: "Registry entry is archived and retained for reference resolution",
      projectId: entry.id,
      path: entry.projectRoot
    }];
  }

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
    const config = await readProjectSetupConfigFile(entry.projectRoot);
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

async function pathState(path: string): Promise<"missing" | "present"> {
  const info = await stat(path).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  return info ? "present" : "missing";
}

function configMismatchFindings(entry: ProjectRegistryEntry, config: ProjectSetupConfig): readonly RegistryDoctorFinding[] {
  const findings: RegistryDoctorFinding[] = [];
  const configuredProjectRoot = resolve(config.projectRoot);
  const expectedMemoryRoot = rebaseConfiguredPath(configuredProjectRoot, entry.projectRoot, config.memoryRoot);
  const expectedInstallRoot = rebaseConfiguredPath(configuredProjectRoot, entry.projectRoot, config.installRoot);
  if (resolve(expectedMemoryRoot) !== resolve(entry.memoryRoot)) {
    findings.push({
      code: "registry.memory_root_mismatch",
      severity: "error",
      message: "Registered memory root does not match project setup config",
      projectId: entry.id,
      path: entry.memoryRoot,
      details: { expected: entry.memoryRoot, actual: expectedMemoryRoot }
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
  if (resolve(expectedInstallRoot) !== resolve(entry.installRoot)) {
    findings.push({
      code: "registry.install_root_mismatch",
      severity: "warning",
      message: "Registered install root does not match project setup config",
      projectId: entry.id,
      path: entry.installRoot,
      details: { expected: entry.installRoot, actual: expectedInstallRoot }
    });
  }
  const expectedBwrkPin = resolveRepoBwrkPin(entry.projectRoot, { requireExisting: true });
  if (JSON.stringify(expectedBwrkPin) !== JSON.stringify(entry.bwrkPin)) {
    findings.push({
      code: "registry.bwrk_pin_mismatch",
      severity: "warning",
      message: "Registered repo-pinned bwrk metadata does not match the linked project",
      projectId: entry.id,
      path: entry.bwrkPin?.binPath ?? expectedBwrkPin?.binPath,
      details: { expected: expectedBwrkPin, actual: entry.bwrkPin }
    });
  }
  const expectedSkillRoots = registrySkillInstallRoots(config, configuredProjectRoot, entry.projectRoot, expectedInstallRoot) ?? [];
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

function isProjectRegistryIdentity(value: unknown): value is ProjectRegistryIdentity {
  return (
    isRecord(value) &&
    (value.strategy === "project-config" || value.strategy === "git-remote" || value.strategy === "path") &&
    typeof value.fingerprint === "string" &&
    value.fingerprint.length > 0
  );
}

function isProjectRegistryLifecycle(value: unknown): value is ProjectRegistryEntry["lifecycle"] {
  return value === "linked" || value === "paused" || value === "archived" || value === "missing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
