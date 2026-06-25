import { createHash } from "node:crypto";

import type { ContentHash } from "./ids.js";

type JsonPrimitive = string | number | boolean | null;
type CanonicalValue = JsonPrimitive | CanonicalValue[] | { [key: string]: CanonicalValue };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new WeakSet<object>()));
}

export function hashContent(value: unknown): ContentHash {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `sha256:${digest}` as ContentHash;
}

function canonicalize(value: unknown, seen: WeakSet<object>): CanonicalValue {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Cannot canonicalize circular structures");
    }

    seen.add(value);
    const record = value as Record<string, unknown>;
    const output: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        output[key] = canonicalize(record[key], seen);
      }
    }
    seen.delete(value);
    return output;
  }

  return String(value);
}

