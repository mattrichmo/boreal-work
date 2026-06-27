import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAbsolute, resolve } from "node:path";

import { createFixtureConsoleData } from "./app/fixtures.js";
import { getSafeConsoleCommand } from "./app/commands.js";
import {
  ConsoleCommandError,
  createNodeCliRunner,
  loadLiveConsoleData,
  runSafeConsoleCommand,
  type ConsoleCliRunner
} from "./app/live-data.js";
import { renderConsoleHtml } from "./app/render.js";
import { consoleStatePayload } from "./app/render.js";
import { routeFromPath } from "./app/routes.js";
import type { ConsoleDataMode, ConsoleDataSet } from "./app/types.js";

export interface ConsoleServerOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
  readonly mode?: ConsoleDataMode;
  readonly runner?: ConsoleCliRunner;
}

export interface RunningConsoleServer {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

export function createConsoleHttpServer(options: ConsoleServerOptions): Server {
  const workspaceRoot = resolve(options.workspaceRoot);
  const mode = options.mode ?? "live";
  return createServer(async (request, response) => {
    try {
      const url = requestUrl(request);
      if (url.pathname === "/api/state") {
        await sendJson(response, consoleStatePayload(await loadConsoleData({ workspaceRoot, mode, runner: options.runner })));
        return;
      }
      if (url.pathname.startsWith("/api/commands/")) {
        await handleCommand({ request, response, workspaceRoot, runner: options.runner });
        return;
      }
      if (url.pathname.startsWith("/api/settings/projects/")) {
        await handleProjectSettings({ request, response, workspaceRoot, runner: options.runner });
        return;
      }
      const route = routeFromPath(url.pathname);
      const data = await loadConsoleData({
        workspaceRoot,
        mode: url.searchParams.get("mode") === "fixture" ? "fixture" : mode,
        runner: options.runner
      });
      sendHtml(response, renderConsoleHtml({ route: `${route.path}${url.search}`, data }));
    } catch (error) {
      sendError(response, error);
    }
  });
}

export async function listenConsole(options: ConsoleServerOptions): Promise<RunningConsoleServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4318;
  const server = createConsoleHttpServer(options);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    server,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

async function handleProjectSettings(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly workspaceRoot: string;
  readonly runner?: ConsoleCliRunner;
}): Promise<void> {
  if (input.request.method !== "POST") {
    input.response.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
    input.response.end(JSON.stringify({ ok: false, error: { code: "CONSOLE_METHOD_NOT_ALLOWED", message: "Project settings require POST" } }, null, 2));
    return;
  }
  const params = new URLSearchParams(await readBody(input.request));
  if (params.get("confirm") !== "yes") {
    await sendJson(input.response, {
      ok: false,
      error: {
        code: "CONSOLE_COMMAND_CONFIRMATION_REQUIRED",
        message: "Project settings writes require confirmation"
      }
    });
    return;
  }
  const action = requestUrl(input.request).pathname.replace("/api/settings/projects/", "");
  const runner = input.runner ?? createNodeCliRunner({ workspaceRoot: input.workspaceRoot });
  const projectRoot = absoluteParam(params, "projectRoot");
  const validation = await validateProjectBeforeSettingsWrite(runner, projectRoot);
  if (action === "add") {
    const result = await runner.run(["registry", "add", "--workspace", projectRoot, "--json"]);
    await sendJson(input.response, { ok: true, action, validation, result });
    return;
  }
  if (action === "import-setup") {
    const result = await runner.run(["--workspace", projectRoot, "registry", "import-setup", "--json"]);
    await sendJson(input.response, { ok: true, action, validation, result });
    return;
  }
  if (action === "apply-setup") {
    const memoryRoot = absoluteParam(params, "memoryRoot");
    const memoryLayout = enumParam(params, "memoryLayout", ["in-repo", "child", "sibling"] as const);
    const memoryGitMode = enumParam(params, "memoryGitMode", ["shared", "separate", "submodule"] as const);
    const memoryRemote = params.get("memoryRemote")?.trim() ?? "";
    if (memoryGitMode === "submodule" && memoryRemote.length === 0) {
      throw new ConsoleCommandError("CONSOLE_SETTINGS_REMOTE_REQUIRED", "Submodule memory mode requires a memory remote");
    }
    const setupArgs = [
      "--workspace",
      projectRoot,
      "init",
      "--setup-memory",
      "--memory-root",
      memoryRoot,
      "--memory-layout",
      memoryLayout,
      "--memory-git-mode",
      memoryGitMode,
      ...(memoryGitMode === "submodule" ? ["--memory-remote", memoryRemote] : []),
      "--json"
    ];
    const setup = await runner.run(setupArgs);
    const registry = await runner.run(["--workspace", projectRoot, "registry", "import-setup", "--json"]);
    await sendJson(input.response, { ok: true, action, validation, setup, registry });
    return;
  }
  throw new ConsoleCommandError("CONSOLE_SETTINGS_ACTION_UNKNOWN", "Unknown project settings action", { action });
}

async function validateProjectBeforeSettingsWrite(runner: ConsoleCliRunner, projectRoot: string): Promise<unknown> {
  const validation = await runner.run(["--workspace", projectRoot, "doctor", "--json"]);
  if (!healthOk(validation)) {
    throw new ConsoleCommandError("CONSOLE_SETTINGS_VALIDATION_FAILED", "Project setup drift must be resolved before settings writes", {
      projectRoot,
      validation
    });
  }
  return validation;
}

function absoluteParam(params: URLSearchParams, key: string): string {
  const value = params.get(key)?.trim() ?? "";
  if (!value || !isAbsolute(value)) {
    throw new ConsoleCommandError("CONSOLE_SETTINGS_INVALID_PATH", `${key} must be an absolute path`, { key });
  }
  return value;
}

function enumParam<const T extends readonly string[]>(params: URLSearchParams, key: string, values: T): T[number] {
  const value = params.get(key)?.trim() ?? "";
  if (!values.includes(value)) {
    throw new ConsoleCommandError("CONSOLE_SETTINGS_INVALID_VALUE", `${key} is invalid`, { key, allowed: [...values] });
  }
  return value;
}

function healthOk(value: unknown): boolean {
  return isRecord(value) && value.ok !== false;
}

async function loadConsoleData(input: {
  readonly workspaceRoot: string;
  readonly mode: ConsoleDataMode;
  readonly runner?: ConsoleCliRunner;
}): Promise<ConsoleDataSet> {
  if (input.mode === "fixture") {
    return createFixtureConsoleData({ workspaceRoot: input.workspaceRoot });
  }
  try {
    return await loadLiveConsoleData(input);
  } catch (error) {
    return createFixtureConsoleData({
      workspaceRoot: input.workspaceRoot,
      warnings: [error instanceof Error ? error.message : String(error)]
    });
  }
}

async function handleCommand(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly workspaceRoot: string;
  readonly runner?: ConsoleCliRunner;
}): Promise<void> {
  if (input.request.method !== "POST") {
    input.response.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
    input.response.end(JSON.stringify({ ok: false, error: { code: "CONSOLE_METHOD_NOT_ALLOWED", message: "Console commands require POST" } }, null, 2));
    return;
  }
  const id = requestUrl(input.request).pathname.replace("/api/commands/", "");
  const body = await readBody(input.request);
  const params = new URLSearchParams(body);
  const confirmed = params.get("confirm") === "yes";
  const command = getSafeConsoleCommand(id);
  if (command?.requiresConfirmation === true && !confirmed) {
    await sendJson(input.response, {
      ok: false,
      error: {
        code: "CONSOLE_COMMAND_CONFIRMATION_REQUIRED",
        message: "Console command requires confirmation",
        details: { commandId: id },
        recovery: recoveryActionsForCode("CONSOLE_COMMAND_CONFIRMATION_REQUIRED", { commandId: id })
      }
    });
    return;
  }
  const result = await runSafeConsoleCommand({ id, workspaceRoot: input.workspaceRoot, runner: input.runner, params });
  const returnTo = safeReturnTo(params.get("returnTo"));
  if (returnTo) {
    input.response.writeHead(303, { location: returnTo });
    input.response.end();
    return;
  }
  await sendJson(input.response, { ok: true, commandId: id, result });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

async function sendJson(response: ServerResponse, value: unknown): Promise<void> {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function sendError(response: ServerResponse, error: unknown): void {
  response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify({ ok: false, error: errorPayload(error) }, null, 2)}\n`);
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ConsoleCommandError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      recovery: recoveryActionsForCode(error.code, error.details)
    };
  }
  return {
    code: "CONSOLE_ERROR",
    message: error instanceof Error ? error.message : String(error),
    recovery: recoveryActionsForCode("CONSOLE_ERROR")
  };
}

function safeReturnTo(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return undefined;
  }
  return trimmed;
}

function recoveryActionsForCode(code: string, details: Record<string, unknown> = {}): readonly Record<string, string>[] {
  const workId = recoveryWorkId(details);
  const commandId = typeof details.commandId === "string" ? details.commandId : "";
  const actions: Record<string, string>[] = [];
  if (code === "CONSOLE_COMMAND_CONFIRMATION_REQUIRED") {
    actions.push({
      label: "Confirm action",
      command: "Submit the form again with the confirmation checkbox selected."
    });
  }
  if (code === "CONSOLE_COMMAND_NEEDS_INPUT" || code === "CONSOLE_COMMAND_INVALID_INPUT") {
    actions.push({
      label: "Check required fields",
      command: commandId ? `Review inputs for ${commandId}` : "Review required command inputs."
    });
  }
  if (workId) {
    actions.push({ label: "Inspect work", command: `bwrk work show ${workId} --json` });
  }
  actions.push(
    { label: "Refresh projections", command: "bwrk sync refresh --json" },
    { label: "Run doctor", command: "bwrk doctor --json" }
  );
  return actions;
}

function recoveryWorkId(details: Record<string, unknown>): string {
  if (typeof details.workId === "string") {
    return details.workId;
  }
  if (isRecord(details.work) && typeof details.work.id === "string") {
    return details.work.id;
  }
  if (isRecord(details.reservation) && typeof details.reservation.workId === "string") {
    return details.reservation.workId;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServerArgs(argv: readonly string[]): ConsoleServerOptions {
  return {
    workspaceRoot: valueAfter(argv, "--workspace") ?? process.cwd(),
    host: valueAfter(argv, "--host") ?? "127.0.0.1",
    port: Number(valueAfter(argv, "--port") ?? "4318"),
    mode: valueAfter(argv, "--mode") === "fixture" ? "fixture" : "live"
  };
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const running = await listenConsole(parseServerArgs(process.argv.slice(2)));
  process.stdout.write(`Boreal console running at ${running.url}\n`);
}
