// GENERATED: scripts/build-installer.mjs. Edit wizard-body.cjs or src/ui, not this file.
'use strict';
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
const CSI = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "shift-tab", "1~": "home", "4~": "end", "7~": "home", "8~": "end", "3~": "delete", "5~": "page-up", "6~": "page-down" };
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
    return { mode, initial, steps, step: 0, cursor: 0, error: '', scroll: 0, maxOffset: 0,
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
            s.scroll = Math.min(s.maxOffset, s.scroll + 6);
        if (key === 'page-up')
            s.scroll = Math.max(0, s.scroll - 6);
        if (key === 'end')
            s.scroll = s.maxOffset;
        if (key === 'home')
            s.scroll = 0;
    }
    if (page === 'Destination') {
        if (key === 'backspace')
            s.prefix = eraseLast(s.prefix);
        else if (key === 'ctrl-u')
            s.prefix = '';
        else if (key.startsWith('paste:'))
            s.prefix = (s.prefix + key.slice(6).replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')).slice(0, 4096);
        else if (Array.from(key).length === 1)
            s.prefix = (s.prefix + key).slice(0, 4096);
    }
    else {
        if (key === 'q')
            return 'cancel';
        if (key === 'down' || key === 'j' || key === 'tab')
            s.cursor = (s.cursor + 1) % Math.max(1, rows.length);
        if (key === 'up' || key === 'k' || key === 'shift-tab')
            s.cursor = (s.cursor + Math.max(1, rows.length) - 1) % Math.max(1, rows.length);
        if ([' ', 'left', 'right'].includes(key) && rows[s.cursor]) {
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
            if (s.scroll < s.maxOffset) {
                s.error = 'Scroll to the end of the review (End / ↓) before confirming.';
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
function renderWizard(s, width = 100, height = 36) {
    width = Math.max(1, Math.min(300, Math.floor(width)));
    height = Math.max(1, Math.min(120, Math.floor(height)));
    const screen = new Screen(width, height);
    if (width < 48 || height < 18) {
        screen.text(2, 2, 'BOREAL / WORK', 'accent');
        screen.text(2, 4, 'Resize to at least 48×18.', 'warn');
        screen.text(2, 6, 'Ctrl-C cancels without installing.', 'muted');
        return screen;
    }
    const contentWidth = Math.min(92, width - 6), x = Math.floor((width - contentWidth) / 2);
    const large = height >= 32 && width >= 76, compact = height < 24;
    let y = compact ? 1 : 2;
    if (large) {
        wordmark().forEach((line, i) => screen.text(x, y + i, line, 'accent', contentWidth));
        y += 6;
    }
    else {
        screen.text(x, y, 'BOREAL / WORK', 'accent');
        y += 2;
    }
    if (!compact) {
        screen.text(x, y, s.mode === 'project' ? 'PROJECT SETUP  /  make this repository agent-ready' : 'INSTALLATION  /  a workspace for deliberate work', 'muted', contentWidth);
        y += 2;
    }
    const stepper = s.steps.map((step, i) => `${i < s.step ? '✓' : i + 1} ${step}`).join('   ');
    screen.text(x, y, clip(stepper, contentWidth), 'muted', contentWidth);
    y += 2;
    screen.rule(x, y, contentWidth);
    y += 2;
    const page = s.steps[s.step];
    screen.text(x, y, `${String(s.step + 1).padStart(2, '0')}   ${page.toUpperCase()}`, 'heading', contentWidth);
    y += 2;
    const bottom = height - 5, available = Math.max(1, bottom - y);
    let lines = [];
    if (page === 'Welcome')
        lines = s.mode === 'project' ? [
            ['A clear place for plans, progress and proof.', 'heading'],
            ['', 'text'], [s.initial.project_id, 'accent'], [s.initial.project_root, 'muted'],
            ['', 'text'], ['Choose agent adapters and a memory layout.', 'text'],
            ['Review exact destinations before anything is written.', 'text'],
            ['Existing memory content is preserved by the Rust setup engine.', 'muted'],
        ] : [
            ['Your work. One focused terminal workspace.', 'heading'], ['', 'text'],
            ['Install the command-line engine and choose your dashboard.', 'text'],
            ['A release install does not create or modify project databases.', 'muted'],
            ['No sudo, no shell-profile edits, no surprise source build.', 'muted'],
            ['', 'text'], ['You will review the destination and all changes before installing.', 'text'],
        ];
    else if (page === 'Destination')
        lines = [
            ['Installation prefix', 'muted'], [`${inputTail(s.prefix, contentWidth - 2)}▏`, 'accent'], ['', 'text'],
            ['The command is installed under <prefix>/bin/bwrk.', 'text'],
            ['Use a separate prefix to keep an existing v1 installation.', 'warn'],
            ['Type to edit · Ctrl-U clears the path.', 'muted'],
        ];
    else if (page === 'Review') {
        if (s.mode === 'project')
            lines = [
                ['PROJECT', 'muted'], [`${s.initial.project_id} · ${s.initial.project_root}`, 'text'],
                ['DATABASE', 'muted'], [s.initial.database, 'text'],
                ['MEMORY', 'muted'], [`${s.initial.memory_root} · ${s.memory_layout}`, 'text'],
                ['AGENT SKILLS', 'muted'], ...projectTargets(s).map(t => [t, 'accent']),
                ['', 'text'], ['Managed metadata and skills may be reconciled; memory content is preserved.', 'warn'],
            ];
        else
            lines = [
                ['DESTINATION', 'muted'], [s.prefix, 'accent'],
                ['INSTALL', 'muted'], [`CLI${s.dashboard ? ' + dashboard' : ' only'}${s.verify ? ' · verify bwrk --version' : ''}`, 'text'],
                ['SOURCE', 'muted'], [s.initial.archive || (s.source === 'source' ? `Build source ref ${s.initial.ref || 'main'}` : s.initial.version ? `Release ${s.initial.version}` : 'Latest verified release'), 'text'],
                ['', 'text'], [s.replace_existing ? 'Existing unrecognized command replacement authorized.' : 'Existing unrecognized commands are protected.', 'warn'],
                ['No project database or shell profile will be changed.', 'muted'],
            ];
    }
    else {
        const rows = choices(s), maxRows = Math.max(1, Math.floor((available - 1) / 3)), start = Math.max(0, s.cursor - maxRows + 1);
        rows.slice(start, start + maxRows).forEach((row, i) => {
            const selected = start + i === s.cursor;
            lines.push([`${selected ? '>' : ' '} [${row.on ? 'x' : ' '}] ${row.label}${row.locked ? '  (fixed)' : ''}`, selected ? 'selected' : 'text']);
            lines.push([`        ${row.hint}`, 'muted']);
            lines.push(['', 'text']);
        });
        if (page === 'Source' && s.source === 'source')
            lines.push(['Builds trusted source. Release verification does not apply to a source checkout.', 'warn']);
    }
    const wrapped = lines.flatMap(([text, tone]) => wrapWords(text, contentWidth).map(text => ({ text, tone })));
    s.maxOffset = choices(s).length ? 0 : Math.max(0, wrapped.length - available);
    s.scroll = Math.min(s.scroll, s.maxOffset);
    wrapped.slice(s.scroll, s.scroll + available).forEach((l, i) => screen.text(x, y + i, l.text, l.tone, contentWidth));
    if (s.error)
        screen.text(x, height - 5, clip(s.error, contentWidth), 'danger', contentWidth);
    screen.rule(x, height - 4, contentWidth);
    const action = page === 'Review' ? (s.mode === 'project' ? 'Enter apply setup' : 'Enter install') : 'Enter continue';
    screen.text(x, height - 3, clip(`${action}   ${choices(s).length ? '↑↓ select · Space toggle   ' : ''}Esc back · Ctrl-C cancel`, contentWidth), 'text', contentWidth);
    const position = s.maxOffset ? `↑↓ / End scroll · ${s.scroll + 1}–${Math.min(wrapped.length, s.scroll + available)} / ${wrapped.length}` : choices(s).length ? `Choice ${s.cursor + 1} / ${choices(s).length}` : 'No changes before confirmation.';
    screen.text(x, height - 2, `${s.step + 1} / ${s.steps.length}   ${position}`, 'muted', contentWidth);
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
    let input, output, closed = false, settled = false, escapeTimer;
    const cleanup = () => {
        if (closed)
            return;
        closed = true;
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
    };
    try {
        input = new tty.ReadStream(fs.openSync('/dev/tty', 'r'));
        output = new tty.WriteStream(fs.openSync('/dev/tty', 'w'));
        if (!input.isTTY || !output.isTTY)
            throw new Error('An interactive terminal is required. Use --yes for automation.');
        const writer = new FrameWriter(value => output.write(value)), decoder = new StreamingKeyDecoder();
        const theme = process.env.NO_COLOR !== undefined || process.env.BOREAL_THEME === 'mono' ? 'mono' : process.env.BOREAL_THEME === 'light' ? 'light' : 'dark';
        const draw = () => { if (!closed)
            writer.paint(renderWizard(state, output.columns || 80, output.rows || 24), theme); };
        const result = await new Promise((resolve, reject) => {
            const onKey = key => {
                if (closed || settled)
                    return;
                const small = (output.columns || 80) < 48 || (output.rows || 24) < 18;
                if (small && !['ctrl-c', 'ctrl-d'].includes(key))
                    return;
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
            output.on('resize', () => { writer.invalidate(); draw(); });
            const cancel = () => { settled = true; resolve(null); };
            process.once('SIGINT', cancel);
            process.once('SIGTERM', cancel);
            process.once('SIGHUP', cancel);
            state.disposeSignals = () => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); process.off('SIGHUP', cancel); };
            output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
            input.setRawMode(true);
            input.resume();
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
module.exports = { createWizardState, applyWizardKey, renderWizard, wizardResult, validateWizard, wordmark, choices };
if (require.main === module || process.argv[1] === 'project') {
    const args = process.argv[1] === 'project' ? process.argv.slice(1) : process.argv.slice(2);
    runWizard(args).catch(error => { process.stderr.write(`Boreal setup: ${safeText(error.message)}\n`); process.exitCode = 1; });
}
