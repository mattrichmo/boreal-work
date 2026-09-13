import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/** Resolve an explicit workspace or discover the nearest `.boreal` root. */
export function resolveWorkspaceRoot(explicit: string | undefined, cwd: string = process.cwd()): string {
  if (explicit) return resolve(explicit.replace(/^~(?=$|\/)/u, homedir()));
  let current = resolve(cwd);
  while (true) {
    if (existsSync(resolve(current, ".boreal"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}
