import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { BorealError } from "@boreal/core";
import { flagValue, hasFlag, type ParsedArgs } from "../args.js";
import type { BinaryIdentity } from "../install-status.js";
import { getVersionInfo } from "../version.js";
import type { UpdateSelfResult } from "./update.js";
import { installVerifiedBundle } from "./update-install.js";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO = "https://github.com/mattrichmo/boreal-work.git";
const ARCHIVE = "bwrk-upgrade.tar.gz";
type Probe = (path: string, cwd?: string, javascript?: boolean) => Promise<BinaryIdentity>;

export interface ReleaseManifest {
  readonly schemaVersion: "boreal.upgrade.release.v1";
  readonly buildSha: string;
  readonly artifactDigest: string;
  readonly version: string;
  readonly archive: typeof ARCHIVE;
  readonly sha256: string;
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  const data = value as Partial<ReleaseManifest> | null;
  if (!data || data.schemaVersion !== "boreal.upgrade.release.v1" || data.archive !== ARCHIVE ||
      typeof data.version !== "string" || !data.version ||
      typeof data.buildSha !== "string" || !/^[a-f0-9]{40,64}$/.test(data.buildSha) ||
      typeof data.artifactDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(data.artifactDigest) ||
      typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "The Boreal release manifest is invalid; the installed version was not changed.");
  }
  return data as ReleaseManifest;
}

/** Only the canonical dist tree and installer may occur in a release archive. */
export function validateReleaseEntries(names: string, details: string): void {
  const entries = names.trim().split("\n");
  if (!entries.length || entries.some((name) => {
    const path = name.replace(/^\.\//, "").replace(/\/$/, "");
    return !path || path.split("/").some((part) => part === ".." || part === "." || !part) ||
      path.includes("\\") || !(/^(apps|apps\/cli|apps\/cli\/dist|install\.sh)$/.test(path) || path.startsWith("apps/cli/dist/"));
  }) || details.trim().split("\n").some((line) => !/^[d-]/.test(line))) {
    throw new BorealError("BOREAL_INVALID_INPUT", "The Boreal release archive contains unsafe entries; the installed version was not changed.");
  }
  if (!entries.some((name) => name.replace(/^\.\//, "") === "apps/cli/dist/index.js")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "The Boreal release archive is missing its CLI bundle.");
  }
}

async function download(url: string, maxBytes: number, timeout = 30_000): Promise<Buffer> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "User-Agent": "bwrk-upgrade", Accept: url.startsWith("https://api.github.com/") ? "application/vnd.github+json" : "application/octet-stream" } });
    if (!response.ok || !response.body) {
      throw new Error(response.status === 404
        ? "No ready-to-run Boreal release is published for this version yet. The installed version was not changed."
        : `Release download returned HTTP ${response.status}. Retry bwrk upgrade when the connection is available.`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error("Release download exceeds the supported size limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    throw new BorealError("BOREAL_STORAGE_ERROR", error instanceof Error ? error.message : "Could not download the Boreal release.");
  }
}

export async function updateFromRelease(args: ParsedArgs, probe: Probe, progress: (line: string) => void): Promise<UpdateSelfResult> {
  const repoUrl = flagValue(args, "repo-url") ?? process.env.BOREAL_UPDATE_REPO_URL ?? DEFAULT_REPO;
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repoUrl);
  if (!match) throw new BorealError("BOREAL_INVALID_INPUT", "Release updates require an HTTPS GitHub repository URL. Use --source for an explicit development source build.");
  const repository = `${match[1]}/${match[2]}`;
  const requestedRef = flagValue(args, "ref");
  const dryRun = hasFlag(args, "dry-run");
  const transactionId = randomUUID();
  const binDir = resolve(flagValue(args, "bin-dir") ?? process.env.BOREAL_INSTALL_BIN_DIR ?? join(homedir(), ".local", "bin"));
  const libDir = resolve(flagValue(args, "lib-dir") ?? process.env.BOREAL_INSTALL_LIB_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "boreal", "bwrk"));
  const binPath = join(binDir, "bwrk");
  const previous = await probe(binPath).catch(() => undefined);
  progress("Checking for the latest Boreal release ...");
  const endpoint = requestedRef ? `tags/${encodeURIComponent(requestedRef)}` : "latest";
  const release = JSON.parse((await download(`https://api.github.com/repos/${repository}/releases/${endpoint}`, 1_000_000)).toString()) as {
    tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: { name: string; browser_download_url: string }[];
  };
  if (!release.tag_name || release.draft || (!requestedRef && release.prerelease) || !Array.isArray(release.assets)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "GitHub did not return a published Boreal release.");
  }
  const ref = release.tag_name;
  const assetUrl = (name: string): string => {
    const asset = release.assets?.find((item) => item.name === name);
    const expected = `https://github.com/${repository}/releases/download/${encodeURIComponent(ref)}/${name}`;
    if (!asset || asset.browser_download_url !== expected) throw new BorealError("BOREAL_INVALID_INPUT", `Boreal release ${ref} is missing a valid ${name} asset. The installed version was not changed.`);
    return expected;
  };
  const manifest = parseReleaseManifest(JSON.parse((await download(assetUrl("bwrk-release.json"), 65_536)).toString()));
  const current = previous?.build?.artifactDigest === manifest.artifactDigest && previous.build.buildSha === manifest.buildSha;
  const base: UpdateSelfResult = {
    updated: false, dryRun, transactionId, repoUrl, ref,
    previousVersion: previous?.version ?? getVersionInfo().version,
    installedVersion: previous?.version, binPath, installedIdentity: previous,
    verification: { staged: false, installed: Boolean(previous) },
    rollback: { available: false, performed: false }, steps: []
  };
  if (current || dryRun) return { ...base, ...(dryRun && !current ? { installedVersion: undefined } : {}) };
  const stageDir = await mkdtemp(join(tmpdir(), "bwrk-release-"));
  try {
    progress("Downloading Boreal ...");
    const bytes = await download(assetUrl(ARCHIVE), 128 * 1024 * 1024, 120_000);
    if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Boreal release checksum verification failed. The installed version was not changed.");
    }
    const archive = join(stageDir, ARCHIVE);
    await writeFile(archive, bytes);
    const options = { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 };
    const [names, details] = await Promise.all([
      execFileAsync("tar", ["-tzf", archive], options),
      execFileAsync("tar", ["-tvzf", archive], options)
    ]);
    validateReleaseEntries(names.stdout, details.stdout);
    const extracted = join(stageDir, "extracted");
    await mkdir(extracted);
    await execFileAsync("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner", "--no-same-permissions"], options);
    const distDir = join(extracted, "apps", "cli", "dist");
    const stagedIdentity = await probe(join(distDir, "index.js"), extracted, true);
    if (stagedIdentity.version !== manifest.version || stagedIdentity.build?.artifactDigest !== manifest.artifactDigest || stagedIdentity.build.buildSha !== manifest.buildSha) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Boreal release identity does not match its manifest. The installed version was not changed.");
    }
    progress("Installing Boreal ...");
    const installedIdentity = await installVerifiedBundle({
      distDir, binDir, libDir, transactionId, identity: stagedIdentity,
      source: { repoUrl, ref }, verify: (path) => probe(path)
    });
    return { ...base, updated: true, installedVersion: installedIdentity.version, stagedIdentity, installedIdentity,
      verification: { staged: true, installed: true }, rollback: { available: true, performed: false } };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
