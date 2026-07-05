#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repoRoot, "apps", "cli");
const distRoot = join(cliRoot, "dist");
const outFile = join(distRoot, "index.js");
const tuiOutFile = join(distRoot, "tui", "index.js");
const assetRoot = join(distRoot, "assets");
const lockDir = join(cliRoot, ".dist-build.lock");
const lockTimeoutMs = 120_000;
const staleLockMs = 300_000;
const distSnapshotRoot = process.env.BOREAL_BUILD_DIST_SNAPSHOT_DIR
  ? resolve(process.env.BOREAL_BUILD_DIST_SNAPSHOT_DIR)
  : undefined;
const validChannels = new Set(["npm", "brew"]);
const installChannel = process.env.BOREAL_INSTALL_CHANNEL && validChannels.has(process.env.BOREAL_INSTALL_CHANNEL)
  ? process.env.BOREAL_INSTALL_CHANNEL
  : "npm";

const rootPackage = await readJson(join(repoRoot, "package.json"));
const cliPackage = await readJson(join(cliRoot, "package.json"));

await withBuildLock(async () => {
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });

  await build({
    entryPoints: [join(cliRoot, "src", "index.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfig: join(repoRoot, "tsconfig.base.json"),
    sourcemap: true,
    define: {
      BOREAL_BUNDLED_CLI: "true",
      BOREAL_BUILD_INSTALL_CHANNEL: JSON.stringify(installChannel),
      BOREAL_BUILD_PACKAGE_NAME: JSON.stringify(stringField(rootPackage, "name")),
      BOREAL_BUILD_PACKAGE_VERSION: JSON.stringify(stringField(rootPackage, "version")),
      BOREAL_BUILD_PACKAGE_MANAGER: JSON.stringify(stringField(rootPackage, "packageManager")),
      BOREAL_BUILD_CLI_PACKAGE_NAME: JSON.stringify(stringField(cliPackage, "name")),
      BOREAL_BUILD_CLI_PACKAGE_VERSION: JSON.stringify(stringField(cliPackage, "version"))
    },
    logLevel: "info"
  });

  await chmod(outFile, 0o755);

  // Bundle the terminal dashboard (apps/tui, Ink + React) alongside the CLI
  // so `bwrk dashboard` works from a standalone install with no source
  // checkout (bw_work_67f67c5afd2decc5). yoga-layout ships its WASM as
  // base64-inlined JS, so the whole app bundles to one self-contained file.
  // spawnAppProcess (apps/cli/src/commands/dashboard.ts) looks for this
  // sibling `tui/index.js` next to the CLI entry before falling back to the
  // in-repo apps/tui layout.
  await build({
    entryPoints: [join(repoRoot, "apps", "tui", "src", "index.tsx")],
    outfile: tuiOutFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    jsx: "automatic",
    tsconfig: join(repoRoot, "tsconfig.base.json"),
    sourcemap: true,
    // Ink's devtools shim imports react-devtools-core only when DEV=true,
    // but bundling hoists it into the static import graph -- alias it to an
    // empty stub so the standalone bundle loads without the optional peer.
    alias: { "react-devtools-core": join(repoRoot, "tools", "empty-module.mjs") },
    // CJS deps in Ink's graph (signal-exit et al) require() node builtins at
    // runtime; esbuild's ESM output shims dynamic require with a throw unless
    // a real require is in scope.
    banner: { js: 'import { createRequire as __bwrkCreateRequire } from "node:module"; const require = __bwrkCreateRequire(import.meta.url);' },
    logLevel: "info"
  });
  await chmod(tuiOutFile, 0o755);

  await mkdir(assetRoot, { recursive: true });
  for (const directory of ["workflows", "templates", "skills", "schemas"]) {
    await cp(join(repoRoot, directory), join(assetRoot, directory), {
      recursive: true,
      force: true,
      verbatimSymlinks: true
    });
  }

  if (distSnapshotRoot && distSnapshotRoot !== distRoot) {
    await rm(distSnapshotRoot, { recursive: true, force: true });
    await mkdir(dirname(distSnapshotRoot), { recursive: true });
    await cp(distRoot, distSnapshotRoot, {
      recursive: true,
      force: true,
      verbatimSymlinks: true
    });
  }
});

console.log(`Built ${outFile}`);
console.log(`Built ${tuiOutFile}`);
console.log(`Install channel: ${installChannel}`);
console.log(`Runtime assets: ${assetRoot}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function stringField(value, key) {
  const field = value?.[key];
  return typeof field === "string" ? field : "";
}

async function withBuildLock(action) {
  await acquireBuildLock();
  try {
    await action();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function acquireBuildLock() {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir);
      await writeFile(
        join(lockDir, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8"
      );
      return;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
      if (await removeStaleBuildLock()) {
        continue;
      }
      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`Timed out waiting for CLI dist build lock at ${lockDir}`);
      }
      await sleep(100);
    }
  }
}

async function removeStaleBuildLock() {
  try {
    const lockStat = await stat(lockDir);
    if (Date.now() - lockStat.mtimeMs < staleLockMs) {
      return false;
    }
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
