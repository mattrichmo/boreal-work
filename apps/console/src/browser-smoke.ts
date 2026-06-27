import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { listenConsole } from "./server.js";
import {
  consoleSmokeRoutes,
  consoleSmokeViewports,
  validateConsoleSmokeHtml,
  type ConsoleSmokeRouteResult
} from "./app/smoke-checks.js";
import type { ConsoleDataMode } from "./app/types.js";

interface BrowserSmokeRouteResult extends ConsoleSmokeRouteResult {
  readonly screenshot: string;
  readonly browserChecks: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly horizontalOverflowPx: number;
}

interface BrowserSmokeOptions {
  readonly workspaceRoot: string;
  readonly mode: ConsoleDataMode;
  readonly outFile?: string;
  readonly screenshotDir: string;
  readonly chromeExecutable: string;
}

interface BrowserSnapshot {
  readonly html: string;
  readonly routeMarker: string | null;
  readonly textLength: number;
  readonly viewportWidth: number;
  readonly pageScrollWidth: number;
}

interface BrowserRouteInput {
  readonly client: DevToolsClient;
  readonly routePath: string;
  readonly url: string;
  readonly viewport: typeof consoleSmokeViewports[number];
  readonly screenshotDir: string;
}

async function runBrowserSmokeCli(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  const running = await listenConsole({
    workspaceRoot: options.workspaceRoot,
    host: "127.0.0.1",
    port: 0,
    mode: options.mode
  });
  const chrome = await launchChrome(options.chromeExecutable);
  const client = await DevToolsClient.connect(chrome.wsUrl);

  try {
    await mkdir(options.screenshotDir, { recursive: true });
    const results: BrowserSmokeRouteResult[] = [];
    for (const viewport of consoleSmokeViewports) {
      for (const route of consoleSmokeRoutes) {
        const url = new URL(route, running.url).toString();
        const browserResult = await loadRouteInBrowser({
          client,
          routePath: route,
          url,
          viewport,
          screenshotDir: options.screenshotDir
        });
        results.push(browserResult);
      }
    }
    const output = {
      ok: true,
      url: running.url,
      mode: options.mode,
      chrome: {
        executable: options.chromeExecutable
      },
      screenshotDir: options.screenshotDir,
      routes: results
    };
    if (options.outFile) {
      await mkdir(dirname(options.outFile), { recursive: true });
      await writeFile(options.outFile, `${JSON.stringify(output, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await client.close();
    await chrome.close();
    await running.close();
  }
}

async function loadRouteInBrowser(input: BrowserRouteInput): Promise<BrowserSmokeRouteResult> {
  const created = await input.client.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const targetId = created.targetId;
  const attached = await input.client.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId,
    flatten: true
  });
  const sessionId = attached.sessionId;
  const consoleErrors: string[] = [];
  const onEvent = input.client.collectEvents(sessionId, (event) => {
    if (event.method === "Runtime.exceptionThrown") {
      consoleErrors.push(formatRuntimeException(event.params));
    }
    if (event.method === "Runtime.consoleAPICalled" && runtimeConsoleType(event.params) === "error") {
      consoleErrors.push(formatRuntimeConsole(event.params));
    }
    if (event.method === "Log.entryAdded" && logEntryLevel(event.params) === "error") {
      consoleErrors.push(formatLogEntry(event.params));
    }
  });

  try {
    await input.client.send("Page.enable", {}, sessionId);
    await input.client.send("Runtime.enable", {}, sessionId);
    await input.client.send("Log.enable", {}, sessionId);
    await input.client.send("Emulation.setDeviceMetricsOverride", {
      width: input.viewport.width,
      height: input.viewport.height,
      deviceScaleFactor: 1,
      mobile: input.viewport.name === "mobile"
    }, sessionId);

    const loaded = input.client.waitForEvent("Page.loadEventFired", sessionId, 10_000);
    await input.client.send("Page.navigate", { url: input.url }, sessionId);
    await loaded;
    await delay(50);

    const snapshot = await evaluateBrowserSnapshot(input.client, sessionId);
    const routeResult = validateConsoleSmokeHtml({
      routePath: input.routePath,
      viewport: input.viewport,
      status: 200,
      html: snapshot.html
    });
    const screenshotPath = join(input.screenshotDir, `${input.viewport.name}-${routeSlug(input.routePath)}.png`);
    const screenshot = await input.client.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    }, sessionId);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

    const horizontalOverflowPx = Math.max(0, snapshot.pageScrollWidth - snapshot.viewportWidth);
    assertBrowserCondition(snapshot.routeMarker === routeResult.routeId, `Route marker mismatch for ${input.routePath}`);
    assertBrowserCondition(snapshot.textLength > 100, `Browser rendered blank text for ${input.routePath}`);
    assertBrowserCondition(consoleErrors.length === 0, `Browser console errors for ${input.routePath}: ${consoleErrors.join("; ")}`);
    assertBrowserCondition(horizontalOverflowPx <= 2, `Horizontal overflow on ${input.routePath}: ${horizontalOverflowPx}px`);

    return {
      ...routeResult,
      screenshot: screenshotPath,
      browserChecks: [
        "route-marker",
        "nonblank-text",
        "no-console-errors",
        "no-horizontal-overflow",
        "screenshot"
      ],
      consoleErrors,
      horizontalOverflowPx
    };
  } finally {
    onEvent.dispose();
    await input.client.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }
}

function routeSlug(routePath: string): string {
  return routePath
    .replace(/^\//, "")
    .replace(/[/?#=&]+/g, "-")
    .replace(/^-|-$/g, "") || "global";
}

async function evaluateBrowserSnapshot(client: DevToolsClient, sessionId: string): Promise<BrowserSnapshot> {
  const expression = `(() => {
    const routeElement = document.querySelector("[data-console-route]");
    return {
      html: document.documentElement.outerHTML,
      routeMarker: routeElement ? routeElement.getAttribute("data-console-route") : null,
      textLength: (document.body && document.body.innerText ? document.body.innerText.trim().length : 0),
      viewportWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth
    };
  })()`;
  const evaluated = await client.send<{ result: { value?: BrowserSnapshot } }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  }, sessionId);
  if (!evaluated.result.value) {
    throw new Error("Browser snapshot evaluation returned no value");
  }
  return evaluated.result.value;
}

function assertBrowserCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runtimeConsoleType(params: unknown): string | undefined {
  return typeof params === "object" && params !== null && "type" in params
    ? String((params as { type?: unknown }).type)
    : undefined;
}

function logEntryLevel(params: unknown): string | undefined {
  const entry = typeof params === "object" && params !== null && "entry" in params
    ? (params as { entry?: { level?: unknown } }).entry
    : undefined;
  return entry?.level ? String(entry.level) : undefined;
}

function formatRuntimeException(params: unknown): string {
  const details = typeof params === "object" && params !== null && "exceptionDetails" in params
    ? (params as { exceptionDetails?: { text?: unknown } }).exceptionDetails
    : undefined;
  return details?.text ? String(details.text) : "runtime exception";
}

function formatRuntimeConsole(params: unknown): string {
  const args = typeof params === "object" && params !== null && "args" in params
    ? (params as { args?: readonly { value?: unknown; description?: unknown }[] }).args ?? []
    : [];
  return args.map((arg) => String(arg.value ?? arg.description ?? "")).filter(Boolean).join(" ") || "console error";
}

function formatLogEntry(params: unknown): string {
  const entry = typeof params === "object" && params !== null && "entry" in params
    ? (params as { entry?: { text?: unknown } }).entry
    : undefined;
  return entry?.text ? String(entry.text) : "log error";
}

interface ChromeLaunch {
  readonly wsUrl: string;
  close(): Promise<void>;
}

async function launchChrome(executable: string): Promise<ChromeLaunch> {
  const userDataDir = await mkdtemp(join(tmpdir(), "boreal-console-chrome-"));
  const chromeProcess = spawn(executable, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-default-browser-check",
    "--no-first-run",
    "about:blank"
  ]);
  const wsUrl = await waitForDevToolsUrl(chromeProcess).catch(async (error: unknown) => {
    chromeProcess.kill("SIGTERM");
    await rm(userDataDir, { recursive: true, force: true });
    throw error;
  });
  return {
    wsUrl,
    async close() {
      chromeProcess.kill("SIGTERM");
      await new Promise<void>((resolvePromise) => {
        chromeProcess.once("exit", () => resolvePromise());
        setTimeout(resolvePromise, 1000).unref();
      });
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
}

function waitForDevToolsUrl(chromeProcess: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Chrome did not expose DevTools in time: ${stderr.slice(-800)}`));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      chromeProcess.stderr.off("data", onData);
      chromeProcess.off("error", onError);
      chromeProcess.off("exit", onExit);
    };
    const onData = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match?.[1]) {
        cleanup();
        resolvePromise(match[1]);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Chrome exited before DevTools became available: ${code ?? "signal"}`));
    };
    chromeProcess.stderr.on("data", onData);
    chromeProcess.once("error", onError);
    chromeProcess.once("exit", onExit);
  });
}

interface DevToolsMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
  readonly sessionId?: string;
}

interface DevToolsPending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface DevToolsEventListener {
  readonly sessionId: string;
  readonly handler: (message: DevToolsMessage) => void;
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { readonly data?: unknown; readonly error?: unknown }) => void, options?: { readonly once?: boolean }): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

class DevToolsClient {
  private nextId = 1;
  private readonly pending = new Map<number, DevToolsPending>();
  private readonly listeners: DevToolsEventListener[] = [];

  private constructor(private readonly socket: WebSocketLike) {
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data ?? "{}")));
  }

  static async connect(wsUrl: string): Promise<DevToolsClient> {
    const WebSocketCtor = (globalThis as unknown as { readonly WebSocket?: WebSocketConstructor }).WebSocket;
    if (!WebSocketCtor) {
      throw new Error("Node runtime does not expose WebSocket");
    }
    const socket = new WebSocketCtor(wsUrl);
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener("open", () => resolvePromise(), { once: true });
      socket.addEventListener("error", (event) => reject(event.error instanceof Error ? event.error : new Error("WebSocket connection failed")), { once: true });
    });
    return new DevToolsClient(socket);
  }

  async close(): Promise<void> {
    this.socket.close();
  }

  collectEvents(sessionId: string, handler: (message: DevToolsMessage) => void): { dispose(): void } {
    const listener = { sessionId, handler };
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      }
    };
  }

  send<T>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise<T>((resolvePromise, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject
      });
      this.socket.send(JSON.stringify(message));
    });
  }

  waitForEvent(method: string, sessionId: string, timeoutMs: number): Promise<DevToolsMessage> {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        dispose();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const subscription = this.collectEvents(sessionId, (message) => {
        if (message.method === method) {
          dispose();
          resolvePromise(message);
        }
      });
      const dispose = () => {
        clearTimeout(timer);
        subscription.dispose();
      };
    });
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as DevToolsMessage;
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "DevTools command failed"));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }
    if (message.method) {
      for (const listener of [...this.listeners]) {
        if (listener.sessionId === message.sessionId) {
          listener.handler(message);
        }
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseArgs(argv: readonly string[]): BrowserSmokeOptions {
  const out = valueAfter(argv, "--out");
  const screenshotDir = valueAfter(argv, "--screenshots")
    ?? (out ? join(dirname(resolve(out)), "console-browser-smoke") : ".boreal/results/console-browser-smoke");
  return {
    workspaceRoot: resolve(valueAfter(argv, "--workspace") ?? "../.."),
    mode: valueAfter(argv, "--mode") === "live" ? "live" : "fixture",
    outFile: out ? resolve(out) : undefined,
    screenshotDir: resolve(screenshotDir),
    chromeExecutable: valueAfter(argv, "--chrome") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  };
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

await runBrowserSmokeCli(process.argv.slice(2));
