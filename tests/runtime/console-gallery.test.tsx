import { describe, expect, it } from "vitest";

import {
  consoleGalleryCopyAudit,
  consoleGalleryFamilies,
  renderConsoleGalleryHtml
} from "@boreal/console";

describe("console gallery fixture", () => {
  it("renders a nonblank desktop and mobile gallery for each component family", () => {
    for (const viewport of ["desktop", "mobile"] as const) {
      const html = renderConsoleGalleryHtml({ viewport, includeDocument: true });

      expect(html.length).toBeGreaterThan(8000);
      expect(html).toContain(`data-gallery-viewport="${viewport}"`);
      for (const family of consoleGalleryFamilies) {
        expect(html).toContain(`data-gallery-family="${family}"`);
      }
      expect(html).toContain("Populated directive states");
      expect(html).toContain("Empty directive state");
      expect(html).toContain("Directive conflicts");
      expect(html).toContain("Directive acknowledgements");
      expect(html).toContain("Missing required directive data");
      expect(html).toContain("blocking directives");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("[object Object]");
    }
  });

  it("keeps gallery copy operational and aligned with CLI commands", () => {
    const html = renderConsoleGalleryHtml({ includeDocument: true }).toLowerCase();

    for (const banned of consoleGalleryCopyAudit.bannedMarketingWords) {
      expect(html).not.toContain(banned);
    }
    for (const command of consoleGalleryCopyAudit.requiredCommandLabels) {
      expect(html).toContain(command);
    }
  });
});
