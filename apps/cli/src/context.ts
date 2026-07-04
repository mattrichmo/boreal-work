import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, resolve } from "node:path";

import {
  BorealError,
  normalizeActorId,
  resolveProjectRegistryPaths,
  resolveWorkspacePaths,
  type ActorKind,
  type ActorRef,
  type OperationId
} from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { FileBorealStore, ObjectDirBorealStore, type BorealStore } from "@boreal/storage";

import { flagValue, hasFlag, type ParsedArgs } from "./args.js";
import { readProjectStorage, type ProjectStorageKind } from "./project-setup.js";

/** The global workspace lives at the machine-local registry root (app-state).
 * Passing env so BOREAL_PROJECT_REGISTRY_ROOT is honored (overrides + tests). */
export function resolveGlobalWorkspaceRoot(): string {
  return resolveProjectRegistryPaths({ env: process.env }).rootDir;
}

/** True when the command should operate on the global workspace. */
export function isGlobalContext(args: ParsedArgs): boolean {
  return hasFlag(args, "global") || args.command[0] === "global";
}

export interface CliContext {
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly paths: ReturnType<typeof resolveWorkspacePaths>;
  readonly storage: ProjectStorageKind;
  readonly store: BorealStore;
  readonly runtime: ReturnType<typeof createBorealRuntime>;
  readonly actor: ActorRef;
  readonly sessionId: string;
  readonly operationId?: OperationId;
}

export interface CreateCliContextOptions {
  readonly operationId?: OperationId;
  readonly sessionId?: string;
}

export async function createCliContext(
  args: ParsedArgs,
  cwd: string,
  options: CreateCliContextOptions = {}
): Promise<CliContext> {
  const useGlobal = isGlobalContext(args);
  const explicitWorkspace = flagValue(args, "workspace") ?? flagValue(args, "project-root");
  const workspaceRoot = useGlobal
    ? resolveGlobalWorkspaceRoot()
    : explicitWorkspace
      ? resolveExplicitWorkspaceRoot(explicitWorkspace)
      : resolveDiscoveredWorkspaceRoot(cwd);
  const paths = resolveWorkspacePaths(workspaceRoot);
  const actor = actorFromArgs(args);
  const sessionId = options.sessionId ? normalizeActorId(options.sessionId) : sessionIdFromArgs(args);
  const storage = await selectStorageKind(args, workspaceRoot, paths);
  const store = storage === "objects-v1" ? new ObjectDirBorealStore({ rootDir: workspaceRoot }) : new FileBorealStore({ rootDir: workspaceRoot });
  const runtime = createBorealRuntime({ store, actor, operationId: options.operationId });
  const context: CliContext = { cwd, workspaceRoot, paths, storage, store, runtime, actor, sessionId, operationId: options.operationId };
  // The global workspace is auto-initialized on first use so it always exists.
  if (useGlobal) {
    await ensureWorkspaceDirs(context);
    await runtime.ensureWorkspaceInitialized();
  }
  return context;
}

export async function ensureWorkspaceDirs(context: CliContext): Promise<void> {
  await mkdir(dirname(context.paths.stateFile), { recursive: true });
}

export function assertInitialized(context: CliContext): void {
  const initialized =
    context.storage === "objects-v1"
      ? existsSync(context.paths.borealDir) && (existsSync(context.paths.eventLogFile) || existsSync(context.paths.objectsDir))
      : existsSync(context.paths.borealDir) && existsSync(context.paths.stateFile);
  if (!initialized) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Boreal workspace is not initialized; run `bwrk init`", {
      workspaceRoot: context.workspaceRoot,
      storage: context.storage
    });
  }
}

async function selectStorageKind(
  args: ParsedArgs,
  workspaceRoot: string,
  paths: ReturnType<typeof resolveWorkspacePaths>
): Promise<ProjectStorageKind> {
  const configured = await readProjectStorage(workspaceRoot);
  if (configured) {
    return configured;
  }
  if (args.command[0] === "init" && !existsSync(paths.stateFile)) {
    return initDefaultStorageKind();
  }
  return "file-v2";
}

function initDefaultStorageKind(): ProjectStorageKind {
  return process.env.BOREAL_INIT_STORAGE === "file-v2" ? "file-v2" : "objects-v1";
}

function resolveExplicitWorkspaceRoot(start: string): string {
  return resolve(start.replace(/^~(?=$|\/)/, homedir()));
}

function resolveDiscoveredWorkspaceRoot(start: string): string {
  const absolute = resolve(start.replace(/^~(?=$|\/)/, homedir()));
  const existing = findBorealRoot(absolute);
  return existing ?? absolute;
}

function findBorealRoot(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, ".boreal"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function actorFromArgs(args: ParsedArgs): ActorRef {
  const id = normalizeActorId(flagValue(args, "actor") ?? process.env.BOREAL_ACTOR ?? userInfo().username);
  const kind = (flagValue(args, "actor-kind") ?? "human") as ActorKind;
  if (kind !== "human" && kind !== "agent" && kind !== "system") {
    throw new BorealError("BOREAL_INVALID_INPUT", "--actor-kind must be human, agent, or system");
  }
  return {
    id,
    kind,
    displayName: id
  };
}

function sessionIdFromArgs(args: ParsedArgs): string {
  return normalizeActorId(flagValue(args, "session") ?? process.env.BOREAL_SESSION_ID ?? "local");
}
