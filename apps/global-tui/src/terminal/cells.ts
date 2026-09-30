/** Terminal-cell primitives. No service text is ever interpreted as an escape. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (value: string): string[] => Array.from(segmenter.segment(value), (s) => s.segment);
export function safeText(value: unknown): string {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "�");
}
function wide(cp: number): boolean {
    return cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd));
}
export function clusterWidth(cluster: string): number {
    if (/\p{Emoji_Presentation}/u.test(cluster) || cluster.includes("\ufe0f") || /[\u{1f1e6}-\u{1f1ff}]/u.test(cluster))
        return 2;
    const base = Array.from(cluster).find((s) => !/[\p{Mark}\u200d\ufe0e\ufe0f]/u.test(s));
    return base ? wide(base.codePointAt(0)!) ? 2 : 1 : 0;
}
export function cellWidth(value: string): number {
    return graphemes(safeText(value)).reduce((sum, g) => sum + clusterWidth(g), 0);
}
export function clip(value: unknown, width: number, ellipsis = "…"): string {
    width = Math.max(0, Math.floor(width));
    const text = safeText(value);
    if (cellWidth(text) <= width)
        return text;
    if (!width)
        return "";
    let used = 0, result = "";
    const budget = width - cellWidth(ellipsis);
    for (const g of graphemes(text)) {
        const w = clusterWidth(g);
        if (used + w > budget)
            break;
        result += g;
        used += w;
    }
    return result + (budget >= 0 ? ellipsis : "");
}
export function fit(value: unknown, width: number, right = false): string {
    width = Math.max(0, Math.floor(width));
    const text = clip(value, width);
    const pad = " ".repeat(Math.max(0, width - cellWidth(text)));
    return right ? pad + text : text + pad;
}
export function wrap(value: unknown, width: number): string[] {
    width = Math.max(1, Math.floor(width));
    const result: string[] = [];
    for (const paragraph of String(value ?? "").split(/\r?\n/)) {
        let row = "", used = 0;
        for (const g of graphemes(safeText(paragraph))) {
            const n = clusterWidth(g);
            if (used + n > width && row) {
                result.push(row);
                row = "";
                used = 0;
            }
            if (n > width) {
                result.push("…");
                continue;
            }
            row += g;
            used += n;
        }
        result.push(row);
    }
    return result;
}
/** Word-aware prose wrapping; very long identifiers still break by grapheme. */
export function wrapWords(value: unknown, width: number): string[] {
    width = Math.max(1, Math.floor(width));
    const lines: string[] = [];
    for (const paragraph of String(value ?? "").split(/\r?\n/)) {
        let row = "";
        for (const token of safeText(paragraph).match(/\s+|\S+/gu) ?? []) {
            if (/^\s+$/u.test(token)) {
                row += token;
                continue;
            }
            if (cellWidth(row + token) <= width) {
                row += token;
                continue;
            }
            if (row.trim()) {
                lines.push(row.trimEnd());
                row = "";
            }
            else
                row = "";
            const parts = wrap(token, width);
            lines.push(...parts.slice(0, -1));
            row = parts.at(-1) ?? "";
        }
        lines.push(row.trimEnd());
    }
    return lines;
}
export function eraseLast(value: string): string { return graphemes(value).slice(0, -1).join(""); }
export function inputTail(value: string, width: number): string {
    const parts = graphemes(safeText(value));
    const limit = Math.max(0, width);
    let used = 0, start = parts.length;
    while (start > 0 && used + clusterWidth(parts[start - 1]) <= limit) {
        used += clusterWidth(parts[--start]);
    }
    return parts.slice(start).join("");
}
