import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("boreal JSONL merge driver", () => {
  it("unions non-conflicting ledger appends deterministically", async () => {
    const dir = await makeTempDir();
    const base = join(dir, "base.jsonl");
    const current = join(dir, "current.jsonl");
    const other = join(dir, "other.jsonl");
    const currentSwapped = join(dir, "current-swapped.jsonl");
    const otherSwapped = join(dir, "other-swapped.jsonl");

    await writeFile(base, `${line({ meta: { id: "bw_work_base" }, title: "Base" })}\n`, "utf8");
    await writeFile(
      current,
      `${line({ meta: { id: "bw_work_base" }, title: "Base" })}\n${line({ meta: { id: "bw_work_current" }, title: "Current" })}\n`,
      "utf8"
    );
    await writeFile(
      other,
      `${line({ meta: { id: "bw_work_base" }, title: "Base" })}\n${line({ meta: { id: "bw_work_other" }, title: "Other" })}\n`,
      "utf8"
    );
    await writeFile(currentSwapped, await readFile(other, "utf8"), "utf8");
    await writeFile(otherSwapped, await readFile(current, "utf8"), "utf8");

    await runDriver(base, current, other);
    await runDriver(base, currentSwapped, otherSwapped);

    const merged = await readFile(current, "utf8");
    expect(merged).toBe(
      [
        line({ meta: { id: "bw_work_base" }, title: "Base" }),
        line({ meta: { id: "bw_work_current" }, title: "Current" }),
        line({ meta: { id: "bw_work_other" }, title: "Other" }),
        ""
      ].join("\n")
    );
    expect(await readFile(currentSwapped, "utf8")).toBe(merged);
  });

  it("fails closed when both sides change the same JSONL record differently", async () => {
    const dir = await makeTempDir();
    const base = join(dir, "base.jsonl");
    const current = join(dir, "current.jsonl");
    const other = join(dir, "other.jsonl");

    await writeFile(base, `${line({ id: "raw-1", title: "Base" })}\n`, "utf8");
    await writeFile(current, `${line({ id: "raw-1", title: "Current" })}\n`, "utf8");
    await writeFile(other, `${line({ id: "raw-1", title: "Other" })}\n`, "utf8");

    await expect(runDriver(base, current, other)).rejects.toMatchObject({
      stderr: expect.stringContaining("record id:raw-1 changed differently on both sides")
    });
    expect(await readFile(current, "utf8")).toBe(`${line({ id: "raw-1", title: "Current" })}\n`);
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-jsonl-merge-"));
  tempDirs.push(dir);
  return dir;
}

async function runDriver(base: string, current: string, other: string): Promise<void> {
  await execFileAsync("node", [new URL("../../tools/boreal-jsonl-merge-driver.mjs", import.meta.url).pathname, base, current, other, "records.jsonl"]);
}

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}
