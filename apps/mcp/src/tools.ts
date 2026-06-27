import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  BorealError,
  bindMcpProjectBoundary,
  defineMcpToolContract,
  isBorealError,
  normalizeActorId,
  safeParseJson,
  type McpProjectBoundary,
  type McpProjectRegistryEntry,
  type McpToolEffect,
  type ProjectRegistryMemoryLayout
} from "@boreal/core";

export const BOREAL_MCP_SERVER_NAME = "boreal-work-mcp";
export const BOREAL_MCP_TOOL_VERSION = "boreal.mcp-tools.v1";
export const BOREAL_MCP_CONFIG_SCHEMA_VERSION = "boreal.mcp-config.v1";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_PAYLOAD_CHARS = 64_000;

export type BorealMcpToolName =
  | "boreal_command_catalog"
  | "boreal_workspace_status"
  | "boreal_work_next"
  | "boreal_work_show"
  | "boreal_work_context"
  | "boreal_search"
  | "boreal_workflows_list"
  | "boreal_work_claim"
  | "boreal_work_reserve"
  | "boreal_work_release"
  | "boreal_work_renew"
  | "boreal_agent_finish"
  | "boreal_sync_refresh";

export interface BorealCliRunner {
  run(args: readonly string[], options: { readonly workspaceRoot: string }): Promise<unknown>;
}

export interface BorealMcpServerOptions {
  readonly workspaceRoot?: string;
  readonly runner?: BorealCliRunner;
  readonly sessionIdFactory?: () => string;
}

export interface BorealMcpToolDescriptor {
  readonly name: BorealMcpToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
}

export interface BorealMcpContent {
  readonly type: "text";
  readonly text: string;
}

export interface BorealMcpToolResult {
  readonly content: readonly BorealMcpContent[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

interface JsonSchemaObject {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties: boolean;
}

interface ReadToolSpec {
  readonly name: BorealMcpToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly kind: "read";
  run(input: ToolInput, context: ToolContext): Promise<unknown>;
}

interface MutatingToolSpec {
  readonly name: BorealMcpToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly kind: "mutating";
  readonly effects: readonly McpToolEffect[];
  command(input: ToolInput, boundary: McpProjectBoundary): readonly string[];
}

type ToolSpec = ReadToolSpec | MutatingToolSpec;
type ToolInput = Readonly<Record<string, unknown>>;

interface ToolContext {
  readonly boundary: McpProjectBoundary;
  readonly runner: BorealCliRunner;
}

interface ProjectSetupLike {
  readonly projectRoot?: string;
  readonly memoryRoot?: string;
  readonly memoryLayout?: ProjectRegistryMemoryLayout;
}

interface OperationListRow {
  readonly id: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly status: string;
  readonly exitCode: number;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly eventCount: number;
}

const COMMON_PROPERTIES = {
  workspaceRoot: { type: "string", description: "Explicit Boreal project root. Required unless the MCP server was launched with --workspace." },
  projectRoot: { type: "string", description: "Selected project root. Defaults to workspaceRoot." },
  memoryRoot: { type: "string", description: "Selected memory root. Defaults to .boreal/project.json or <project>/memory." },
  memoryLayout: { type: "string", enum: ["in-repo", "child", "sibling"] },
  selectedProjectId: { type: "string" }
} as const;

const CONFIRM_PROPERTY = {
  confirmed: { type: "boolean", description: "Must be true before a mutating tool executes." }
} as const;

const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: "boreal_command_catalog",
    title: "Boreal command catalog",
    description: "List the registered bwrk command surface without reading project runtime state.",
    kind: "read",
    inputSchema: schema(COMMON_PROPERTIES),
    async run(_input, context) {
      return scopedRead(context, ["commands", "--json"]);
    }
  },
  {
    name: "boreal_workspace_status",
    title: "Boreal workspace status",
    description: "Return selected-project doctor and sync status through bounded CLI JSON contracts.",
    kind: "read",
    inputSchema: schema(COMMON_PROPERTIES),
    async run(_input, context) {
      const [sync, doctor] = await Promise.all([
        scopedRead(context, ["sync", "status", "--json"]),
        scopedRead(context, ["doctor", "--json"])
      ]);
      return {
        workspaceRoot: context.boundary.workspaceRoot,
        projectRoot: context.boundary.projectRoot,
        memoryRoot: context.boundary.memoryRoot,
        sync,
        doctor
      };
    }
  },
  {
    name: "boreal_work_next",
    title: "Boreal next work",
    description: "List ready work for the selected project.",
    kind: "read",
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      label: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT }
    }),
    async run(input, context) {
      return scopedRead(context, [
        "work",
        "next",
        ...optionalRepeatedFlag("label", stringArrayInput(input, "labels", optionalString(input, "label"))),
        "--limit",
        String(limitInput(input, DEFAULT_LIST_LIMIT)),
        "--json"
      ]);
    }
  },
  {
    name: "boreal_work_show",
    title: "Boreal work detail",
    description: "Show one selected-project work item view.",
    kind: "read",
    inputSchema: schema({ ...COMMON_PROPERTIES, workId: { type: "string" } }, ["workId"]),
    async run(input, context) {
      return scopedRead(context, ["work", "show", requiredString(input, "workId"), "--json"]);
    }
  },
  {
    name: "boreal_work_context",
    title: "Boreal work context",
    description: "Show one selected-project context pack.",
    kind: "read",
    inputSchema: schema({ ...COMMON_PROPERTIES, workId: { type: "string" } }, ["workId"]),
    async run(input, context) {
      return scopedRead(context, ["context", "show", requiredString(input, "workId"), "--json"]);
    }
  },
  {
    name: "boreal_search",
    title: "Boreal search",
    description: "Search the selected project's fresh generated index.",
    kind: "read",
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      query: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT }
    }, ["query"]),
    async run(input, context) {
      return scopedRead(context, [
        "search",
        "query",
        requiredString(input, "query"),
        "--limit",
        String(limitInput(input, 10)),
        "--json"
      ]);
    }
  },
  {
    name: "boreal_workflows_list",
    title: "Boreal workflows",
    description: "List checked-in Boreal workflow playbooks.",
    kind: "read",
    inputSchema: schema(COMMON_PROPERTIES),
    async run(_input, context) {
      return scopedRead(context, ["workflows", "list", "--json"]);
    }
  },
  {
    name: "boreal_work_claim",
    title: "Claim Boreal work",
    description: "Claim next ready work through bwrk work claim with lock and audit semantics.",
    kind: "mutating",
    effects: ["state"],
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      ...CONFIRM_PROPERTY,
      agentId: { type: "string" },
      label: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      purpose: { type: "string" },
      ttl: { type: "string" },
      expiresAt: { type: "string" }
    }, ["confirmed", "agentId"]),
    command(input) {
      const labels = stringArrayInput(input, "labels", optionalString(input, "label"));
      return [
        "work",
        "claim",
        "--agent",
        requiredString(input, "agentId"),
        ...optionalRepeatedFlag("label", labels),
        ...optionalFlag(input, "purpose"),
        ...reservationExpiryArgs(input),
        "--json"
      ];
    }
  },
  {
    name: "boreal_work_reserve",
    title: "Reserve Boreal work",
    description: "Reserve a specific work item through bwrk work reserve.",
    kind: "mutating",
    effects: ["state"],
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      ...CONFIRM_PROPERTY,
      workId: { type: "string" },
      agentId: { type: "string" },
      purpose: { type: "string" },
      ttl: { type: "string" },
      expiresAt: { type: "string" }
    }, ["confirmed", "workId", "agentId"]),
    command(input) {
      return [
        "work",
        "reserve",
        requiredString(input, "workId"),
        "--agent",
        requiredString(input, "agentId"),
        ...optionalFlag(input, "purpose"),
        ...reservationExpiryArgs(input),
        "--json"
      ];
    }
  },
  {
    name: "boreal_work_release",
    title: "Release Boreal work",
    description: "Release a work reservation through bwrk work release.",
    kind: "mutating",
    effects: ["state"],
    inputSchema: schema({ ...COMMON_PROPERTIES, ...CONFIRM_PROPERTY, workId: { type: "string" } }, ["confirmed", "workId"]),
    command(input) {
      return ["work", "release", requiredString(input, "workId"), "--json"];
    }
  },
  {
    name: "boreal_work_renew",
    title: "Renew Boreal work",
    description: "Renew a work reservation through bwrk work renew.",
    kind: "mutating",
    effects: ["state"],
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      ...CONFIRM_PROPERTY,
      workId: { type: "string" },
      ttl: { type: "string" },
      expiresAt: { type: "string" }
    }, ["confirmed", "workId"]),
    command(input) {
      return ["work", "renew", requiredString(input, "workId"), ...reservationExpiryArgs(input, true), "--json"];
    }
  },
  {
    name: "boreal_agent_finish",
    title: "Finish Boreal work",
    description: "Finish reserved work through bwrk agent finish, preserving evidence and verification policy.",
    kind: "mutating",
    effects: ["state"],
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      ...CONFIRM_PROPERTY,
      workId: { type: "string" },
      agentId: { type: "string" },
      summary: { type: "string" },
      close: { type: "boolean" },
      release: { type: "boolean" },
      reason: { type: "string" },
      kind: { type: "string" },
      outcome: { type: "string" },
      command: { type: "string" },
      uri: { type: "string" },
      verdict: { type: "string" },
      notes: { type: "string" }
    }, ["confirmed", "workId", "summary"]),
    command(input) {
      return [
        "agent",
        "finish",
        requiredString(input, "workId"),
        "--summary",
        requiredString(input, "summary"),
        ...optionalFlag(input, "agent", optionalString(input, "agentId")),
        ...optionalFlag(input, "kind"),
        ...optionalFlag(input, "outcome"),
        ...optionalFlag(input, "command"),
        ...optionalFlag(input, "uri"),
        ...optionalFlag(input, "verdict"),
        ...optionalFlag(input, "notes"),
        ...finishActionArgs(input),
        "--json"
      ];
    }
  },
  {
    name: "boreal_sync_refresh",
    title: "Refresh Boreal generated state",
    description: "Run bwrk sync refresh through the generated-artifact command boundary.",
    kind: "mutating",
    effects: ["generated"],
    inputSchema: schema({ ...COMMON_PROPERTIES, ...CONFIRM_PROPERTY }, ["confirmed"]),
    command() {
      return ["sync", "refresh", "--json"];
    }
  }
];

export function listBorealMcpTools(): readonly BorealMcpToolDescriptor[] {
  return TOOL_SPECS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
}

export async function callBorealMcpTool(
  name: string,
  args: Readonly<Record<string, unknown>>,
  options: BorealMcpServerOptions = {}
): Promise<BorealMcpToolResult> {
  const spec = TOOL_SPECS.find((tool) => tool.name === name);
  if (!spec) {
    throw new BorealError("BOREAL_NOT_FOUND", "Unknown Boreal MCP tool", { name });
  }
  try {
    const boundary = await boundaryFromInput(args, options);
    const runner = options.runner ?? createNodeBorealCliRunner({ workspaceRoot: boundary.workspaceRoot });
    const context = { boundary, runner };
    if (spec.kind === "read") {
      const contract = defineMcpToolContract(boundary, { id: spec.name, title: spec.title, effects: ["read"] });
      const result = await spec.run(args, context);
      return toolResult({
        schemaVersion: BOREAL_MCP_TOOL_VERSION,
        tool: spec.name,
        workspaceRoot: boundary.workspaceRoot,
        projectRoot: boundary.projectRoot,
        memoryRoot: boundary.memoryRoot,
        contract,
        result
      });
    }
    return await executeMutatingTool(spec, args, context, options);
  } catch (error) {
    return toolError(error);
  }
}

export function createNodeBorealCliRunner(input: { readonly workspaceRoot: string; readonly cliPath?: string }): BorealCliRunner {
  const workspaceRoot = resolve(input.workspaceRoot);
  return {
    async run(args) {
      const invocation = cliInvocation(workspaceRoot, input.cliPath);
      const output = await runCommand({
        cwd: workspaceRoot,
        command: invocation.command,
        args: [...invocation.args, ...args]
      });
      return parseCliData(output);
    }
  };
}

export function mcpConfigPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".boreal", "mcp.json");
}

async function executeMutatingTool(
  spec: MutatingToolSpec,
  input: ToolInput,
  context: ToolContext,
  options: BorealMcpServerOptions
): Promise<BorealMcpToolResult> {
  if (input.confirmed !== true) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Mutating Boreal MCP tools require confirmed=true", {
      tool: spec.name
    });
  }

  const sessionId = normalizeActorId(options.sessionIdFactory?.() ?? `mcp-${randomUUID()}`);
  const commandArgs = spec.command(input, context.boundary);
  const commandPreview = ["bwrk", "--workspace", context.boundary.workspaceRoot, "--session", sessionId, ...commandArgs];
  const contract = defineMcpToolContract(context.boundary, {
    id: spec.name,
    title: spec.title,
    effects: spec.effects,
    requiresConfirmation: true,
    returnsOperationId: true,
    commandPreview
  });
  const result = await context.runner.run(commandPreview.slice(1), { workspaceRoot: context.boundary.workspaceRoot });
  const operation = await loadMutationOperation(context.runner, context.boundary.workspaceRoot, sessionId);

  return toolResult({
    schemaVersion: BOREAL_MCP_TOOL_VERSION,
    tool: spec.name,
    workspaceRoot: context.boundary.workspaceRoot,
    projectRoot: context.boundary.projectRoot,
    memoryRoot: context.boundary.memoryRoot,
    contract,
    commandPreview,
    operationId: operation.id,
    operation,
    result
  });
}

async function loadMutationOperation(
  runner: BorealCliRunner,
  workspaceRoot: string,
  sessionId: string
): Promise<OperationListRow> {
  const rows = await runner.run(
    ["--workspace", workspaceRoot, "operation", "list", "--session-id", sessionId, "--limit", "1", "--json"],
    { workspaceRoot }
  );
  if (!Array.isArray(rows) || rows.length === 0 || !isRecord(rows[0]) || typeof rows[0].id !== "string") {
    throw new BorealError("BOREAL_INVARIANT", "Confirmed MCP mutation did not produce a queryable operation record", {
      workspaceRoot,
      sessionId,
      rows
    });
  }
  return rows[0] as unknown as OperationListRow;
}

async function scopedRead(context: ToolContext, args: readonly string[]): Promise<unknown> {
  return context.runner.run(["--workspace", context.boundary.workspaceRoot, ...args], {
    workspaceRoot: context.boundary.workspaceRoot
  });
}

async function boundaryFromInput(
  input: ToolInput,
  options: BorealMcpServerOptions
): Promise<McpProjectBoundary> {
  const workspaceRootValue = optionalString(input, "workspaceRoot") ?? options.workspaceRoot;
  if (!workspaceRootValue) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Boreal MCP tools require workspaceRoot or a server --workspace");
  }
  const workspaceRoot = resolve(workspaceRootValue);
  const setup = await readProjectSetup(workspaceRoot);
  const projectRoot = resolve(optionalString(input, "projectRoot") ?? setup.projectRoot ?? workspaceRoot);
  const memoryRoot = resolve(optionalString(input, "memoryRoot") ?? setup.memoryRoot ?? join(projectRoot, "memory"));
  return bindMcpProjectBoundary({
    workspaceRoot,
    projectRoot,
    memoryRoot,
    memoryLayout: memoryLayoutInput(input, setup.memoryLayout),
    selectedProjectId: optionalString(input, "selectedProjectId"),
    registryEntries: registryEntriesInput(input)
  });
}

async function readProjectSetup(workspaceRoot: string): Promise<ProjectSetupLike> {
  const path = join(workspaceRoot, ".boreal", "project.json");
  if (!existsSync(path)) {
    return {};
  }
  const parsed = safeParseJson(await readFile(path, "utf8"), {
    path,
    schemaName: "boreal.project-setup.v1",
    expectedObject: true
  });
  if (!isRecord(parsed)) {
    return {};
  }
  return {
    projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : undefined,
    memoryRoot: typeof parsed.memoryRoot === "string" ? parsed.memoryRoot : undefined,
    memoryLayout: memoryLayoutValue(parsed.memoryLayout)
  };
}

function cliInvocation(workspaceRoot: string, cliPath?: string): { readonly command: string; readonly args: readonly string[] } {
  const distCliPath = cliPath ?? join(workspaceRoot, "apps", "cli", "dist", "index.js");
  if (existsSync(distCliPath)) {
    return { command: process.execPath, args: [distCliPath] };
  }
  const tsxCliPath = join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs");
  return {
    command: process.execPath,
    args: [
      tsxCliPath,
      "--tsconfig",
      join(workspaceRoot, "tsconfig.base.json"),
      join(workspaceRoot, "apps", "cli", "src", "index.ts")
    ]
  };
}

async function runCommand(input: {
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.command, input.args, { cwd: input.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      const payload = firstJsonPayload(out, err);
      if (payload) {
        resolvePromise(payload);
        return;
      }
      if (code === 0) {
        resolvePromise(out);
        return;
      }
      reject(new BorealError("BOREAL_STORAGE_ERROR", err.trim() || out.trim() || `bwrk exited with ${code ?? "unknown"}`));
    });
  });
}

function parseCliData(output: string): unknown {
  const parsed = safeParseJson(output, { schemaName: "boreal.cli.envelope.v1", expectedObject: true });
  if (!isRecord(parsed)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal CLI response was not an object");
  }
  if (parsed.ok === true) {
    return parsed.data;
  }
  throw new BorealError(cliErrorCode(parsed.code), typeof parsed.message === "string" ? parsed.message : "Boreal CLI command failed", {
    details: parsed.details
  });
}

function firstJsonPayload(...candidates: readonly string[]): string | undefined {
  return candidates.map((candidate) => candidate.trim()).find((candidate) => candidate.startsWith("{"));
}

function toolResult(payload: unknown): BorealMcpToolResult {
  const bounded = boundedPayload(payload);
  return {
    content: [{ type: "text", text: `${JSON.stringify(bounded, null, 2)}\n` }],
    structuredContent: bounded
  };
}

function toolError(error: unknown): BorealMcpToolResult {
  const payload = isBorealError(error)
    ? { ok: false, code: error.code, message: error.message, details: error.details }
    : { ok: false, code: "BOREAL_INVARIANT", message: error instanceof Error ? error.message : String(error) };
  return {
    isError: true,
    content: [{ type: "text", text: `${JSON.stringify(payload, null, 2)}\n` }],
    structuredContent: payload
  };
}

function boundedPayload(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text.length <= MAX_PAYLOAD_CHARS) {
    return value;
  }
  return {
    schemaVersion: BOREAL_MCP_TOOL_VERSION,
    truncated: true,
    fullSizeChars: text.length,
    maxSizeChars: MAX_PAYLOAD_CHARS,
    preview: previewJsonValue(value, 0)
  };
}

function previewJsonValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      items: value.slice(0, 5).map((entry) => previewJsonValue(entry, depth + 1))
    };
  }
  const entries = Object.entries(value);
  if (depth >= 2) {
    return {
      kind: "object",
      keyCount: entries.length,
      keys: entries.slice(0, 20).map(([key]) => key)
    };
  }
  return Object.fromEntries(entries.slice(0, 20).map(([key, entry]) => [key, previewJsonValue(entry, depth + 1)]));
}

function schema(properties: Readonly<Record<string, unknown>>, required: readonly string[] = []): JsonSchemaObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function requiredString(input: ToolInput, name: string): string {
  const value = optionalString(input, name);
  if (!value) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Missing required MCP argument: ${name}`, { name });
  }
  return value;
}

function optionalString(input: ToolInput, name: string): string | undefined {
  const value = input[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringArrayInput(input: ToolInput, name: string, fallback?: string): readonly string[] {
  const value = input[name];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return fallback ? [fallback] : [];
}

function limitInput(input: ToolInput, fallback: number): number {
  const value = input.limit;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(parsed)));
}

function optionalFlag(input: ToolInput, name: string, value = optionalString(input, name)): readonly string[] {
  return value ? [`--${name}`, value] : [];
}

function optionalRepeatedFlag(name: string, values: readonly string[]): readonly string[] {
  return values.flatMap((value) => [`--${name}`, value]);
}

function reservationExpiryArgs(input: ToolInput, required = false): readonly string[] {
  const ttl = optionalString(input, "ttl");
  const expiresAt = optionalString(input, "expiresAt");
  if (ttl && expiresAt) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Use either ttl or expiresAt, not both");
  }
  if (ttl) {
    return ["--ttl", ttl];
  }
  if (expiresAt) {
    return ["--expires-at", expiresAt];
  }
  if (required) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Renew requires ttl or expiresAt");
  }
  return [];
}

function finishActionArgs(input: ToolInput): readonly string[] {
  const close = input.close === true;
  const release = input.release === true;
  if (close && release) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Use either close or release, not both");
  }
  if (close) {
    return ["--close", "--reason", requiredString(input, "reason")];
  }
  if (release) {
    return ["--release"];
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Agent finish requires close=true or release=true");
}

function memoryLayoutInput(input: ToolInput, fallback?: ProjectRegistryMemoryLayout): ProjectRegistryMemoryLayout | undefined {
  return memoryLayoutValue(input.memoryLayout) ?? fallback;
}

function memoryLayoutValue(value: unknown): ProjectRegistryMemoryLayout | undefined {
  return value === "in-repo" || value === "child" || value === "sibling" ? value : undefined;
}

function registryEntriesInput(input: ToolInput): readonly McpProjectRegistryEntry[] {
  const value = input.registryEntries;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): readonly McpProjectRegistryEntry[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = typeof entry.id === "string" ? entry.id : undefined;
    const projectRoot = typeof entry.projectRoot === "string" ? entry.projectRoot : undefined;
    const memoryRoot = typeof entry.memoryRoot === "string" ? entry.memoryRoot : undefined;
    const memoryLayout = memoryLayoutValue(entry.memoryLayout);
    return id && projectRoot && memoryRoot && memoryLayout
      ? [{ id, projectRoot, memoryRoot, memoryLayout }]
      : [];
  });
}

function cliErrorCode(value: unknown): ConstructorParameters<typeof BorealError>[0] {
  return value === "BOREAL_INVALID_INPUT" ||
    value === "BOREAL_NOT_FOUND" ||
    value === "BOREAL_CONFLICT" ||
    value === "BOREAL_POLICY_VIOLATION" ||
    value === "BOREAL_STORAGE_ERROR" ||
    value === "BOREAL_JSON_PARSE" ||
    value === "BOREAL_UNSAFE_UNICODE" ||
    value === "BOREAL_INVARIANT"
    ? value
    : "BOREAL_STORAGE_ERROR";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
