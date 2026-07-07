import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConsoleCommandError, createFixtureConsoleData, renderConsoleHtml } from "@boreal/console";

import { main } from "../../apps/cli/src/index.ts";
import type { CliOutput } from "../../apps/cli/src/output.ts";
import { DevToolsClient, launchChromium, resolvePlaywrightChromiumExecutable } from "../../apps/console/src/browser-smoke.ts";
import { runDaemonWatchOnce } from "../../apps/daemon/src/runtime.ts";
import { buildGlobalBoardView } from "../../packages/ui-model/src/dashboard-view.ts";

interface CommandRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly env?: Readonly<Record<string, string>>;
}

interface RegistryImportResult {
  readonly entry: {
    readonly id: string;
  };
}

interface WorkResult {
  readonly meta: {
    readonly id: string;
  };
  readonly title: string;
  readonly status: string;
}

interface EvidenceResult {
  readonly meta: {
    readonly id: string;
  };
}

interface RawAddResult {
  readonly record: {
    readonly id: string;
  };
}

interface RawTriageResult {
  readonly targetRecord?: {
    readonly meta: {
      readonly id: string;
    };
  };
}

interface EvaluateResult<T> {
  readonly result?: {
    readonly value?: T;
    readonly description?: string;
  };
  readonly exceptionDetails?: {
    readonly text?: string;
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("global board browser dogfood", () => {
  it("drives linked fixture projects through command-backed board drags with Chromium", async () => {
    const callerRoot = await makeTempDir("boreal-board-global-");
    const alphaRoot = await makeTempDir("boreal-board-alpha-");
    const betaRoot = await makeTempDir("boreal-board-beta-");
    const registryRoot = await makeTempDir("boreal-board-registry-");
    const env = { BOREAL_PROJECT_REGISTRY_ROOT: registryRoot };
    const transcript: string[] = [];

    await runJson(callerRoot, ["global", "init", "--registry-root", registryRoot, "--json"], { env });
    await runJson(registryRoot, ["init", "--setup-memory", "--json"], { env });
    await runJson(alphaRoot, ["init", "--setup-memory", "--json"], { env });
    await runJson(betaRoot, ["init", "--setup-memory", "--json"], { env });
    await runJson<RegistryImportResult>(registryRoot, [
      "registry",
      "import-setup",
      "--registry-root",
      registryRoot,
      "--name",
      "Global Fixture",
      "--json"
    ], { env });
    const alpha = await runJson<RegistryImportResult>(alphaRoot, [
      "registry",
      "import-setup",
      "--registry-root",
      registryRoot,
      "--name",
      "Alpha Fixture",
      "--json"
    ], { env });
    const beta = await runJson<RegistryImportResult>(betaRoot, [
      "registry",
      "import-setup",
      "--registry-root",
      registryRoot,
      "--name",
      "Beta Fixture",
      "--json"
    ], { env });

    const reserveCard = await runJson<WorkResult>(alphaRoot, [
      "work",
      "create",
      "Dogfood reserve card",
      "--kind",
      "task",
      "--ready",
      "--json"
    ], { env });
    const gatedCard = await runJson<WorkResult>(alphaRoot, [
      "work",
      "create",
      "Dogfood gated close",
      "--kind",
      "task",
      "--ready",
      "--required-gate",
      "verification",
      "--json"
    ], { env });
    const remoteBlocker = await runJson<WorkResult>(betaRoot, [
      "work",
      "create",
      "Remote portfolio blocker",
      "--kind",
      "task",
      "--ready",
      "--json"
    ], { env });
    const portfolio = await runJson<WorkResult>(callerRoot, [
      "work",
      "create",
      "Portfolio unblock row",
      "--kind",
      "milestone",
      "--ready",
      "--global",
      "--json"
    ], { env });
    await runJson(callerRoot, [
      "dep",
      "add",
      portfolio.meta.id,
      `boreal://${beta.entry.id}/${remoteBlocker.meta.id}`,
      "--global",
      "--json"
    ], { env });

    const raw = await runJson<RawAddResult>(callerRoot, [
      "capture",
      "Dogfood capture to route",
      "--json"
    ], { env });
    const routed = await runJson<RawTriageResult>(callerRoot, [
      "raw",
      "triage",
      "promote",
      raw.record.id,
      "--to",
      alpha.entry.id,
      "--as",
      "work",
      "--title",
      "Routed capture card",
      "--ready",
      "--global",
      "--json"
    ], { env });
    const routedWorkId = routed.targetRecord?.meta.id;
    expect(routedWorkId).toBeDefined();
    await runJson(alphaRoot, ["sync", "refresh", "--json"], { env });
    await runJson(betaRoot, ["sync", "refresh", "--json"], { env });

    const previousRegistryRoot = process.env.BOREAL_PROJECT_REGISTRY_ROOT;
    process.env.BOREAL_PROJECT_REGISTRY_ROOT = registryRoot;
    const running = await listenDogfoodConsole({
      workspaceRoot: registryRoot,
      env,
      projects: [
        {
          projectId: "global",
          projectName: "Global Fixture",
          projectRoot: registryRoot,
          workIds: [portfolio.meta.id]
        },
        {
          projectId: alpha.entry.id,
          projectName: "Alpha Fixture",
          projectRoot: alphaRoot,
          workIds: [reserveCard.meta.id, gatedCard.meta.id, routedWorkId as string]
        },
        {
          projectId: beta.entry.id,
          projectName: "Beta Fixture",
          projectRoot: betaRoot,
          workIds: [remoteBlocker.meta.id]
        }
      ]
    });
    const preflightHtml = await withTimeout(fetch(running.url).then((response) => response.text()), 20_000, "dogfood server preflight");
    expect(preflightHtml).toContain("Alpha Fixture");
    const browser = await launchChromium(resolvePlaywrightChromiumExecutable());
    const client = await DevToolsClient.connect(browser.wsUrl);
    const page = await openPage(client, running.url);

    try {
      transcript.push(`opened ${running.url} with ${resolvePlaywrightChromiumExecutable()}`);
      expect(await pageTextContains(page, "Alpha Fixture")).toBe(true);
      expect(await pageTextContains(page, "Beta Fixture")).toBe(true);
      expect(await pageTextContains(page, "Routed capture card")).toBe(true);
      expect(await cardColumn(page, "Portfolio unblock row")).toBe("blocked");
      transcript.push("verified lanes, routed capture card, and blocked portfolio row");

      await dragCard(page, "Dogfood reserve card", "in_progress", { expectReload: true });
      await waitForCardColumn(page, "Dogfood reserve card", "in_progress");
      expect((await runJson<WorkResult>(alphaRoot, ["work", "show", reserveCard.meta.id, "--json"], { env })).status).toBe("in_progress");
      transcript.push("reserve drag moved card only after command-backed reload");

      await dragCard(page, "Dogfood gated close", "closed", { expectReload: false });
      await waitForRefusal(page, "gate.verification.unsatisfied");
      expect(await pageTextContains(page, "bwrk work show")).toBe(true);
      expect(await cardColumn(page, "Dogfood gated close")).toBe("ready");
      transcript.push("unsatisfied close drag snapped back and rendered gate refusal details");

      const gateEvidence = await runJson<EvidenceResult>(alphaRoot, [
        "evidence",
        "add",
        gatedCard.meta.id,
        "--kind",
        "test",
        "--outcome",
        "passed",
        "--summary",
        "dogfood gate passed",
        "--command",
        "dogfood gate",
        "--json"
      ], { env });
      await runJson(alphaRoot, [
        "work",
        "verify",
        gatedCard.meta.id,
        "--evidence",
        gateEvidence.meta.id,
        "--verdict",
        "passed",
        "--json"
      ], { env });

      const remoteEvidence = await runJson<EvidenceResult>(betaRoot, [
        "evidence",
        "add",
        remoteBlocker.meta.id,
        "--kind",
        "test",
        "--outcome",
        "passed",
        "--summary",
        "remote blocker done",
        "--command",
        "remote dogfood gate",
        "--json"
      ], { env });
      await runJson(betaRoot, [
        "work",
        "verify",
        remoteBlocker.meta.id,
        "--evidence",
        remoteEvidence.meta.id,
        "--verdict",
        "passed",
        "--json"
      ], { env });
      await runJson(betaRoot, [
        "work",
        "close",
        remoteBlocker.meta.id,
        "--reason",
        "remote blocker satisfied",
        "--dirty-path",
        "no_repo_changes: browser dogfood fixture",
        "--json"
      ], { env });
      await runJson(betaRoot, ["sync", "refresh", "--json"], { env });
      await runDaemonWatchOnce({ workspaceRoot: betaRoot, registryRoot });
      await runJson(alphaRoot, ["sync", "refresh", "--json"], { env });
      await reload(page);

      await waitForCardColumn(page, "Dogfood gated close", "verified");
      await dragCard(page, "Dogfood gated close", "closed", { expectReload: true });
      await waitForCardColumn(page, "Dogfood gated close", "closed");
      await waitForCardColumn(page, "Portfolio unblock row", "ready");
      transcript.push("verified card closed through board drag and cross-project portfolio row unblocked");

      await captureScreenshot(page, join(registryRoot, "dogfood-global-board.png"));
      await writeFile(join(registryRoot, "dogfood-transcript.txt"), `${transcript.join("\n")}\n`, "utf8");
    } finally {
      await page.close();
      await client.close();
      await browser.close();
      await running.close();
      if (previousRegistryRoot === undefined) {
        delete process.env.BOREAL_PROJECT_REGISTRY_ROOT;
      } else {
        process.env.BOREAL_PROJECT_REGISTRY_ROOT = previousRegistryRoot;
      }
    }
  }, 120_000);
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function cliData(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<unknown> {
  const result = await runCli(cwd, argv, options);
  const payloadText = firstJsonPayload(result.stdout, result.stderr);
  if (!payloadText) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `bwrk exited with ${result.exitCode}`);
  }
  const payload = JSON.parse(payloadText) as Record<string, unknown>;
  if (payload.ok !== true) {
    const details = {
      ...(isRecord(payload.details) ? payload.details : {}),
      ...(Array.isArray(payload.gaps) ? { gaps: payload.gaps } : {}),
      ...(Array.isArray(payload.agentDirectives) ? { agentDirectives: payload.agentDirectives } : {}),
      ...(Array.isArray(payload.recovery) ? { recovery: payload.recovery } : {})
    };
    throw new ConsoleCommandError(
      typeof payload.code === "string" ? payload.code : "BOREAL_COMMAND_FAILED",
      typeof payload.message === "string" ? payload.message : "Boreal CLI response was not ok",
      details
    );
  }
  return withAgentDirectives(payload.data, payload);
}

async function runJson<T>(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<T> {
  expect(argv).toContain("--json");
  return await cliData(cwd, argv, options) as T;
}

async function runCli(cwd: string, argv: readonly string[], options: RunOptions = {}): Promise<CommandRun> {
  let stdout = "";
  let stderr = "";
  const output: CliOutput = {
    write(text) {
      stdout += text;
    },
    error(text) {
      stderr += text;
    }
  };
  const previousEnv = new Map(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(options.env ?? {})) {
      process.env[key] = value;
    }
    const exitCode = await main([...argv], output, cwd);
    return { exitCode, stdout, stderr };
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withAgentDirectives(data: unknown, payload: Record<string, unknown>): unknown {
  return isRecord(data) && Array.isArray(payload.agentDirectives)
    ? { ...data, agentDirectives: payload.agentDirectives }
    : data;
}

function firstJsonPayload(...values: readonly string[]): string | undefined {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      return trimmed;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface DogfoodProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly workIds: readonly string[];
}

interface DogfoodConsole {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

async function listenDogfoodConsole(input: {
  readonly workspaceRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly projects: readonly DogfoodProject[];
}): Promise<DogfoodConsole> {
  const token = "dogfood-console-token";
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
      if (request.method === "POST" && url.pathname.startsWith("/api/commands/")) {
        const commandId = url.pathname.replace("/api/commands/", "");
        const params = new URLSearchParams(await readBody(request));
        if (params.get("consoleToken") !== token) {
          sendJson(response, 403, { ok: false, error: { code: "CONSOLE_SECURITY_TOKEN_INVALID", message: "invalid token" } });
          return;
        }
        try {
          const result = await runDogfoodBoardCommand(input.workspaceRoot, input.env, commandId, params);
          sendJson(response, 200, { ok: true, commandId, result });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: dogfoodErrorPayload(error, params.get("workId") ?? undefined) });
        }
        return;
      }
      const data = await loadDogfoodConsoleData(input);
      sendHtml(response, injectConsoleToken(renderConsoleHtml({ route: "/", data }), token));
    } catch (error) {
      sendJson(response, 500, { ok: false, error: dogfoodErrorPayload(error) });
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

async function loadDogfoodConsoleData(input: {
  readonly workspaceRoot: string;
  readonly env: Readonly<Record<string, string>>;
  readonly projects: readonly DogfoodProject[];
}) {
  const base = createFixtureConsoleData({ workspaceRoot: input.workspaceRoot, scope: "global" });
  const generatedAt = new Date().toISOString();
  const projects = await Promise.all(input.projects.map(async (project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
    projectRoot: project.projectRoot,
    lifecycle: "linked" as const,
    health: "ok" as const,
    stale: false,
    syncFreshness: "fresh" as const,
    generatedAt,
    work: await Promise.all(project.workIds.map((workId) =>
      runJson(project.projectRoot, ["work", "show", workId, "--json"], { env: input.env })
    ))
  })));
  return {
    ...base,
    workspace: {
      ...base.workspace,
      projectName: "Global Fixture",
      workspaceRoot: input.workspaceRoot,
      mode: "live" as const,
      scope: "global" as const,
      generatedAt
    },
    globalBoard: buildGlobalBoardView({ generatedAt, projects })
  };
}

async function runDogfoodBoardCommand(
  cwd: string,
  env: Readonly<Record<string, string>>,
  commandId: string,
  params: URLSearchParams
): Promise<unknown> {
  const projectRoot = requiredParam(params, "projectRoot");
  const workId = requiredParam(params, "workId");
  switch (commandId) {
    case "work.reserve":
      return runJson(cwd, [
        "--workspace",
        projectRoot,
        "work",
        "reserve",
        workId,
        "--agent",
        params.get("agentId") || "console",
        "--purpose",
        params.get("purpose") || "Console board drag",
        "--json"
      ], { env });
    case "work.release":
      return runJson(cwd, ["--workspace", projectRoot, "work", "release", workId, "--json"], { env });
    case "work.close":
      return runJson(cwd, [
        "--workspace",
        projectRoot,
        "work",
        "close",
        workId,
        "--reason",
        requiredParam(params, "reason"),
        ...(params.get("dirtyPath") ? ["--dirty-path", params.get("dirtyPath") as string] : []),
        "--json"
      ], { env });
    default:
      throw new ConsoleCommandError("CONSOLE_COMMAND_NOT_ALLOWED", "Unknown dogfood board command", { commandId });
  }
}

function requiredParam(params: URLSearchParams, key: string): string {
  const value = params.get(key)?.trim() ?? "";
  if (!value) {
    throw new ConsoleCommandError("CONSOLE_COMMAND_INVALID_INPUT", `Missing ${key}`, { key });
  }
  return value;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function dogfoodErrorPayload(error: unknown, workId?: string): Record<string, unknown> {
  if (error instanceof ConsoleCommandError) {
    const recoveryWorkId = typeof error.details.workId === "string" ? error.details.workId : workId;
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      recovery: [
        ...(recoveryWorkId ? [{ label: "Inspect work", command: `bwrk work show ${recoveryWorkId} --json` }] : []),
        { label: "Refresh projections", command: "bwrk sync refresh --json" }
      ]
    };
  }
  return {
    code: "CONSOLE_ERROR",
    message: error instanceof Error ? error.message : String(error),
    recovery: [{ label: "Refresh projections", command: "bwrk sync refresh --json" }]
  };
}

function injectConsoleToken(html: string, token: string): string {
  const field = `<input type="hidden" name="consoleToken" value="${htmlAttribute(token)}" />`;
  return html.replace(/(<form\b(?=[^>]*\bmethod="post")[^>]*>)/giu, `$1${field}`);
}

function htmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function openPage(client: DevToolsClient, url: string): Promise<BrowserPage> {
  const created = await client.send<{ targetId: string }>("Target.createTarget", { url });
  const attached = await client.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true
  });
  const page = new BrowserPage(client, created.targetId, attached.sessionId);
  await page.enable();
  await waitFor(async () => page.evaluate<boolean>("document.readyState === 'complete' && document.body.innerText.length > 0"), "initial document ready");
  return page;
}

class BrowserPage {
  constructor(
    readonly client: DevToolsClient,
    private readonly targetId: string,
    readonly sessionId: string
  ) {}

  async enable(): Promise<void> {
    await this.client.send("Page.enable", {}, this.sessionId);
    await this.client.send("Runtime.enable", {}, this.sessionId);
    await this.client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false
    }, this.sessionId);
    await this.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.prompt = () => 'Closed from browser dogfood';"
    }, this.sessionId);
  }

  async navigate(url: string): Promise<void> {
    await withTimeout(this.client.send("Page.navigate", { url }, this.sessionId), 20_000, `navigate ${url}`);
    await waitFor(async () => this.evaluate<boolean>("document.readyState === 'complete'"), `navigate ${url}`);
  }

  async reload(): Promise<void> {
    await this.evaluate("window.location.reload()");
    await delay(250);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const evaluated = await this.client.send<EvaluateResult<T>>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, this.sessionId);
    if (evaluated.exceptionDetails) {
      throw new Error(evaluated.exceptionDetails.text ?? "browser evaluation failed");
    }
    return evaluated.result?.value as T;
  }

  async close(): Promise<void> {
    await this.client.send("Target.closeTarget", { targetId: this.targetId }).catch(() => undefined);
  }
}

async function pageTextContains(page: BrowserPage, text: string): Promise<boolean> {
  return page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(text)})`);
}

async function cardColumn(page: BrowserPage, title: string): Promise<string | null> {
  return page.evaluate<string | null>(`(() => {
    const card = [...document.querySelectorAll("[data-bw-board-card]")]
      .find((node) => node.getAttribute("data-work-title") === ${JSON.stringify(title)});
    return card ? card.getAttribute("data-current-column") : null;
  })()`);
}

async function waitForCardColumn(page: BrowserPage, title: string, column: string): Promise<void> {
  await waitFor(async () => (await cardColumn(page, title)) === column, `card ${title} to enter ${column}`);
}

async function waitForRefusal(page: BrowserPage, text: string): Promise<void> {
  await waitFor(async () => pageTextContains(page, text), `refusal text ${text}`);
}

async function dragCard(
  page: BrowserPage,
  title: string,
  targetColumn: string,
  options: { readonly expectReload: boolean }
): Promise<void> {
  const result = await page.evaluate<{ readonly ok: boolean; readonly message?: string }>(`(() => {
    const card = [...document.querySelectorAll("[data-bw-board-card]")]
      .find((node) => node.getAttribute("data-work-title") === ${JSON.stringify(title)});
    const target = document.querySelector(${JSON.stringify(`[data-bw-drop-column="${targetColumn}"]`)});
    if (!card) {
      return { ok: false, message: "missing card" };
    }
    if (!target) {
      return { ok: false, message: "missing target" };
    }
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    return { ok: true };
  })()`);
  expect(result.ok, result.message).toBe(true);
  if (options.expectReload) {
    await delay(250);
  }
}

async function reload(page: BrowserPage): Promise<void> {
  await page.reload();
}

async function captureScreenshot(page: BrowserPage, path: string): Promise<void> {
  const screenshot = await page.client.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  }, page.sessionId);
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

async function waitFor(condition: () => Promise<boolean>, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    try {
      if (await condition()) {
        return;
      }
    } catch {
      // Navigations can briefly make the runtime unavailable while the next document commits.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out during ${label}`)), timeoutMs);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
