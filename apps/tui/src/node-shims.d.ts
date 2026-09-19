declare module "node:net" {
  interface Socket {
    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "error", listener: (error: Error & { readonly code?: string }) => void): this;
    on(event: "end" | "close", listener: () => void): this;
    once(event: "error", listener: (error: Error & { readonly code?: string }) => void): this;
    write(data: Uint8Array, callback?: (error?: Error) => void): boolean;
    end(callback?: () => void): this;
    destroy(): this;
    setTimeout(milliseconds: number, callback: () => void): this;
  }

  interface Server {
    on(event: "error", listener: (error: Error) => void): this;
    listen(path: string, callback?: () => void): this;
    close(callback?: (error?: Error) => void): this;
  }

  export function createConnection(path: string, callback?: () => void): Socket;
  export function createServer(listener: (socket: Socket) => void): Server;
}

declare module "node:fs" {
  export function unlinkSync(path: string): void;
  export function openSync(path: string, flags: string): number;
  export function closeSync(fd: number): void;
}

declare module "node:tty" {
  export class WriteStream {
    constructor(fd: number);
    readonly columns?: number;
    readonly rows?: number;
    on(event: "error", listener: () => void): this;
    destroy(): this;
  }
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: readonly string[];
  readonly stdin: {
    readonly isTTY?: boolean;
    readonly isRaw?: boolean;
    on(event: "end", listener: () => void): void;
    off(event: "end", listener: () => void): void;
    setRawMode?(enabled: boolean): void;
    resume?(): void;
    pause?(): void;
    on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
    off(event: "data", listener: (chunk: string | Uint8Array) => void): void;
    [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>;
  };
  readonly stdout: {
    readonly isTTY?: boolean;
    readonly columns?: number;
    readonly rows?: number;
    write(value: string): boolean;
    on(event: "resize", listener: () => void): void;
    off(event: "resize", listener: () => void): void;
  };
  readonly stderr: { write(value: string): boolean };
  on(signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGWINCH", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGWINCH", listener: () => void): void;
  exitCode?: number;
};
