import type { Key } from "ink";

/** Shared physical-key matcher used by route bindings and their hints. */
export function matchToken(token: string, input: string, key: Key): boolean {
  switch (token) {
    case "move":
      return Boolean(key.upArrow || key.downArrow) || input === "j" || input === "k";
    case "drill":
      return Boolean(key.return || key.rightArrow) || input === "l";
    case "back":
      return Boolean(key.escape || key.backspace || key.delete || key.leftArrow) || input === "h";
    default:
      return input === token;
  }
}
