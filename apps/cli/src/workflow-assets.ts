import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve } from "node:path";

import { BorealError, assertPathInside, assertRealPathInside } from "@boreal/core";

import { COMMAND_DEFINITIONS, commandPath } from "./command-registry.js";

const sourceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SKILL_FORBIDDEN_WORKFLOW_BODY_HEADINGS = ["## Steps", "## Command Sequences", "## CLI Commands", "## Finish Criteria"] as const;
const SKILL_DIRECTIVE_HANDLING_MARKERS = [
  "agentDirectives",
  'severity: "required"',
  'severity: "blocking"',
  "conflicts",
  "missingRequired",
  "typed data"
] as const;
const ASSET_ROOT_ENV = "BOREAL_ASSET_ROOT";

export interface WorkflowAsset {
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly allowedCommands: readonly string[];
  readonly templates: readonly string[];
  readonly text: string;
}

export interface SkillAsset {
  readonly path: string;
  readonly name: string;
  readonly displayName: string;
  readonly workflows: readonly string[];
  readonly text: string;
  readonly files: readonly SkillAssetFile[];
}

export interface SkillAssetFile {
  readonly source: string;
  readonly relativePath: string;
}

export interface AssetValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface WorkflowAssetRootOptions {
  readonly workspaceRoot?: string;
  readonly assetRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface WorkflowAssetRoots {
  readonly sourceRoot: string;
  readonly assetRoot: string;
  readonly workflowsRoot: string;
  readonly templatesRoot: string;
  readonly skillsRoot: string;
  readonly source: "explicit" | "environment" | "workspace" | "source";
}

export interface InstalledSkillRootValidationInput {
  readonly target: "codex" | "claude" | "skills";
  readonly installRoot: string;
}

export interface InstalledSkillRootInspection {
  readonly target: "codex" | "claude" | "skills";
  readonly installRoot: string;
  readonly skillRoot: string;
  readonly skillCount: number;
  readonly expectedFileCount: number;
  readonly checkedFileCount: number;
}

export interface SkillInstallPlan {
  readonly target: "codex" | "claude" | "skills";
  readonly dryRun: boolean;
  readonly assetRoot: string;
  readonly installRoot: string;
  readonly skillRoot: string;
  readonly files: readonly {
    readonly source: string;
    readonly destination: string;
    readonly workflowRefs: readonly string[];
    readonly wouldWrite: boolean;
  }[];
  readonly issues: readonly AssetValidationIssue[];
}

export function resolveWorkflowAssetRoots(options: WorkflowAssetRootOptions = {}): WorkflowAssetRoots {
  const envRoot = options.env?.[ASSET_ROOT_ENV] ?? process.env[ASSET_ROOT_ENV];
  const candidates = [
    options.assetRoot ? { root: options.assetRoot, source: "explicit" as const } : undefined,
    envRoot ? { root: envRoot, source: "environment" as const } : undefined,
    options.workspaceRoot ? { root: options.workspaceRoot, source: "workspace" as const } : undefined,
    { root: sourceRoot, source: "source" as const }
  ].filter((entry): entry is { readonly root: string; readonly source: WorkflowAssetRoots["source"] } => Boolean(entry));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const assetRoot = resolve(candidate.root);
    if (seen.has(assetRoot)) {
      continue;
    }
    seen.add(assetRoot);
    if (hasWorkflowAssetDirs(assetRoot)) {
      return workflowAssetRoots(assetRoot, candidate.source);
    }
  }
  return workflowAssetRoots(resolve(sourceRoot), "source");
}

function workflowAssetRoots(assetRoot: string, source: WorkflowAssetRoots["source"]): WorkflowAssetRoots {
  return {
    sourceRoot: resolve(sourceRoot),
    assetRoot,
    workflowsRoot: join(assetRoot, "workflows"),
    templatesRoot: join(assetRoot, "templates"),
    skillsRoot: join(assetRoot, "skills"),
    source
  };
}

function hasWorkflowAssetDirs(assetRoot: string): boolean {
  return existsSync(join(assetRoot, "workflows")) && existsSync(join(assetRoot, "templates")) && existsSync(join(assetRoot, "skills"));
}

export async function listWorkflowAssets(options: WorkflowAssetRootOptions = {}): Promise<readonly WorkflowAsset[]> {
  const roots = resolveWorkflowAssetRoots(options);
  const files = (await markdownFiles(roots.workflowsRoot)).filter(
    (file) => !file.endsWith("README.md") && !file.endsWith("_workflow-template.md")
  );
  return Promise.all(files.map((file) => readWorkflowAsset(file, roots)));
}

export async function getWorkflowAsset(ref: string, options: WorkflowAssetRootOptions = {}): Promise<WorkflowAsset> {
  const workflows = await listWorkflowAssets(options);
  const matches = workflows.filter((workflow) => workflow.id === ref || workflow.path === ref || workflow.path.endsWith(`/${ref}.md`));
  if (matches.length === 1 && matches[0]) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Workflow reference is ambiguous", { ref, candidates: matches.map((item) => item.path) });
  }
  throw new BorealError("BOREAL_NOT_FOUND", "Workflow not found", { ref });
}

export async function inspectWorkflowAssets(input: {
  readonly installChecks?: readonly InstalledSkillRootValidationInput[];
  readonly workspaceRoot?: string;
  readonly assetRoot?: string;
} = {}): Promise<{
  readonly ok: boolean;
  readonly workflowCount: number;
  readonly templateCount: number;
  readonly skillCount: number;
  readonly installedChecks: readonly InstalledSkillRootInspection[];
  readonly issues: readonly AssetValidationIssue[];
}> {
  const roots = resolveWorkflowAssetRoots(input);
  const [workflows, templates, skills] = await Promise.all([listWorkflowAssets(input), listTemplateIds(roots), listSkillAssets(roots)]);
  const commandNames = new Set(COMMAND_DEFINITIONS.map(commandPath));
  const templateIds = new Set(templates);
  const workflowRefs = new Set(workflows.map((workflow) => workflow.path));
  const workflowIds = new Set<string>();
  const issues: AssetValidationIssue[] = [];

  for (const workflow of workflows) {
    if (workflowIds.has(workflow.id)) {
      issues.push({ code: "workflow.duplicate_id", path: workflow.path, message: `Duplicate workflow ID ${workflow.id}` });
    }
    workflowIds.add(workflow.id);
    for (const command of workflow.allowedCommands) {
      if (!commandNames.has(command)) {
        issues.push({ code: "workflow.unknown_command", path: workflow.path, message: `Unknown command ${command}` });
      }
    }
    for (const template of workflow.templates.filter((entry) => entry !== "none")) {
      if (!templateIds.has(template)) {
        issues.push({ code: "workflow.unknown_template", path: workflow.path, message: `Unknown template ${template}` });
      }
    }
    for (const workflowRef of workflowReferencesFromMarkdown(workflow.text)) {
      if (!workflowRefs.has(workflowRef)) {
        issues.push({ code: "workflow.unknown_workflow_reference", path: workflow.path, message: `Unknown workflow reference ${workflowRef}` });
      }
    }
  }

  for (const skill of skills) {
    const markdownWorkflowRefs = workflowReferencesFromMarkdown(skill.text);
    if (!skill.text.includes("bwrk workflows show <ref>")) {
      issues.push({
        code: "skill.missing_workflow_resolver",
        path: skill.path,
        message: "Skill must explain how to resolve workflow refs when installed workflow files are not local"
      });
    }
    if (!skill.text.includes("Keep this skill as a thin adapter")) {
      issues.push({
        code: "skill.not_thin_adapter",
        path: skill.path,
        message: "Skill must stay a thin adapter and defer detailed execution steps to workflow files"
      });
    }
    if (!hasAgentDirectiveHandling(skill.text)) {
      issues.push({
        code: "skill.missing_agent_directive_handling",
        path: skill.path,
        message: "Skill must require agentDirectives inspection, required/blocking directive handling, conflict reporting, and typed-data safety"
      });
    }
    for (const heading of SKILL_FORBIDDEN_WORKFLOW_BODY_HEADINGS) {
      if (skill.text.includes(heading)) {
        issues.push({
          code: "skill.duplicates_workflow_body",
          path: skill.path,
          message: `Skill must not duplicate workflow body section ${heading}`
        });
      }
    }
    for (const workflow of skill.workflows) {
      if (!workflowRefs.has(workflow)) {
        issues.push({ code: "skill.unknown_workflow", path: skill.path, message: `Unknown workflow ${workflow}` });
      }
      if (!markdownWorkflowRefs.has(workflow)) {
        issues.push({ code: "skill.missing_workflow_reference", path: skill.path, message: `SKILL.md does not reference workflow ${workflow}` });
      }
    }
    for (const workflowRef of markdownWorkflowRefs) {
      if (!workflowRefs.has(workflowRef)) {
        issues.push({ code: "skill.unknown_workflow_reference", path: skill.path, message: `Unknown workflow reference ${workflowRef}` });
      }
    }
  }

  const installedChecks = await Promise.all(
    (input.installChecks ?? []).map((check) => validateInstalledSkillRoot(check, skills, issues, roots))
  );

  return { ok: issues.length === 0, workflowCount: workflows.length, templateCount: templates.length, skillCount: skills.length, installedChecks, issues };
}

export async function buildSkillInstallPlan(input: {
  readonly target: "codex" | "claude" | "skills";
  readonly installRoot: string;
  readonly dryRun: boolean;
  readonly workspaceRoot?: string;
  readonly assetRoot?: string;
}): Promise<SkillInstallPlan> {
  const roots = resolveWorkflowAssetRoots(input);
  const root = resolve(input.installRoot);
  const skillRoot = skillRootForInstall(root, input.target);
  const skills = await listSkillAssets(roots);
  const inspection = await inspectWorkflowAssets(input);
  const files = skills.flatMap((skill) => expectedSkillInstallFiles(skillRoot, input.target, skill, !input.dryRun));

  return { target: input.target, dryRun: input.dryRun, assetRoot: roots.assetRoot, installRoot: root, skillRoot, files, issues: inspection.issues };
}

export async function validateInstalledSkillRoot(
  input: InstalledSkillRootValidationInput,
  skills?: readonly SkillAsset[],
  issues: AssetValidationIssue[] = [],
  roots: WorkflowAssetRoots = resolveWorkflowAssetRoots()
): Promise<InstalledSkillRootInspection> {
  const installRoot = resolve(input.installRoot);
  const skillRoot = skillRootForInstall(installRoot, input.target);
  const skillAssets = skills ?? await listSkillAssets(roots);
  const expectedFiles = skillAssets.flatMap((skill) => expectedSkillInstallFiles(skillRoot, input.target, skill, false));
  let checkedFileCount = 0;

  for (const file of expectedFiles) {
    const sourceText = await readFile(resolve(roots.assetRoot, file.source), "utf8");
    let installedText: string | undefined;
    try {
      installedText = await readFile(file.destination, "utf8");
      checkedFileCount += 1;
    } catch {
      issues.push({
        code: "installed_skill.missing_file",
        path: relative(roots.assetRoot, file.destination),
        message: `Missing installed skill file expected from ${file.source}`
      });
      continue;
    }
    if (installedText !== sourceText) {
      issues.push({
        code: "installed_skill.stale_file",
        path: relative(roots.assetRoot, file.destination),
        message: `Installed skill file differs from ${file.source}`
      });
    }
    if (file.destination.endsWith("/SKILL.md") && !installedText.includes("bwrk workflows show <ref>")) {
      issues.push({
        code: "installed_skill.missing_workflow_resolver",
        path: relative(roots.assetRoot, file.destination),
        message: "Installed SKILL.md does not explain the workflow resolver fallback"
      });
    }
    if (file.destination.endsWith("/SKILL.md") && !hasAgentDirectiveHandling(installedText)) {
      issues.push({
        code: "installed_skill.missing_agent_directive_handling",
        path: relative(roots.assetRoot, file.destination),
        message: "Installed SKILL.md does not require directive-bundle inspection and conflict reporting"
      });
    }
  }

  if (input.target === "claude") {
    for (const skill of skillAssets) {
      const unexpected = join(skillRoot, skill.name, "agents", "openai.yaml");
      try {
        await readFile(unexpected, "utf8");
        issues.push({
          code: "installed_skill.unexpected_openai_metadata",
          path: relative(roots.assetRoot, unexpected),
          message: "Claude installs must not include Codex agents/openai.yaml metadata"
        });
      } catch {
        // Expected for Claude installs.
      }
    }
  }

  return {
    target: input.target,
    installRoot,
    skillRoot,
    skillCount: skillAssets.length,
    expectedFileCount: expectedFiles.length,
    checkedFileCount
  };
}

export async function installSkillsFromPlan(plan: SkillInstallPlan): Promise<SkillInstallPlan> {
  if (plan.issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Cannot install skills while workflow assets are invalid", {
      issues: plan.issues
    });
  }
  await mkdir(plan.installRoot, { recursive: true });
  for (const file of plan.files) {
    await assertInstallDestination(plan.installRoot, file.destination);
    await mkdir(dirname(file.destination), { recursive: true });
    await writeFile(file.destination, await readFile(resolve(plan.assetRoot, file.source), "utf8"), "utf8");
  }
  return plan;
}

async function readWorkflowAsset(file: string, roots: WorkflowAssetRoots): Promise<WorkflowAsset> {
  const text = await readFile(file, "utf8");
  const meta = parseFrontmatter(text, relative(roots.assetRoot, file));
  return {
    path: relative(roots.workflowsRoot, file),
    id: requiredScalar(meta, "id"),
    title: requiredScalar(meta, "title"),
    group: requiredScalar(meta, "group"),
    allowedCommands: listValue(meta, "allowed_commands"),
    templates: listValue(meta, "templates"),
    text
  };
}

async function listTemplateIds(roots: WorkflowAssetRoots): Promise<readonly string[]> {
  return (await markdownFiles(roots.templatesRoot))
    .filter((file) => !file.endsWith("README.md"))
    .map((file) => file.replace(/^.*\/([^/]+)\.md$/u, "$1"));
}

async function listSkillAssets(roots: WorkflowAssetRoots): Promise<readonly SkillAsset[]> {
  const skillRoot = roots.skillsRoot;
  const entries = await readdir(skillRoot, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(skillRoot, entry.name);
        const skillPath = join(dir, "SKILL.md");
        const metadataPath = join(dir, "boreal.yaml");
        const skillText = await readFile(skillPath, "utf8");
        const meta = parseFrontmatter(skillText, relative(roots.assetRoot, skillPath));
        const borealMeta = parseYamlDocument(await readFile(metadataPath, "utf8"), relative(roots.assetRoot, metadataPath));
        const name = requiredScalar(meta, "name");
        if (name !== entry.name) {
          throw new BorealError("BOREAL_INVALID_INPUT", "Skill folder name must match SKILL.md name", {
            path: relative(roots.assetRoot, skillPath),
            folder: entry.name,
            name
          });
        }
        const metadataSkill = requiredScalar(borealMeta, "skill");
        if (metadataSkill !== name) {
          throw new BorealError("BOREAL_INVALID_INPUT", "Skill boreal.yaml skill must match SKILL.md name", {
            path: relative(roots.assetRoot, metadataPath),
            skill: metadataSkill,
            name
          });
        }
        const files = await recursiveFiles(dir);
        const installFiles = files
          .map((file) => ({
            source: relative(roots.assetRoot, file),
            relativePath: relative(dir, file)
          }))
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
        return {
          path: relative(roots.assetRoot, dir),
          name,
          displayName: requiredScalar(borealMeta, "display_name"),
          workflows: listValue(borealMeta, "workflows"),
          text: skillText,
          files: installFiles
        };
      })
  );
}

function workflowReferencesFromMarkdown(text: string): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(/`workflows\/([^`\s]+\.md)`/gu)) {
    const ref = match[1];
    if (ref) {
      refs.add(ref);
    }
  }
  return refs;
}

function hasAgentDirectiveHandling(text: string): boolean {
  return SKILL_DIRECTIVE_HANDLING_MARKERS.every((marker) => text.includes(marker));
}

function skillRootForInstall(root: string, target: "codex" | "claude" | "skills"): string {
  if (target === "skills" || basename(root) === "skills") {
    return root;
  }
  return join(root, "skills");
}

function skillInstallDestination(skillRoot: string, skillName: string, filePath: string): string {
  return join(skillRoot, skillName, filePath);
}

function shouldInstallSkillFile(target: "codex" | "claude" | "skills", file: SkillAssetFile): boolean {
  if (target === "claude" && file.relativePath.startsWith("agents/")) {
    return false;
  }
  return true;
}

function expectedSkillInstallFiles(
  skillRoot: string,
  target: "codex" | "claude" | "skills",
  skill: SkillAsset,
  wouldWrite: boolean
): SkillInstallPlan["files"] {
  return skill.files
    .filter((file) => shouldInstallSkillFile(target, file))
    .map((file) => ({
      source: file.source,
      destination: skillInstallDestination(skillRoot, skill.name, file.relativePath),
      workflowRefs: skill.workflows,
      wouldWrite
    }));
}

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(path);
      }
      return entry.isFile() && path.endsWith(".md") ? [path] : [];
    })
  );
  return files.flat().sort();
}

function parseFrontmatter(text: string, path: string): Map<string, string | string[]> {
  const match = /^---\n(?<body>[\s\S]*?)\n---/u.exec(text);
  if (!match?.groups?.body) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Markdown asset missing frontmatter", { path });
  }
  return parseYamlDocument(match.groups.body, path);
}

function parseYamlDocument(text: string, path: string): Map<string, string | string[]> {
  const values = new Map<string, string | string[]>();
  let listKey: string | undefined;
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    const item = /^  - (.*)$/u.exec(line);
    if (item && listKey) {
      (values.get(listKey) as string[]).push(parseYamlScalar(item[1] ?? "", path, index + 1));
      continue;
    }
    const keyValue = /^([a-z_]+):(?: (.*))?$/u.exec(line);
    if (!keyValue) {
      throw new BorealError("BOREAL_INVALID_INPUT", "YAML frontmatter contains unsupported syntax", {
        path,
        line: index + 1,
        text: line
      });
    }
    const key = keyValue[1] ?? "";
    const value = keyValue[2];
    if (value === undefined) {
      values.set(key, []);
      listKey = key;
    } else {
      values.set(key, parseYamlScalar(value, path, index + 1));
      listKey = undefined;
    }
  }
  return values;
}

function parseYamlScalar(value: string, path: string, line: number): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuotedYamlScalar(trimmed, path, line);
  }
  if (trimmed.includes(": ")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "YAML scalar containing ': ' must be quoted", {
      path,
      line,
      value: trimmed
    });
  }
  if (/[\[\]{}]/u.test(trimmed)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "YAML frontmatter only supports block lists and scalar strings", {
      path,
      line,
      value: trimmed
    });
  }
  return trimmed;
}

function parseQuotedYamlScalar(value: string, path: string, line: number): string {
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length === 1) {
      throw new BorealError("BOREAL_INVALID_INPUT", "YAML double-quoted scalar is unterminated", { path, line, value });
    }
    try {
      return JSON.parse(value) as string;
    } catch (error) {
      throw new BorealError("BOREAL_INVALID_INPUT", "YAML double-quoted scalar is invalid", {
        path,
        line,
        value,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (!value.endsWith("'") || value.length === 1) {
    throw new BorealError("BOREAL_INVALID_INPUT", "YAML single-quoted scalar is unterminated", { path, line, value });
  }
  return value.slice(1, -1).replace(/''/gu, "'");
}

async function recursiveFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return recursiveFiles(path);
      }
      return entry.isFile() ? [path] : [];
    })
  );
  return files.flat().sort();
}

function requiredScalar(values: Map<string, string | string[]>, key: string): string {
  const value = values.get(key);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", `Markdown asset missing ${key}`);
}

function listValue(values: Map<string, string | string[]>, key: string): readonly string[] {
  const value = values.get(key);
  return Array.isArray(value) ? value : [];
}

async function assertInstallDestination(root: string, destination: string): Promise<void> {
  assertPathInside(root, destination);
  await assertRealPathInside(root, destination);
}
