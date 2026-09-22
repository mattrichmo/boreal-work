# R-ARCHIVER — create-zips.mjs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `create-zips.mjs:L1–L250`  
**File SHA-256:** `fdb78833f0d82c94b65946dc2dd51c6d147cc775ab396a7767b307af76fd8b21`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Source selector, required paths and provenance manifest; source archives are not production binaries.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,250p' 'create-zips.mjs'
```

## Exact baseline excerpt

````text
    1 | import {
    2 |   copyFile,
    3 |   mkdtemp,
    4 |   mkdir,
    5 |   readdir,
    6 |   readFile,
    7 |   rm,
    8 |   stat,
    9 |   writeFile,
   10 | } from "node:fs/promises";
   11 | import { createHash } from "node:crypto";
   12 | import { existsSync } from "node:fs";
   13 | import { spawnSync } from "node:child_process";
   14 | import { tmpdir } from "node:os";
   15 | import path from "node:path";
   16 | import { fileURLToPath } from "node:url";
   17 | 
   18 | const repoRoot = path.dirname(fileURLToPath(import.meta.url));
   19 | const SYSTEM_OUTPUT_DIR = "/scratch/reference-zips";
   20 | const LOCAL_OUTPUT_DIR = path.join(repoRoot, "scratch", "reference-zips");
   21 | 
   22 | function defaultOutputDirectory() {
   23 |   return existsSync("/scratch") ? SYSTEM_OUTPUT_DIR : LOCAL_OUTPUT_DIR;
   24 | }
   25 | 
   26 | const DEFAULT_OUTPUT_DIR = defaultOutputDirectory();
   27 | 
   28 | function usage() {
   29 |   return `Usage: node create-zips.mjs [--output-dir PATH]
   30 | 
   31 | Creates one timestamped, stripped-down read-only review archive for the
   32 | current refactored v2 tree.
   33 | 
   34 | The preferred output is /scratch/reference-zips. On systems without a writable
   35 | /scratch directory, output falls back to ./scratch/reference-zips.
   36 | 
   37 | Options:
   38 |   --output-dir PATH  Directory for generated archives
   39 |                      (default: ${DEFAULT_OUTPUT_DIR})
   40 |   --help             Show this help
   41 | 
   42 | Environment:
   43 |   BOREAL_ZIP_OUTPUT_DIR  Overrides the default output directory
   44 | `;
   45 | }
   46 | 
   47 | function parseArguments(argv) {
   48 |   let outputDir = process.env.BOREAL_ZIP_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;
   49 | 
   50 |   for (let index = 0; index < argv.length; index += 1) {
   51 |     const argument = argv[index];
   52 | 
   53 |     if (argument === "--help" || argument === "-h") {
   54 |       console.log(usage());
   55 |       process.exit(0);
   56 |     }
   57 | 
   58 |     if (argument === "--output-dir") {
   59 |       const value = argv[index + 1];
   60 |       if (!value || value.startsWith("-")) {
   61 |         throw new Error("--output-dir requires a path");
   62 |       }
   63 |       outputDir = value;
   64 |       index += 1;
   65 |       continue;
   66 |     }
   67 | 
   68 |     if (argument.startsWith("--output-dir=")) {
   69 |       const value = argument.slice("--output-dir=".length);
   70 |       if (!value) {
   71 |         throw new Error("--output-dir requires a path");
   72 |       }
   73 |       outputDir = value;
   74 |       continue;
   75 |     }
   76 | 
   77 |     throw new Error(`unknown argument: ${argument}`);
   78 |   }
   79 | 
   80 |   return path.resolve(outputDir);
   81 | }
   82 | 
   83 | const outputDir = parseArguments(process.argv.slice(2));
   84 | const generatedAt = new Date();
   85 | const archiveTimestamp = generatedAt.toISOString().replace(/[-:.]/g, "");
   86 | 
   87 | if (
   88 |   DEFAULT_OUTPUT_DIR === LOCAL_OUTPUT_DIR &&
   89 |   !process.env.BOREAL_ZIP_OUTPUT_DIR &&
   90 |   !process.argv.slice(2).some((argument) => argument === "--output-dir" || argument.startsWith("--output-dir="))
   91 | ) {
   92 |   console.warn(
   93 |     `System /scratch is unavailable; using repository-local output: ${outputDir}`,
   94 |   );
   95 | }
   96 | 
   97 | const TEXT_EXTENSIONS = new Set([
   98 |   ".json",
   99 |   ".cjs",
  100 |   ".lock",
  101 |   ".mjs",
  102 |   ".md",
  103 |   ".py",
  104 |   ".rb",
  105 |   ".rs",
  106 |   ".sh",
  107 |   ".sql",
  108 |   ".template",
  109 |   ".toml",
  110 |   ".ts",
  111 |   ".tsx",
  112 |   ".yaml",
  113 |   ".yml",
  114 | ]);
  115 | 
  116 | const TEXT_FILENAMES = new Set([".gitattributes", ".gitignore", ".gitkeep"]);
  117 | 
  118 | const V2_ROOT_FILES = new Set([
  119 |   "AGENTS.md",
  120 |   "AGENT_HANDOFF.md",
  121 |   "Cargo.lock",
  122 |   "Cargo.toml",
  123 |   ".gitignore",
  124 |   ".gitattributes",
  125 |   "LICENSE",
  126 |   "MASTER_PLAN.md",
  127 |   "README.md",
  128 |   "IMPLEMENTATION_REPORT.md",
  129 |   "create-zips.mjs",
  130 |   "install.sh",
  131 | ]);
  132 | 
  133 | const V2_PROJECT_FILES = new Set([
  134 |   "project/AGENT_GUIDANCE.md",
  135 |   "project/AGENT_LIFECYCLE.md",
  136 |   "project/ARCHITECTURE.md",
  137 |   "project/CLI_COMMANDS.md",
  138 |   "project/DECISIONS.md",
  139 |   "project/INTERFACES.md",
  140 |   "project/MEMORY_BANK.md",
  141 |   "project/NEXT_AGENT_TASKS.md",
  142 |   "project/PRODUCT.md",
  143 |   "project/README.md",
  144 |   "project/SOURCE_ENGINE.md",
  145 |   "project/STATE_AND_CONCURRENCY.md",
  146 |   "project/STATUS_MODEL.md",
  147 |   "project/WORKFLOW_PARITY.md",
  148 | ]);
  149 | 
  150 | function extensionOf(relativePath) {
  151 |   return path.extname(relativePath).toLowerCase();
  152 | }
  153 | 
  154 | function isTextFile(relativePath) {
  155 |   return (
  156 |     TEXT_FILENAMES.has(path.basename(relativePath)) ||
  157 |     TEXT_EXTENSIONS.has(extensionOf(relativePath))
  158 |   );
  159 | }
  160 | 
  161 | function isExcluded(relativePath) {
  162 |   const segments = relativePath.split("/");
  163 |   const basename = segments.at(-1);
  164 | 
  165 |   if (
  166 |     basename === ".DS_Store" ||
  167 |     segments.includes(".git") ||
  168 |     segments.includes("node_modules") ||
  169 |     segments.includes("dist") ||
  170 |     segments.includes("target") ||
  171 |     segments.includes("__pycache__") ||
  172 |     segments.includes("coverage") ||
  173 |     segments.includes(".boreal")
  174 |   ) {
  175 |     return true;
  176 |   }
  177 | 
  178 |   if (
  179 |     relativePath.includes("/results/") ||
  180 |     relativePath.startsWith("test-project/")
  181 |   ) {
  182 |     return true;
  183 |   }
  184 | 
  185 |   return false;
  186 | }
  187 | 
  188 | function selectV2(relativePath) {
  189 |   if (V2_ROOT_FILES.has(relativePath) || V2_PROJECT_FILES.has(relativePath)) {
  190 |     return true;
  191 |   }
  192 | 
  193 |   // Preserve the full file-based execution plan, including future milestones
  194 |   // and sprint handoffs. Generated/runtime state is still filtered above.
  195 |   if (relativePath.startsWith("milestones/")) {
  196 |     return isTextFile(relativePath);
  197 |   }
  198 | 
  199 |   if (relativePath.startsWith("crates/")) {
  200 |     return isTextFile(relativePath);
  201 |   }
  202 | 
  203 |   // Keep the complete text-only TUI tree, including the service smoke
  204 |   // fixture.  `isExcluded` removes dist/node_modules and other generated
  205 |   // output before this selector is reached.
  206 |   if (relativePath.startsWith("apps/tui/")) {
  207 |     return isTextFile(relativePath);
  208 |   }
  209 | 
  210 |   // The refactored hierarchy, migration, release, and agent-dispatch
  211 |   // contracts live throughout project/, not only in project/spec. Preserve
  212 |   // every text document there so reviewers have the complete v2 contract
  213 |   // packet without the live repository.
  214 |   if (relativePath.startsWith("project/")) {
  215 |     return isTextFile(relativePath);
  216 |   }
  217 | 
  218 |   if (relativePath.startsWith(".github/")) {
  219 |     return isTextFile(relativePath);
  220 |   }
  221 | 
  222 |   if (relativePath.startsWith("packaging/")) {
  223 |     return isTextFile(relativePath);
  224 |   }
  225 | 
  226 |   if (relativePath.startsWith("docs/")) {
  227 |     return isTextFile(relativePath);
  228 |   }
  229 | 
  230 |   if (relativePath.startsWith("scripts/")) {
  231 |     return isTextFile(relativePath);
  232 |   }
  233 | 
  234 |   if (relativePath.startsWith("skills/")) {
  235 |     return isTextFile(relativePath);
  236 |   }
  237 | 
  238 |   return false;
  239 | }
  240 | 
  241 | async function collectFiles(root, selector) {
  242 |   const results = [];
  243 | 
  244 |   async function visit(currentPath) {
  245 |     const entries = await readdir(currentPath, { withFileTypes: true });
  246 |     entries.sort((left, right) => left.name.localeCompare(right.name));
  247 | 
  248 |     for (const entry of entries) {
  249 |       const absolutePath = path.join(currentPath, entry.name);
  250 |       const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
````
