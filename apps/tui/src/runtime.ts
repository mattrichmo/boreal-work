import { useStdout } from "ink";
import { useInsertionEffect } from "react";

const ESC = "";
const ENTER_ALT = `${ESC}[?1049h${ESC}[2J${ESC}[H`;
const EXIT_ALT = `${ESC}[?1049l`;
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1006h`;
const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1000l`;

// Enter the alternate screen for the lifetime of the component, enable SGR
// mouse tracking, and — critically — restore the main screen on every exit
// path (unmount, SIGINT/SIGTERM/SIGHUP, normal exit). A manual escape written
// before render() and undone in a .finally() leaks the alt screen when the
// process is signalled. useInsertionEffect runs during the mutation phase, so
// the enter sequence reaches the terminal before Ink paints the first frame.
export function useAltScreen(enableMouse = true): void {
  const { stdout } = useStdout();
  useInsertionEffect(() => {
    const out = stdout ?? process.stdout;
    const write = (value: string): void => {
      try {
        out.write(value);
      } catch {
        /* terminal closed */
      }
    };
    let restored = false;
    const restore = (): void => {
      if (restored) return;
      restored = true;
      write((enableMouse ? MOUSE_OFF : "") + EXIT_ALT);
    };
    const onExit = (): void => restore();
    const onSignal = (signal: NodeJS.Signals): void => {
      restore();
      process.exit(signal === "SIGINT" ? 130 : 143);
    };

    write(ENTER_ALT + (enableMouse ? MOUSE_ON : ""));
    process.on("exit", onExit);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);

    return () => {
      restore();
      process.off("exit", onExit);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
    };
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
