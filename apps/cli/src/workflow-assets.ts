import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import { BorealError, assertPathInside, assertRealPathInside } from "@boreal/core";

import { COMMAND_DEFINITIONS, commandPath } from "./command-registry.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

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

export interface SkillInstallPlan {
  readonly target: "codex" | "claude" | "skills";
  readonly dryRun: boolean;
  readonly installRoot: string;
  readonly files: readonly {
    readonly source: string;
    readonly destination: string;
    readonly workflowRefs: readonly string[];
    readonly wouldWrite: boolean;
  }[];
  readonly issues: readonly AssetValidationIssue[];
}

export async function listWorkflowAssets(): Promise<readonly WorkflowAsset[]> {
  const files = (await markdownFiles(join(repoRoot, "workflows"))).filter(
    (file) => !file.endsWith("README.md") && !file.endsWith("_workflow-template.md")
  );
  return Promise.all(files.map(readWorkflowAsset));
}

export async function getWorkflowAsset(ref: string): Promise<WorkflowAsset> {
  const workflows = await listWorkflowAssets();
  const matches = workflows.filter((workflow) => workflow.id === ref || workflow.path === ref || workflow.path.endsWith(`/${ref}.md`));
  if (matches.length === 1 && matches[0]) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new BorealError("BOREAL_CONFLICT", "Workflow reference is ambiguous", { ref, candidates: matches.map((item) => item.path) });
  }
  throw new BorealError("BOREAL_NOT_FOUND", "Workflow not found", { ref });
}

export async function inspectWorkflowAssets(): Promise<{
  readonly ok: boolean;
  readonly workflowCount: number;
  readonly templateCount: number;
  readonly skillCount: number;
  readonly issues: readonly AssetValidationIssue[];
}> {
  const [workflows, templates, skills] = await Promise.all([listWorkflowAssets(), listTemplateIds(), listSkillAssets()]);
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
  }

  for (const skill of skills) {
    for (const workflow of skill.workflows) {
      if (!workflowRefs.has(workflow)) {
        issues.push({ code: "skill.unknown_workflow", path: skill.path, message: `Unknown workflow ${workflow}` });
      }
    }
  }

  return { ok: issues.length === 0, workflowCount: workflows.length, templateCount: templates.length, skillCount: skills.length, issues };
}

export async function buildSkillInstallPlan(input: {
  readonly target: "codex" | "claude" | "skills";
  readonly installRoot: string;
  readonly dryRun: boolean;
}): Promise<SkillInstallPlan> {
  const root = resolve(input.installRoot);
  const skills = await listSkillAssets();
  const inspection = await inspectWorkflowAssets();
  const files = skills.flatMap((skill) =>
    skill.files
      .filter((file) => shouldInstallSkillFile(input.target, file))
      .map((file) => ({
        source: file.source,
        destination: skillInstallDestination(root, input.target, skill.name, file.relativePath),
        workflowRefs: skill.workflows,
        wouldWrite: !input.dryRun
      }))
  );

  return { target: input.target, dryRun: input.dryRun, installRoot: root, files, issues: inspection.issues };
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
    await writeFile(file.destination, await readFile(resolve(repoRoot, file.source), "utf8"), "utf8");
  }
  return plan;
}

async function readWorkflowAsset(file: string): Promise<WorkflowAsset> {
  const text = await readFile(file, "utf8");
  const meta = parseFrontmatter(text);
  return {
    path: relative(join(repoRoot, "workflows"), file),
    id: requiredScalar(meta, "id"),
    title: requiredScalar(meta, "title"),
    group: requiredScalar(meta, "group"),
    allowedCommands: listValue(meta, "allowed_commands"),
    templates: listValue(meta, "templates"),
    text
  };
}

async function listTemplateIds(): Promise<readonly string[]> {
  return (await markdownFiles(join(repoRoot, "templates")))
    .filter((file) => !file.endsWith("README.md"))
    .map((file) => file.replace(/^.*\/([^/]+)\.md$/u, "$1"));
}

async function listSkillAssets(): Promise<readonly SkillAsset[]> {
  const skillRoot = join(repoRoot, "skills");
  const entries = await readdir(skillRoot, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(skillRoot, entry.name);
        const skillPath = join(dir, "SKILL.md");
        const metadataPath = join(dir, "boreal.yaml");
        const skillText = await readFile(skillPath, "utf8");
        const meta = parseFrontmatter(skillText);
        const borealMeta = parseYamlDocument(await readFile(metadataPath, "utf8"));
        const name = requiredScalar(meta, "name");
        if (name !== entry.name) {
          throw new BorealError("BOREAL_INVALID_INPUT", "Skill folder name must match SKILL.md name", {
            path: relative(repoRoot, skillPath),
            folder: entry.name,
            name
          });
        }
        const metadataSkill = requiredScalar(borealMeta, "skill");
        if (metadataSkill !== name) {
          throw new BorealError("BOREAL_INVALID_INPUT", "Skill boreal.yaml skill must match SKILL.md name", {
            path: relative(repoRoot, metadataPath),
            skill: metadataSkill,
            name
          });
        }
        const files = await recursiveFiles(dir);
        const installFiles = files
          .map((file) => ({
            source: relative(repoRoot, file),
            relativePath: relative(dir, file)
          }))
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
        return {
          path: relative(repoRoot, dir),
          name,
          displayName: requiredScalar(borealMeta, "display_name"),
          workflows: listValue(borealMeta, "workflows"),
          files: installFiles
        };
      })
  );
}

function skillInstallDestination(root: string, target: "codex" | "claude" | "skills", skillName: string, filePath: string): string {
  switch (target) {
    case "codex":
      return join(root, "skills", skillName, filePath);
    case "claude":
      return join(root, "skills", skillName, filePath);
    case "skills":
      return join(root, skillName, filePath);
  }
}

function shouldInstallSkillFile(target: "codex" | "claude" | "skills", file: SkillAssetFile): boolean {
  if (target === "claude" && file.relativePath.startsWith("agents/")) {
    return false;
  }
  return true;
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

function parseFrontmatter(text: string): Map<string, string | string[]> {
  const match = /^---\n(?<body>[\s\S]*?)\n---/u.exec(text);
  if (!match?.groups?.body) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Markdown asset missing frontmatter");
  }
  return parseYamlDocument(match.groups.body);
}

function parseYamlDocument(text: string): Map<string, string | string[]> {
  const values = new Map<string, string | string[]>();
  let listKey: string | undefined;
  for (const line of text.split("\n")) {
    const item = /^  - (.*)$/u.exec(line);
    if (item && listKey) {
      (values.get(listKey) as string[]).push(item[1] ?? "");
      continue;
    }
    const keyValue = /^([a-z_]+):(?: (.*))?$/u.exec(line);
    if (!keyValue) {
      listKey = undefined;
      continue;
    }
    const key = keyValue[1] ?? "";
    const value = keyValue[2];
    if (value === undefined) {
      values.set(key, []);
      listKey = key;
    } else {
      values.set(key, value);
      listKey = undefined;
    }
  }
  return values;
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
