import { mkdtemp, mkdir, readdir, copyFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(repoRoot, "reference-zips");
const legacyRoot = process.env.BOREAL_V1_ARCHIVE_ROOT
  ? path.resolve(process.env.BOREAL_V1_ARCHIVE_ROOT)
  : path.join(repoRoot, "v1");

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".lock",
  ".mjs",
  ".md",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const V1_ROOT_FILES = new Set([
  "INSTALL.md",
  "README.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "vitest.config.ts",
]);

const V1_DOC_FILES = new Set([
  "docs/cli/COMMANDS.md",
  "docs/concepts.md",
  "docs/getting-started.md",
  "docs/product/GLOBAL_MANAGER_DESIGN.md",
  "docs/product/PRODUCT_CONTRACT.md",
  "docs/product/V1_WORKFLOWS.md",
  "docs/architecture/AGENT_DIRECTIVES.md",
  "docs/architecture/CLI_TUI_RUNTIME_BOUNDARY.md",
  "docs/architecture/CLI_UX.md",
  "docs/architecture/CLOSEOUT_GATE_CONTRACT.md",
  "docs/architecture/COMPATIBILITY_POLICY.md",
  "docs/architecture/DAEMON.md",
  "docs/architecture/EVIDENCE_TRUST.md",
  "docs/architecture/MCP_DAEMON_BOUNDARY.md",
  "docs/architecture/MCP_SERVER.md",
  "docs/architecture/RUNTIME.md",
  "docs/architecture/SKILLS_AND_WORKFLOWS.md",
  "docs/architecture/TUI_SURFACE_CONTRACTS.md",
]);

const V2_ROOT_FILES = new Set([
  "AGENTS.md",
  "AGENT_HANDOFF.md",
  "Cargo.lock",
  "Cargo.toml",
  "MASTER_PLAN.md",
  "README.md",
]);

const V2_PROJECT_FILES = new Set([
  "project/AGENT_GUIDANCE.md",
  "project/AGENT_LIFECYCLE.md",
  "project/ARCHITECTURE.md",
  "project/CLI_COMMANDS.md",
  "project/DECISIONS.md",
  "project/INTERFACES.md",
  "project/MEMORY_BANK.md",
  "project/NEXT_AGENT_TASKS.md",
  "project/PRODUCT.md",
  "project/README.md",
  "project/SOURCE_ENGINE.md",
  "project/STATE_AND_CONCURRENCY.md",
  "project/STATUS_MODEL.md",
  "project/WORKFLOW_PARITY.md",
]);

const V2_MILESTONE_FILES = new Set([
  "milestones/M01-v2-product/README.md",
]);

function extensionOf(relativePath) {
  return path.extname(relativePath).toLowerCase();
}

function isTextFile(relativePath) {
  return TEXT_EXTENSIONS.has(extensionOf(relativePath));
}

function isExcluded(relativePath) {
  const segments = relativePath.split("/");
  const basename = segments.at(-1);

  if (
    basename === ".DS_Store" ||
    segments.includes(".git") ||
    segments.includes("node_modules") ||
    segments.includes("dist") ||
    segments.includes("target") ||
    segments.includes("__pycache__") ||
    segments.includes("coverage") ||
    segments.includes(".boreal")
  ) {
    return true;
  }

  if (
    relativePath.startsWith("scripts/release/fixtures/") ||
    relativePath.includes("/results/") ||
    relativePath.startsWith("test-project/")
  ) {
    return true;
  }

  return false;
}

function selectV1(relativePath) {
  if (V1_ROOT_FILES.has(relativePath) || V1_DOC_FILES.has(relativePath)) {
    return true;
  }

  if (relativePath.startsWith("apps/") || relativePath.startsWith("packages/")) {
    return (
      (relativePath.includes("/src/") && isTextFile(relativePath)) ||
      /^(apps|packages)\/[^/]+\/(package\.json|tsconfig\.json)$/.test(relativePath)
    );
  }

  if (relativePath.startsWith("schemas/") && extensionOf(relativePath) === ".json") {
    return true;
  }

  if (relativePath.startsWith("workflows/") && extensionOf(relativePath) === ".md") {
    return true;
  }

  if (relativePath.startsWith("skills/")) {
    return ["SKILL.md", "boreal.yaml", "openai.yaml"].includes(path.basename(relativePath));
  }

  if (relativePath.startsWith("tests/") || relativePath.startsWith("tools/")) {
    return isTextFile(relativePath);
  }

  return false;
}

function selectV2(relativePath) {
  if (V2_ROOT_FILES.has(relativePath) || V2_PROJECT_FILES.has(relativePath)) {
    return true;
  }

  if (V2_MILESTONE_FILES.has(relativePath)) {
    return true;
  }

  if (
    relativePath.startsWith("milestones/M01-v2-product/sprints/") &&
    path.basename(relativePath) === "SPRINT.md"
  ) {
    return true;
  }

  if (relativePath.startsWith("crates/")) {
    return isTextFile(relativePath);
  }

  if (relativePath.startsWith("apps/tui/src/")) {
    return isTextFile(relativePath);
  }

  if (
    relativePath === "apps/tui/README.md" ||
    relativePath === "apps/tui/package.json" ||
    relativePath === "apps/tui/tsconfig.json"
  ) {
    return true;
  }

  if (relativePath.startsWith("project/spec/")) {
    return isTextFile(relativePath);
  }

  if (relativePath.startsWith("project/legacy-map/")) {
    return extensionOf(relativePath) === ".md";
  }

  if (relativePath.startsWith("docs/")) {
    return extensionOf(relativePath) === ".md";
  }

  if (relativePath.startsWith("scripts/")) {
    return isTextFile(relativePath);
  }

  return false;
}

async function collectFiles(root, selector) {
  const results = [];

  async function visit(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

      if (isExcluded(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && selector(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  await visit(root);
  return results;
}

function groupedFileList(files) {
  const groups = new Map();

  for (const file of files) {
    const group = file.includes("/") ? file.slice(0, file.indexOf("/")) : ".";
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, count]) => `- ${group}: ${count} file${count === 1 ? "" : "s"}`)
    .join("\n");
}

function indexFor(spec, files) {
  return `# ${spec.title}\n\n` +
    `This archive is a read-only reference snapshot for another agent. ` +
    `It is intentionally source-oriented and is not intended to be run directly.\n\n` +
    `Generated: ${new Date().toISOString()}\n` +
    `Source root: ${spec.sourceLabel}\n` +
    `Included files: ${files.length}\n` +
    `Compression: ZIP/Deflate level 9\n\n` +
    `## Included\n\n${spec.included}\n\n` +
    `## Excluded\n\n` +
    `- Images, fonts, binary assets, and other non-text files.\n` +
    `- Dependencies and generated output: node_modules, dist, target, coverage, and caches.\n` +
    `- Local runtime state, memory databases, dumps, and machine-specific files.\n` +
    `- ${spec.excluded}\n\n` +
    `## File groups\n\n${groupedFileList(files)}\n\n` +
    `## Files\n\n${files.map((file) => `- ${file}`).join("\n")}\n`;
}

async function buildArchive(spec) {
  const sourceRoot = spec.sourceRoot ?? path.join(repoRoot, spec.sourceDirectory);
  if (!existsSync(sourceRoot)) {
    if (spec.optional) {
      console.warn(`Skipped ${spec.id}: source directory does not exist: ${sourceRoot}`);
      return null;
    }
    throw new Error(`source directory does not exist: ${sourceRoot}`);
  }
  const files = await collectFiles(sourceRoot, spec.selector);
  const stagingRoot = await mkdtemp(path.join(tmpdir(), `boreal-${spec.id}-`));
  const archiveRoot = path.join(stagingRoot, spec.archiveDirectory);
  const outputPath = path.join(outputDir, `${spec.id}-reference.zip`);

  try {
    await mkdir(archiveRoot, { recursive: true });

    for (const relativePath of files) {
      const destination = path.join(archiveRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(sourceRoot, relativePath), destination);
    }

    await writeFile(
      path.join(archiveRoot, "REFERENCE_INDEX.md"),
      indexFor(spec, files),
      "utf8",
    );

    if (existsSync(outputPath)) {
      await rm(outputPath, { force: true });
    }

    const result = spawnSync(
      "zip",
      ["-q", "-9", "-X", "-r", outputPath, spec.archiveDirectory],
      { cwd: stagingRoot, encoding: "utf8" },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(result.stderr || `zip exited with status ${result.status}`);
    }

    return { outputPath, fileCount: files.length };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

const specs = [
  {
    id: "boreal-v1",
    title: "Boreal v1 code reference",
    sourceRoot: legacyRoot,
    archiveDirectory: "boreal-v1",
    sourceLabel: "the sibling v1 archive (the legacy TypeScript implementation)",
    optional: true,
    selector: selectV1,
    included:
      "Active TypeScript application and package source, schemas, workflow/skill definitions, tests, tooling, build manifests, and selected architecture/product documentation.",
    excluded:
      "the broad historical/audit documentation set, examples/templates, and the nested memory repository",
  },
  {
    id: "boreal-v2",
    title: "Boreal v2 code reference",
    sourceDirectory: ".",
    archiveDirectory: "boreal-v2",
    sourceLabel: "repository root (the Rust/TUI v2 implementation)",
    selector: selectV2,
    included:
      "Rust crates and manifests, TUI source/configuration, executable contract specifications, selected architecture/state documentation, milestone sprint definitions, and validation/release scripts.",
    excluded:
      "build-plan review history, release fixtures, validation result files, compiled TUI output, and test-project runtime state",
  },
];

await mkdir(outputDir, { recursive: true });

const results = [];
for (const spec of specs) {
  const result = await buildArchive(spec);
  if (result) results.push(result);
}

for (const result of results) {
  console.log(
    `Created ${path.relative(repoRoot, result.outputPath)} (${result.fileCount} source files)`,
  );
}
