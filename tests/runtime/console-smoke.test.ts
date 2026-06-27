import { describe, expect, it } from "vitest";

import {
  consoleSmokeRoutes,
  consoleSmokeViewports,
  createFixtureConsoleData,
  renderConsoleHtml,
  validateConsoleSmokeHtml
} from "@boreal/console";

describe("console route smoke checks", () => {
  it("validates nonblank desktop and mobile route shells without layout leak markers", () => {
    const data = createFixtureConsoleData({
      workspaceRoot: "/workspace/boreal-work",
      generatedAt: "2026-06-27T00:00:00.000Z"
    });

    for (const viewport of consoleSmokeViewports) {
      for (const route of consoleSmokeRoutes) {
        const result = validateConsoleSmokeHtml({
          routePath: route,
          viewport,
          status: 200,
          html: renderConsoleHtml({ route, data })
        });

        expect(result.viewport).toBe(viewport.name);
        expect(result.bytes).toBeGreaterThan(3000);
        expect(result.checks).toContain("text-overlap-guards");
        if (viewport.name === "mobile") {
          expect(result.checks).toContain("mobile-breakpoint");
        }
      }
    }
  });
});
