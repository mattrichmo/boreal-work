import { execFile } from "node:child_process";

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly code?: string | number;
}

export function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          stdout,
          stderr,
          error: stderr.trim() || error.message,
          code: "code" in error && error.code !== null ? error.code : undefined
        });
        return;
      }
      resolve({ ok: true, stdout, stderr });
    });
  });
}

export function isMissingGit(result: GitResult): boolean {
  return result.code === "ENOENT";
}
