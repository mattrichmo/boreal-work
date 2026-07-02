import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("release package preparation", () => {
  it("stages a bundled npm package with publish metadata and a dist-only whitelist", async () => {
    const stageDir = await makeTempDir("boreal-release-package-");
    await execFileAsync(process.execPath, [join(repoRoot, "tools", "prepare-npm-package.mjs"), "--out", stageDir], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024
    });

    const rootPackage = parseJson<{ readonly version: string }>(await readFile(join(repoRoot, "package.json"), "utf8"));
    const packageJson = parseJson<{
      readonly name: string;
      readonly version: string;
      readonly private?: boolean;
      readonly dependencies?: Record<string, string>;
      readonly files: readonly string[];
      readonly publishConfig?: { readonly access?: string; readonly provenance?: boolean };
    }>(await readFile(join(stageDir, "package.json"), "utf8"));

    expect(packageJson.name).toBe("@boreal/cli");
    expect(packageJson.version).toBe(rootPackage.version);
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.files).toEqual(["dist"]);
    expect(packageJson.publishConfig).toEqual(expect.objectContaining({ access: "public", provenance: true }));
    expect((await stat(join(stageDir, "dist", "index.js"))).isFile()).toBe(true);
    expect((await stat(join(stageDir, "dist", "assets", "workflows"))).isDirectory()).toBe(true);

    const packed = await execFileAsync("npm", ["pack", stageDir, "--dry-run", "--json"], {
      cwd: repoRoot,
      env: { ...process.env, npm_config_cache: join(stageDir, "npm-cache") },
      maxBuffer: 10 * 1024 * 1024
    });
    const records = parseJson<readonly Array<{ readonly files: readonly Array<{ readonly path: string }> }>>(String(packed.stdout));
    const files = records[0]?.files.map((file) => file.path).sort() ?? [];
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files.every((file) => file === "package.json" || file === "README.md" || file.startsWith("dist/"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/") || file.includes("node_modules"))).toBe(false);
  }, 30_000);

  it("keeps the Homebrew formula wired to the npm tarball and brew channel wrapper", async () => {
    const rootPackage = parseJson<{ readonly version: string }>(await readFile(join(repoRoot, "package.json"), "utf8"));
    const formula = await readFile(join(repoRoot, "homebrew-tap", "Formula", "boreal-work.rb"), "utf8");

    expect(formula).toContain(`version "${rootPackage.version}"`);
    expect(formula).toContain(`url "https://registry.npmjs.org/@boreal/cli/-/cli-${rootPackage.version}.tgz"`);
    expect(formula).toContain('depends_on "node"');
    expect(formula).toContain("BOREAL_INSTALL_CHANNEL=brew");
  });
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}
