# Retained execution: baseline-tui

Command: `npm --prefix apps/tui test`

Exit: 1. Baseline failure: installer CJS source omitted from supplied archive.

```text

> test
> tsc && node dist/test.js && node --test tests/*.test.mjs

TUI mounted workflow, protocol/error, monitoring, disabled-action, pagination, recovery, terminal, and refresh tests passed
TAP version 13
# node:internal/modules/cjs/loader:1401
#   const err = new Error(message);
#               ^
# Error: Cannot find module '../installer/wizard.cjs'
# Require stack:
# - /mnt/data/workspace/boreal-v2/apps/tui/tests/premium.test.mjs
#     at Function._resolveFilename (node:internal/modules/cjs/loader:1401:15)
#     at defaultResolveImpl (node:internal/modules/cjs/loader:1057:19)
#     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1062:22)
#     at Function._load (node:internal/modules/cjs/loader:1211:37)
#     at TracingChannel.traceSync (node:diagnostics_channel:322:14)
#     at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)
#     at Module.require (node:internal/modules/cjs/loader:1487:12)
#     at require (node:internal/modules/helpers:135:16)
#     at file:///mnt/data/workspace/boreal-v2/apps/tui/tests/premium.test.mjs:16:110
#     at ModuleJob.run (node:internal/modules/esm/module_job:274:25) {
#   code: 'MODULE_NOT_FOUND',
#   requireStack: [ '/mnt/data/workspace/boreal-v2/apps/tui/tests/premium.test.mjs' ]
# }
# Node.js v22.16.0
# Subtest: tests/premium.test.mjs
not ok 1 - tests/premium.test.mjs
  ---
  duration_ms: 56.667161
  type: 'test'
  location: '/mnt/data/workspace/boreal-v2/apps/tui/tests/premium.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# node:internal/modules/cjs/loader:1401
#   const err = new Error(message);
#               ^
# Error: Cannot find module '../installer/wizard.cjs'
# Require stack:
# - /mnt/data/workspace/boreal-v2/apps/tui/tests/responsive.test.mjs
#     at Function._resolveFilename (node:internal/modules/cjs/loader:1401:15)
#     at defaultResolveImpl (node:internal/modules/cjs/loader:1057:19)
#     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1062:22)
#     at Function._load (node:internal/modules/cjs/loader:1211:37)
#     at TracingChannel.traceSync (node:diagnostics_channel:322:14)
#     at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)
#     at Module.require (node:internal/modules/cjs/loader:1487:12)
#     at require (node:internal/modules/helpers:135:16)
#     at file:///mnt/data/workspace/boreal-v2/apps/tui/tests/responsive.test.mjs:15:84
#     at ModuleJob.run (node:internal/modules/esm/module_job:274:25) {
#   code: 'MODULE_NOT_FOUND',
#   requireStack: [
#     '/mnt/data/workspace/boreal-v2/apps/tui/tests/responsive.test.mjs'
#   ]
# }
# Node.js v22.16.0
# Subtest: tests/responsive.test.mjs
not ok 2 - tests/responsive.test.mjs
  ---
  duration_ms: 55.00766
  type: 'test'
  location: '/mnt/data/workspace/boreal-v2/apps/tui/tests/responsive.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..2
# tests 2
# suites 0
# pass 0
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 66.400592

```
