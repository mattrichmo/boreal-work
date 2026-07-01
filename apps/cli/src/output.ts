import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";

import { safeParseJson, type AgentDirectiveBundle } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

export interface CliOutput {
  write(text: string): void;
  error(text: string): void;
}

export interface CliSuccessEnvelope {
  readonly ok: true;
  readonly data: unknown;
  readonly agentDirectives?: readonly AgentDirectiveBundle[];
}

export interface ResultSpoolingOutput extends CliOutput {
  flush(): Promise<void>;
}

export interface ResultSpoolingOptions {
  readonly workspaceRoot: string;
  readonly command: string;
  readonly maxResultSizeChars: number;
}

export function formatRecord(
  value: unknown,
  json: boolean,
  options: { readonly agentDirectives?: readonly AgentDirectiveBundle[] } = {}
): string {
  if (json) {
    const envelope: CliSuccessEnvelope = {
      ok: true,
      data: value,
      ...(options.agentDirectives && options.agentDirectives.length > 0
        ? { agentDirectives: options.agentDirectives }
        : {})
    };
    return `${JSON.stringify(envelope, null, 2)}\n`;
  }
  if (typeof value === "string") {
    return `${value}\n`;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createResultSpoolingOutput(output: CliOutput, options: ResultSpoolingOptions): ResultSpoolingOutput {
  let stdout = "";
  return {
    write(text) {
      stdout += text;
    },
    error(text) {
      output.error(text);
    },
    async flush() {
      if (stdout.length <= options.maxResultSizeChars) {
        output.write(stdout);
        return;
      }

      const fullResultPath = resultPath(options.workspaceRoot);
      await writeTextFileAtomic(fullResultPath, stdout);
      output.write(
        formatRecord(
          {
            truncated: true,
            command: options.command,
            maxResultSizeChars: options.maxResultSizeChars,
            fullResultPath: relative(options.workspaceRoot, fullResultPath),
            fullResultBytes: Buffer.byteLength(stdout, "utf8"),
            preview: previewJsonEnvelope(stdout)
          },
          true
        )
      );
    }
  };
}

function resultPath(workspaceRoot: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return join(workspaceRoot, ".boreal", "results", `result-${timestamp}-${process.pid}-${randomUUID()}.json`);
}

function previewJsonEnvelope(text: string): unknown {
  try {
    const parsed = safeParseJson(text, { schemaName: "boreal.cli.output.v1", expectedObject: true });
    if (isRecord(parsed) && parsed.ok === true && "data" in parsed) {
      return previewJsonValue(parsed.data, 0);
    }
  } catch {
    return text.slice(0, 1_000);
  }
  return text.slice(0, 1_000);
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
      keys: entries.slice(0, 20).map(([key]) => key),
      keyCount: entries.length
    };
  }
  return Object.fromEntries(entries.slice(0, 20).map(([key, entry]) => [key, previewJsonValue(entry, depth + 1)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function table(rows: readonly Record<string, string | number | undefined>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const columns = Object.keys(rows[0] ?? {});
  const widths = new Map(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))
    ])
  );

  const header = columns.map((column) => column.padEnd(widths.get(column) ?? column.length)).join("  ");
  const divider = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("  ");
  const body = rows
    .map((row) => columns.map((column) => String(row[column] ?? "").padEnd(widths.get(column) ?? 0)).join("  "))
    .join("\n");
  return `${header}\n${divider}\n${body}\n`;
}
