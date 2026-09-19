/** Grapheme-indexed editing shared by dashboard forms and the installation prefix. */
import { graphemes, safeText, cellWidth } from "./cells.js";
export interface EditedInput { value: string; cursor: number; }
export function editInput(value: string, cursor: number | undefined, key: string, limit = 8192, multiline = false): EditedInput {
    const parts = graphemes(value);
    let at = Math.max(0, Math.min(parts.length, cursor ?? parts.length));
    if (key === "left" || key === "ctrl-b") at = Math.max(0, at - 1);
    else if (key === "right" || key === "ctrl-f") at = Math.min(parts.length, at + 1);
    else if (key === "home" || key === "ctrl-a") at = 0;
    else if (key === "end" || key === "ctrl-e") at = parts.length;
    else if (key === "backspace" && at) parts.splice(--at, 1);
    else if (key === "delete") parts.splice(at, 1);
    else if (key === "ctrl-u") { parts.length = 0; at = 0; }
    else if (key === "ctrl-w") {
        const end = at;
        while (at && /^\s+$/u.test(parts[at - 1])) at--;
        while (at && !/^\s+$/u.test(parts[at - 1])) at--;
        parts.splice(at, end - at);
    } else {
        let inserted = key.startsWith("paste:") ? key.slice(6) : Array.from(key).length === 1 ? key : "";
        inserted = inserted.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ");
        const room = Math.max(0, limit - parts.join("").length), adding: string[] = [];
        let size = 0;
        for (const g of graphemes(inserted)) { if (size + g.length > room) break; adding.push(g); size += g.length; }
        // Don't spread a large clipboard into a call stack.
        return { value: [...parts.slice(0, at), ...adding, ...parts.slice(at)].join(""), cursor: at + adding.length };
    }
    return { value: parts.join(""), cursor: at };
}
export function inputDisplay(value: string, cursor: number | undefined, width: number, ascii = false): string {
    const parts = graphemes(safeText(value)), at = Math.max(0, Math.min(parts.length, cursor ?? parts.length));
    const marker = ascii ? "|" : "▏", budget = Math.max(0, width - 1);
    let from = at, used = 0;
    while (from > 0 && used + cellWidth(parts[from - 1]) <= budget) used += cellWidth(parts[--from]);
    let result = parts.slice(from, at).join("") + marker;
    for (const g of parts.slice(at)) { if (cellWidth(result + g) > width) break; result += g; }
    return result;
}
