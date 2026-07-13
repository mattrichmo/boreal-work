import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const rootDir = new URL("../..", import.meta.url).pathname;

describe("technical portability CI contract", () => {
  it("covers supported operating systems, Node lines, migrations, packaging, and install smoke without publishing", async () => {
    const workflow = await readFile(`${rootDir}/.github/workflows/technical-portability.yml`, "utf8");
    const smoke = await readFile(`${rootDir}/tools/smoke-npm-package.mjs`, "utf8");

    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain('- "22"');
    expect(workflow).toContain('- "24"');
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("tests/runtime/storage-migrate.test.ts");
    expect(workflow).toContain("tests/runtime/package-smoke.test.ts");
    expect(workflow).toContain("tests/runtime/release-boundary-audit.test.ts");
    expect(workflow).toContain("tests/runtime/process-runner.test.ts");
    expect(workflow).toContain("node tools/smoke-npm-package.mjs --json");
    expect(workflow).not.toContain("npm publish");
    expect(workflow).not.toContain("release:npm:dry-run");
    expect(smoke).toContain('process.platform === "win32"');
    expect(smoke).toContain('process.env.ComSpec ?? "cmd.exe"');
    expect(smoke).toContain('command.toLowerCase().endsWith(".exe")');
  });
});
