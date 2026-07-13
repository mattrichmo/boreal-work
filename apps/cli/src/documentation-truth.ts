import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { COMMAND_DEFINITIONS, commandPath } from "./command-registry.js";

export interface DocumentationTruthIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface DocumentationTruthResult {
  readonly checked: boolean;
  readonly commandCount: number;
  readonly documentedCommandCount: number;
  readonly storageContract: "objects-v1-default-file-v2-legacy";
  readonly interfaceStatus: {
    readonly cli: "implemented";
    readonly console: "implemented";
    readonly mcp: "implemented";
    readonly daemon: "implemented-observer";
    readonly tui: "implemented-optional";
  };
  readonly issueCount: number;
  readonly issues: readonly DocumentationTruthIssue[];
}

/**
 * Validate source-repository documentation against live registry and storage
 * contracts. Installed asset bundles intentionally omit the public docs tree,
 * so the check is skipped there while command metadata validation still runs.
 */
export async function inspectDocumentationTruth(assetRoot: string): Promise<DocumentationTruthResult> {
  const docsRoot = join(assetRoot, "docs");
  const commandGuidePath = join(docsRoot, "cli", "COMMANDS.md");
  const commandCount = COMMAND_DEFINITIONS.length;
  const base = {
    commandCount,
    storageContract: "objects-v1-default-file-v2-legacy" as const,
    interfaceStatus: {
      cli: "implemented" as const,
      console: "implemented" as const,
      mcp: "implemented" as const,
      daemon: "implemented-observer" as const,
      tui: "implemented-optional" as const
    }
  };

  if (!existsSync(docsRoot) || !existsSync(commandGuidePath)) {
    return { checked: false, documentedCommandCount: 0, issueCount: 0, issues: [], ...base };
  }

  const issues: DocumentationTruthIssue[] = [];
  const commandGuide = await readFile(commandGuidePath, "utf8");
  const sections = commandSections(commandGuide);
  const expectedPaths = new Set(COMMAND_DEFINITIONS.map(commandPath));

  for (const definition of COMMAND_DEFINITIONS) {
    const path = commandPath(definition);
    const section = sections.get(path);
    if (!section) {
      issues.push(issue("docs.command.missing", commandGuidePath, `Missing command section for ${path}`, assetRoot));
      continue;
    }
    if (!section.includes(definition.usage)) {
      issues.push(issue("docs.command.usage-drift", commandGuidePath, `Usage drift for ${path}`, assetRoot));
    }
    for (const flag of definition.flags) {
      if (!section.includes(`--${flag.name}`)) {
        issues.push(issue("docs.command.flag-drift", commandGuidePath, `Missing --${flag.name} documentation for ${path}`, assetRoot));
      }
    }
  }
  for (const path of sections.keys()) {
    if (!expectedPaths.has(path)) {
      issues.push(issue("docs.command.unknown", commandGuidePath, `Unknown command section ${path}`, assetRoot));
    }
  }

  const markdownFiles = [join(assetRoot, "README.md"), ...(await listMarkdownFiles(docsRoot))].filter(existsSync);
  for (const path of markdownFiles) {
    const text = await readFile(path, "utf8");
    if (/\b(?:current|currently|live) registry exposes \d+ commands\b/iu.test(text)) {
      issues.push(
        issue(
          "docs.command.static-count",
          path,
          "Live command counts must come from `bwrk commands --json` or `bwrk docs check --json`, not a copied number",
          assetRoot
        )
      );
    }
  }

  await requireMarkers(assetRoot, issues, "README.md", [
    "New workspaces use a Git-friendly per-record object store",
    "**TUI** | Optional terminal dashboard"
  ]);
  await requireMarkers(assetRoot, issues, "docs/concepts.md", [
    "**`.boreal/objects/`**",
    "Legacy `file-v2` workspaces",
    "**TUI (`bwrk-tui`)**"
  ]);
  await requireMarkers(assetRoot, issues, "docs/architecture/RUNTIME.md", [
    "`ObjectDirBorealStore` is the default durable adapter",
    "`FileBorealStore` is the legacy compatibility adapter",
    "The retired `.boreal/cache/runtime-cache.sqlite`"
  ]);
  await requireMarkers(assetRoot, issues, "docs/architecture/HARDENING_STATUS.md", [
    "per-record `.boreal/objects/` store is the default durable runtime adapter",
    "optional Ink TUI is implemented"
  ]);
  await requireMarkers(assetRoot, issues, "docs/architecture/V2_STORAGE_COLLABORATION_PLAN.md", [
    "Status: superseded as an implementation contract",
    "must not be read as current runtime truth"
  ]);

  return {
    checked: true,
    documentedCommandCount: sections.size,
    issueCount: issues.length,
    issues,
    ...base
  };
}

function commandSections(markdown: string): ReadonlyMap<string, string> {
  const matches = [...markdown.matchAll(/^## `([^`]+)`\s*$/gmu)];
  const sections = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const end = matches[index + 1]?.index ?? markdown.length;
    sections.set(name, markdown.slice(match.index, end));
  }
  return sections;
}

async function requireMarkers(
  assetRoot: string,
  issues: DocumentationTruthIssue[],
  relativePath: string,
  markers: readonly string[]
): Promise<void> {
  const path = join(assetRoot, relativePath);
  if (!existsSync(path)) {
    issues.push(issue("docs.file.missing", path, "Required public documentation file is missing", assetRoot));
    return;
  }
  const text = await readFile(path, "utf8");
  for (const marker of markers) {
    if (!text.includes(marker)) {
      issues.push(issue("docs.contract.missing", path, `Missing contract marker: ${marker}`, assetRoot));
    }
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(path);
      return entry.isFile() && path.endsWith(".md") ? [path] : [];
    })
  );
  return nested.flat().sort();
}

function issue(code: string, path: string, message: string, assetRoot: string): DocumentationTruthIssue {
  return { code, path: relative(assetRoot, path), message };
}
