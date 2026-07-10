import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), "boreal-ci-doctor-")));
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
const cliArgs = ["--tsconfig", join(repoRoot, "tsconfig.base.json"), join(repoRoot, "apps", "cli", "src", "index.ts")];

try {
  await runCli([
    "--workspace",
    fixtureRoot,
    "init",
    "--setup-memory",
    "--memory-root",
    "memory",
    "--json"
  ]);
  await runCli(["--workspace", fixtureRoot, "sync", "refresh", "--json"]);
  const doctor = parseEnvelope(await runCli(["--workspace", fixtureRoot, "doctor", "--strict", "--json"]));
  if (doctor.ok !== true || doctor.data?.ok !== true || doctor.data.strict !== true) {
    throw new Error(`Strict doctor fixture returned an unhealthy payload: ${JSON.stringify(doctor)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, fixture: "temporary", strict: true, fixed: false })}\n`);
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [...cliArgs, ...args], {
      cwd: repoRoot,
      env: { ...process.env, BOREAL_SESSION_ID: "ci-doctor-strict" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`Boreal fixture command failed (${code ?? "signal"})\n${stdout}\n${stderr}`));
    });
  });
}

function parseEnvelope(output) {
  const parsed = JSON.parse(output);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Strict doctor fixture did not return a JSON object");
  }
  return parsed;
}
