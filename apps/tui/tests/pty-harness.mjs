/** PTY lifecycle test adapter. This does not start, impersonate or write to a real service. */
import { runFullScreen } from '../dist/full-screen.js';
import { FakeController } from './fixtures.mjs';
const terminal = {
    is_tty: process.stdin.isTTY === true && process.stdout.isTTY === true,
    was_raw: process.stdin.isRaw === true,
    dimensions: () => ({ width: process.stdout.columns ?? 80, height: process.stdout.rows ?? 24 }),
    write: value => process.stdout.write(value),
    setRawMode: value => process.stdin.setRawMode(value),
    resume: () => process.stdin.resume(), pause: () => process.stdin.pause(),
    onData(listener) { process.stdin.on('data', listener); return () => process.stdin.off('data', listener); },
    onEnd(listener) { process.stdin.on('end', listener); return () => process.stdin.off('end', listener); },
    onResize(listener) { process.stdout.on('resize', listener); return () => process.stdout.off('resize', listener); },
    onSignal(signal, listener) { process.on(signal, listener); return () => process.off(signal, listener); },
};
await runFullScreen(new FakeController(), terminal, { auto_refresh_ms: 0 });
process.stdout.write('\nBOREAL_PTY_RESTORED\n');
