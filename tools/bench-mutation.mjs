import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const count = Number(process.argv[2] ?? 200);
const ws = mkdtempSync(join(tmpdir(), "boreal-bench-"));
const corepackHome = join(tmpdir(), "boreal-corepack-cache");

const bwrk = (args) =>
  execFileSync("pnpm", ["--silent", "bwrk", ...args, "--workspace", ws, "--json"], {
    encoding: "utf8",
    env: { ...process.env, COREPACK_HOME: process.env.COREPACK_HOME ?? corepackHome },
    stdio: ["ignore", "pipe", "pipe"]
  });

const parseJson = (text) => JSON.parse(text);

const workIdFrom = (payload) => {
  const id =
    payload?.data?.meta?.id ??
    payload?.result?.meta?.id ??
    payload?.meta?.id ??
    payload?.workId ??
    payload?.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Unable to read work id from output: ${JSON.stringify(payload)}`);
  }
  return id;
};

const filesSnapshot = (root) => {
  const files = new Map();
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = statSync(path);
      files.set(relative(root, path), { mtimeMs: stat.mtimeMs, size: stat.size });
    }
  };
  visit(root);
  return files;
};

const changedFiles = (before, after) =>
  [...after.entries()]
    .filter(([path, stat]) => {
      const previous = before.get(path);
      return !previous || previous.mtimeMs !== stat.mtimeMs || previous.size !== stat.size;
    })
    .map(([path]) => path)
    .sort();

const bytesUnder = (files, prefix) =>
  [...files.entries()]
    .filter(([path]) => path === prefix || path.startsWith(`${prefix}/`))
    .reduce((total, [, stat]) => total + stat.size, 0);

bwrk(["init"]);
const ids = [];
for (let i = 0; i < count; i += 1) {
  const out = parseJson(bwrk(["work", "create", `bench item ${i}`, "--kind", "task", "--ready"]));
  ids.push(workIdFrom(out));
}

for (let i = 1; i < Math.floor(count / 2); i += 1) {
  bwrk(["work", "block", ids[i], ids[i - 1]]);
}

const target = ids[0];
bwrk(["agent", "start", target, "--agent", "bench-agent"]);

const borealDir = join(ws, ".boreal");
const beforeFiles = filesSnapshot(borealDir);
const t0 = performance.now();
bwrk([
  "agent",
  "finish",
  target,
  "--agent",
  "bench-agent",
  "--summary",
  "bench close",
  "--kind",
  "command",
  "--outcome",
  "passed",
  "--command",
  "bench mutation",
  "--verdict",
  "passed",
  "--notes",
  "bench evidence",
  "--close",
  "--reason",
  "bench",
  "--dirty-path",
  "no_repo_changes: benchmark fixture"
]);
const closeMs = performance.now() - t0;
const afterFiles = filesSnapshot(borealDir);
const writtenFiles = changedFiles(beforeFiles, afterFiles);

const stateFile = join(ws, ".boreal", "runtime", "state.json");
const stateBytes = existsSync(stateFile) ? statSync(stateFile).size : 0;
const objectBytes = bytesUnder(afterFiles, "objects");
const logBytes = bytesUnder(afterFiles, "log");
const runtimeDir = join(ws, ".boreal", "runtime");
console.log(
  JSON.stringify(
    {
      workspace: ws,
      count,
      closeMs: Math.round(closeMs),
      stateBytes,
      objectBytes,
      logBytes,
      filesWritten: writtenFiles.length,
      writtenFiles,
      runtimeFiles: existsSync(runtimeDir) ? readdirSync(runtimeDir).sort() : []
    },
    null,
    2
  )
);
