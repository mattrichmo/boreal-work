# R-INSTALLER — scripts/build-installer.mjs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/build-installer.mjs:L1–L31`  
**File SHA-256:** `bf7dd503d6de0695c159e27096fa7a15b6261cf5ea9d5aed5fe25448a32e51fd`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Canonical wizard bundle and embedded installer identity; generated-file writer must be serialized.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,31p' 'scripts/build-installer.mjs'
```

## Exact baseline excerpt

````text
    1 | #!/usr/bin/env node
    2 | /** Run after tsc, before cargo. One renderer is embedded into both installer entry points. */
    3 | import { readFileSync, writeFileSync } from 'node:fs';
    4 | import { resolve, dirname } from 'node:path';
    5 | import { fileURLToPath } from 'node:url';
    6 | const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    7 | const check = process.argv.includes('--check');
    8 | const modules = ['cells', 'screen', 'keys', 'layout', 'input', 'terminal-size'].map(name => readFileSync(resolve(root, `apps/tui/dist/ui/${name}.js`), 'utf8')
    9 |     .replace(/^import .*;\n/gm, '').replace(/^export \{.*\};?\n/gm, '').replace(/^export /gm, ''));
   10 | const body = readFileSync(resolve(root, 'apps/tui/installer/wizard-body.cjs'), 'utf8');
   11 | const generated = `// GENERATED: scripts/build-installer.mjs. Edit wizard-body.cjs or src/ui, not this file.\n'use strict';\nconst {openSync: openTerminalFd, closeSync: closeTerminalFd} = require('node:fs');\nconst {WriteStream: TerminalSizeStream} = require('node:tty');\n${modules.join('\n')}\n${body}`;
   12 | const target = resolve(root, 'apps/tui/installer/wizard.cjs');
   13 | if (check) {
   14 |     if (readFileSync(target, 'utf8') !== generated)
   15 |         throw new Error('wizard.cjs is stale; run node scripts/build-installer.mjs');
   16 | }
   17 | else
   18 |     writeFileSync(target, generated);
   19 | const shellPath = resolve(root, 'install.sh'), shell = readFileSync(shellPath, 'utf8');
   20 | const start = '# BOREAL_EMBEDDED_WIZARD_BEGIN\n', end = '# BOREAL_EMBEDDED_WIZARD_END';
   21 | if (!shell.includes(start) || !shell.includes(end))
   22 |     throw new Error('install.sh is missing its wizard markers');
   23 | const replacement = `${start}cat > "$UI_TEMP/wizard.cjs" <<'BOREAL_WIZARD_JS'\n${generated}\nBOREAL_WIZARD_JS\n${end}`;
   24 | const next = shell.slice(0, shell.indexOf(start)) + replacement + shell.slice(shell.indexOf(end) + end.length);
   25 | if (check) {
   26 |     if (next !== shell)
   27 |         throw new Error('install.sh wizard is stale; run the installer generator');
   28 | }
   29 | else
   30 |     writeFileSync(shellPath, next);
   31 | console.log(check ? 'Installer bundles match their source.' : 'Updated standalone and embedded installer UI.');
````
