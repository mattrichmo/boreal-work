// GENERATED: scripts/build-installer.mjs. Edit wizard-body.cjs or src/ui, not this file.
'use strict';
const {openSync: openTerminalFd, closeSync: closeTerminalFd} = require('node:fs');
const {WriteStream: TerminalSizeStream} = require('node:tty');
/** Terminal-cell primitives. No service text is ever interpreted as an escape. */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (value) => Array.from(segmenter.segment(value), (s) => s.segment);
function safeText(value) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "�");
}
function wide(cp) {
    return cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd));
}
function clusterWidth(cluster) {
    if (/\p{Emoji_Presentation}/u.test(cluster) || cluster.includes("\ufe0f") || /[\u{1f1e6}-\u{1f1ff}]/u.test(cluster))
        return 2;
    const base = Array.from(cluster).find((s) => !/[\p{Mark}\u200d\ufe0e\ufe0f]/u.test(s));
    return base ? wide(base.codePointAt(0)) ? 2 : 1 : 0;
}
function cellWidth(value) {
    return graphemes(safeText(value)).reduce((sum, g) => sum + clusterWidth(g), 0);
}
function clip(value, width, ellipsis = "…") {
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
function fit(value, width, right = false) {
    width = Math.max(0, Math.floor(width));
    const text = clip(value, width);
    const pad = " ".repeat(Math.max(0, width - cellWidth(text)));
    return right ? pad + text : text + pad;
}
function wrap(value, width) {
    width = Math.max(1, Math.floor(width));
    const result = [];
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
function wrapWords(value, width) {
    width = Math.max(1, Math.floor(width));
    const lines = [];
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
function eraseLast(value) { return graphemes(value).slice(0, -1).join(""); }
function inputTail(value, width) {
    const parts = graphemes(safeText(value));
    const limit = Math.max(0, width);
    let used = 0, start = parts.length;
    while (start > 0 && used + clusterWidth(parts[start - 1]) <= limit) {
        used += clusterWidth(parts[--start]);
    }
    return parts.slice(start).join("");
}

class Screen {
    width;
    height;
    cells;
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ text: " ", tone: "text" })));
    }
    clearCell(x, y) {
        const row = this.cells[y];
        if (!row || x < 0 || x >= this.width)
            return;
        if (row[x].continuation && x > 0)
            row[x - 1] = { text: " ", tone: "text" };
        if (x + 1 < this.width && row[x + 1].continuation)
            row[x + 1] = { text: " ", tone: "text" };
        row[x] = { text: " ", tone: "text" };
    }
    text(x, y, value, tone = "text", maxWidth = this.width - x) {
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
    fill(r, tone = "text") {
        for (let y = Math.max(0, r.y); y < Math.min(this.height, r.y + r.height); y++) {
            this.text(r.x, y, " ".repeat(Math.max(0, r.width)), tone, r.width);
        }
    }
    rule(x, y, width, ascii = false) { this.text(x, y, (ascii ? "-" : "─").repeat(Math.max(0, width)), "border", width); }
    box(r, title, focused = false, ascii = false) {
        if (r.width < 2 || r.height < 2)
            return;
        const [tl, tr, bl, br, h, v] = ascii ? ["+", "+", "+", "+", "-", "|"] : ["┌", "┐", "└", "┘", "─", "│"];
        const tone = focused ? "accent" : "border";
        this.text(r.x, r.y, tl + h.repeat(r.width - 2) + tr, tone);
        this.text(r.x, r.y + r.height - 1, bl + h.repeat(r.width - 2) + br, tone);
        for (let y = r.y + 1; y < r.y + r.height - 1; y++) {
            this.text(r.x, y, v, tone);
            this.text(r.x + r.width - 1, y, v, tone);
        }
        this.text(r.x + 2, r.y, clip(` ${title} `, r.width - 4), focused ? "accent" : "heading", r.width - 4);
    }
    plain() { return this.cells.map((row) => row.map((c) => c.text).join("")); }
    ansi(theme = "dark") {
        if (theme === "mono")
            return this.plain();
        const map = theme === "light"
            ? { text: "\x1b[0m", muted: "\x1b[90m", accent: "\x1b[34;1m", good: "\x1b[32m", warn: "\x1b[33m", danger: "\x1b[31;1m", selected: "\x1b[7;1m", heading: "\x1b[1m", border: "\x1b[90m" }
            : { text: "\x1b[0m", muted: "\x1b[90m", accent: "\x1b[36;1m", good: "\x1b[32m", warn: "\x1b[33m", danger: "\x1b[31;1m", selected: "\x1b[7;1m", heading: "\x1b[1m", border: "\x1b[90m" };
        return this.cells.map((row) => {
            let tone = null, result = "";
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
class FrameWriter {
    write;
    previous = [];
    width = 0;
    constructor(write) {
        this.write = write;
    }
    paint(screen, theme = "dark") {
        const rows = screen.ansi(theme);
        const resized = this.width !== screen.width || this.previous.length !== rows.length;
        let output = resized ? "\x1b[2J" : "";
        rows.forEach((row, i) => {
            if (resized || row !== this.previous[i])
                output += `\x1b[${i + 1};1H${row}\x1b[K`;
        });
        if (output)
            this.write(output);
        this.previous = rows;
        this.width = screen.width;
    }
    invalidate() { this.previous = []; this.width = 0; }
}
function rightLabel(screen, y, text, tone = "muted", padding = 2) {
    screen.text(Math.max(padding, screen.width - cellWidth(text) - padding), y, text, tone, screen.width - padding * 2);
}

/** Buffered UTF-8/CSI parser. Unknown escape sequences are swallowed, not typed. */
const CSI = { P: "f1", "11~": "f1", A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "shift-tab", "1~": "home", "4~": "end", "7~": "home", "8~": "end", "3~": "delete", "5~": "page-up", "6~": "page-down" };
class StreamingKeyDecoder {
    decoder = new TextDecoder();
    pending = "";
    pasting = false;
    pasted = "";
    controlString = false;
    get awaitingEscape() { return this.pending.startsWith("\x1b") && !this.pasting; }
    push(value) {
        this.pending += typeof value === "string" ? value : this.decoder.decode(value, { stream: true });
        return this.parse(false);
    }
    flush() { this.pending += this.decoder.decode(); return this.parse(true); }
    flushEscape() { return this.parse(true); }
    parse(flush) {
        const result = [];
        while (this.pending) {
            if (this.controlString) {
                const interrupt = this.pending.indexOf("\x03");
                if (interrupt >= 0) {
                    this.controlString = false;
                    this.pending = this.pending.slice(interrupt + 1);
                    result.push("ctrl-c");
                    continue;
                }
                const end = /\x07|\x1b\\/.exec(this.pending);
                if (!end) {
                    this.pending = this.pending.endsWith("\x1b") ? "\x1b" : "";
                    break;
                }
                this.pending = this.pending.slice(end.index + end[0].length);
                this.controlString = false;
                continue;
            }
            if (this.pasting) {
                const end = this.pending.indexOf("\x1b[201~");
                if (end < 0) {
                    // Retain a possible partial terminator. Bound clipboard memory.
                    const take = Math.max(0, this.pending.length - 6);
                    this.pasted = (this.pasted + this.pending.slice(0, take)).slice(0, 262144);
                    this.pending = this.pending.slice(take);
                    break;
                }
                this.pasted = (this.pasted + this.pending.slice(0, end)).slice(0, 262144);
                result.push("paste:" + this.pasted);
                this.pending = this.pending.slice(end + 6);
                this.pasting = false;
                this.pasted = "";
                continue;
            }
            if (this.pending.startsWith("\x1b[200~")) {
                this.pending = this.pending.slice(6);
                this.pasting = true;
                continue;
            }
            if (this.pending[0] === "\x1b") {
                if (this.pending.length === 1) {
                    if (!flush)
                        break;
                    result.push("escape");
                    this.pending = "";
                    break;
                }
                if (["]", "P", "^", "_"].includes(this.pending[1])) {
                    this.controlString = true;
                    this.pending = this.pending.slice(2);
                    continue;
                }
                if (this.pending[1] === "[" || this.pending[1] === "O") {
                    const match = /^\x1b(?:\[|O)([0-?]*[ -/]*[@-~])/.exec(this.pending);
                    if (!match) {
                        if (flush || this.pending.length > 128)
                            this.pending = "";
                        break;
                    }
                    const key = CSI[match[1]];
                    if (key)
                        result.push(key);
                    this.pending = this.pending.slice(match[0].length);
                    continue;
                }
                // Drop an unknown Alt-key chord as a unit; never let it trigger a mutation.
                this.pending = this.pending.slice(2);
                continue;
            }
            const code = this.pending.codePointAt(0);
            const value = String.fromCodePoint(code);
            this.pending = this.pending.slice(value.length);
            if (code === 13 || code === 10)
                result.push("enter");
            else if (code === 3)
                result.push("ctrl-c");
            else if (code === 4)
                result.push("ctrl-d");
            else if (code === 9)
                result.push("tab");
            else if (code === 1)
                result.push("ctrl-a");
            else if (code === 2)
                result.push("ctrl-b");
            else if (code === 5)
                result.push("ctrl-e");
            else if (code === 6)
                result.push("ctrl-f");
            else if (code === 12)
                result.push("ctrl-l");
            else if (code === 23)
                result.push("ctrl-w");
            else if (code === 11)
                result.push("ctrl-k");
            else if (code === 21)
                result.push("ctrl-u");
            else if (code === 127 || code === 8)
                result.push("backspace");
            else if (code >= 32 && !(code >= 0x7f && code <= 0x9f))
                result.push(value);
        }
        return result;
    }
}
function decodeKeys(value) { const decoder = new StreamingKeyDecoder(); return [...decoder.push(value), ...decoder.flush()]; }

const positive = (n) => typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
/** A zero/NaN resize must not erase the last valid geometry. Live PTY data wins over env. */
function resolveViewport(live = {}, previous, env = {}) {
    return {
        width: Math.min(500, positive(live.width) ?? positive(previous?.width) ?? positive(Number(env.COLUMNS)) ?? 80),
        height: Math.min(200, positive(live.height) ?? positive(previous?.height) ?? positive(Number(env.LINES)) ?? 24),
    };
}
function chromeFor(width, height, density = "auto") {
    if (height < 10 || width < 36)
        return "micro";
    if (height < 22 || width < 60 || density === "compact")
        return "compact";
    if (height >= (density === "comfortable" ? 26 : 32) && width >= 80)
        return "comfortable";
    return "standard";
}
const cycleDensity = (density) => density === "auto" ? "compact" : density === "compact" ? "comfortable" : "auto";
/** Every pane keeps >=1 content row. Decorations are the first thing removed. */
function paneViewport(r, chrome) {
    const boxed = (chrome === "comfortable" || chrome === "standard") && r.height >= 7 && r.width >= 24;
    return { x: r.x + (boxed ? 2 : 0), y: r.y + (boxed ? 2 : r.height > 1 ? 1 : 0),
        width: Math.max(1, r.width - (boxed ? 4 : 0)), height: Math.max(1, r.height - (boxed ? 3 : r.height > 1 ? 1 : 0)), boxed };
}
/** Small dialogs become full-view sheets; no centering gutters consume scarce rows. */
function dialogViewport(width, height, desiredHeight = 26) {
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
function adaptiveHint(width, ...variants) {
    // Variants here use one-cell UI glyphs only; service strings are measured elsewhere.
    return variants.find(v => Array.from(v).length <= width) ?? variants.at(-1) ?? "";
}
function windowStart(index, total, capacity) {
    capacity = Math.max(1, capacity);
    return Math.min(Math.max(0, index - Math.floor(capacity / 2)), Math.max(0, total - capacity));
}

/** Grapheme-indexed editing shared by dashboard forms and the installation prefix. */
function editInput(value, cursor, key, limit = 8192, multiline = false) {
    const parts = graphemes(value);
    let at = Math.max(0, Math.min(parts.length, cursor ?? parts.length));
    if (key === "left" || key === "ctrl-b")
        at = Math.max(0, at - 1);
    else if (key === "right" || key === "ctrl-f")
        at = Math.min(parts.length, at + 1);
    else if (key === "home" || key === "ctrl-a")
        at = 0;
    else if (key === "end" || key === "ctrl-e")
        at = parts.length;
    else if (key === "backspace" && at)
        parts.splice(--at, 1);
    else if (key === "delete")
        parts.splice(at, 1);
    else if (key === "ctrl-u") {
        parts.length = 0;
        at = 0;
    }
    else if (key === "ctrl-w") {
        const end = at;
        while (at && /^\s+$/u.test(parts[at - 1]))
            at--;
        while (at && !/^\s+$/u.test(parts[at - 1]))
            at--;
        parts.splice(at, end - at);
    }
    else {
        let inserted = key.startsWith("paste:") ? key.slice(6) : Array.from(key).length === 1 ? key : "";
        inserted = inserted.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ");
        const room = Math.max(0, limit - parts.join("").length), adding = [];
        let size = 0;
        for (const g of graphemes(inserted)) {
            if (size + g.length > room)
                break;
            adding.push(g);
            size += g.length;
        }
        // Don't spread a large clipboard into a call stack.
        return { value: [...parts.slice(0, at), ...adding, ...parts.slice(at)].join(""), cursor: at + adding.length };
    }
    return { value: parts.join(""), cursor: at };
}
function inputDisplay(value, cursor, width, ascii = false) {
    const parts = graphemes(safeText(value)), at = Math.max(0, Math.min(parts.length, cursor ?? parts.length));
    const marker = ascii ? "|" : "▏", budget = Math.max(0, width - 1);
    let from = at, used = 0;
    while (from > 0 && used + cellWidth(parts[from - 1]) <= budget)
        used += cellWidth(parts[--from]);
    let result = parts.slice(from, at).join("") + marker;
    for (const g of parts.slice(at)) {
        if (cellWidth(result + g) > width)
            break;
        result += g;
    }
    return result;
}

/** Live POSIX terminal geometry for stdout AND privately opened /dev/tty streams.
 * A custom tty.WriteStream does not get Node's stdio SIGWINCH wiring. Constructing
 * a short-lived, owned probe uses the public constructor's fresh kernel query;
 * getWindowSize() on the existing stream would only return its cached properties.
 * No shell, stty subprocess, private _handle API, or terminal query/response bytes.
 */
function probeTerminalSize() {
    let fd, stream;
    try {
        fd = openTerminalFd("/dev/tty", "w");
        stream = new TerminalSizeStream(fd);
        stream.on("error", () => { });
        return { width: stream.columns, height: stream.rows };
    }
    catch {
        return undefined;
    }
    finally {
        if (stream)
            stream.destroy();
        // libuv reopens POSIX tty descriptors for its handle. Destroying the
        // stream closes that handle, not the original descriptor we opened.
        // Close our original synchronously too (no async fd-reuse window).
        if (fd !== undefined) {
            try {
                closeTerminalFd(fd);
            }
            catch { }
        }
    }
}
class TerminalSizeTracker {
    fallback;
    probe;
    env;
    size;
    listeners = new Set();
    poll;
    debounce;
    signal = () => {
        if (this.debounce)
            clearTimeout(this.debounce);
        this.debounce = setTimeout(() => { this.debounce = undefined; this.refresh(); }, 16);
    };
    constructor(fallback = () => ({}), probe = probeTerminalSize, env = process.env) {
        this.fallback = fallback;
        this.probe = probe;
        this.env = env;
        const live = probe();
        this.size = resolveViewport(live ?? fallback(), undefined, env);
    }
    dimensions() { return { ...this.size }; }
    refresh() {
        const live = this.probe();
        const next = resolveViewport(live ?? this.fallback(), this.size, this.env);
        if (next.width === this.size.width && next.height === this.size.height)
            return;
        this.size = next;
        this.listeners.forEach(fn => fn());
    }
    subscribe(listener) {
        this.listeners.add(listener);
        if (!this.poll) {
            process.on("SIGWINCH", this.signal);
            // Some editor/embedded PTYs miss a signal; recover without user action.
            this.poll = setInterval(() => this.refresh(), 1000);
            this.refresh();
        }
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) {
                if (this.poll)
                    clearInterval(this.poll);
                if (this.debounce)
                    clearTimeout(this.debounce);
                this.poll = undefined;
                this.debounce = undefined;
                process.off("SIGWINCH", this.signal);
            }
        };
    }
}

/* Canonical wizard logic. Generated wizard.cjs also embeds the shared cell renderer.
 * UI reads /dev/tty; stdout carries exactly one JSON result. No shell evaluation.
 * Project mode chooses options only. Rust remains the sole project writer.
 */
const fs = require('node:fs');
const tty = require('node:tty');
const path = require('node:path');
const GLYPHS = {
    B: ['#### ', '#   #', '#### ', '#   #', '#### '], O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
    R: ['#### ', '#   #', '#### ', '#  # ', '#   #'], E: ['#####', '#    ', '#### ', '#    ', '#####'],
    A: [' ### ', '#   #', '#####', '#   #', '#   #'], L: ['#    ', '#    ', '#    ', '#    ', '#####'],
    W: ['#   #', '#   #', '# # #', '## ##', '#   #'], K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'],
    '-': ['     ', '     ', ' ### ', '     ', '     '],
};
function wordmark(word = 'BOREAL-WORK') { return [0, 1, 2, 3, 4].map(row => Array.from(word, c => GLYPHS[c][row]).join(' ')); }
function createWizardState(mode, initial) {
    if (!['project', 'machine'].includes(mode))
        throw new Error('Unknown wizard mode.');
    const steps = mode === 'project' ? ['Welcome', 'Agent tools', 'Memory', 'Review'] : ['Welcome', 'Destination', 'Components', 'Source', 'Review'];
    return { mode, initial, steps, step: 0, cursor: 0, error: '', scroll: 0, maxOffset: 0, pageSize: 1,
        density: 'auto', theme: 'dark', ascii: false, help: false, helpScroll: 0, helpMax: 0, prefixCursor: undefined,
        prefix: initial.prefix || '', source: initial.source || 'release',
        agents: Array.isArray(initial.agents) ? [...initial.agents] : ['codex'],
        memory_layout: initial.memory_layout || 'child', dashboard: initial.dashboard !== false,
        verify: initial.verify !== false, replace_existing: initial.replace_existing === true,
    };
}
function machineCollision(s) {
    return s.mode === 'machine' && fs.existsSync(path.join(s.prefix, 'bin/bwrk')) && !fs.existsSync(path.join(s.prefix, 'share/boreal/release.json'));
}
function choices(s) {
    const page = s.steps[s.step];
    if (page === 'Agent tools')
        return [
            { id: 'codex', label: 'Codex', hint: '.agents/skills · Boreal agent skills', on: s.agents.includes('codex'), locked: s.initial.agents_locked },
            { id: 'claude', label: 'Claude', hint: '.claude/skills · Boreal agent skills', on: s.agents.includes('claude'), locked: s.initial.agents_locked },
        ];
    if (page === 'Components')
        return [
            { id: 'cli', label: 'Boreal command-line engine', hint: 'Required · bwrk and release metadata', on: true, locked: true },
            { id: 'dashboard', label: 'Interactive work dashboard', hint: 'Human-facing TUI · requires Node.js 20–26', on: s.dashboard },
            { id: 'verify', label: 'Verify the installed command', hint: 'Run staged bwrk --version before publishing', on: s.verify },
            ...(machineCollision(s) ? [{ id: 'replace_existing', label: 'Replace the existing unrecognized bwrk', hint: 'Unchecked by default. A separate prefix retains v1.', on: s.replace_existing }] : []),
        ];
    if (page === 'Memory')
        return [
            { id: 'child', label: 'Separate memory repository', hint: 'memory/ gets its own Git repository (default)', on: s.memory_layout === 'child', locked: s.initial.memory_locked },
            { id: 'in-repo', label: 'Keep memory in this repository', hint: 'Memory is versioned alongside the project', on: s.memory_layout === 'in-repo', locked: s.initial.memory_locked },
        ];
    if (page === 'Source')
        return s.initial.archive ? [{ id: 'archive', label: 'Local release archive', hint: s.initial.archive, on: true, locked: true }] : [
            { id: 'release', label: 'Verified release archive', hint: s.initial.version ? `Pinned release ${s.initial.version}` : 'Latest compatible published release · checksum verified', on: s.source === 'release', locked: s.initial.source_locked },
            { id: 'source', label: 'Build from source', hint: `Checkout / ref ${s.initial.ref || 'main'} · requires Rust, Node, npm, Python and tsc`, on: s.source === 'source', locked: s.initial.source_locked },
        ];
    return [];
}
function validateWizard(s) {
    const page = s.steps[s.step];
    if (s.mode === 'machine' && (page === 'Destination' || page === 'Review')) {
        const prefix = s.prefix.trim();
        if (!prefix || path.resolve(prefix) === '/' || !path.isAbsolute(prefix))
            return 'Choose an absolute installation path other than /.';
        if (fs.existsSync(prefix) && fs.realpathSync(prefix) === '/')
            return 'The destination resolves to the filesystem root. Choose a separate directory.';
        if (/[\u0000-\u001f\u007f-\u009f]/u.test(prefix))
            return 'Installation path cannot contain control characters.';
        const collision = fs.existsSync(path.join(prefix, 'bin/bwrk')) && !fs.existsSync(path.join(prefix, 'share/boreal/release.json'));
        if (page === 'Review' && collision && !s.replace_existing)
            return 'Existing unrecognized bwrk: choose another destination or authorize replacement.';
    }
    if ((page === 'Agent tools' || page === 'Review') && s.mode === 'project' && !s.agents.length)
        return 'Choose at least one agent tool.';
    if (s.mode === 'project' && s.initial.install_root && s.agents.length > 1)
        return 'A custom skill directory supports one agent only.';
    return '';
}
function wizardResult(s) {
    if (s.mode === 'project')
        return { confirmed: true, agents: s.agents, memory_layout: s.memory_layout };
    return { confirmed: true, prefix: s.prefix.trim(), source: s.source, dashboard: s.dashboard, verify: s.verify, replace_existing: s.replace_existing };
}
/** Reducer returns only continue, cancel, or submit. It never performs installation. */
function applyWizardKey(s, key) {
    if (key === 'ctrl-c' || key === 'ctrl-d')
        return 'cancel';
    const page = s.steps[s.step], rows = choices(s);
    if (key === 'f1' || (key === '?' && page !== 'Destination')) {
        s.help = !s.help; s.helpScroll = 0; return 'continue';
    }
    if (s.help) {
        if (key === 'escape' || key === 'q') s.help = false;
        else if (['down', 'j', 'page-down', 'enter'].includes(key)) s.helpScroll = Math.min(s.helpMax, s.helpScroll + (key === 'page-down' || key === 'enter' ? s.pageSize : 1));
        else if (['up', 'k', 'page-up'].includes(key)) s.helpScroll = Math.max(0, s.helpScroll - (key === 'page-up' ? s.pageSize : 1));
        else if (key === 'end') s.helpScroll = s.helpMax;
        else if (key === 'home') s.helpScroll = 0;
        return 'continue';
    }
    if (key === '!' && page !== 'Destination') { s.help = true; s.helpScroll = 0; return 'continue'; }
    if (key === 'd' && page !== 'Destination') { s.density = cycleDensity(s.density); return 'continue'; }
    if (key === 'T' && page !== 'Destination' && !s.forceMono) { s.theme = s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'mono' : 'dark'; return 'continue'; }
    if (key === 'a' && page === 'Agent tools' && !s.initial.agents_locked && !s.initial.install_root) { s.agents = ['codex', 'claude']; s.error = ''; }

    if (key === 'escape') {
        if (s.step === 0)
            return 'cancel';
        s.step--;
        s.cursor = 0;
        s.scroll = 0;
        s.maxOffset = 0;
        s.error = '';
        return 'continue';
    }
    if (!rows.length && page !== 'Destination') {
        if (key === 'down' || key === 'j')
            s.scroll = Math.min(s.maxOffset, s.scroll + 1);
        if (key === 'up' || key === 'k')
            s.scroll = Math.max(0, s.scroll - 1);
        if (key === 'page-down')
            s.scroll = Math.min(s.maxOffset, s.scroll + s.pageSize);
        if (key === 'page-up')
            s.scroll = Math.max(0, s.scroll - s.pageSize);
        if (key === 'end')
            s.scroll = s.maxOffset;
        if (key === 'home')
            s.scroll = 0;
    }
    if (page === 'Destination') {
        const edited = editInput(s.prefix, s.prefixCursor, key, 4096);
        s.prefix = edited.value; s.prefixCursor = edited.cursor;
        if (!['enter', 'ctrl-l'].includes(key)) s.error = '';
    }
    else {
        if (key === 'q')
            return 'cancel';
        if (key === 'down' || key === 'j' || key === 'tab')
            s.cursor = (s.cursor + 1) % Math.max(1, rows.length);
        if (key === 'up' || key === 'k' || key === 'shift-tab')
            s.cursor = (s.cursor + Math.max(1, rows.length) - 1) % Math.max(1, rows.length);
        if (key === 'home' && rows.length) s.cursor = 0;
        if (key === 'end' && rows.length) s.cursor = rows.length - 1;
        if (key === 'page-down' && rows.length) s.cursor = Math.min(rows.length - 1, s.cursor + s.pageSize);
        if (key === 'page-up' && rows.length) s.cursor = Math.max(0, s.cursor - s.pageSize);
        if ([' ', 'left', 'right'].includes(key) && rows[s.cursor]) {
            s.error = '';
            const row = rows[s.cursor];
            if (row.locked)
                s.error = 'This choice was fixed by a command-line option or is required.';
            else if (page === 'Agent tools')
                s.agents = s.agents.includes(row.id) ? s.agents.filter(a => a !== row.id) : [...s.agents, row.id];
            else if (page === 'Memory')
                s.memory_layout = row.id;
            else if (page === 'Source')
                s.source = row.id;
            else
                s[row.id] = !s[row.id];
        }
    }
    if (key === 'enter') {
        s.error = validateWizard(s);
        if (s.error)
            return 'continue';
        if (s.step === s.steps.length - 1) {
            if (s.viewport && (s.viewport.width < 12 || s.viewport.height < 4)) { s.error = 'More space is needed to review safely. Ctrl-C cancels.'; return 'continue'; }
            if (s.scroll < s.maxOffset) {
                s.error = 'Scroll to the end of the review (End / ↓) before confirming.';
                s.scroll = Math.min(s.maxOffset, s.scroll + s.pageSize);
                return 'continue';
            }
            return 'submit';
        }
        s.step++;
        s.cursor = 0;
        s.scroll = 0;
        s.maxOffset = 0;
        s.error = '';
    }
    return 'continue';
}
function projectTargets(s) {
    const root = s.initial.project_root;
    return s.agents.map(agent => s.initial.install_root || path.join(root, agent === 'codex' ? '.agents/skills' : '.claude/skills'));
}
/** The wizard gives up decoration before content. A wide-short panel is not small. */
function wizardLayout(width, height, s) {
    ({ width, height } = resolveViewport({ width, height }));
    const chrome = chromeFor(width, height, s.density);
    const large = s.step === 0 && !s.help && height >= 32 && width >= 76 && s.density !== 'compact';
    const top = large ? 10 : height >= 22 ? 4 : height >= 10 ? 2 : height >= 4 ? 1 : 0;
    const footer = height >= 8 ? 2 : height >= 3 ? 1 : 0;
    const padding = width >= 60 ? 2 : width >= 36 ? 1 : 0;
    const totalWidth = Math.min(144, Math.max(1, width - padding * 2)), x = Math.floor((width - totalWidth) / 2);
    const side = width >= 120 && height >= 14 && !s.help ? 28 : 0;
    const body = { x, y: top, width: totalWidth - (side ? side + 3 : 0), height: Math.max(1, height - top - footer) };
    return { width, height, chrome, large, top, footer, x, totalWidth, body,
        rail: side ? { x: x + totalWidth - side, y: top, width: side, height: body.height } : undefined };
}
function wizardDocument(s) {
    const page = s.steps[s.step];
    if (s.help) {
        const focused = choices(s)[s.cursor];
        return [
            [s.error ? `ATTENTION: ${s.error}` : 'KEYBOARD & DISPLAY', s.error ? 'danger' : 'heading'],
            ...(focused ? [[focused.label, 'heading'], [focused.hint, 'text'], [focused.locked ? 'Required or fixed by command-line options.' : 'Space changes this choice.', 'muted']] : []),
            ['↑↓ / Tab: choose. Space: toggle. Enter: next screen.', 'text'],
            ['Review: Enter pages through the document before confirmation.', 'text'],
            ['Home / End, Page Up / Down: navigate choices or scroll text.', 'text'],
            ['Esc: back. Ctrl-C / Ctrl-D: cancel without starting installation.', 'text'],
            ['Prefix: ←→, Home, End, Delete, Backspace. Ctrl-U clears; Ctrl-W deletes a word.', 'text'],
            ['F1: help, also while editing a path. ? opens help outside text fields.', 'text'],
            ['a: select both agent tools (unless a CLI option fixes the choice).', 'text'],
            ['d: auto / compact / comfortable density. T: colour theme. Outside text fields only.', 'text'],
            ['Ctrl-L: repaint. !: read the full error / choice description.', 'text'],
            [`Terminal ${s.viewport?.width}×${s.viewport?.height}. Layout reflows without losing choices.`, 'muted'],
            ['Nothing is installed until the final review is confirmed.', 'warn'],
        ];
    }
    if (page === 'Welcome') return s.mode === 'project' ? [
        ['A clear place for plans, progress and proof.', 'heading'],
        [s.initial.project_id, 'accent'], [s.initial.project_root, 'muted'], ['','text'],
        ['Choose agent adapters and a memory layout.', 'text'],
        ['Review exact destinations before anything is written.', 'text'],
        ['Existing memory content is preserved by the Rust setup engine.', 'muted'],
    ] : [
        ['Your work. One focused terminal workspace.', 'heading'], ['','text'],
        ['Install the command-line engine and choose your dashboard.', 'text'],
        ['A release install does not create or modify project databases.', 'muted'],
        ['No sudo, no shell-profile edits, no surprise source build.', 'muted'],
        ['You will review all destinations and choices before installing.', 'text'],
    ];
    if (page === 'Review') return s.mode === 'project' ? [
        ['PROJECT', 'muted'], [s.initial.project_id, 'heading'], [s.initial.project_root, 'text'],
        ['DATABASE', 'muted'], [s.initial.database, 'text'],
        ['MEMORY', 'muted'], [`${s.initial.memory_root} · ${s.memory_layout}`, 'text'],
        ['AGENT SKILLS', 'muted'], ...projectTargets(s).map(t => [t, 'accent']),
        ['Managed metadata and skills may be reconciled; memory content is preserved.', 'warn'],
    ] : [
        ['DESTINATION', 'muted'], [s.prefix.trim(), 'accent'],
        ['INSTALL', 'muted'], [`CLI${s.dashboard ? ' + dashboard' : ' only'}${s.verify ? ' · verify bwrk --version' : ''}`, 'text'],
        ['SOURCE', 'muted'], [s.initial.archive || (s.source === 'source' ? `Build source ref ${s.initial.ref || 'main'}` : s.initial.version ? `Release ${s.initial.version}` : 'Latest verified release'), 'text'],
        [s.replace_existing ? 'Existing unrecognized command replacement authorized.' : 'Existing unrecognized commands are protected.', 'warn'],
        ['No project database or shell profile will be changed.', 'muted'],
    ];
    return [];
}
function renderWizard(s, width = 100, height = 36) {
    const l = wizardLayout(width, height, s);
    ({ width, height } = l);
    s.viewport = { width, height };
    const screen = new Screen(width, height), p = l.body, page = s.steps[s.step];
    const rows = choices(s), multi = page === 'Agent tools' || page === 'Components';
    const pageName = s.help ? 'HELP / DETAILS' : page.toUpperCase();
    const step = `${s.step + 1}/${s.steps.length} ${pageName}`;
    if (l.large) {
        wordmark().forEach((line, i) => screen.text(l.x, i + 1, line, 'accent', l.totalWidth));
        screen.text(l.x, 7, s.mode === 'project' ? 'PROJECT SETUP / MAKE THIS REPOSITORY AGENT-READY' : 'INSTALLATION / A WORKSPACE FOR DELIBERATE WORK', 'muted', l.totalWidth);
        screen.text(l.x, 8, step, 'heading', l.totalWidth);
    } else if (l.top) {
        const compactTitle = width < 48 ? `${s.step + 1}/${s.steps.length} ${s.help ? 'Help' : page}` : `BOREAL / WORK  ·  ${step}`;
        screen.text(l.x, 0, clip(compactTitle, l.totalWidth), 'accent', l.totalWidth);
        if (l.top >= 4) {
            screen.text(l.x, 1, s.mode === 'project' ? 'PROJECT SETUP  /  adapters · memory · review' : 'INSTALLATION  /  destination · components · source', 'muted', l.totalWidth);
            const steps = s.steps.map((name, i) => i === s.step ? `[${i + 1} ${name}]` : `${i < s.step ? (s.ascii ? '+' : '✓') : i + 1} ${name}`).join('  ');
            screen.text(l.x, 2, cellWidth(steps) <= l.totalWidth ? steps : step, 'heading', l.totalWidth);
            screen.rule(l.x, 3, l.totalWidth, s.ascii);
        } else if (l.top >= 2) screen.text(l.x, 1, s.mode === 'project' ? `PROJECT  ${s.initial.project_id}` : 'INSTALLATION  /  no changes before confirmation', 'muted', l.totalWidth);
    }
    if (l.rail) {
        const r = l.rail;
        for (let y = r.y; y < r.y + r.height; y++) screen.text(r.x - 2, y, s.ascii ? '|' : '│', 'border', 1);
        screen.text(r.x, r.y, 'SETUP PLAN', 'heading', r.width);
        s.steps.forEach((name, i) => { if (i + 2 < r.height) screen.text(r.x, r.y + 2 + i, clip(`${i === s.step ? '>' : i < s.step ? '+' : ' '} ${i + 1} ${name}`, r.width), i === s.step ? 'accent' : 'muted', r.width); });
        if (r.height >= 10) {
            screen.text(r.x, r.y + r.height - 2, `${width}×${height} / ${l.chrome}`, 'muted', r.width);
            screen.text(r.x, r.y + r.height - 1, 'd density · ? help', 'muted', r.width);
        }
    }
    let position = 'No changes before confirmation.', hint = '', offset = 0, documentLength = 0;
    s.pageSize = p.height;
    if (s.help || page === 'Welcome' || page === 'Review') {
        const wrapped = wizardDocument(s).flatMap(([text, tone]) => wrapWords(text, p.width).map(text => ({ text, tone })));
        documentLength = wrapped.length;
        const max = Math.max(0, wrapped.length - p.height);
        if (s.help) { s.helpMax = max; s.helpScroll = Math.min(s.helpScroll, max); offset = s.helpScroll; }
        else { s.maxOffset = max; s.scroll = Math.min(s.scroll, max); offset = s.scroll; }
        wrapped.slice(offset, offset + p.height).forEach((line, i) => screen.text(p.x, p.y + i, line.text, line.tone, p.width));
        if (max) position = `${offset + 1}-${Math.min(wrapped.length, offset + p.height)}/${wrapped.length} · ↑↓ / End scroll`;
    } else if (page === 'Destination') {
        s.maxOffset = 0; s.scroll = 0;
        screen.text(p.x, p.y, inputDisplay(s.prefix, s.prefixCursor, p.width, s.ascii), 'accent', p.width);
        if (p.height > 2) {
            const hints = ['Installation prefix. The command goes in <prefix>/bin/bwrk.', 'Use a separate prefix to keep an existing installation.', '←→ edit · Home/End · Ctrl-U clear · F1 help'];
            hints.flatMap(t => wrapWords(t, p.width)).slice(0, p.height - 2).forEach((t, i) => screen.text(p.x, p.y + 2 + i, t, 'muted', p.width));
        }
        position = 'Prefix · ←→ edit · Ctrl-U clear · F1 help';
    } else {
        s.maxOffset = 0; s.scroll = 0;
        const roomy = l.chrome === 'comfortable' || l.chrome === 'standard';
        const stride = roomy && p.height >= rows.length * 3 + 2 ? 3 : p.height >= rows.length * 2 + 1 ? 2 : 1;
        const hintRows = stride === 1 && p.height >= 4 ? Math.min(2, Math.max(0, p.height - rows.length)) : 0;
        const capacity = Math.max(1, Math.floor((p.height - hintRows) / stride));
        s.pageSize = capacity;
        const start = windowStart(s.cursor, rows.length, capacity);
        rows.slice(start, start + capacity).forEach((row, i) => {
            const selected = start + i === s.cursor, prefix = `${selected ? '>' : ' '} ${multi ? '[' : '('}${row.on ? 'x' : ' '}${multi ? ']' : ')'} `;
            const y = p.y + i * stride;
            screen.text(p.x, y, fit(prefix + row.label + (row.locked ? ' [fixed]' : ''), p.width), selected ? 'selected' : 'text', p.width);
            if (stride > 1) screen.text(p.x + 6, y + 1, clip(row.hint, p.width - 6), 'muted', p.width - 6);
        });
        if (hintRows && rows[s.cursor]) {
            const focused = rows[s.cursor];
            wrapWords(`${focused.locked ? 'FIXED · ' : ''}${focused.hint}`, p.width).slice(0, hintRows).forEach((t, i) => screen.text(p.x, p.y + p.height - hintRows + i, t, focused.locked ? 'warn' : 'muted', p.width));
        }
        position = `Choice ${s.cursor + 1}/${rows.length}${multi ? ` · ${rows.filter(r => r.on).length} selected` : ''} · ? details`;
    }
    if (s.help) hint = adaptiveHint(l.totalWidth, '↑↓ / PgUp PgDn scroll · Esc close · Ctrl-C cancel', '↑↓ scroll · Esc close', '↑↓ Esc');
    else if (rows.length) hint = adaptiveHint(l.totalWidth, '↑↓ select · Space toggle · Enter continue · Esc back · Ctrl-C cancel · ? help', '↑↓ Space toggle · Enter next · Esc back · ^C cancel', '↑↓ Space · Enter · Esc', 'Space Enter Esc');
    else if (page === 'Review') {
        const action = s.scroll < s.maxOffset ? 'Enter next page' : s.mode === 'project' ? 'Enter apply setup' : 'Enter install';
        hint = adaptiveHint(l.totalWidth, `${action} · ↑↓ / End scroll · Esc back · Ctrl-C cancel`, `${action} · Esc back`, s.scroll < s.maxOffset ? 'Enter more / Esc' : 'Enter apply / Esc');
    } else hint = adaptiveHint(l.totalWidth, 'Enter continue · Esc back · Ctrl-C cancel · F1 help', 'Enter next · Esc back · ^C cancel', 'Enter / Esc / ^C');
    if (l.footer >= 2) screen.text(l.x, height - 2, clip(s.error && !s.help ? `${s.error} (! / F1 details)` : position, l.totalWidth), s.error && !s.help ? 'danger' : 'muted', l.totalWidth);
    if (l.footer) screen.text(l.x, height - 1, fit(height < 4 && s.error ? s.error : hint, l.totalWidth), page === 'Review' && !s.help ? 'accent' : 'text', l.totalWidth);
    return screen;
}
function machineInitial(args) {
    const [prefix, version, source, archive, ref, dashboard, verify, replace_existing, source_locked] = args;
    const collision = fs.existsSync(path.join(prefix, 'bin/bwrk')) && !fs.existsSync(path.join(prefix, 'share/boreal/release.json'));
    return { prefix, version, source: source === '1' ? 'source' : 'release', archive, ref, dashboard: dashboard !== '0', verify: verify !== '0', replace_existing: replace_existing === '1', source_locked: source_locked === '1', collision };
}
async function runWizard(args) {
    const mode = args[0], initial = mode === 'project' ? JSON.parse(args[1]) : machineInitial(args.slice(1));
    const state = createWizardState(mode, initial);
    let input, output, inputFd, outputFd, closed = false, settled = false, escapeTimer, disposeSize;
    const cleanup = () => {
        if (closed)
            return;
        closed = true;
        disposeSize?.();
        if (escapeTimer)
            clearTimeout(escapeTimer);
        try {
            input?.setRawMode(false);
        }
        catch { }
        try {
            output?.write('\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l');
        }
        catch { }
        input?.pause();
        input?.removeAllListeners();
        output?.removeAllListeners();
        input?.destroy();
        output?.destroy();
        // The tty handles own reopened descriptors; release our originals too.
        for (const fd of [inputFd, outputFd]) { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
        inputFd = outputFd = undefined;
    };
    try {
        inputFd = fs.openSync('/dev/tty', 'r');
        input = new tty.ReadStream(inputFd);
        outputFd = fs.openSync('/dev/tty', 'w');
        output = new tty.WriteStream(outputFd);
        if (!input.isTTY || !output.isTTY)
            throw new Error('An interactive terminal is required. Use --yes for automation.');
        const writer = new FrameWriter(value => output.write(value)), decoder = new StreamingKeyDecoder();
        state.forceMono = process.env.NO_COLOR !== undefined;
        state.theme = state.forceMono || process.env.BOREAL_THEME === 'mono' ? 'mono' : process.env.BOREAL_THEME === 'light' ? 'light' : 'dark';
        state.ascii = process.env.BOREAL_ASCII === '1';
        state.density = ['auto', 'compact', 'comfortable'].includes(process.env.BOREAL_TUI_DENSITY) ? process.env.BOREAL_TUI_DENSITY : 'auto';
        const sizes = new TerminalSizeTracker(() => ({ width: output.columns, height: output.rows }));
        const draw = () => { if (!closed) { const size = sizes.dimensions(); writer.paint(renderWizard(state, size.width, size.height), state.theme); } };
        const result = await new Promise((resolve, reject) => {
            const onKey = key => {
                if (closed || settled)
                    return;
                if (key === 'ctrl-l') { writer.invalidate(); draw(); return; }
                const action = applyWizardKey(state, key);
                if (action === 'cancel') {
                    settled = true;
                    resolve(null);
                    return;
                }
                if (action === 'submit') {
                    settled = true;
                    resolve(wizardResult(state));
                    return;
                }
                draw();
            };
            input.on('error', reject);
            output.on('error', reject);
            input.on('end', () => resolve(null));
            input.on('data', chunk => {
                if (escapeTimer)
                    clearTimeout(escapeTimer);
                decoder.push(chunk).forEach(onKey);
                if (decoder.awaitingEscape)
                    escapeTimer = setTimeout(() => decoder.flushEscape().forEach(onKey), 35);
            });

            const cancel = () => { settled = true; resolve(null); };
            process.once('SIGINT', cancel);
            process.once('SIGTERM', cancel);
            process.once('SIGHUP', cancel);
            state.disposeSignals = () => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); process.off('SIGHUP', cancel); };
            output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
            input.setRawMode(true);
            input.resume();
            disposeSize = sizes.subscribe(() => { writer.invalidate(); draw(); });
            draw();
        });
        cleanup();
        state.disposeSignals?.();
        if (result === null) {
            process.stderr.write('Boreal setup cancelled. No installation was started.\n');
            process.exitCode = 130;
            return;
        }
        process.stdout.write(JSON.stringify(result) + '\n');
    }
    finally {
        cleanup();
        state.disposeSignals?.();
    }
}
module.exports = { createWizardState, applyWizardKey, renderWizard, wizardResult, validateWizard, wordmark, choices, wizardLayout, wizardDocument };
if (require.main === module || process.argv[1] === 'project') {
    const args = process.argv[1] === 'project' ? process.argv.slice(1) : process.argv.slice(2);
    runWizard(args).catch(error => { process.stderr.write(`Boreal setup: ${safeText(error.message)}\n`); process.exitCode = 1; });
}
