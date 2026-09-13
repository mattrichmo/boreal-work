import { useStdout } from "ink";
import { useInsertionEffect } from "react";

const ESC = "";
const ENTER_ALT = `${ESC}[?1049h${ESC}[2J${ESC}[H`;
const EXIT_ALT = `${ESC}[?1049l`;
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1006h`;
const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1000l`;

export interface TerminalLifecycleProcess {
  on(event: "exit" | "SIGINT" | "SIGTERM" | "SIGHUP", listener: (...args: any[]) => void): unknown;
  off(event: "exit" | "SIGINT" | "SIGTERM" | "SIGHUP", listener: (...args: any[]) => void): unknown;
  exit(code: number): never | void;
}

/** Install terminal escape/lifecycle handling and return an idempotent restore. */
export function installTerminalLifecycle(input: {
  readonly write: (value: string) => void;
  readonly processLike: TerminalLifecycleProcess;
  readonly enableMouse: boolean;
}): () => void {
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    input.write((input.enableMouse ? MOUSE_OFF : "") + EXIT_ALT);
  };
  const onExit = (): void => restore();
  const onSignal = (signal: "SIGINT" | "SIGTERM" | "SIGHUP"): void => {
    restore();
    input.processLike.exit(signal === "SIGINT" ? 130 : 143);
  };
  const onSignalHandlers = {
    SIGINT: onSignal.bind(null, "SIGINT"),
    SIGTERM: onSignal.bind(null, "SIGTERM"),
    SIGHUP: onSignal.bind(null, "SIGHUP")
  };
  input.write(ENTER_ALT + (input.enableMouse ? MOUSE_ON : ""));
  input.processLike.on("exit", onExit);
  input.processLike.on("SIGINT", onSignalHandlers.SIGINT);
  input.processLike.on("SIGTERM", onSignalHandlers.SIGTERM);
  input.processLike.on("SIGHUP", onSignalHandlers.SIGHUP);
  return () => {
    restore();
    input.processLike.off("exit", onExit);
    // Signal listeners are bound below so each exact function can be removed.
    input.processLike.off("SIGINT", onSignalHandlers.SIGINT);
    input.processLike.off("SIGTERM", onSignalHandlers.SIGTERM);
    input.processLike.off("SIGHUP", onSignalHandlers.SIGHUP);
  };
}

// Enter the alternate screen for the lifetime of the component, enable SGR
// mouse tracking, and — critically — restore the main screen on every exit
// path (unmount, SIGINT/SIGTERM/SIGHUP, normal exit). A manual escape written
// before render() and undone in a .finally() leaks the alt screen when the
// process is signalled. useInsertionEffect runs during the mutation phase, so
// the enter sequence reaches the terminal before Ink paints the first frame.
// Mouse tracking is opt-in: enabling it captures the mouse and disables the
// terminal's own text selection / copy, so it's off unless the user asks
// (--mouse) and confirms wheel events actually arrive on their terminal.
export function useAltScreen(enableMouse = false): void {
  const { stdout } = useStdout();
  useInsertionEffect(() => {
    const out = stdout ?? process.stdout;
    // RouteApp can also be rendered by tests or embedded callers without a
    // real terminal. Never emit alternate-screen or mouse escape sequences
    // into a pipe/log stream where there is no lifecycle to restore them.
    if (out.isTTY !== true || process.stdin.isTTY !== true) return undefined;
    const write = (value: string): void => {
      try {
        out.write(value);
      } catch {
        /* terminal closed */
      }
    };
    return installTerminalLifecycle({ write, processLike: process, enableMouse });
  }, [stdout, enableMouse]);
}

export type WheelDirection = "up" | "down";

// SGR mouse wheel arrives as ESC [ < 64 ; col ; row M (up) / 65 (down).
// Ink surfaces unrecognised sequences as raw `input`; detect the wheel there.
export function wheelFromInput(input: string): WheelDirection | undefined {
  const match = /\[<(\d+);\d+;\d+[Mm]/u.exec(input);
  if (!match) return undefined;
  const button = Number(match[1]);
  if (button === 64) return "up";
  if (button === 65) return "down";
  return undefined;
}
