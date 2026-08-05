import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  type AgentDirectiveBundle,
  BorealError,
  bindMcpProjectBoundary,
  classifyBorealError,
  defineMcpToolContract,
  isBorealError,
  normalizeActorId,
  runBoundedProcess,
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
const MAX_DIAGNOSTIC_CHARS = 4_000;
const MAX_DIAGNOSTIC_DEPTH = 8;
const MAX_DIAGNOSTIC_ITEMS = 24;
const MAX_DIAGNOSTIC_STRING_LENGTH = 1_000;
const SENSITIVE_DIAGNOSTIC_KEY = /(authorization|api[-_]?key|cookie|credential|password|private[-_]?key|secret|token)/iu;

export type BorealMcpToolName =
  | "boreal_command_catalog"
  | "boreal_workspace_status"
  | "boreal_directives_current"
  | "boreal_directives_compile"
  | "boreal_directives_explain"
  | "boreal_work_next"
  | "boreal_work_parallel"
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

export interface BorealCliRunOptions {
  readonly workspaceRoot: string;
  /** Correlates an adapter invocation with the operation it produced. */
  readonly correlationId?: string;
}

export interface BorealCliRunner {
  run(args: readonly string[], options: BorealCliRunOptions): Promise<unknown>;
  runEnvelope?(args: readonly string[], options: BorealCliRunOptions): Promise<BorealCliEnvelope>;
}

export interface BorealMcpServerOptions {
  readonly workspaceRoot?: string;
  readonly registryEntries?: readonly McpProjectRegistryEntry[];
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

interface BorealCliEnvelope {
  readonly ok: true;
  readonly ledgerSeq?: number | null;
  readonly data: unknown;
  readonly agentDirectives?: readonly AgentDirectiveBundle[];
}

const COMMON_PROPERTIES = {
  selectedProjectId: {
    type: "string",
    description: "Stable project ID. Used only by a global MCP server backed by its own authoritative project registry."
  }
} as const;

const CONFIRM_PROPERTY = {
  confirmed: { type: "boolean", description: "Must be true before a mutating tool executes." }
} as const;

const DIRECTIVE_DEBUG_PROPERTIES = {
  fixture: { type: "string", description: "Directive debug fixture such as blocked-work, closeout-success, doctor-recovery, or session-handoff." },
  commandPath: { type: "string", description: "Boreal command path used to compile directive selectors, for example work show or agent finish." },
  subjectType: { type: "string", description: "Directive subject type such as work, sprint, milestone, session, or workspace." },
  subjectId: { type: "string" },
  subjectTitle: { type: "string" },
  status: { type: "string" },
  label: { type: "string" },
  labels: { type: "array", items: { type: "string" } },
  dependencies: { type: "array", items: { type: "string" } },
  activeBlockers: { type: "array", items: { type: "string" } },
  openDescendants: { type: "array", items: { type: "string" } },
  evidenceIds: { type: "array", items: { type: "string" } },
  verificationIds: { type: "array", items: { type: "string" } },
  summaryId: { type: "string" },
  summaryUri: { type: "string" },
  commits: { type: "array", items: { type: "string" } },
  dirtyPaths: { type: "array", items: { type: "string" } }
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
    name: "boreal_directives_current",
    title: "Boreal current directives",
    description: "Return the current CLI agentDirectives bundle for a selected work, sprint, phase, or milestone subject.",
    kind: "read",
    inputSchema: schema({ ...COMMON_PROPERTIES, workId: { type: "string" } }, ["workId"]),
    async run(input, context) {
      const workId = requiredString(input, "workId");
      const envelope = await scopedReadEnvelope(context, ["work", "show", workId, "--json"]);
      const agentDirectives = envelope.agentDirectives ?? [];
      return {
        schemaVersion: "boreal.mcp.directives.current.v1",
        workspaceRoot: context.boundary.workspaceRoot,
        projectRoot: context.boundary.projectRoot,
        memoryRoot: context.boundary.memoryRoot,
        commandPath: "work show",
        subject: directiveSubjectFromWorkData(envelope.data, workId),
        summary: summarizeDirectiveBundles(agentDirectives),
        agentDirectives,
        result: envelope.data
      };
    }
  },
  {
    name: "boreal_directives_compile",
    title: "Compile Boreal directives",
    description: "Compile a directive bundle through the CLI directive compiler for a fixture or explicit typed subject snapshot.",
    kind: "read",
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      ...DIRECTIVE_DEBUG_PROPERTIES
    }),
    async run(input, context) {
      return scopedRead(context, ["directives", "compile", ...directiveDebugArgs(input), "--json"]);
    }
  },
  {
    name: "boreal_directives_explain",
    title: "Explain Boreal directive",
    description: "Explain why one directive registry entry was emitted, selected, missing data, conflicted, or not selected.",
    kind: "read",
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      directiveId: { type: "string" },
      ...DIRECTIVE_DEBUG_PROPERTIES
    }, ["directiveId"]),
    async run(input, context) {
      return scopedRead(context, [
        "directives",
        "explain",
        requiredString(input, "directiveId"),
        ...directiveDebugArgs(input),
        "--json"
      ]);
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
      labels: { type: "array", items: { type: "string" } },
      containerId: { type: "string", description: "Optional work container whose dependency-graph descendants scope ready work." },
      agentId: { type: "string", description: "Agent ID to include in generated claim/start commands." },
      purpose: { type: "string", description: "Reservation purpose to include in generated claim/start commands." },
      limit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT }
    }),
    async run(input, context) {
      return scopedRead(context, [
        "work",
        "next",
        ...optionalRepeatedFlag("label", stringArrayInput(input, "labels", optionalString(input, "label"))),
        ...optionalNamedFlag("container", optionalString(input, "containerId")),
        ...optionalNamedFlag("agent", optionalString(input, "agentId")),
        ...optionalFlag(input, "purpose"),
        "--limit",
        String(limitInput(input, DEFAULT_LIST_LIMIT)),
        "--json"
      ]);
    }
  },
  {
    name: "boreal_work_parallel",
    title: "Boreal parallel work queue",
    description: "Build a read-only ready-work queue with exact agent start and work claim commands per row.",
    kind: "read",
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      label: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      containerId: { type: "string", description: "Optional work container whose dependency-graph descendants scope ready work." },
      agentId: { type: "string", description: "Single agent ID to include in generated commands." },
      agentIds: { type: "array", items: { type: "string" }, description: "Agent IDs to round-robin across generated commands." },
      agentPrefix: { type: "string", description: "Generate per-row agent IDs as <prefix>-1, <prefix>-2, and so on." },
      purpose: { type: "string", description: "Reservation purpose to include in generated claim/start commands." },
      limit: { type: "number", minimum: 1, maximum: MAX_LIST_LIMIT }
    }),
    async run(input, context) {
      return scopedRead(context, [
        "work",
        "parallel",
        ...optionalRepeatedFlag("label", stringArrayInput(input, "labels", optionalString(input, "label"))),
        ...optionalNamedFlag("container", optionalString(input, "containerId")),
        ...optionalRepeatedFlag("agent", stringArrayInput(input, "agentIds", optionalString(input, "agentId"))),
        ...optionalNamedFlag("agent-prefix", optionalString(input, "agentPrefix")),
        ...optionalFlag(input, "purpose"),
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
    description: "Claim a specific work item or the next matching ready work through bwrk work claim with lock and audit semantics.",
    kind: "mutating",
    effects: ["state"],
    inputSchema: schema({
      ...COMMON_PROPERTIES,
      ...CONFIRM_PROPERTY,
      workId: { type: "string", description: "Optional exact work item to claim instead of the next matching ready item." },
      agentId: { type: "string" },
      label: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      containerId: { type: "string", description: "Optional work container whose dependency-graph descendants scope ready work." },
      purpose: { type: "string" },
      ttl: { type: "string" },
      expiresAt: { type: "string" },
      start: { type: "boolean", description: "Return the agent-start handoff payload after claiming or resuming." }
    }, ["confirmed", "agentId"]),
    command(input) {
      const labels = stringArrayInput(input, "labels", optionalString(input, "label"));
      return [
        "work",
        "claim",
        ...optionalWorkIdArg(input),
        ...(input.start === true ? ["--start"] : []),
        "--agent",
        requiredString(input, "agentId"),
        ...optionalRepeatedFlag("label", labels),
        ...optionalNamedFlag("container", optionalString(input, "containerId")),
        ...optionalFlag(input, "purpose"),
        ...reservationExpiryArgs(input),
        "--json"
      ];
    }
  },
  {
    name: "boreal_work_reserve",
    title: "Reserve Boreal work",
    description: "Reserve a specific work item through bwrk work reserve and return the updated work plus active reservation.",
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
      evidence: { type: "string" },
      evidenceIds: { type: "array", items: { type: "string" } },
      close: { type: "boolean" },
      release: { type: "boolean" },
      reason: { type: "string" },
      kind: { type: "string" },
      outcome: { type: "string" },
      command: { type: "string" },
      uri: { type: "string" },
      verdict: { type: "string" },
      notes: { type: "string" }
    }, ["confirmed", "workId"]),
    command(input) {
      const evidence = stringArrayInput(input, "evidenceIds", optionalString(input, "evidence"));
      const summary = optionalString(input, "summary");
      return [
        "agent",
        "finish",
        requiredString(input, "workId"),
        ...(summary ? ["--summary", summary] : []),
        ...optionalRepeatedFlag("evidence", evidence),
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
    validateToolInput(spec.inputSchema, args);
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
    },
    async runEnvelope(args) {
      const invocation = cliInvocation(workspaceRoot, input.cliPath);
      const output = await runCommand({
        cwd: workspaceRoot,
        command: invocation.command,
        args: [...invocation.args, ...args]
      });
      return parseCliEnvelope(output);
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
  const correlationId = sessionId;
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
  const result = await context.runner.run(commandPreview.slice(1), {
    workspaceRoot: context.boundary.workspaceRoot,
    correlationId
  });
  const operation = await loadMutationOperation(
    context.runner,
    context.boundary.workspaceRoot,
    correlationId,
    mcpCommandPath(commandArgs)
  );

  return toolResult({
    schemaVersion: BOREAL_MCP_TOOL_VERSION,
    tool: spec.name,
    workspaceRoot: context.boundary.workspaceRoot,
    projectRoot: context.boundary.projectRoot,
    memoryRoot: context.boundary.memoryRoot,
    contract,
    commandPreview,
    correlationId,
    operationId: operation.id,
    operation,
    result
  });
}

async function loadMutationOperation(
  runner: BorealCliRunner,
  workspaceRoot: string,
  correlationId: string,
  commandPath: string
): Promise<OperationListRow> {
  const rows = await runner.run(
    ["--workspace", workspaceRoot, "operation", "list", "--session-id", correlationId, "--command", commandPath, "--limit", "20", "--json"],
    { workspaceRoot, correlationId }
  );
  const candidates = Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> =>
        isRecord(row) &&
        row.sessionId === correlationId &&
        row.commandPath === commandPath &&
        typeof row.id === "string"
      )
    : [];
  if (candidates.length !== 1) {
    throw new BorealError("BOREAL_INVARIANT", "Confirmed MCP mutation did not produce a queryable operation record", {
      workspaceRoot,
      correlationId,
      commandPath,
      candidateCount: candidates.length,
      candidateIds: candidates.slice(0, MAX_DIAGNOSTIC_ITEMS).map((row) => row.id)
    });
  }
  return candidates[0] as unknown as OperationListRow;
}

function mcpCommandPath(args: readonly string[]): string {
  return args.slice(0, 2).join(" ");
}

async function scopedRead(context: ToolContext, args: readonly string[]): Promise<unknown> {
  return context.runner.run(["--workspace", context.boundary.workspaceRoot, ...args], {
    workspaceRoot: context.boundary.workspaceRoot
  });
}

async function scopedReadEnvelope(context: ToolContext, args: readonly string[]): Promise<BorealCliEnvelope> {
  const scopedArgs = ["--workspace", context.boundary.workspaceRoot, ...args];
  if (context.runner.runEnvelope) {
    return context.runner.runEnvelope(scopedArgs, {
      workspaceRoot: context.boundary.workspaceRoot
    });
  }
  const result = await context.runner.run(scopedArgs, {
    workspaceRoot: context.boundary.workspaceRoot
  });
  if (isRecord(result) && result.ok === true && "data" in result) {
    return cliEnvelopeFromRecord(result);
  }
  return { ok: true, data: result };
}

async function boundaryFromInput(
  input: ToolInput,
  options: BorealMcpServerOptions
): Promise<McpProjectBoundary> {
  if (options.workspaceRoot) {
    const workspaceRoot = resolve(options.workspaceRoot);
    const setup = await readProjectSetup(workspaceRoot);
    const projectRoot = resolve(setup.projectRoot ?? workspaceRoot);
    const memoryRoot = resolve(setup.memoryRoot ?? join(projectRoot, "memory"));
    return bindMcpProjectBoundary({
      workspaceRoot,
      projectRoot,
      memoryRoot,
      memoryLayout: setup.memoryLayout,
      selectedProjectId: optionalString(input, "selectedProjectId"),
      registryEntries: options.registryEntries
    });
  }

  const selectedProjectId = requiredString(input, "selectedProjectId");
  const registryEntries = options.registryEntries ?? [];
  const selected = registryEntries.find((entry) => entry.id === selectedProjectId);
  if (!selected) {
    throw new BorealError("BOREAL_NOT_FOUND", "Selected MCP project is not present in the server registry", {
      selectedProjectId
    });
  }
  return bindMcpProjectBoundary({
    workspaceRoot: selected.projectRoot,
    projectRoot: selected.projectRoot,
    memoryRoot: selected.memoryRoot,
    memoryLayout: selected.memoryLayout,
    selectedProjectId,
    registryEntries
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
  const result = await runBoundedProcess({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    timeoutMs: 60_000,
    stdoutMaxBytes: 4 * 1024 * 1024,
    stderrMaxBytes: 1024 * 1024
  });
  const out = result.stdout.text;
  const err = result.stderr.text;
  const payload = firstJsonPayload(out, err);
  if (result.exitCode !== 0) {
    const parsedFailure = parseCliFailurePayload(payload);
    const diagnostics = boundedDiagnostic({
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      stdout: errExcerpt(out),
      stderr: errExcerpt(err)
    });
    if (parsedFailure) {
      throw new BorealError(
        cliErrorCode(parsedFailure.code),
        boundedDiagnosticText(typeof parsedFailure.message === "string" ? parsedFailure.message : "Boreal CLI command failed"),
        {
          exitCode: result.exitCode,
          diagnostics,
          details: boundedDiagnostic(parsedFailure.details)
        }
      );
    }
    throw new BorealError("BOREAL_STORAGE_ERROR", `Boreal CLI exited with code ${result.exitCode ?? "unknown"}`, diagnostics);
  }
  if (payload) {
    return payload;
  }
  return out;
}

function parseCliEnvelope(output: string): BorealCliEnvelope {
  const parsed = safeParseJson(output, { schemaName: "boreal.cli.envelope.v1", expectedObject: true });
  if (!isRecord(parsed)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal CLI response was not an object");
  }
  if (parsed.ok === true) {
    return cliEnvelopeFromRecord(parsed);
  }
  throw new BorealError(cliErrorCode(parsed.code), typeof parsed.message === "string" ? parsed.message : "Boreal CLI command failed", {
    details: parsed.details
  });
}

function parseCliData(output: string): unknown {
  return parseCliEnvelope(output).data;
}

interface CliFailurePayload {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
}

function parseCliFailurePayload(payload: string | undefined): CliFailurePayload | undefined {
  if (!payload) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed) || parsed.ok !== false) {
      return undefined;
    }
    return parsed as CliFailurePayload;
  } catch {
    return undefined;
  }
}

function cliEnvelopeFromRecord(value: Readonly<Record<string, unknown>>): BorealCliEnvelope {
  return {
    ok: true,
    ...(typeof value.ledgerSeq === "number" || value.ledgerSeq === null ? { ledgerSeq: value.ledgerSeq } : {}),
    data: value.data,
    ...(Array.isArray(value.agentDirectives) ? { agentDirectives: value.agentDirectives as readonly AgentDirectiveBundle[] } : {})
  };
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
    ? {
        ok: false,
        code: error.code,
        message: boundedDiagnosticText(error.message),
        retryable: classifyBorealError(error.code, error.details).retryable,
        recovery: classifyBorealError(error.code, error.details).recovery,
        details: boundedDiagnostic(error.details)
      }
    : {
        ok: false,
        code: "BOREAL_INVARIANT",
        message: boundedDiagnosticText(error instanceof Error ? error.message : String(error)),
        retryable: false,
        recovery: classifyBorealError("BOREAL_INVARIANT").recovery
      };
  const bounded = boundedPayload(payload);
  return {
    isError: true,
    content: [{ type: "text", text: `${JSON.stringify(bounded, null, 2)}\n` }],
    structuredContent: bounded
  };
}

function boundedPayload(value: unknown): unknown {
  const sanitized = boundedDiagnostic(value);
  const text = safeJsonStringify(sanitized);
  if (text.length <= MAX_PAYLOAD_CHARS) {
    return sanitized;
  }
  return {
    schemaVersion: BOREAL_MCP_TOOL_VERSION,
    truncated: true,
    fullSizeChars: text.length,
    maxSizeChars: MAX_PAYLOAD_CHARS,
    preview: previewJsonValue(sanitized, 0)
  };
}

function boundedDiagnostic(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactDiagnosticText(value).slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) {
    return "[diagnostic depth limited]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DIAGNOSTIC_ITEMS).map((entry) => boundedDiagnostic(entry, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).slice(0, MAX_DIAGNOSTIC_ITEMS).map(([key, entry]) => [
        key,
        SENSITIVE_DIAGNOSTIC_KEY.test(key) ? "[redacted]" : boundedDiagnostic(entry, depth + 1)
      ])
    );
  }
  return String(value).slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
}

function boundedDiagnosticText(value: string): string {
  return redactDiagnosticText(value).slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
}

function errExcerpt(value: string): string {
  return boundedDiagnosticText(value.trim()).slice(0, MAX_DIAGNOSTIC_CHARS);
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/((?:authorization|api[-_]?key|cookie|credential|password|private[-_]?key|secret|token)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/([?&](?:api[-_]?key|password|secret|token)=)[^&\s]+/giu, "$1[redacted]");
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ truncated: true, reason: "diagnostic_not_serializable" });
  }
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

function validateToolInput(schema: JsonSchemaObject, input: ToolInput): void {
  const allowed = new Set(Object.keys(schema.properties));
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (schema.additionalProperties === false && unknown.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool arguments contain unsupported properties", {
      unknown,
      allowed: [...allowed].sort((left, right) => left.localeCompare(right))
    });
  }

  const missing = (schema.required ?? []).filter((key) => input[key] === undefined);
  if (missing.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool arguments are missing required properties", { missing });
  }

  for (const [key, value] of Object.entries(input)) {
    const definition = schema.properties[key];
    if (!isRecord(definition)) {
      continue;
    }
    const expectedType = definition.type;
    const valid = expectedType === "array"
      ? Array.isArray(value)
      : expectedType === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : expectedType === "boolean"
          ? typeof value === "boolean"
          : expectedType === "string"
            ? typeof value === "string"
            : true;
    if (!valid) {
      throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool argument has the wrong type", {
        property: key,
        expectedType,
        actualType: Array.isArray(value) ? "array" : typeof value
      });
    }
    if (Array.isArray(definition.enum) && !definition.enum.includes(value)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool argument is outside the allowed enum", {
        property: key,
        value,
        allowed: definition.enum
      });
    }
    if (typeof value === "number") {
      if (typeof definition.minimum === "number" && value < definition.minimum) {
        throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool numeric argument is below its minimum", {
          property: key,
          value,
          minimum: definition.minimum
        });
      }
      if (typeof definition.maximum === "number" && value > definition.maximum) {
        throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool numeric argument exceeds its maximum", {
          property: key,
          value,
          maximum: definition.maximum
        });
      }
    }
    if (Array.isArray(value) && isRecord(definition.items) && definition.items.type === "string") {
      const invalidIndex = value.findIndex((entry) => typeof entry !== "string");
      if (invalidIndex >= 0) {
        throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool array argument contains an invalid item", {
          property: key,
          index: invalidIndex,
          expectedType: "string"
        });
      }
    }
  }
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

function optionalWorkIdArg(input: ToolInput): readonly string[] {
  const workId = optionalString(input, "workId");
  return workId ? [workId] : [];
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

function directiveDebugArgs(input: ToolInput): readonly string[] {
  return [
    ...optionalNamedFlag("fixture", optionalString(input, "fixture")),
    ...optionalNamedFlag("command", optionalString(input, "commandPath")),
    ...optionalNamedFlag("subject-type", optionalString(input, "subjectType")),
    ...optionalNamedFlag("subject-id", optionalString(input, "subjectId")),
    ...optionalNamedFlag("subject-title", optionalString(input, "subjectTitle")),
    ...optionalNamedFlag("status", optionalString(input, "status")),
    ...optionalRepeatedFlag("label", stringArrayInput(input, "labels", optionalString(input, "label"))),
    ...optionalRepeatedFlag("dependency", stringArrayInput(input, "dependencies")),
    ...optionalRepeatedFlag("active-blocker", stringArrayInput(input, "activeBlockers")),
    ...optionalRepeatedFlag("open-descendant", stringArrayInput(input, "openDescendants")),
    ...optionalRepeatedFlag("evidence", stringArrayInput(input, "evidenceIds")),
    ...optionalRepeatedFlag("verification", stringArrayInput(input, "verificationIds")),
    ...optionalNamedFlag("summary-id", optionalString(input, "summaryId")),
    ...optionalNamedFlag("summary-uri", optionalString(input, "summaryUri")),
    ...optionalRepeatedFlag("commit", stringArrayInput(input, "commits")),
    ...optionalRepeatedFlag("dirty-path", stringArrayInput(input, "dirtyPaths"))
  ];
}

function optionalNamedFlag(name: string, value: string | undefined): readonly string[] {
  return value ? [`--${name}`, value] : [];
}

function directiveSubjectFromWorkData(data: unknown, fallbackId: string): unknown {
  if (!isRecord(data)) {
    return { id: fallbackId };
  }
  return {
    id: typeof data.id === "string" ? data.id : fallbackId,
    ...(typeof data.kind === "string" ? { type: data.kind } : {}),
    ...(typeof data.title === "string" ? { title: data.title } : {}),
    ...(typeof data.status === "string" ? { status: data.status } : {})
  };
}

function summarizeDirectiveBundles(bundles: readonly AgentDirectiveBundle[]): unknown {
  const directives = bundles.flatMap((bundle) => bundle.directives);
  const conflicts = bundles.flatMap((bundle) => bundle.conflicts);
  const deprecations = bundles.flatMap((bundle) => bundle.deprecations);
  const missingRequired = bundles.flatMap((bundle) => bundle.missingRequired);
  return {
    bundleCount: bundles.length,
    directiveCount: directives.length,
    advisoryCount: directives.filter((directive) => directive.severity === "advisory").length,
    requiredCount: directives.filter((directive) => directive.severity === "required").length,
    blockingCount: directives.filter((directive) => directive.severity === "blocking").length,
    conflictCount: conflicts.length,
    deprecationCount: deprecations.length,
    missingRequiredCount: missingRequired.length,
    registryIds: uniqueStrings(directives.map((directive) => directive.registryId)),
    missingRequiredRegistryIds: uniqueStrings(missingRequired.map((entry) => entry.registryId).filter(isDefined))
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function memoryLayoutValue(value: unknown): ProjectRegistryMemoryLayout | undefined {
  return value === "in-repo" || value === "child" || value === "sibling" ? value : undefined;
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
