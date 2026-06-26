import { readFile, stat } from "node:fs/promises";

import { BorealError } from "./errors.js";

export const DEFAULT_JSON_MAX_BYTES = 10 * 1024 * 1024;

export interface SafeParseJsonOptions {
  readonly path?: string;
  readonly schemaName?: string;
  readonly sizeBytes?: number;
  readonly stripBom?: boolean;
  readonly expectedObject?: boolean;
}

export interface ReadJsonFileOptions extends Omit<SafeParseJsonOptions, "sizeBytes"> {
  readonly maxBytes?: number;
}

export async function readJsonFile(path: string, options: ReadJsonFileOptions = {}): Promise<unknown> {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
  const info = await stat(path);
  if (!info.isFile()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "JSON path must be a regular file", {
      path,
      schemaName: options.schemaName,
      sizeBytes: info.size
    });
  }
  if (info.size > maxBytes) {
    throw new BorealError("BOREAL_INVALID_INPUT", "JSON file exceeds maximum readable size", {
      path,
      schemaName: options.schemaName,
      sizeBytes: info.size,
      maxBytes
    });
  }

  return safeParseJson(await readFile(path, "utf8"), {
    ...options,
    path,
    sizeBytes: info.size
  });
}

export function safeParseJson(text: string, options: SafeParseJsonOptions = {}): unknown {
  const source = (options.stripBom ?? true) && text.startsWith("\uFEFF") ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new BorealError("BOREAL_JSON_PARSE", "JSON parse failed", {
      path: options.path,
      schemaName: options.schemaName,
      sizeBytes: options.sizeBytes ?? Buffer.byteLength(text, "utf8"),
      message: error instanceof Error ? error.message : String(error)
    });
  }

  if (options.expectedObject && !isRecord(parsed)) {
    throw new BorealError("BOREAL_JSON_PARSE", "JSON document must contain an object", {
      path: options.path,
      schemaName: options.schemaName,
      sizeBytes: options.sizeBytes ?? Buffer.byteLength(text, "utf8")
    });
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
