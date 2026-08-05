import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL("../..", import.meta.url));

describe("release boundary audit", () => {
  it("rejects secrets, dependency license drift, and package-boundary leakage", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["tools/audit-release-boundary.mjs", "--json"], {
      cwd: rootDir,
      maxBuffer: 2 * 1024 * 1024
    });
    const result = JSON.parse(stdout) as {
      readonly schemaVersion: string;
      readonly ok: boolean;
      readonly secrets: { readonly findingCount: number };
      readonly dependencies: { readonly scannedPackageCount: number; readonly issueCount: number };
      readonly licenseState: { readonly classification: string; readonly changedByAudit: boolean };
      readonly repositoryBoundary: {
        readonly blockedTrackedFileCount: number;
        readonly packageBoundaryOk: boolean;
        readonly publicRepositoryRequiresTrackerSanitization: boolean;
      };
    };

    expect(result.schemaVersion).toBe("boreal.release-boundary-audit.v1");
    expect(result.ok).toBe(true);
    expect(result.secrets.findingCount).toBe(0);
    expect(result.dependencies.scannedPackageCount).toBeGreaterThan(0);
    expect(result.dependencies.issueCount).toBe(0);
    expect(result.licenseState).toMatchObject({ classification: "private-unlicensed", changedByAudit: false });
    expect(result.repositoryBoundary).toMatchObject({
      blockedTrackedFileCount: 0,
      packageBoundaryOk: true,
      publicRepositoryRequiresTrackerSanitization: true
    });
  });
});
