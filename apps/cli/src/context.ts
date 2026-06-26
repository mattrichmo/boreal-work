import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, resolve } from "node:path";

import {
  BorealError,
  normalizeActorId,
  resolveWorkspacePaths,
  type ActorKind,
  type ActorRef,
  type OperationId
} from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { FileBorealStore } from "@boreal/storage";

import { flagValue, type ParsedArgs } from "./args.js";

export interface CliContext {
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly paths: ReturnType<typeof resolveWorkspacePaths>;
  readonly store: FileBorealStore;
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
  const explicitWorkspace = flagValue(args, "workspace") ?? flagValue(args, "project-root");
  const workspaceRoot = explicitWorkspace
    ? resolveExplicitWorkspaceRoot(explicitWorkspace)
    : resolveDiscoveredWorkspaceRoot(cwd);
  const paths = resolveWorkspacePaths(workspaceRoot);
  const actor = actorFromArgs(args);
  const sessionId = options.sessionId ? normalizeActorId(options.sessionId) : sessionIdFromArgs(args);
  const store = new FileBorealStore({ rootDir: workspaceRoot });
  const runtime = createBorealRuntime({ store, actor, operationId: options.operationId });
  return { cwd, workspaceRoot, paths, store, runtime, actor, sessionId, operationId: options.operationId };
}

export async function ensureWorkspaceDirs(context: CliContext): Promise<void> {
  await mkdir(dirname(context.paths.stateFile), { recursive: true });
}

export function assertInitialized(context: CliContext): void {
  if (!existsSync(context.paths.borealDir) || !existsSync(context.paths.stateFile)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Boreal workspace is not initialized; run `bwrk init`", {
      workspaceRoot: context.workspaceRoot
    });
  }
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
