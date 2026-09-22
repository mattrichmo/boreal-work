# R-TUI-INPUT — apps/tui/src/ui/input.ts

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/src/ui/input.ts:L1–L38`  
**File SHA-256:** `f0fe7cb5b540efeed5fd1d6d76cc469612f7a04aeb388d6a951f91c0524e1678`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

UTF-8/paste/form editing and focus semantics that confirmations must preserve.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,38p' 'apps/tui/src/ui/input.ts'
```

## Exact baseline excerpt

````text
    1 | /** Grapheme-indexed editing shared by dashboard forms and the installation prefix. */
    2 | import { graphemes, safeText, cellWidth } from "./cells.js";
    3 | export interface EditedInput { value: string; cursor: number; }
    4 | export function editInput(value: string, cursor: number | undefined, key: string, limit = 8192, multiline = false): EditedInput {
    5 |     const parts = graphemes(value);
    6 |     let at = Math.max(0, Math.min(parts.length, cursor ?? parts.length));
    7 |     if (key === "left" || key === "ctrl-b") at = Math.max(0, at - 1);
    8 |     else if (key === "right" || key === "ctrl-f") at = Math.min(parts.length, at + 1);
    9 |     else if (key === "home" || key === "ctrl-a") at = 0;
   10 |     else if (key === "end" || key === "ctrl-e") at = parts.length;
   11 |     else if (key === "backspace" && at) parts.splice(--at, 1);
   12 |     else if (key === "delete") parts.splice(at, 1);
   13 |     else if (key === "ctrl-u") { parts.length = 0; at = 0; }
   14 |     else if (key === "ctrl-w") {
   15 |         const end = at;
   16 |         while (at && /^\s+$/u.test(parts[at - 1])) at--;
   17 |         while (at && !/^\s+$/u.test(parts[at - 1])) at--;
   18 |         parts.splice(at, end - at);
   19 |     } else {
   20 |         let inserted = key.startsWith("paste:") ? key.slice(6) : Array.from(key).length === 1 ? key : "";
   21 |         inserted = inserted.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ");
   22 |         const room = Math.max(0, limit - parts.join("").length), adding: string[] = [];
   23 |         let size = 0;
   24 |         for (const g of graphemes(inserted)) { if (size + g.length > room) break; adding.push(g); size += g.length; }
   25 |         // Don't spread a large clipboard into a call stack.
   26 |         return { value: [...parts.slice(0, at), ...adding, ...parts.slice(at)].join(""), cursor: at + adding.length };
   27 |     }
   28 |     return { value: parts.join(""), cursor: at };
   29 | }
   30 | export function inputDisplay(value: string, cursor: number | undefined, width: number, ascii = false): string {
   31 |     const parts = graphemes(safeText(value)), at = Math.max(0, Math.min(parts.length, cursor ?? parts.length));
   32 |     const marker = ascii ? "|" : "▏", budget = Math.max(0, width - 1);
   33 |     let from = at, used = 0;
   34 |     while (from > 0 && used + cellWidth(parts[from - 1]) <= budget) used += cellWidth(parts[--from]);
   35 |     let result = parts.slice(from, at).join("") + marker;
   36 |     for (const g of parts.slice(at)) { if (cellWidth(result + g) > width) break; result += g; }
   37 |     return result;
   38 | }
````
