import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

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
import type { ConsoleDataMode, ConsoleDataSet, ConsoleScope, ConsoleSelection } from "./app/types.js";

export interface ConsoleServerOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
  readonly mode?: ConsoleDataMode;
  readonly scope?: ConsoleScope;
  readonly runner?: ConsoleCliRunner;
  readonly csrfToken?: string;
  readonly liveCacheTtlMs?: number;
  readonly allowFixtureFallback?: boolean;
}

const DEFAULT_LIVE_CACHE_TTL_MS = 60_000;
const MAX_CONSOLE_BODY_BYTES = 64 * 1024;

export interface RunningConsoleServer {
  readonly server: Server;
  readonly url: string;
  readonly csrfToken: string;
  readonly warnings: readonly string[];
  close(): Promise<void>;
}

export function createConsoleHttpServer(options: ConsoleServerOptions): Server {
  const workspaceRoot = resolve(options.workspaceRoot);
  const mode = options.mode ?? "live";
  const scope = options.scope ?? "repo";
  const host = options.host ?? "127.0.0.1";
  const csrfToken = options.csrfToken ?? createConsoleToken();
  const liveCache = createConsoleDataCache(options.liveCacheTtlMs ?? DEFAULT_LIVE_CACHE_TTL_MS);
  const allowFixtureFallback = options.allowFixtureFallback ?? false;
  return createServer(async (request, response) => {
    try {
      const url = requestUrl(request);
      if (url.pathname === "/api/state") {
        await sendJson(response, consoleStatePayload(await liveCache.load({ workspaceRoot, mode, scope, runner: options.runner, allowFixtureFallback })));
        return;
      }
      if (url.pathname.startsWith("/api/commands/")) {
        await handleCommand({ request, response, workspaceRoot, runner: options.runner, csrfToken, host, afterMutation: liveCache.invalidate });
        return;
      }
      if (url.pathname.startsWith("/api/settings/projects/")) {
        await handleProjectSettings({ request, response, workspaceRoot, runner: options.runner, csrfToken, host, afterMutation: liveCache.invalidate });
        return;
      }
      const route = routeFromPath(url.pathname, scope);
      const data = await liveCache.load({
        workspaceRoot,
        mode: url.searchParams.get("mode") === "fixture" ? "fixture" : mode,
        scope,
        runner: options.runner,
        allowFixtureFallback,
        selection: {
          wikiPage: url.searchParams.get("page") ?? undefined,
          rawSource: url.searchParams.get("source") ?? undefined
        }
      });
      sendHtml(response, injectConsoleToken(renderConsoleHtml({ route: `${route.path}${url.search}`, data }), csrfToken));
    } catch (error) {
      sendError(response, error);
    }
  });
}

export async function listenConsole(options: ConsoleServerOptions): Promise<RunningConsoleServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4318;
  const csrfToken = options.csrfToken ?? createConsoleToken();
  const server = createConsoleHttpServer({ ...options, host, csrfToken });
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
    csrfToken,
    warnings: consoleBindWarnings(host),
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

async function handleProjectSettings(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly workspaceRoot: string;
  readonly runner?: ConsoleCliRunner;
  readonly csrfToken: string;
  readonly host: string;
  readonly afterMutation?: () => void;
}): Promise<void> {
  if (input.request.method !== "POST") {
    input.response.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
    input.response.end(JSON.stringify({ ok: false, error: { code: "CONSOLE_METHOD_NOT_ALLOWED", message: "Project settings require POST" } }, null, 2));
    return;
  }
  const params = new URLSearchParams(await readBody(input.request));
  validateMutatingConsoleRequest(input.request, params, input.csrfToken, input.host);
  const returnTo = safeReturnTo(params.get("returnTo"));
  const finish = async (payload: unknown): Promise<void> => {
    if (returnTo) {
      input.response.writeHead(303, { location: returnTo });
      input.response.end();
      return;
    }
    await sendJson(input.response, payload);
  };
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
    input.afterMutation?.();
    await finish({ ok: true, action, validation, result });
    return;
  }
  if (action === "import-setup") {
    const result = await runner.run(["--workspace", projectRoot, "registry", "import-setup", "--json"]);
    input.afterMutation?.();
    await finish({ ok: true, action, validation, result });
    return;
  }
  if (action === "apply-setup") {
    const memoryRoot = absoluteParam(params, "memoryRoot");
    const memoryLayout = enumParam(params, "memoryLayout", ["in-repo", "child", "sibling"] as const);
    const memoryGitMode = enumParam(params, "memoryGitMode", ["shared", "separate", "submodule"] as const);
    validateMemoryRootBounds(projectRoot, memoryRoot, memoryLayout);
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
    input.afterMutation?.();
    await finish({ ok: true, action, validation, setup, registry });
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

function validateMemoryRootBounds(projectRoot: string, memoryRoot: string, memoryLayout: "in-repo" | "child" | "sibling"): void {
  const project = resolve(projectRoot);
  const memory = resolve(memoryRoot);
  if (memoryLayout === "sibling") {
    if (dirname(memory) !== dirname(project)) {
      throw new ConsoleCommandError("CONSOLE_SETTINGS_INVALID_PATH", "Sibling memory roots must share the project root parent", {
        projectRoot: project,
        memoryRoot: memory
      });
    }
    return;
  }
  if (memory === project || !memory.startsWith(`${project}/`)) {
    throw new ConsoleCommandError("CONSOLE_SETTINGS_INVALID_PATH", "Memory root must be inside the project root for in-repo and child layouts", {
      projectRoot: project,
      memoryRoot: memory
    });
  }
  if (memoryLayout === "child" && dirname(memory) !== project) {
    throw new ConsoleCommandError("CONSOLE_SETTINGS_INVALID_PATH", "Child memory root must be a direct child of the project root", {
      projectRoot: project,
      memoryRoot: memory
    });
  }
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
  readonly scope?: ConsoleScope;
  readonly runner?: ConsoleCliRunner;
  readonly selection?: ConsoleSelection;
  readonly allowFixtureFallback?: boolean;
}): Promise<ConsoleDataSet> {
  if (input.mode === "fixture") {
    return createFixtureConsoleData({ workspaceRoot: input.workspaceRoot, scope: input.scope });
  }
  try {
    return await loadLiveConsoleData(input);
  } catch (error) {
    if (!input.allowFixtureFallback) {
      throw new ConsoleCommandError("CONSOLE_LIVE_DATA_UNAVAILABLE", "Live console data failed; use fixture mode explicitly to inspect static sample data", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return createFixtureConsoleData({
      workspaceRoot: input.workspaceRoot,
      scope: input.scope,
      warnings: [error instanceof Error ? error.message : String(error)]
    });
  }
}

function createConsoleDataCache(ttlMs: number): {
  load(input: {
    readonly workspaceRoot: string;
    readonly mode: ConsoleDataMode;
    readonly scope?: ConsoleScope;
    readonly runner?: ConsoleCliRunner;
    readonly selection?: ConsoleSelection;
    readonly allowFixtureFallback?: boolean;
  }): Promise<ConsoleDataSet>;
  invalidate(): void;
} {
  let cached: { readonly key: string; readonly expiresAt: number; readonly value: Promise<ConsoleDataSet> } | undefined;
  return {
    load(input) {
      if (input.mode === "fixture" || ttlMs <= 0) {
        return loadConsoleData(input);
      }
      const selectionKey = `${input.selection?.wikiPage ?? ""}|${input.selection?.rawSource ?? ""}`;
      const key = `${input.mode}:${input.scope ?? "repo"}:${resolve(input.workspaceRoot)}:${input.runner ? "custom" : "default"}:${selectionKey}`;
      const now = Date.now();
      if (!cached || cached.key !== key || cached.expiresAt <= now) {
        cached = {
          key,
          expiresAt: now + ttlMs,
          value: loadConsoleData(input)
        };
      }
      return cached.value;
    },
    invalidate() {
      cached = undefined;
    }
  };
}

async function handleCommand(input: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly workspaceRoot: string;
  readonly runner?: ConsoleCliRunner;
  readonly csrfToken: string;
  readonly host: string;
  readonly afterMutation?: () => void;
}): Promise<void> {
  if (input.request.method !== "POST") {
    input.response.writeHead(405, { "content-type": "application/json; charset=utf-8", allow: "POST" });
    input.response.end(JSON.stringify({ ok: false, error: { code: "CONSOLE_METHOD_NOT_ALLOWED", message: "Console commands require POST" } }, null, 2));
    return;
  }
  const id = requestUrl(input.request).pathname.replace("/api/commands/", "");
  const body = await readBody(input.request);
  const params = new URLSearchParams(body);
  validateMutatingConsoleRequest(input.request, params, input.csrfToken, input.host);
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
  input.afterMutation?.();
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
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_CONSOLE_BODY_BYTES) {
      throw new ConsoleCommandError("CONSOLE_BODY_TOO_LARGE", "Console POST body exceeds the configured limit", {
        maxBytes: MAX_CONSOLE_BODY_BYTES
      });
    }
    chunks.push(buffer);
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
  response.writeHead(errorStatus(error), { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify({ ok: false, error: errorPayload(error) }, null, 2)}\n`);
}

function errorStatus(error: unknown): number {
  if (error instanceof ConsoleCommandError && error.code === "CONSOLE_BODY_TOO_LARGE") {
    return 413;
  }
  return error instanceof ConsoleCommandError && error.code.startsWith("CONSOLE_SECURITY_") ? 403 : 500;
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

function createConsoleToken(): string {
  return randomBytes(32).toString("base64url");
}

function validateMutatingConsoleRequest(
  request: IncomingMessage,
  params: URLSearchParams,
  csrfToken: string,
  configuredHost: string
): void {
  const token = params.get("consoleToken") ?? headerValue(request, "x-boreal-console-token");
  if (token !== csrfToken) {
    throw new ConsoleCommandError("CONSOLE_SECURITY_TOKEN_INVALID", "Console POST token is missing or invalid");
  }
  validateConsoleOrigin(request, configuredHost);
}

function validateConsoleOrigin(request: IncomingMessage, configuredHost: string): void {
  const host = headerValue(request, "host");
  if (!host) {
    throw new ConsoleCommandError("CONSOLE_SECURITY_HOST_REJECTED", "Console POST requests require a Host header");
  }
  const hostName = hostnameFromHeader(host);
  if (!hostName || !isAllowedConsoleHost(hostName, configuredHost)) {
    throw new ConsoleCommandError("CONSOLE_SECURITY_HOST_REJECTED", "Console POST Host is not allowed", { host });
  }
  const origin = headerValue(request, "origin");
  if (!origin) {
    return;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new ConsoleCommandError("CONSOLE_SECURITY_ORIGIN_REJECTED", "Console POST Origin is invalid", { origin });
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    throw new ConsoleCommandError("CONSOLE_SECURITY_ORIGIN_REJECTED", "Console POST Origin protocol is not allowed", { origin });
  }
  const expectedHost = normalizeHostHeader(host);
  const originHost = normalizeHostHeader(originUrl.host);
  if (originHost !== expectedHost) {
    throw new ConsoleCommandError("CONSOLE_SECURITY_ORIGIN_REJECTED", "Console POST Origin must match Host", {
      origin,
      host
    });
  }
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function hostnameFromHeader(host: string): string | undefined {
  try {
    return normalizeHostname(new URL(`http://${host}`).hostname);
  } catch {
    return undefined;
  }
}

function normalizeHostHeader(host: string): string {
  try {
    const parsed = new URL(`http://${host}`);
    const hostname = normalizeHostname(parsed.hostname);
    return parsed.port ? `${hostname}:${parsed.port}` : hostname;
  } catch {
    return host.toLocaleLowerCase("en-US");
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, "").toLocaleLowerCase("en-US");
}

function isAllowedConsoleHost(hostname: string, configuredHost: string): boolean {
  const configured = normalizeHostname(configuredHost);
  return isLocalConsoleHost(hostname) || (isSpecificBindHost(configured) && hostname === configured);
}

function isLocalConsoleHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function isSpecificBindHost(hostname: string): boolean {
  return hostname !== "0.0.0.0" && hostname !== "::" && hostname !== "";
}

function consoleBindWarnings(host: string): readonly string[] {
  const normalized = normalizeHostname(host);
  if (isLocalConsoleHost(normalized)) {
    return [];
  }
  return [
    `Console is bound to ${host}; mutating POST requests still require the per-server token and same Host/Origin validation.`
  ];
}

function injectConsoleToken(html: string, csrfToken: string): string {
  const field = `<input type="hidden" name="consoleToken" value="${htmlAttribute(csrfToken)}" />`;
  return html.replace(/(<form\b(?=[^>]*\bmethod="post")[^>]*>)/giu, `$1${field}`);
}

function htmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
    mode: valueAfter(argv, "--mode") === "fixture" ? "fixture" : "live",
    scope: valueAfter(argv, "--scope") === "global" ? "global" : "repo",
    liveCacheTtlMs: numberAfter(argv, "--live-cache-ttl-ms"),
    allowFixtureFallback: argv.includes("--allow-fixture-fallback")
  };
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberAfter(argv: readonly string[], flag: string): number | undefined {
  const value = valueAfter(argv, flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const running = await listenConsole(parseServerArgs(process.argv.slice(2)));
  process.stdout.write(`Boreal console running at ${running.url}\n`);
}
