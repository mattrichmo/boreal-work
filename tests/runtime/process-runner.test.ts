import { describe, expect, it } from "vitest";

import { BorealError, runBoundedProcess } from "@boreal/core";

describe("bounded process runner", () => {
  it("captures bounded non-json output with hashes", async () => {
    const result = await runBoundedProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('plain output')"],
      timeoutMs: 1_000,
      stdoutMaxBytes: 128,
      stderrMaxBytes: 128
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.text).toBe("plain output");
    expect(result.stdout.bytes).toBe(Buffer.byteLength("plain output"));
    expect(result.stdout.sha256).toMatch(/^sha256:/u);
    expect(result.stderr.text).toBe("");
  });

  it("times out and kills long-running processes", async () => {
    await expect(
      runBoundedProcess({
        command: process.execPath,
        args: ["-e", "setTimeout(() => undefined, 10_000)"],
        timeoutMs: 25,
        stdoutMaxBytes: 128,
        stderrMaxBytes: 128
      })
    ).rejects.toMatchObject({
      code: "BOREAL_COMMAND_TIMEOUT"
    } satisfies Partial<BorealError>);
  });

  it("fails with structured stdout and stderr cap errors", async () => {
    await expect(
      runBoundedProcess({
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(1024))"],
        timeoutMs: 1_000,
        stdoutMaxBytes: 16,
        stderrMaxBytes: 128
      })
    ).rejects.toMatchObject({
      code: "BOREAL_COMMAND_OUTPUT_LIMIT",
      details: { stream: "stdout", maxBytes: 16 }
    } satisfies Partial<BorealError>);

    await expect(
      runBoundedProcess({
        command: process.execPath,
        args: ["-e", "process.stderr.write('x'.repeat(1024))"],
        timeoutMs: 1_000,
        stdoutMaxBytes: 128,
        stderrMaxBytes: 16
      })
    ).rejects.toMatchObject({
      code: "BOREAL_COMMAND_OUTPUT_LIMIT",
      details: { stream: "stderr", maxBytes: 16 }
    } satisfies Partial<BorealError>);
  });
});
