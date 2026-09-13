import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { packageUpgradeRelease } from "../../tools/package-upgrade-release.mjs";

const execFileAsync = promisify(execFile);

describe("upgrade release packager", () => {
  it("writes the archive, checksum, and release manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "bwrk-package-test-"));
    const dist = join(root, "dist");
    const output = join(root, "out");
    await cp("apps/cli/dist", dist, { recursive: true });

    const result = await packageUpgradeRelease({ dist, out: output });
    const archive = await readFile(result.archivePath);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as Record<string, string>;

    expect(createHash("sha256").update(archive).digest("hex")).toBe(result.sha256);
    expect(await readFile(result.checksumPath, "utf8")).toBe(`${result.sha256}  bwrk-upgrade.tar.gz\n`);
    expect(manifest).toMatchObject({
      schemaVersion: "boreal.upgrade.release.v1",
      buildSha: result.buildSha,
      artifactDigest: result.artifactDigest,
      archive: "bwrk-upgrade.tar.gz",
      sha256: result.sha256,
      version: "0.1.0"
    });
    const listing = String((await execFileAsync("tar", ["-tzf", result.archivePath])).stdout);
    expect(listing).toContain("apps/cli/dist/index.js");
    expect(listing).toContain("install.sh");
  }, 30_000);

  it("rejects symlinks in the bundled dist", async () => {
    const root = await mkdtemp(join(tmpdir(), "bwrk-package-test-"));
    const dist = join(root, "dist");
    await cp("apps/cli/dist", dist, { recursive: true });
    await symlink("index.js", join(dist, "unsafe-link.js"));

    await expect(packageUpgradeRelease({ dist, out: join(root, "out") })).rejects.toThrow("symlink is not allowed");
    expect(await readlink(join(dist, "unsafe-link.js"))).toBe("index.js");
  }, 30_000);
});
