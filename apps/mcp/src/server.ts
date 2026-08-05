import {
  BorealError,
  isBorealError,
  safeParseJson
} from "@boreal/core";

import {
  BOREAL_MCP_SERVER_NAME,
  BOREAL_MCP_TOOL_VERSION,
  callBorealMcpTool,
  listBorealMcpTools,
  type BorealMcpServerOptions,
  type BorealMcpToolResult
} from "./tools.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface JsonRpcRequest {
  readonly jsonrpc?: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export async function handleBorealMcpRequest(
  request: unknown,
  options: BorealMcpServerOptions = {}
): Promise<JsonRpcResponse | undefined> {
  const normalized = normalizeRequest(request);
  if (!normalized) {
    return invalidRequestResponse(requestId(request));
  }

  if (normalized.id === undefined) {
    try {
      await handleNotification(normalized, options);
    } catch {
      // JSON-RPC notifications do not have a response channel. A malformed or
      // failed notification must not tear down the long-lived stdio server.
    }
    return undefined;
  }

  try {
    return {
      jsonrpc: "2.0",
      id: normalized.id,
      result: await dispatchRequest(normalized, options)
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: normalized.id,
      error: jsonRpcError(error)
    };
  }
}

export async function serveBorealMcpStdio(options: BorealMcpServerOptions = {}): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let response: JsonRpcResponse | undefined;
      try {
        response = await handleBorealMcpRequest(parseRequest(trimmed), options);
      } catch {
        // Parsing is deliberately isolated per line. The next JSON-RPC message
        // must remain serviceable after malformed input.
        response = parseErrorResponse();
      }
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

async function dispatchRequest(request: JsonRpcRequest, options: BorealMcpServerOptions): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: BOREAL_MCP_SERVER_NAME,
          version: BOREAL_MCP_TOOL_VERSION
        }
      };
    case "tools/list":
      return { tools: listBorealMcpTools() };
    case "tools/call":
      return callTool(request.params, options);
    case "ping":
      return {};
    default:
      throw new BorealError("BOREAL_NOT_FOUND", `Unknown MCP method: ${request.method}`, { method: request.method });
  }
}

async function handleNotification(request: JsonRpcRequest, options: BorealMcpServerOptions): Promise<void> {
  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") {
    return;
  }
  await dispatchRequest(request, options);
}

async function callTool(params: unknown, options: BorealMcpServerOptions): Promise<BorealMcpToolResult> {
  if (!isRecord(params)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP tools/call params must be an object");
  }
  if (typeof params.name !== "string") {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP tools/call requires a tool name");
  }
  return callBorealMcpTool(params.name, isRecord(params.arguments) ? params.arguments : {}, options);
}

function parseRequest(line: string): JsonRpcRequest {
  return safeParseJson(line, { schemaName: "boreal.mcp.json-rpc.v1" }) as JsonRpcRequest;
}

function jsonRpcError(error: unknown): JsonRpcResponse["error"] {
  if (isBorealError(error)) {
    return {
      code: -32602,
      message: boundedMessage(error.message),
      data: {
        code: error.code,
        details: boundedDiagnostic(error.details)
      }
    };
  }
  return {
    code: -32603,
    message: "Internal MCP server error"
  };
}

function normalizeRequest(value: unknown): JsonRpcRequest | undefined {
  if (!isRecord(value) || (value.jsonrpc !== undefined && value.jsonrpc !== "2.0") || typeof value.method !== "string") {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(value, "id") && !isJsonRpcId(value.id)) {
    return undefined;
  }
  return value as unknown as JsonRpcRequest;
}

function requestId(value: unknown): string | number | null {
  if (!isRecord(value) || !isJsonRpcId(value.id)) {
    return null;
  }
  return value.id;
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function invalidRequestResponse(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32600,
      message: "Invalid JSON-RPC request"
    }
  };
}

function parseErrorResponse(): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32700,
      message: "Invalid JSON-RPC message"
    }
  };
}

const MAX_DIAGNOSTIC_DEPTH = 3;
const MAX_DIAGNOSTIC_ITEMS = 20;
const MAX_DIAGNOSTIC_STRING_LENGTH = 1_000;
const SENSITIVE_DIAGNOSTIC_KEY = /(authorization|api[-_]?key|cookie|credential|password|private[-_]?key|secret|token)/iu;

function boundedMessage(value: string): string {
  return redactDiagnosticText(value).slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
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

function redactDiagnosticText(value: string): string {
  return value
    .replace(/((?:authorization|api[-_]?key|cookie|credential|password|private[-_]?key|secret|token)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/([?&](?:api[-_]?key|password|secret|token)=)[^&\s]+/giu, "$1[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
