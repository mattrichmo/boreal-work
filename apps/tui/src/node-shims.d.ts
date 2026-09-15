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
}

declare const process: {
  readonly argv: readonly string[];
  readonly stdin: {
    readonly isTTY?: boolean;
    [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>;
  };
  readonly stdout: { write(value: string): boolean };
  readonly stderr: { write(value: string): boolean };
  exitCode?: number;
};
