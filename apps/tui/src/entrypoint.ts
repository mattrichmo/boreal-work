#!/usr/bin/env node
import { VersionedServiceClient, MountedWorkflowController, TuiWorkflowContext } from "./client.js";
import { UnixSocketFramedTransport } from "./node-transport.js";
import { renderMountedView } from "./terminal.js";
import { runLineShell } from "./line-shell.js";
import { FullScreenTerminal, TerminalSignal, runFullScreen } from "./full-screen.js";
export interface TerminalLaunchOptions {
    readonly socket: string;
    readonly project: string;
    readonly actor: string;
    readonly harness: string;
    readonly session: string;
    readonly work?: string;
    readonly timeout_ms?: number;
    readonly interactive?: boolean;
    readonly plain?: boolean;
    readonly theme?: "dark" | "light" | "mono";
    readonly ascii?: boolean;
}
function flagValue(argv: readonly string[], flag: string): string | undefined {
    const index = argv.indexOf(flag);
    const value = index >= 0 ? argv[index + 1] : undefined;
    return value && !value.startsWith("--") ? value : undefined;
}
export function parseTerminalArgs(argv: readonly string[]): TerminalLaunchOptions {
    const socket = flagValue(argv, "--socket");
    const project = flagValue(argv, "--project");
    if (!socket || !project)
        throw new Error("usage: bwrk-tui --socket PATH --project PROJECT [--work WORK]");
    const actor = flagValue(argv, "--actor") ?? "tui-operator";
    const dashboardId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const harness = flagValue(argv, "--harness") ?? `tui_${dashboardId}`;
    const session = flagValue(argv, "--session") ?? `session_tui_${dashboardId}`;
    const timeout = flagValue(argv, "--timeout-ms");
    let timeout_ms: number | undefined;
    if (timeout !== undefined) {
        const parsed = Number(timeout);
        if (!Number.isInteger(parsed) || parsed <= 0)
            throw new Error("--timeout-ms must be a positive integer");
        timeout_ms = parsed;
    }
    const selectedTheme = flagValue(argv, "--theme") ?? process.env.BOREAL_THEME ?? "dark";
    if (!["dark", "light", "mono"].includes(selectedTheme))
        throw new Error("--theme must be dark, light, or mono");
    const theme = argv.includes("--no-color") || process.env.NO_COLOR !== undefined ? "mono" : selectedTheme as "dark" | "light" | "mono";
    return { theme, plain: argv.includes("--plain") || process.env.TERM === "dumb" || process.env.BOREAL_PLAIN !== undefined, ascii: argv.includes("--ascii"), socket, project, actor, harness, session, work: flagValue(argv, "--work"), timeout_ms, interactive: argv.includes("--interactive") };
}
export async function mountAndRender(options: TerminalLaunchOptions, write: (value: string) => void): Promise<void> {
    const transport = new UnixSocketFramedTransport(options.socket, { timeout_ms: options.timeout_ms });
    const client = new VersionedServiceClient(transport, { project_id: options.project, actor_id: options.actor, harness_id: options.harness, session_id: options.session });
    const context: TuiWorkflowContext = { project_id: options.project, actor_id: options.actor, harness_id: options.harness, session_id: options.session };
    const controller = new MountedWorkflowController(client, { context });
    try {
        const view = await controller.mount({ kind: options.work ? "work" : "monitoring", project_id: options.project, work_id: options.work });
        write(renderMountedView(view));
    }
    finally {
        controller.unmount();
        await client.close();
    }
}
async function* stdinLines(): AsyncIterable<string> {
    let pending = "";
    const decoder = new TextDecoder();
    for await (const chunk of process.stdin) {
        pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines)
            yield line;
    }
    pending += decoder.decode();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines)
        yield line;
    if (pending)
        yield pending;
}
export async function interactiveMountAndRender(options: TerminalLaunchOptions, write: (value: string) => void): Promise<void> {
    return interactiveMountAndRenderWithTerminal(options, write, processTerminal());
}
export async function interactiveMountAndRenderWithTerminal(options: TerminalLaunchOptions, write: (value: string) => void, terminal: FullScreenTerminal): Promise<void> {
    const transport = new UnixSocketFramedTransport(options.socket, { timeout_ms: options.timeout_ms });
    const client = new VersionedServiceClient(transport, { project_id: options.project, actor_id: options.actor, harness_id: options.harness, session_id: options.session });
    const context: TuiWorkflowContext = { project_id: options.project, actor_id: options.actor, harness_id: options.harness, session_id: options.session };
    const controller = new MountedWorkflowController(client, { context });
    try {
        const view = await controller.mount({ kind: options.work ? "work" : "monitoring", project_id: options.project, work_id: options.work });
        if (terminal.is_tty && !options.plain) {
            await runFullScreen(controller, terminal, { auto_refresh_ms: 5000, theme: options.theme, ascii: options.ascii });
        }
        else {
            write(renderMountedView(view));
            await runLineShell(stdinLines(), controller, write, { auto_refresh_ms: 5000 });
        }
    }
    finally {
        controller.unmount();
        await client.close();
    }
}
function processTerminal(): FullScreenTerminal {
    return {
        is_tty: process.stdin.isTTY === true && process.stdout.isTTY === true,
        dimensions: () => ({ width: process.stdout.columns ?? 120, height: process.stdout.rows ?? 40 }),
        write: (value) => { process.stdout.write(value); },
        was_raw: process.stdin.isRaw === true,
        setRawMode: (enabled) => { process.stdin.setRawMode?.(enabled); },
        resume: () => { process.stdin.resume?.(); },
        pause: () => { process.stdin.pause?.(); },
        onData(listener) {
            const wrapped = (chunk: string | Uint8Array): void => { listener(chunk); };
            process.stdin.on("data", wrapped);
            return () => { process.stdin.off("data", wrapped); };
        },
        onEnd(listener) {
            process.stdin.on("end", listener);
            return () => { process.stdin.off("end", listener); };
        },
        onResize(listener) {
            process.stdout.on("resize", listener);
            return () => { process.stdout.off("resize", listener); };
        },
        onSignal(signal: TerminalSignal, listener: () => void) {
            process.on(signal, listener);
            return () => { process.off(signal, listener); };
        },
    };
}
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    if (argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write("Usage: bwrk-tui --socket PATH --project PROJECT [--actor ID] [--harness ID] [--session ID] [--work WORK] [--timeout-ms N] [--interactive] [--plain] [--theme dark|light|mono] [--no-color] [--ascii]\n");
        return;
    }
    try {
        const options = parseTerminalArgs(argv);
        if (options.interactive)
            await interactiveMountAndRender(options, (value) => process.stdout.write(value));
        else
            await mountAndRender(options, (value) => process.stdout.write(value));
    }
    catch (error) {
        process.stderr.write(`bwrk-tui: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
if (process.argv[1]?.endsWith("/entrypoint.js"))
    void main();
