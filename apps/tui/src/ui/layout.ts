/** Geometry, not minimum-size gates. Width and height are independent constraints. */
import type { Rect } from "./screen.js";
export type Density = "auto" | "comfortable" | "compact";
export type Chrome = "comfortable" | "standard" | "compact" | "micro";
export interface Viewport { width: number; height: number; }
const positive = (n: unknown): number | undefined => typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
/** A zero/NaN resize must not erase the last valid geometry. Live PTY data wins over env. */
export function resolveViewport(live: Partial<Viewport> = {}, previous?: Viewport, env: Record<string, string | undefined> = {}): Viewport {
    return {
        width: Math.min(500, positive(live.width) ?? positive(previous?.width) ?? positive(Number(env.COLUMNS)) ?? 80),
        height: Math.min(200, positive(live.height) ?? positive(previous?.height) ?? positive(Number(env.LINES)) ?? 24),
    };
}
export function chromeFor(width: number, height: number, density: Density = "auto"): Chrome {
    if (height < 10 || width < 36) return "micro";
    if (height < 22 || width < 60 || density === "compact") return "compact";
    if (height >= (density === "comfortable" ? 26 : 32) && width >= 80) return "comfortable";
    return "standard";
}
export const cycleDensity = (density: Density): Density => density === "auto" ? "compact" : density === "compact" ? "comfortable" : "auto";
export interface PaneViewport { x: number; y: number; width: number; height: number; boxed: boolean; }
/** Every pane keeps >=1 content row. Decorations are the first thing removed. */
export function paneViewport(r: Rect, chrome: Chrome): PaneViewport {
    const boxed = (chrome === "comfortable" || chrome === "standard") && r.height >= 7 && r.width >= 24;
    return { x: r.x + (boxed ? 2 : 0), y: r.y + (boxed ? 2 : r.height > 1 ? 1 : 0),
        width: Math.max(1, r.width - (boxed ? 4 : 0)), height: Math.max(1, r.height - (boxed ? 3 : r.height > 1 ? 1 : 0)), boxed };
}
export interface DialogViewport {
    rect: Rect; body: Rect; footerY: number; titleY: number; boxed: boolean;
}
/** Small dialogs become full-view sheets; no centering gutters consume scarce rows. */
export function dialogViewport(width: number, height: number, desiredHeight = 26): DialogViewport {
    const boxed = width >= 84 && height >= 24;
    const w = boxed ? Math.min(88, width - 6) : width;
    const h = boxed ? Math.min(desiredHeight, height - 4) : height;
    const rect = { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
    const pad = boxed ? 2 : width >= 40 ? 1 : 0;
    const header = h >= 3 ? 1 : 0, footer = h >= 2 ? 1 : 0;
    return { rect, boxed, titleY: rect.y, footerY: rect.y + h - (boxed ? 2 : 1),
        body: { x: rect.x + pad, y: rect.y + header, width: Math.max(1, w - pad * 2), height: Math.max(1, h - header - footer - (boxed ? 1 : 0)) } };
}
/** Choose the richest hint string that fits; don't clip away the only exit key. */
export function adaptiveHint(width: number, ...variants: string[]): string {
    // Variants here use one-cell UI glyphs only; service strings are measured elsewhere.
    return variants.find(v => Array.from(v).length <= width) ?? variants.at(-1) ?? "";
}
export function windowStart(index: number, total: number, capacity: number): number {
    capacity = Math.max(1, capacity);
    return Math.min(Math.max(0, index - Math.floor(capacity / 2)), Math.max(0, total - capacity));
}
