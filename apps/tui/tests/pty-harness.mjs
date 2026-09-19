/** PTY lifecycle test adapter. This does not start, impersonate or write to a real service. */
import { runFullScreen } from '../dist/full-screen.js';
import { FakeController } from './fixtures.mjs';
import { processTerminal } from '../dist/entrypoint.js';
const terminal = processTerminal();
await runFullScreen(new FakeController(), terminal, { auto_refresh_ms: 0 });
process.stdout.write('\nBOREAL_PTY_RESTORED\n');
