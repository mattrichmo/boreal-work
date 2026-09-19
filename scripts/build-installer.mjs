#!/usr/bin/env node
/** Run after tsc, before cargo. One renderer is embedded into both installer entry points. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const modules = ['cells', 'screen', 'keys'].map(name => readFileSync(resolve(root, `apps/tui/dist/ui/${name}.js`), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export \{.*\};?\n/gm, '').replace(/^export /gm, ''));
const body = readFileSync(resolve(root, 'apps/tui/installer/wizard-body.cjs'), 'utf8');
const generated = `// GENERATED: scripts/build-installer.mjs. Edit wizard-body.cjs or src/ui, not this file.\n'use strict';\n${modules.join('\n')}\n${body}`;
const target = resolve(root, 'apps/tui/installer/wizard.cjs');
if (check) {
    if (readFileSync(target, 'utf8') !== generated)
        throw new Error('wizard.cjs is stale; run node scripts/build-installer.mjs');
}
else
    writeFileSync(target, generated);
const shellPath = resolve(root, 'install.sh'), shell = readFileSync(shellPath, 'utf8');
const start = '# BOREAL_EMBEDDED_WIZARD_BEGIN\n', end = '# BOREAL_EMBEDDED_WIZARD_END';
if (!shell.includes(start) || !shell.includes(end))
    throw new Error('install.sh is missing its wizard markers');
const replacement = `${start}cat > "$UI_TEMP/wizard.cjs" <<'BOREAL_WIZARD_JS'\n${generated}\nBOREAL_WIZARD_JS\n${end}`;
const next = shell.slice(0, shell.indexOf(start)) + replacement + shell.slice(shell.indexOf(end) + end.length);
if (check) {
    if (next !== shell)
        throw new Error('install.sh wizard is stale; run the installer generator');
}
else
    writeFileSync(shellPath, next);
console.log(check ? 'Installer bundles match their source.' : 'Updated standalone and embedded installer UI.');
