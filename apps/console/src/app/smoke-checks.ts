import { routeFromPath } from "./routes.js";

export type ConsoleSmokeViewportName = "desktop" | "mobile";

export interface ConsoleSmokeViewport {
  readonly name: ConsoleSmokeViewportName;
  readonly width: number;
  readonly height: number;
}

export interface ConsoleSmokeHtmlInput {
  readonly routePath: string;
  readonly viewport: ConsoleSmokeViewport;
  readonly status: number;
  readonly html: string;
}

export interface ConsoleSmokeRouteResult {
  readonly route: string;
  readonly routeId: string;
  readonly viewport: ConsoleSmokeViewportName;
  readonly width: number;
  readonly height: number;
  readonly status: number;
  readonly bytes: number;
  readonly checks: readonly string[];
}

export const consoleSmokeRoutes = [
  "/",
  "/sprint",
  "/sprint?view=table",
  "/sprint?view=dependency",
  "/sprint?view=timeline",
  "/sprint?view=progress",
  "/knowledge",
  "/repo",
  "/reports",
  "/settings",
  "/work",
  "/health"
] as const;

export const consoleSmokeViewports: readonly ConsoleSmokeViewport[] = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "mobile", width: 390, height: 844 }
] as const;

export function validateConsoleSmokeHtml(input: ConsoleSmokeHtmlInput): ConsoleSmokeRouteResult {
  const route = routeFromPath(input.routePath);
  const checks: string[] = [];

  requireCondition(input.status === 200, `Console route ${input.routePath} returned HTTP ${input.status}`);
  checks.push("http-200");

  requireCondition(input.html.length > 3000, `Console route ${input.routePath} rendered a blank or tiny document`);
  checks.push("nonblank-html");

  requireContains(input.html, "Boreal Console", "console brand");
  requireContains(input.html, `data-console-route="${route.id}"`, "route marker");
  requireContains(input.html, "<meta name=\"viewport\"", "viewport meta");
  requireContains(input.html, "bw-console__sidebar", "sidebar shell");
  requireContains(input.html, "bw-console__topbar", "topbar shell");
  requireContains(input.html, "bw-console__content", "content shell");
  checks.push("shell-markers");

  for (const invalid of ["undefined", "[object Object]", "_owner", "style=\"[object Object]\""]) {
    requireCondition(!input.html.includes(invalid), `Console route ${input.routePath} leaked ${invalid}`);
  }
  checks.push("no-render-leaks");

  requireContains(input.html, "min-width: 0", "layout containment");
  requireContains(input.html, "overflow-wrap: anywhere", "text wrapping guard");
  requireContains(input.html, "flex-wrap: wrap", "wrapping row guard");
  requireContains(input.html, "repeat(auto-fit", "responsive grid guard");
  checks.push("text-overlap-guards");

  if (input.viewport.name === "mobile") {
    requireContains(input.html, "@media (max-width: 860px)", "mobile breakpoint");
    requireContains(input.html, ".bw-console { grid-template-columns: 1fr; }", "mobile single-column shell");
    requireContains(input.html, ".bw-page-grid { grid-template-columns: 1fr; }", "mobile single-column content");
    checks.push("mobile-breakpoint");
  }

  return {
    route: input.routePath,
    routeId: route.id,
    viewport: input.viewport.name,
    width: input.viewport.width,
    height: input.viewport.height,
    status: input.status,
    bytes: Buffer.byteLength(input.html, "utf8"),
    checks
  };
}

function requireContains(value: string, needle: string, label: string): void {
  requireCondition(value.includes(needle), `Console smoke check missing ${label}: ${needle}`);
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
