import { clusterWidth, graphemes, safeText, clip, cellWidth } from "./cells.js";
export type Tone = "text" | "muted" | "accent" | "good" | "warn" | "danger" | "selected" | "heading" | "border";
export type Theme = "dark" | "light" | "mono";
export interface Cell {
    text: string;
    tone: Tone;
    continuation?: boolean;
}
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export class Screen {
    readonly cells: Cell[][];
    constructor(readonly width: number, readonly height: number) {
        this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ text: " ", tone: "text" as Tone })));
    }
    private clearCell(x: number, y: number): void {
        const row = this.cells[y];
        if (!row || x < 0 || x >= this.width)
            return;
        if (row[x].continuation && x > 0)
            row[x - 1] = { text: " ", tone: "text" };
        if (x + 1 < this.width && row[x + 1].continuation)
            row[x + 1] = { text: " ", tone: "text" };
        row[x] = { text: " ", tone: "text" };
    }
    text(x: number, y: number, value: unknown, tone: Tone = "text", maxWidth = this.width - x): void {
        if (y < 0 || y >= this.height || maxWidth <= 0)
            return;
        const end = Math.min(this.width, x + maxWidth);
        for (const g of graphemes(safeText(value))) {
            const size = clusterWidth(g);
            if (!size)
                continue;
            if (x + size > end)
                break;
            if (x >= 0) {
                this.clearCell(x, y);
                if (size === 2)
                    this.clearCell(x + 1, y);
                this.cells[y][x] = { text: g, tone };
                if (size === 2)
                    this.cells[y][x + 1] = { text: "", tone, continuation: true };
            }
            x += size;
        }
    }
    fill(r: Rect, tone: Tone = "text"): void {
        for (let y = Math.max(0, r.y); y < Math.min(this.height, r.y + r.height); y++) {
            this.text(r.x, y, " ".repeat(Math.max(0, r.width)), tone, r.width);
        }
    }
    rule(x: number, y: number, width: number, ascii = false): void { this.text(x, y, (ascii ? "-" : "─").repeat(Math.max(0, width)), "border", width); }
    box(r: Rect, title: string, focused = false, ascii = false): void {
        if (r.width < 2 || r.height < 2)
            return;
        const [tl, tr, bl, br, h, v] = ascii ? ["+", "+", "+", "+", "-", "|"] : ["┌", "┐", "└", "┘", "─", "│"];
        const tone: Tone = focused ? "accent" : "border";
        this.text(r.x, r.y, tl + h.repeat(r.width - 2) + tr, tone);
        this.text(r.x, r.y + r.height - 1, bl + h.repeat(r.width - 2) + br, tone);
        for (let y = r.y + 1; y < r.y + r.height - 1; y++) {
            this.text(r.x, y, v, tone);
            this.text(r.x + r.width - 1, y, v, tone);
        }
        this.text(r.x + 2, r.y, clip(` ${title} `, r.width - 4), focused ? "accent" : "heading", r.width - 4);
    }
    plain(): string[] { return this.cells.map((row) => row.map((c) => c.text).join("")); }
    ansi(theme: Theme = "dark"): string[] {
        if (theme === "mono")
            return this.plain();
        const map: Record<Tone, string> = theme === "light"
            ? { text: "\x1b[0m", muted: "\x1b[90m", accent: "\x1b[34;1m", good: "\x1b[32m", warn: "\x1b[33m", danger: "\x1b[31;1m", selected: "\x1b[7;1m", heading: "\x1b[1m", border: "\x1b[90m" }
            : { text: "\x1b[0m", muted: "\x1b[90m", accent: "\x1b[36;1m", good: "\x1b[32m", warn: "\x1b[33m", danger: "\x1b[31;1m", selected: "\x1b[7;1m", heading: "\x1b[1m", border: "\x1b[90m" };
        return this.cells.map((row) => {
            let tone: Tone | null = null, result = "";
            for (const cell of row) {
                if (cell.continuation)
                    continue;
                if (cell.tone !== tone) {
                    result += map[cell.tone];
                    tone = cell.tone;
                }
                result += cell.text;
            }
            return result + "\x1b[0m";
        });
    }
}
/** Row-diff output. Never clears the whole screen during normal navigation. */
export class FrameWriter {
    private previous: string[] = [];
    private width = 0;
    constructor(private readonly write: (value: string) => void) { }
    paint(screen: Screen, theme: Theme = "dark"): void {
        const rows = screen.ansi(theme);
        const resized = this.width !== screen.width || this.previous.length !== rows.length;
        let output = resized ? "\x1b[2J" : "";
        rows.forEach((row, i) => { if (resized || row !== this.previous[i])
            output += `\x1b[${i + 1};1H${row}\x1b[K`; });
        if (output)
            this.write(output);
        this.previous = rows;
        this.width = screen.width;
    }
    invalidate(): void { this.previous = []; this.width = 0; }
}
export function rightLabel(screen: Screen, y: number, text: string, tone: Tone = "muted", padding = 2): void {
    screen.text(Math.max(padding, screen.width - cellWidth(text) - padding), y, text, tone, screen.width - padding * 2);
}
