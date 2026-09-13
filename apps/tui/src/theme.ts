export type ColorMode = "color" | "light" | "terminal-default" | "high-contrast" | "none";

export interface ColorPalette {
  readonly accent: string;
  readonly accentSoft: string;
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  readonly warn: string;
  readonly danger: string;
  readonly selectionBg: string;
  readonly barBg: string;
}

const COLOR_PALETTES: Readonly<Record<ColorMode, ColorPalette>> = {
  color: {
    accent: "#82e69a",
    accentSoft: "#b0f5bd",
    text: "#f1f8f3",
    muted: "#c0cec5",
    faint: "#a6b5ac",
    warn: "#f0d477",
    danger: "#ff9898",
    selectionBg: "#183321",
    barBg: "#0c100d"
  },
  light: {
    accent: "#176b35",
    accentSoft: "#285f3a",
    text: "#17221b",
    muted: "#526158",
    faint: "#6f7b73",
    warn: "#855b00",
    danger: "#a02f2f",
    selectionBg: "#d9f1df",
    barBg: "#edf3ee"
  },
  "terminal-default": {
    accent: "green",
    accentSoft: "brightGreen",
    text: "",
    muted: "",
    faint: "",
    warn: "yellow",
    danger: "red",
    selectionBg: "",
    barBg: ""
  },
  "high-contrast": {
    accent: "#00ff66",
    accentSoft: "#baffc9",
    text: "#ffffff",
    muted: "#f0f0f0",
    faint: "#d2d2d2",
    warn: "#ffe066",
    danger: "#ff9f9f",
    selectionBg: "#244d32",
    barBg: "#000000"
  },
  none: {
    // Ink skips SGR output for empty colour values. Keeping the palette shape
    // intact means every existing component can remain colour-mode agnostic.
    accent: "",
    accentSoft: "",
    text: "",
    muted: "",
    faint: "",
    warn: "",
    danger: "",
    selectionBg: "",
    barBg: ""
  }
};

export function resolveColorMode(env: Readonly<Record<string, string | undefined>> = process.env): ColorMode {
  // NO_COLOR is presence-based by convention, including NO_COLOR="".
  if (Object.prototype.hasOwnProperty.call(env, "NO_COLOR") || env.BOREAL_TUI_NO_COLOR === "1") return "none";
  if (env.BOREAL_TUI_HIGH_CONTRAST === "1" || env.BOREAL_TUI_COLOR_MODE === "high-contrast") return "high-contrast";
  if (env.BOREAL_TUI_COLOR_MODE === "light") return "light";
  if (env.BOREAL_TUI_COLOR_MODE === "terminal-default") return "terminal-default";
  return "color";
}

export function createColorPalette(mode: ColorMode): ColorPalette {
  return COLOR_PALETTES[mode];
}

export const COLOR = createColorPalette(resolveColorMode());

export function statusColor(status: string): string {
  switch (status) {
    case "ready":
      return COLOR.accent;
    case "in_progress":
    case "reserved":
      return COLOR.accentSoft;
    case "verified":
    case "complete":
      return COLOR.accent;
    case "closed":
      return COLOR.accent;
    case "blocked":
      return COLOR.danger;
    case "needs_verification":
      return COLOR.warn;
    case "cancelled":
      return COLOR.danger;
    default:
      return COLOR.muted;
  }
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  ready: "ready",
  in_progress: "in progress",
  reserved: "reserved",
  needs_verification: "needs verification",
  blocked: "blocked",
  verified: "complete",
  complete: "complete",
  closed: "complete",
  cancelled: "cancelled",
  draft: "draft"
};

export function statusGlyph(status: string): string {
  return {
    ready: "○",
    in_progress: "●",
    reserved: "◉",
    needs_verification: "◇",
    blocked: "!",
    verified: "✓",
    complete: "✓",
    closed: "✓",
    cancelled: "×"
  }[status] ?? "·";
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function healthColor(health: string): string {
  if (health === "ok") return COLOR.accent;
  if (health === "warning") return COLOR.warn;
  if (health === "error" || health === "critical") return COLOR.danger;
  if (health === "missing") return COLOR.danger;
  return COLOR.muted;
}

// The TUI deliberately keeps this small and dependency-free. These ranges
// cover combining marks, variation selectors, emoji, CJK, and the other wide
// blocks commonly encountered in work titles and labels.
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f1e6, 0x1f1ff],
  [0x1f201, 0x1f202],
  [0x1f21a, 0x1f21a],
  [0x1f22f, 0x1f22f],
  [0x1f232, 0x1f23a],
  [0x1f250, 0x1f251],
  [0x1f300, 0x1faff],
  [0x1fc00, 0x1fffd]
];

function inRange(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isCombining(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x0483 && codePoint <= 0x0489) ||
    (codePoint >= 0x0591 && codePoint <= 0x05bd) ||
    (codePoint >= 0x0610 && codePoint <= 0x061a) ||
    (codePoint >= 0x064b && codePoint <= 0x065f) ||
    (codePoint >= 0x0670 && codePoint <= 0x0670) ||
    (codePoint >= 0x06d6 && codePoint <= 0x06ed) ||
    (codePoint >= 0x0711 && codePoint <= 0x074a) ||
    (codePoint >= 0x07a6 && codePoint <= 0x07b0) ||
    (codePoint >= 0x07eb && codePoint <= 0x07f3) ||
    (codePoint >= 0x0816 && codePoint <= 0x0819) ||
    (codePoint >= 0x081b && codePoint <= 0x0823) ||
    (codePoint >= 0x0825 && codePoint <= 0x0827) ||
    (codePoint >= 0x0829 && codePoint <= 0x082d) ||
    (codePoint >= 0x0859 && codePoint <= 0x085f) ||
    (codePoint >= 0x08d3 && codePoint <= 0x08ff) ||
    (codePoint >= 0x0900 && codePoint <= 0x0903) ||
    (codePoint >= 0x093a && codePoint <= 0x094f) ||
    (codePoint >= 0x0951 && codePoint <= 0x0957) ||
    (codePoint >= 0x0962 && codePoint <= 0x0963) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

function codePointCellWidth(codePoint: number): number {
  if (codePoint === 0x200d || isCombining(codePoint)) return 0;
  if (codePoint === 0x09) return 1;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  return inRange(codePoint, WIDE_RANGES) ? 2 : 1;
}

interface GraphemeSegmenter {
  segment(value: string): Iterable<{ readonly segment: string }>;
}

let graphemeSegmenter: GraphemeSegmenter | undefined;

export function graphemeClusters(value: string): readonly string[] {
  if (graphemeSegmenter === undefined) {
    const Segmenter = (Intl as unknown as {
      Segmenter?: new (locales?: string | string[], options?: { readonly granularity: "grapheme" }) => GraphemeSegmenter;
    }).Segmenter;
    graphemeSegmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : nullSegmenter;
  }
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

const nullSegmenter: GraphemeSegmenter = {
  segment(value: string): Iterable<{ readonly segment: string }> {
    return Array.from(value, (segment) => ({ segment }));
  }
};

function normalizedText(value: string): string {
  // ANSI sequences are styling, not printable cells. Controls are replaced
  // with spaces so a malformed cell cannot introduce a newline into a row.
  return value
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ");
}

function clusterCellWidth(cluster: string): number {
  let total = 0;
  let joined = false;
  let emojiPresentation = false;
  for (const character of cluster) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x200d) joined = true;
    if (codePoint === 0xfe0f) emojiPresentation = true;
    const width = codePointCellWidth(codePoint);
    total += width;
  }
  // ZWJ emoji sequences occupy one emoji cell pair even though they contain
  // multiple wide code points.
  return joined || emojiPresentation ? 2 : Math.min(2, total);
}

function textCells(value: string): readonly { readonly text: string; readonly width: number }[] {
  return graphemeClusters(normalizedText(value)).map((text) => ({ text, width: clusterCellWidth(text) }));
}

/** Return the number of terminal cells occupied by a single-line string. */
export function cellWidth(value: string): number {
  return textCells(value).reduce((total, cell) => total + cell.width, 0);
}

/** Truncate a value to terminal cells, without adding padding. */
export function truncate(value: string, width: number): string {
  const target = Math.max(0, Math.floor(width));
  if (target === 0) return "";
  const cells = textCells(value);
  const total = cells.reduce((sum, cell) => sum + cell.width, 0);
  if (total <= target) return cells.map((cell) => cell.text).join("");

  // At one cell, retain the original narrow glyph when possible. This keeps
  // the historical fit("abc", 1) behaviour while still protecting a wide
  // glyph from overflowing the cell.
  if (target === 1) {
    const first = cells[0];
    return first && first.width <= 1 ? first.text : "…";
  }

  const budget = target - 1;
  let used = 0;
  let result = "";
  for (const cell of cells) {
    if (used + cell.width > budget) break;
    result += cell.text;
    used += cell.width;
  }
  // A wide first glyph may fill the whole target width. Appending an
  // ellipsis would overflow, so keep the exact-width glyph instead.
  if (result.length === 0 && cells[0] && cells[0].width <= target) return cells[0].text;
  return `${result}…`;
}

// Memoize cell formatting. The dashboard re-renders the same labels every
// refresh tick; caching avoids recomputing pad/slice for unchanged strings.
const FIT_CACHE = new Map<string, string>();
const FIT_CACHE_MAX = 4096;

/** Fit a value to exactly `width` terminal cells. */
export function fit(value: string, width: number, align: "left" | "right" = "left"): string {
  const target = Math.max(0, Math.floor(width));
  const key = `${target}\u0000${align}\u0000${value}`;
  const cached = FIT_CACHE.get(key);
  if (cached !== undefined) return cached;

  const truncated = truncate(value, target);
  const padding = Math.max(0, target - cellWidth(truncated));
  const result = align === "right" ? `${" ".repeat(padding)}${truncated}` : `${truncated}${" ".repeat(padding)}`;
  if (FIT_CACHE.size >= FIT_CACHE_MAX) FIT_CACHE.clear();
  FIT_CACHE.set(key, result);
  return result;
}
