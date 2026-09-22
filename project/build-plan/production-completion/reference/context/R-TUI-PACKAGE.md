# R-TUI-PACKAGE — apps/tui/package.json

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/package.json:L1–L20`  
**File SHA-256:** `1c2c90da7d5fdc98c8648193c825678a3e465f18fb4a461f721f8050fb5300f1`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Actual npm commands and declared Node range; validate supported runtime policy at release, not by assumption.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,20p' 'apps/tui/package.json'
```

## Exact baseline excerpt

````text
    1 | {
    2 |   "name": "@boreal/tui",
    3 |   "private": true,
    4 |   "type": "module",
    5 |   "engines": {
    6 |     "node": ">=20 <27"
    7 |   },
    8 |   "bin": {
    9 |     "bwrk-tui": "./dist/entrypoint.js"
   10 |   },
   11 |   "scripts": {
   12 |     "build": "tsc",
   13 |     "typecheck": "tsc --noEmit",
   14 |     "test": "tsc && node dist/test.js && node --test tests/*.test.mjs",
   15 |     "start": "tsc && node dist/entrypoint.js",
   16 |     "test:premium": "tsc && node --test tests/*.test.mjs",
   17 |     "build:installer": "tsc && node ../../scripts/build-installer.mjs",
   18 |     "verify:installer": "node ../../scripts/build-installer.mjs --check"
   19 |   }
   20 | }
````
