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
  request: JsonRpcRequest,
  options: BorealMcpServerOptions = {}
): Promise<JsonRpcResponse | undefined> {
  if (request.id === undefined) {
    await handleNotification(request, options);
    return undefined;
  }

  try {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: await dispatchRequest(request, options)
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id,
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
      const response = await handleBorealMcpRequest(parseRequest(trimmed), options);
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
  const parsed = safeParseJson(line, { schemaName: "boreal.mcp.json-rpc.v1", expectedObject: true });
  if (!isRecord(parsed) || typeof parsed.method !== "string") {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP JSON-RPC message must include a method");
  }
  return parsed as unknown as JsonRpcRequest;
}

function jsonRpcError(error: unknown): JsonRpcResponse["error"] {
  if (isBorealError(error)) {
    return {
      code: -32602,
      message: error.message,
      data: {
        code: error.code,
        details: error.details
      }
    };
  }
  return {
    code: -32603,
    message: error instanceof Error ? error.message : String(error)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
