import type { Key } from "ink";

/** Shared physical-key matcher used by route bindings and their hints. */
export function matchToken(token: string, input: string, key: Key): boolean {
  switch (token) {
    case "move":
      return Boolean(key.upArrow || key.downArrow) || input === "j" || input === "k";
    case "drill":
      return Boolean(key.return || key.rightArrow) || input === "l";
    case "drillRollup":
      return Boolean(key.return);
    case "toggleDisclosure":
      return input === " ";
    case "expandDisclosure":
      return Boolean(key.rightArrow) || input === "l";
    case "collapseDisclosure":
      return Boolean(key.leftArrow) || input === "h";
    case "readyFilter":
      return input === "a";
    case "back":
      return Boolean(key.escape || key.backspace || key.delete || key.leftArrow) || input === "h";
    default:
      return input === token;
  }
}
