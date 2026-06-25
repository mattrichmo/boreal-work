export type IsoTimestamp = string & { readonly __brand: "IsoTimestamp" };

export function nowIso(date = new Date()): IsoTimestamp {
  return date.toISOString() as IsoTimestamp;
}

export function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function assertIsoTimestamp(value: unknown, label = "timestamp"): asserts value is IsoTimestamp {
  if (!isIsoTimestamp(value)) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
}

