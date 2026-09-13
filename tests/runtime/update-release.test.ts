import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReleaseManifest, updateFromRelease, validateReleaseEntries } from "../../apps/cli/src/commands/update-release.js";
import { installVerifiedBundle } from "../../apps/cli/src/commands/update-install.js";
import type { BinaryIdentity } from "../../apps/cli/src/install-status.js";

vi.mock("../../apps/cli/src/commands/update-install.js", () => ({ installVerifiedBundle: vi.fn() }));
const buildSha = "a".repeat(40);
const artifactDigest = `sha256:${"b".repeat(64)}`;
const manifest = { schemaVersion: "boreal.upgrade.release.v1", buildSha, artifactDigest, version: "0.1.0", archive: "bwrk-upgrade.tar.gz", sha256: "c".repeat(64) };
const identity = { name: "bwrk", version: "0.1.0", installChannel: "npm", build: { buildSha, artifactDigest } } as BinaryIdentity;
const base = "https://github.com/mattrichmo/boreal-work/releases/download/upgrade-test/";
const api = { tag_name: "upgrade-test", assets: ["bwrk-release.json", "bwrk-upgrade.tar.gz"].map((name) => ({ name, browser_download_url: base + name })) };
const args = (flags: string[] = []) => ({ command: ["update", "self"], flags: new Map(flags.map((flag) => [flag, ["true"]])) });
let stage: string | undefined;
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); if (stage) await rm(stage, { recursive: true, force: true }); stage = undefined; });

function mockDownloads(releaseManifest = manifest, archive?: Buffer) {
  vi.stubEnv("BOREAL_UPDATE_REPO_URL", "https://github.com/mattrichmo/boreal-work.git");
  const request = vi.fn(async (url: string) => {
    if (url.includes("api.github.com")) return Response.json(api);
    if (url.endsWith("bwrk-release.json")) return Response.json(releaseManifest);
    if (archive && url.endsWith("tar.gz")) return new Response(new Uint8Array(archive));
    throw new Error(`Unexpected download: ${url}`);
  });
  vi.stubGlobal("fetch", request);
  return request;
}

describe("ready-to-run Boreal updates", () => {
  it("skips bundle download and install when the exact build is current", async () => {
    const request = mockDownloads();
    const result = await updateFromRelease(args(), vi.fn().mockResolvedValue(identity), vi.fn());
    expect(result.updated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(installVerifiedBundle).not.toHaveBeenCalled();
  });

  it("dry-run checks metadata only even when no installation exists", async () => {
    const request = mockDownloads();
    const result = await updateFromRelease(args(["dry-run"]), vi.fn().mockRejectedValue(new Error("not installed")), vi.fn());
    expect(result.dryRun).toBe(true);
    expect(result.updated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(installVerifiedBundle).not.toHaveBeenCalled();
  });

  it("reports unavailable releases without falling back to a source build", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(updateFromRelease(args(), vi.fn().mockRejectedValue(new Error("missing")), vi.fn())).rejects.toThrow("No ready-to-run Boreal release");
    expect(installVerifiedBundle).not.toHaveBeenCalled();
  });

  it("rejects a checksum mismatch before extracting or installing", async () => {
    mockDownloads(manifest, Buffer.from("not an archive"));
    await expect(updateFromRelease(args(), vi.fn().mockRejectedValue(new Error("missing")), vi.fn())).rejects.toThrow("checksum verification failed");
    expect(installVerifiedBundle).not.toHaveBeenCalled();
  });

  it("downloads and verifies a complete bundle without git, pnpm, or install.sh execution", async () => {
    stage = await mkdtemp(join(tmpdir(), "bwrk-release-test-"));
    const dist = join(stage, "apps", "cli", "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "index.js"), "// test bundle\n");
    const archivePath = join(stage, "bundle.tar.gz");
    execFileSync("tar", ["-czf", archivePath, "-C", stage, "apps/cli/dist"]);
    const archive = await readFile(archivePath);
    mockDownloads({ ...manifest, sha256: createHash("sha256").update(archive).digest("hex") }, archive);
    const probe = vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValue(identity);
    vi.mocked(installVerifiedBundle).mockResolvedValue(identity);
    const result = await updateFromRelease(args(), probe, vi.fn());
    expect(result.updated).toBe(true);
    expect(result.verification).toEqual({ staged: true, installed: true });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(installVerifiedBundle).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed manifests and unsafe archive members", () => {
    expect(() => parseReleaseManifest({ ...manifest, sha256: "oops" })).toThrow("manifest is invalid");
    for (const names of ["../../outside", "/etc/passwd", "apps/cli/dist/../../outside"]) {
      expect(() => validateReleaseEntries(names, "-rw-r--r-- file")).toThrow("unsafe entries");
    }
    expect(() => validateReleaseEntries("apps/cli/dist/index.js", "lrwxrwxrwx symlink")).toThrow("unsafe entries");
    expect(() => validateReleaseEntries("apps/cli/dist/index.js", "hrw-r--r-- hardlink")).toThrow("unsafe entries");
  });
});
