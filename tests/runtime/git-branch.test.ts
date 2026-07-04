import { describe, expect, it } from "vitest";

import { shortWorkId, slugify, workBranchName } from "../../apps/cli/src/git-branch.ts";

describe("git branch naming", () => {
  it("mints deterministic branch names", () => {
    expect(
      workBranchName({
        kind: "epic",
        title: "Harden Workflow Refs!",
        meta: { id: "bw_work_5e51e2c55b98c622" }
      })
    ).toBe("epic/5b98c622-harden-workflow-refs");
  });

  it("slugify strips unsafe chars and caps length", () => {
    expect(slugify("Ünsafe // Name --- here", 10)).toBe("nsafe-name");
  });

  it("returns the last eight hex characters as the short work id", () => {
    expect(shortWorkId("bw_work_5e51e2c55b98c622")).toBe("5b98c622");
  });

  it("returns the same branch for the same input", () => {
    const work = {
      kind: "task",
      title: "Fix parser",
      meta: { id: "bw_work_1111111122222222" }
    } as const;

    expect(workBranchName(work)).toBe(workBranchName(work));
    expect(workBranchName(work)).toBe("work/22222222-fix-parser");
  });
});
