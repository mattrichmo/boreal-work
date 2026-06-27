#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [, , basePath, currentPath, otherPath, mergedPath = currentPath] = process.argv;

if (!basePath || !currentPath || !otherPath) {
  console.error("usage: boreal-jsonl-merge-driver <base> <current> <other> [path]");
  process.exit(2);
}

try {
  const [base, current, other] = await Promise.all([
    readJsonlFile(basePath, "base"),
    readJsonlFile(currentPath, "current"),
    readJsonlFile(otherPath, "other")
  ]);
  const merged = mergeJsonl(base, current, other, mergedPath);
  await writeFile(currentPath, serializeEntries(merged), "utf8");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`boreal-jsonl merge failed for ${mergedPath}: ${message}`);
  process.exit(1);
}

async function readJsonlFile(path, label) {
  const text = await readFile(path, "utf8");
  const lines = text.length === 0 ? [] : text.replace(/\n$/u, "").split(/\r?\n/u);
  const entries = [];
  const seen = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.trim().length === 0) {
      throw new Error(`${label}:${index + 1} blank JSONL lines are not supported`);
    }
    const parsed = parseObject(line, `${label}:${index + 1}`);
    const normalized = stableStringify(parsed);
    const key = recordKey(parsed, normalized);
    const existing = seen.get(key);
    if (existing && existing.normalized !== normalized) {
      throw new Error(`${label}:${index + 1} duplicate record key ${key} has different content`);
    }
    if (!existing) {
      const entry = { key, line, normalized };
      seen.set(key, entry);
      entries.push(entry);
    }
  }

  return entries;
}

function mergeJsonl(baseEntries, currentEntries, otherEntries, path) {
  const base = mapEntries(baseEntries);
  const current = mapEntries(currentEntries);
  const other = mapEntries(otherEntries);
  const orderedKeys = [
    ...baseEntries.map((entry) => entry.key),
    ...[...new Set([...current.keys(), ...other.keys()])]
      .filter((key) => !base.has(key))
      .sort((left, right) => left.localeCompare(right))
  ];
  const merged = [];

  for (const key of orderedKeys) {
    const baseEntry = base.get(key);
    const currentEntry = current.get(key);
    const otherEntry = other.get(key);
    const chosen = chooseEntry(path, key, baseEntry, currentEntry, otherEntry);
    if (chosen) {
      merged.push(chosen);
    }
  }

  return merged;
}

function chooseEntry(path, key, baseEntry, currentEntry, otherEntry) {
  if (currentEntry && otherEntry && currentEntry.normalized === otherEntry.normalized) {
    return currentEntry;
  }
  if (baseEntry && currentEntry && currentEntry.normalized === baseEntry.normalized) {
    return otherEntry;
  }
  if (baseEntry && otherEntry && otherEntry.normalized === baseEntry.normalized) {
    return currentEntry;
  }
  if (!currentEntry) {
    return otherEntry;
  }
  if (!otherEntry) {
    return currentEntry;
  }
  throw new Error(`${path}: record ${key} changed differently on both sides`);
}

function mapEntries(entries) {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function serializeEntries(entries) {
  return entries.length === 0 ? "" : `${entries.map((entry) => entry.line).join("\n")}\n`;
}

function parseObject(line, label) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} invalid JSON: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function recordKey(record, normalized) {
  const meta = record.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta) && typeof meta.id === "string") {
    return `id:${meta.id}`;
  }
  if (typeof record.id === "string") {
    return `id:${record.id}`;
  }
  return `hash:${createHash("sha256").update(normalized).digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
