import { BorealError } from "./errors.js";

export type SuspiciousUnicodeKind =
  | "bidi_control"
  | "control"
  | "invisible_format"
  | "variation_selector"
  | "unpaired_surrogate";

export interface SuspiciousUnicodeFinding {
  readonly index: number;
  readonly codePoint: string;
  readonly kind: SuspiciousUnicodeKind;
}

export interface NormalizeMachineStringOptions {
  readonly allowEmpty?: boolean;
  readonly lowerCase?: boolean;
}

const CONTROL_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000e, 0x001f],
  [0x007f, 0x009f]
];

const BIDI_CONTROL_CODE_POINTS = new Set([
  0x061c,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069
]);

const INVISIBLE_FORMAT_CODE_POINTS = new Set([0x00ad, 0x034f, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

const VARIATION_SELECTOR_RANGES: readonly (readonly [number, number])[] = [
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef]
];

export function detectSuspiciousUnicode(value: string): readonly SuspiciousUnicodeFinding[] {
  const findings: SuspiciousUnicodeFinding[] = [];

  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const char = String.fromCodePoint(codePoint);
    const kind = suspiciousUnicodeKind(codePoint);
    if (kind) {
      findings.push({
        index,
        codePoint: formatCodePoint(codePoint),
        kind
      });
    }
    if (isUnpairedSurrogate(value, index, codePoint)) {
      findings.push({
        index,
        codePoint: formatCodePoint(codePoint),
        kind: "unpaired_surrogate"
      });
    }
    index += char.length;
  }

  return findings;
}

export function assertNoSuspiciousUnicode(value: string, label = "value"): void {
  const findings = detectSuspiciousUnicode(value);
  if (findings.length > 0) {
    throw new BorealError("BOREAL_UNSAFE_UNICODE", `Unsafe Unicode in ${label}`, {
      label,
      findings
    });
  }
}

export function normalizeMachineString(
  value: string,
  label = "value",
  options: NormalizeMachineStringOptions = {}
): string {
  const normalized = value.normalize("NFKC");
  assertNoSuspiciousUnicode(normalized, label);
  const compact = normalized.replace(/\s+/gu, " ").trim();
  if (!options.allowEmpty && compact.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} cannot be empty`);
  }
  return options.lowerCase ? compact.toLocaleLowerCase("en-US") : compact;
}

export function normalizeOptionalMachineString(value: string | undefined, label = "value"): string | undefined {
  return value === undefined ? undefined : normalizeMachineString(value, label);
}

export function normalizeLabel(value: string): string {
  return normalizeMachineString(value, "label", { lowerCase: true });
}

export function normalizeLabels(values: readonly string[]): readonly string[] {
  return unique(values.map(normalizeLabel));
}

export function normalizeActorId(value: string): string {
  return normalizeMachineString(value, "actor id", { lowerCase: true });
}

export function normalizeSearchQuery(value: string): string {
  return normalizeMachineString(value, "search query");
}

export function normalizeGeneratedSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0100}-\u{e01ef}]/gu,
      " "
    )
    .trim()
    .toLocaleLowerCase("en-US");
}

function suspiciousUnicodeKind(codePoint: number): SuspiciousUnicodeKind | undefined {
  if (BIDI_CONTROL_CODE_POINTS.has(codePoint)) {
    return "bidi_control";
  }
  if (INVISIBLE_FORMAT_CODE_POINTS.has(codePoint)) {
    return "invisible_format";
  }
  if (inRanges(codePoint, CONTROL_CODE_POINT_RANGES)) {
    return "control";
  }
  if (inRanges(codePoint, VARIATION_SELECTOR_RANGES)) {
    return "variation_selector";
  }
  return undefined;
}

function inRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isUnpairedSurrogate(value: string, index: number, codePoint: number): boolean {
  if (codePoint < 0xd800 || codePoint > 0xdfff) {
    return false;
  }
  const current = value.charCodeAt(index);
  const next = value.charCodeAt(index + 1);
  const previous = value.charCodeAt(index - 1);
  return !(
    current >= 0xd800 &&
    current <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  ) && !(current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff);
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
