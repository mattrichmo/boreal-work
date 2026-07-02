#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repoRoot, "apps", "cli");
const distRoot = join(cliRoot, "dist");
const outFile = join(distRoot, "index.js");
const assetRoot = join(distRoot, "assets");
const validChannels = new Set(["npm", "brew"]);
const installChannel = process.env.BOREAL_INSTALL_CHANNEL && validChannels.has(process.env.BOREAL_INSTALL_CHANNEL)
  ? process.env.BOREAL_INSTALL_CHANNEL
  : "npm";

const rootPackage = await readJson(join(repoRoot, "package.json"));
const cliPackage = await readJson(join(cliRoot, "package.json"));

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
await mkdir(assetRoot, { recursive: true });
for (const directory of ["workflows", "templates", "skills", "schemas"]) {
  await cp(join(repoRoot, directory), join(assetRoot, directory), {
    recursive: true,
    force: true,
    verbatimSymlinks: true
  });
}

console.log(`Built ${outFile}`);
console.log(`Install channel: ${installChannel}`);
console.log(`Runtime assets: ${assetRoot}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function stringField(value, key) {
  const field = value?.[key];
  return typeof field === "string" ? field : "";
}
