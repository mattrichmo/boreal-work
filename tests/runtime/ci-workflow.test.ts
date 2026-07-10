import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("pull request hardening workflow", () => {
  it("runs runtime and strict-doctor gates before package smoke and publish dry-run", async () => {
    const [workflow, packageJsonText, doctorScript] = await Promise.all([
      readFile(".github/workflows/npm-publish-dry-run.yml", "utf8"),
      readFile("package.json", "utf8"),
      readFile("tools/ci-doctor-strict.mjs", "utf8")
    ]);
    const packageJson = JSON.parse(packageJsonText) as { readonly scripts?: Readonly<Record<string, string>> };
    const orderedSteps = [
      "pnpm check",
      "pnpm test",
      "pnpm ci:doctor:strict",
      "pnpm release:npm:smoke",
      "pnpm release:npm:dry-run"
    ];

    const offsets = orderedSteps.map((step) => workflow.indexOf(`- run: ${step}`));

    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    expect(packageJson.scripts?.["ci:doctor:strict"]).toBe("node tools/ci-doctor-strict.mjs");
    expect(doctorScript).toContain('"doctor", "--strict", "--json"');
    expect(doctorScript).toContain('"sync", "refresh", "--json"');
    expect(doctorScript).not.toContain('"doctor", "--fix"');
  });
});
