#!/usr/bin/env node
import { VersionedServiceClient, MountedWorkflowController } from "./client.js";
import { UnixSocketFramedTransport } from "./node-transport.js";
import { renderMountedView } from "./terminal.js";
import { runLineShell } from "./line-shell.js";

export interface TerminalLaunchOptions {
  readonly socket: string;
  readonly project: string;
  readonly work?: string;
  readonly timeout_ms?: number;
  readonly interactive?: boolean;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export function parseTerminalArgs(argv: readonly string[]): TerminalLaunchOptions {
  const socket = flagValue(argv, "--socket");
  const project = flagValue(argv, "--project");
  if (!socket || !project) throw new Error("usage: bwrk-tui --socket PATH --project PROJECT [--work WORK]");
  const timeout = flagValue(argv, "--timeout-ms");
  let timeout_ms: number | undefined;
  if (timeout !== undefined) {
    const parsed = Number(timeout);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("--timeout-ms must be a positive integer");
    timeout_ms = parsed;
  }
  return { socket, project, work: flagValue(argv, "--work"), timeout_ms, interactive: argv.includes("--interactive") };
}

export async function mountAndRender(options: TerminalLaunchOptions, write: (value: string) => void): Promise<void> {
  const transport = new UnixSocketFramedTransport(options.socket, { timeout_ms: options.timeout_ms });
  const client = new VersionedServiceClient(transport);
  const controller = new MountedWorkflowController(client);
  try {
    const view = await controller.mount({ kind: options.work ? "work" : "monitoring", project_id: options.project, work_id: options.work });
    write(renderMountedView(view));
  } finally {
    controller.unmount();
    client.close();
  }
}

async function* stdinLines(): AsyncIterable<string> {
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of process.stdin) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) yield line;
  }
  pending += decoder.decode();
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() ?? "";
  for (const line of lines) yield line;
  if (pending) yield pending;
}

export async function interactiveMountAndRender(options: TerminalLaunchOptions, write: (value: string) => void): Promise<void> {
  const transport = new UnixSocketFramedTransport(options.socket, { timeout_ms: options.timeout_ms });
  const client = new VersionedServiceClient(transport);
  const controller = new MountedWorkflowController(client);
  try {
    const view = await controller.mount({ kind: options.work ? "work" : "monitoring", project_id: options.project, work_id: options.work });
    write(renderMountedView(view));
    await runLineShell(stdinLines(), controller, write);
  } finally {
    controller.unmount();
    client.close();
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Usage: bwrk-tui --socket PATH --project PROJECT [--work WORK] [--timeout-ms N] [--interactive]\n");
    return;
  }
  try {
    const options = parseTerminalArgs(argv);
    if (options.interactive) await interactiveMountAndRender(options, (value) => process.stdout.write(value));
    else await mountAndRender(options, (value) => process.stdout.write(value));
  } catch (error) {
    process.stderr.write(`bwrk-tui: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("/entrypoint.js")) void main();
