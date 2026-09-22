# R-TUI-LAYOUT — apps/tui/src/ui/layout.ts

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/src/ui/layout.ts:L1–L50`  
**File SHA-256:** `2492abfc8783a6fbf9cf199082181dff61e668e3ea1b2a3330a025cd6b5b17c2`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing width/height breakpoints and adaptive layout; retain usable short editor terminals.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,50p' 'apps/tui/src/ui/layout.ts'
```

## Exact baseline excerpt

````text
    1 | /** Geometry, not minimum-size gates. Width and height are independent constraints. */
    2 | import type { Rect } from "./screen.js";
    3 | export type Density = "auto" | "comfortable" | "compact";
    4 | export type Chrome = "comfortable" | "standard" | "compact" | "micro";
    5 | export interface Viewport { width: number; height: number; }
    6 | const positive = (n: unknown): number | undefined => typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
    7 | /** A zero/NaN resize must not erase the last valid geometry. Live PTY data wins over env. */
    8 | export function resolveViewport(live: Partial<Viewport> = {}, previous?: Viewport, env: Record<string, string | undefined> = {}): Viewport {
    9 |     return {
   10 |         width: Math.min(500, positive(live.width) ?? positive(previous?.width) ?? positive(Number(env.COLUMNS)) ?? 80),
   11 |         height: Math.min(200, positive(live.height) ?? positive(previous?.height) ?? positive(Number(env.LINES)) ?? 24),
   12 |     };
   13 | }
   14 | export function chromeFor(width: number, height: number, density: Density = "auto"): Chrome {
   15 |     if (height < 10 || width < 36) return "micro";
   16 |     if (height < 22 || width < 60 || density === "compact") return "compact";
   17 |     if (height >= (density === "comfortable" ? 26 : 32) && width >= 80) return "comfortable";
   18 |     return "standard";
   19 | }
   20 | export const cycleDensity = (density: Density): Density => density === "auto" ? "compact" : density === "compact" ? "comfortable" : "auto";
   21 | export interface PaneViewport { x: number; y: number; width: number; height: number; boxed: boolean; }
   22 | /** Every pane keeps >=1 content row. Decorations are the first thing removed. */
   23 | export function paneViewport(r: Rect, chrome: Chrome): PaneViewport {
   24 |     const boxed = (chrome === "comfortable" || chrome === "standard") && r.height >= 7 && r.width >= 24;
   25 |     return { x: r.x + (boxed ? 2 : 0), y: r.y + (boxed ? 2 : r.height > 1 ? 1 : 0),
   26 |         width: Math.max(1, r.width - (boxed ? 4 : 0)), height: Math.max(1, r.height - (boxed ? 3 : r.height > 1 ? 1 : 0)), boxed };
   27 | }
   28 | export interface DialogViewport {
   29 |     rect: Rect; body: Rect; footerY: number; titleY: number; boxed: boolean;
   30 | }
   31 | /** Small dialogs become full-view sheets; no centering gutters consume scarce rows. */
   32 | export function dialogViewport(width: number, height: number, desiredHeight = 26): DialogViewport {
   33 |     const boxed = width >= 84 && height >= 24;
   34 |     const w = boxed ? Math.min(88, width - 6) : width;
   35 |     const h = boxed ? Math.min(desiredHeight, height - 4) : height;
   36 |     const rect = { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
   37 |     const pad = boxed ? 2 : width >= 40 ? 1 : 0;
   38 |     const header = h >= 3 ? 1 : 0, footer = h >= 2 ? 1 : 0;
   39 |     return { rect, boxed, titleY: rect.y, footerY: rect.y + h - (boxed ? 2 : 1),
   40 |         body: { x: rect.x + pad, y: rect.y + header, width: Math.max(1, w - pad * 2), height: Math.max(1, h - header - footer - (boxed ? 1 : 0)) } };
   41 | }
   42 | /** Choose the richest hint string that fits; don't clip away the only exit key. */
   43 | export function adaptiveHint(width: number, ...variants: string[]): string {
   44 |     // Variants here use one-cell UI glyphs only; service strings are measured elsewhere.
   45 |     return variants.find(v => Array.from(v).length <= width) ?? variants.at(-1) ?? "";
   46 | }
   47 | export function windowStart(index: number, total: number, capacity: number): number {
   48 |     capacity = Math.max(1, capacity);
   49 |     return Math.min(Math.max(0, index - Math.floor(capacity / 2)), Math.max(0, total - capacity));
   50 | }
````
