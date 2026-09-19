/** Live POSIX terminal geometry for stdout AND privately opened /dev/tty streams.
 * A custom tty.WriteStream does not get Node's stdio SIGWINCH wiring. Constructing
 * a short-lived, owned probe uses the public constructor's fresh kernel query;
 * getWindowSize() on the existing stream would only return its cached properties.
 * No shell, stty subprocess, private _handle API, or terminal query/response bytes.
 */
import { openSync as openTerminalFd, closeSync as closeTerminalFd } from "node:fs";
import { WriteStream as TerminalSizeStream } from "node:tty";
import { resolveViewport, type Viewport } from "./layout.js";
export function probeTerminalSize(): Partial<Viewport> | undefined {
    let fd: number | undefined, stream: InstanceType<typeof TerminalSizeStream> | undefined;
    try {
        fd = openTerminalFd("/dev/tty", "w");
        stream = new TerminalSizeStream(fd);
        stream.on("error", () => {});
        return { width: stream.columns, height: stream.rows };
    } catch { return undefined; }
    finally {
        if (stream) stream.destroy();
        // libuv reopens POSIX tty descriptors for its handle. Destroying the
        // stream closes that handle, not the original descriptor we opened.
        // Close our original synchronously too (no async fd-reuse window).
        if (fd !== undefined) { try { closeTerminalFd(fd); } catch {} }
    }
}
export class TerminalSizeTracker {
    private size: Viewport;
    private listeners = new Set<() => void>();
    private poll?: ReturnType<typeof setInterval>;
    private debounce?: ReturnType<typeof setTimeout>;
    private readonly signal = (): void => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => { this.debounce = undefined; this.refresh(); }, 16);
    };
    constructor(private readonly fallback: () => Partial<Viewport> = () => ({}), private readonly probe = probeTerminalSize,
        private readonly env: Record<string, string | undefined> = process.env) {
        const live = probe();
        this.size = resolveViewport(live ?? fallback(), undefined, env);
    }
    dimensions(): Viewport { return { ...this.size }; }
    refresh(): void {
        const live = this.probe();
        const next = resolveViewport(live ?? this.fallback(), this.size, this.env);
        if (next.width === this.size.width && next.height === this.size.height) return;
        this.size = next;
        this.listeners.forEach(fn => fn());
    }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        if (!this.poll) {
            process.on("SIGWINCH", this.signal);
            // Some editor/embedded PTYs miss a signal; recover without user action.
            this.poll = setInterval(() => this.refresh(), 1000);
            this.refresh();
        }
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) {
                if (this.poll) clearInterval(this.poll);
                if (this.debounce) clearTimeout(this.debounce);
                this.poll = undefined; this.debounce = undefined;
                process.off("SIGWINCH", this.signal);
            }
        };
    }
}
