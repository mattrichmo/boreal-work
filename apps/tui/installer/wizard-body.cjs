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
