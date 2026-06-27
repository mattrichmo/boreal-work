import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export interface VersionInfo {
  readonly name: string;
  readonly version: string;
  readonly packageManager?: string;
  readonly node: string;
}

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly packageManager?: string;
}

let cachedVersionInfo: VersionInfo | undefined;

export function getVersionInfo(): VersionInfo {
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }
  const parsed = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageJson;
  cachedVersionInfo = {
    name: parsed.name ?? "boreal-work",
    version: parsed.version ?? "0.0.0",
    packageManager: parsed.packageManager,
    node: process.version
  };
  return cachedVersionInfo;
}

export function formatVersionInfo(info = getVersionInfo()): string {
  return `${info.name} ${info.version}\n`;
}
