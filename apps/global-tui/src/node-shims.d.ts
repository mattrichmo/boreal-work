declare module "node:net" {
  interface Socket {
    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "end" | "close", listener: () => void): this;
    write(data: Uint8Array, callback?: (error?: Error) => void): boolean;
    end(): this;
    destroy(): this;
    setTimeout(milliseconds: number, callback: () => void): this;
  }
  export function createConnection(path: string, callback?: () => void): Socket;
}
declare module "node:readline" {
  export function createInterface(options: { input: unknown; output: unknown; terminal?: boolean }): {
    question(prompt: string): Promise<string>;
    close(): void;
  };
}
declare module "node:child_process" {
  export function spawn(executable: string, args: readonly string[], options: { cwd: string; stdio: "inherit" }): {
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "exit", listener: (code: number | null, signal: string | null) => void): void;
  };
}
declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: readonly string[];
  readonly stdin: { readonly isTTY?: boolean; readonly isRaw?: boolean; setRawMode?(enabled: boolean): void; resume?(): void; pause?(): void; on(event: "data", listener: (chunk: Uint8Array | string) => void): void; off(event: "data", listener: (chunk: Uint8Array | string) => void): void; [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array> };
  readonly stdout: { readonly isTTY?: boolean; readonly columns?: number; readonly rows?:number; on(event:"resize",listener:()=>void):void; off(event:"resize",listener:()=>void):void; write(value: string): boolean };
  readonly stderr: { write(value: string): boolean };
  on(signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGWINCH", listener: () => void): void;
  off(signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGWINCH", listener: () => void): void;
  exitCode?: number;
};
