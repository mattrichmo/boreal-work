import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createResultSpoolingOutput, formatRecord, type CliOutput } from "../../apps/cli/src/output.ts";

interface CliEnvelope<T> {
  readonly ok: true;
  readonly data: T;
}

interface VerdictPayload {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly blockingDiagnosticCodes: readonly string[];
  readonly diagnostics: readonly Array<{ readonly code: string; readonly message: string }>;
}

interface TruncatedVerdictPayload {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly blockingDiagnosticCodes: readonly string[];
  readonly truncated: true;
  readonly command: string;
  readonly fullResultPath: string;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI output spooling", () => {
  it.each(["doctor", "gate closeout"] as const)(
    "keeps %s verdict fields at stable paths for inline and truncated results",
    async (command) => {
      const rootDir = await makeTempDir();
      const inline = await spoolVerdict<VerdictPayload>(rootDir, command, 20_000);
      const truncated = await spoolVerdict<TruncatedVerdictPayload>(rootDir, command, 100);

      expect(inline.data.ok).toBe(false);
      expect(inline.data.fixed).toBe(true);
      expect(inline.data.blockingDiagnosticCodes).toEqual(["operation.volume"]);

      expect(truncated.data.ok).toBe(false);
      expect(truncated.data.fixed).toBe(true);
      expect(truncated.data.blockingDiagnosticCodes).toEqual(["operation.volume"]);
      expect(truncated.data.truncated).toBe(true);
      expect(truncated.data.command).toBe(command);

      const fullResult = parseEnvelope<VerdictPayload>(await readFile(join(rootDir, truncated.data.fullResultPath), "utf8"));
      expect(fullResult.data.ok).toBe(inline.data.ok);
      expect(fullResult.data.fixed).toBe(inline.data.fixed);
      expect(fullResult.data.blockingDiagnosticCodes).toEqual(inline.data.blockingDiagnosticCodes);
    }
  );
});

async function spoolVerdict<T extends VerdictPayload | TruncatedVerdictPayload>(
  workspaceRoot: string,
  command: "doctor" | "gate closeout",
  maxResultSizeChars: number
): Promise<CliEnvelope<T>>;
async function spoolVerdict(
  workspaceRoot: string,
  command: "doctor" | "gate closeout",
  maxResultSizeChars: number
): Promise<CliEnvelope<VerdictPayload | TruncatedVerdictPayload>> {
  let stdout = "";
  let stderr = "";
  const output: CliOutput = {
    write(text) {
      stdout += text;
    },
    error(text) {
      stderr += text;
    }
  };
  const spoolingOutput = createResultSpoolingOutput(output, {
    workspaceRoot,
    command,
    maxResultSizeChars
  });

  spoolingOutput.write(formatRecord(verdictPayload(), true));
  await spoolingOutput.flush();

  expect(stderr).toBe("");
  return parseEnvelope<VerdictPayload | TruncatedVerdictPayload>(stdout);
}

function verdictPayload(): VerdictPayload {
  return {
    ok: false,
    fixed: true,
    blockingDiagnosticCodes: ["operation.volume"],
    diagnostics: Array.from({ length: 20 }, (_, index) => ({
      code: index === 0 ? "operation.volume" : `diagnostic.${index}`,
      message: "x".repeat(250)
    }))
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-output-test-"));
  await mkdir(join(dir, ".boreal", "results"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function parseEnvelope<T>(text: string): CliEnvelope<T> {
  return JSON.parse(text) as CliEnvelope<T>;
}
