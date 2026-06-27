import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMAND_DEFINITIONS, commandPath } from "../../apps/cli/src/command-registry.ts";

const rootDir = new URL("../..", import.meta.url).pathname;
const requiredWorkflowSections = [
  "## Purpose",
  "## When To Use",
  "## Inputs Required",
  "## Safety Constraints",
  "## Steps",
  "## CLI Commands",
  "## Evidence And Checkpoints",
  "## Failure And Repair",
  "## Finish Criteria",
  "## Next Suggested Workflow"
] as const;

describe("workflow, template, and skill docs", () => {
  it("keeps every workflow machine-checkable and routed to valid CLI commands", async () => {
    const workflowFiles = (await listMarkdownFiles(join(rootDir, "workflows"))).filter(
      (file) => !file.endsWith("README.md") && !file.endsWith("_workflow-template.md")
    );
    const workflowRefs = new Set(workflowFiles.map((file) => relative(join(rootDir, "workflows"), file)));
    const commandNames = new Set(COMMAND_DEFINITIONS.map(commandPath));
    const templateIds = new Set(
      (await listMarkdownFiles(join(rootDir, "templates")))
        .filter((file) => !file.endsWith("README.md"))
        .map((file) => file.replace(/^.*\/([^/]+)\.md$/u, "$1"))
    );
    const ids = new Set<string>();

    expect(workflowFiles.length).toBeGreaterThanOrEqual(38);
    for (const file of workflowFiles) {
      const text = await readFile(file, "utf8");
      const meta = parseFrontmatter(text, file);

      expect(meta.id).toMatch(/^boreal\.workflow\.[a-z0-9-]+\.v1$/u);
      expect(ids.has(meta.id)).toBe(false);
      ids.add(meta.id);
      expect(meta.title).toBeTruthy();
      expect(meta.group).toMatch(/^\d\d-[a-z-]+$/u);
      expect(meta.status).toBe("v1");
      expect(meta.allowed_commands.length).toBeGreaterThan(0);
      expect(meta.templates.length).toBeGreaterThan(0);
      for (const command of meta.allowed_commands) {
        expect(commandNames.has(command), `${relative(rootDir, file)} references unknown command ${command}`).toBe(true);
      }
      for (const template of meta.templates.filter((entry) => entry !== "none")) {
        expect(templateIds.has(template), `${relative(rootDir, file)} references unknown template ${template}`).toBe(true);
      }
      for (const section of requiredWorkflowSections) {
        expect(text, `${relative(rootDir, file)} missing ${section}`).toContain(section);
      }
      expect(text).toContain("Never read or write a sibling repository's memory");
      expect(text).toContain("bwrk doctor --strict --json");
      for (const workflow of workflowReferencesFromMarkdown(text)) {
        expect(workflowRefs.has(workflow), `${relative(rootDir, file)} references unknown workflow ${workflow}`).toBe(true);
      }
    }
  });

  it("keeps templates and skills connected to existing workflows", async () => {
    const workflowRefs = new Set(
      (await listMarkdownFiles(join(rootDir, "workflows")))
        .filter((file) => !file.endsWith("README.md") && !file.endsWith("_workflow-template.md"))
        .map((file) => relative(join(rootDir, "workflows"), file))
    );
    const templateFiles = (await listMarkdownFiles(join(rootDir, "templates"))).filter((file) => !file.endsWith("README.md"));
    const skillFiles = await listSkillFiles(join(rootDir, "skills"));

    expect(templateFiles.length).toBeGreaterThanOrEqual(15);
    for (const file of templateFiles) {
      const text = await readFile(file, "utf8");
      const meta = parseFrontmatter(text, file);
      expect(meta.id).toMatch(/^boreal\.template\.[a-z0-9-]+\.v1$/u);
      expect(text).toContain("## Required Fields");
      expect(text).toContain("## Template");
    }

    expect(skillFiles.length).toBeGreaterThanOrEqual(11);
    for (const file of skillFiles) {
      const text = await readFile(file, "utf8");
      const meta = parseFrontmatter(text, file);
      const name = meta.name as string;
      const metadataPath = join(dirname(file), "boreal.yaml");
      const openAiMetadataPath = join(dirname(file), "agents", "openai.yaml");
      const borealMeta = parseYamlDocument(await readFile(metadataPath, "utf8"), metadataPath);
      const openAiMetadata = await readFile(openAiMetadataPath, "utf8");
      const workflows = borealMeta.workflows as string[];

      expect(name).toMatch(/^boreal-[a-z0-9-]+$/u);
      expect(basename(dirname(file))).toBe(name);
      expect(Object.keys(meta).sort()).toEqual(["description", "name"]);
      expect(borealMeta.schema_version).toBe("boreal.skill.v1");
      expect(borealMeta.system).toBe("boreal");
      expect(borealMeta.skill).toBe(name);
      expect(borealMeta.display_name).toMatch(/^Boreal /u);
      expect(workflows.length).toBeGreaterThan(0);
      expect(openAiMetadata).toContain("interface:");
      expect(openAiMetadata).toContain(`default_prompt: "Use $${name}`);
      expect(text).toContain("bwrk workflows show <ref>");
      expect(text).toContain("not paths that must exist inside the installed skill folder");
      expect(text).toContain("You may read this skill folder's `SKILL.md`, `boreal.yaml`");

      const markdownWorkflowRefs = workflowReferencesFromMarkdown(text);
      for (const workflow of workflows) {
        expect(workflowRefs.has(workflow), `${relative(rootDir, file)} references unknown workflow ${workflow}`).toBe(true);
        expect(markdownWorkflowRefs.has(workflow), `${relative(rootDir, file)} does not mention ${workflow}`).toBe(true);
      }
      for (const workflow of markdownWorkflowRefs) {
        expect(workflowRefs.has(workflow), `${relative(rootDir, file)} references unknown workflow ${workflow}`).toBe(true);
      }
      expect(text).toContain("No-Leak Rules");
      expect(text).toContain("Do not read sibling");
      expect(text).toContain("Keep this skill as a thin adapter");
      for (const workflowBodyHeading of ["## Steps", "## Command Sequences", "## CLI Commands", "## Finish Criteria"]) {
        expect(text, `${relative(rootDir, file)} duplicates ${workflowBodyHeading}`).not.toContain(workflowBodyHeading);
      }
    }
  });

  it("keeps work and sprint playbooks specific enough for agents to execute", async () => {
    const launchSprint = await readFile(join(rootDir, "workflows/40-work/launch-sprint.md"), "utf8");
    const createWork = await readFile(join(rootDir, "workflows/40-work/create-work-structure.md"), "utf8");
    const claimFinish = await readFile(join(rootDir, "workflows/40-work/claim-and-finish-work.md"), "utf8");
    const closeout = await readFile(join(rootDir, "workflows/40-work/closeout-work.md"), "utf8");

    expect(launchSprint).toContain('bwrk work create "Sprint: <name>" --kind sprint');
    expect(launchSprint).toContain("Capture the sprint ID from `data.meta.id`");
    expect(launchSprint).toContain("bwrk dep add <sprint-id> <task-id> --json");
    expect(launchSprint).toContain("bwrk work ready <task-id> --json");
    expect(createWork).toContain("Create a container when the request describes a program, backlog, milestone, or issue group");
    expect(createWork).toContain("Capture the returned container ID from `data.meta.id`");
    expect(claimFinish).toContain("Prefer `agent finish` for normal reserved work closeout");
    expect(claimFinish).toContain("bwrk agent finish current --agent <agent-id>");
    expect(claimFinish).toContain("Use manual `evidence add`, `work verify`, and `work close` only when no active reservation exists");
    expect(closeout).toContain("Capture the evidence ID from `data.meta.id`");
    expect(closeout).toContain("bwrk work verify <work-id> --evidence <evidence-id> --verdict passed");
  });

  it("keeps board transition contracts behind safe CLI commands", async () => {
    const dashboardContracts = await readFile(join(rootDir, "docs/architecture/DASHBOARD_COMMAND_CONTRACTS.md"), "utf8");

    expect(dashboardContracts).toContain("## Board Transition Contract");
    expect(dashboardContracts).toContain("UI cannot mutate `.boreal/runtime/state.json`");
    expect(dashboardContracts).toContain("`mutatesState`");
    expect(dashboardContracts).toContain("`requiresConfirmation`");
    expect(dashboardContracts).toContain("bwrk sprint board [<sprint-ref>] --json");
    expect(dashboardContracts).toContain("bwrk sprint activate <sprint-ref> --json");
    expect(dashboardContracts).toContain("bwrk work reserve <work-id> --agent <agent-id> --purpose <text> --json");
    expect(dashboardContracts).toContain("bwrk evidence add <work-id>");
    expect(dashboardContracts).toContain("bwrk work verify <work-id> --evidence <evidence-id> --verdict passed --json");
    expect(dashboardContracts).toContain("bwrk work close <work-id> --reason <text> --json");
    expect(dashboardContracts).toContain("bwrk agent finish current --agent <agent-id>");
    expect(dashboardContracts).toContain("passed verification requires passed evidence");
    expect(dashboardContracts).toContain("Board UI must not run broad `work claim` for a card");
    expect(dashboardContracts).toContain("`activeBlockerIds` remains the derived unresolved-blocker subset");
  });

  it("keeps runtime versioning and migration policy explicit", async () => {
    const runtime = await readFile(join(rootDir, "docs/architecture/RUNTIME.md"), "utf8");
    const commands = await readFile(join(rootDir, "docs/cli/COMMANDS.md"), "utf8");

    expect(runtime).toContain("## Versioning And Migration Policy");
    expect(runtime).toContain("bwrk version --json");
    expect(runtime).toContain("boreal.cli.version.v1");
    expect(runtime).toContain("boreal.runtime.v1");
    expect(runtime).toContain("boreal.file-store.v1");
    expect(runtime).toContain("Migrations that cannot be cleanly reversed must create a `boreal.export.v1` recovery snapshot");
    expect(runtime).toContain("Breaking persisted runtime or adapter changes require a new schema version");
    expect(commands).toContain("`boreal.cli.version.v1`");
    expect(commands).toContain("Non-reversible migrations must be snapshot-backed by a `boreal.export.v1` recovery snapshot");
  });

  it("keeps dashboard usage docs distinct from JSON and plain CLI modes", async () => {
    const consoleApp = await readFile(join(rootDir, "docs/architecture/CONSOLE_APP.md"), "utf8");
    const commands = await readFile(join(rootDir, "docs/cli/COMMANDS.md"), "utf8");

    expect(consoleApp).toContain("## CLI Output Modes");
    expect(consoleApp).toContain("JSON mode is the canonical contract for agents and the console");
    expect(consoleApp).toContain("Plain CLI mode is the default terminal format");
    expect(consoleApp).toContain("Dashboard human mode is an opt-in terminal view");
    expect(consoleApp).toContain("bwrk dashboard global --json");
    expect(consoleApp).toContain("It is different from `--view dashboard`");
    expect(commands).toContain("Output modes:");
    expect(commands).toContain("JSON mode is the stable automation contract");
    expect(commands).toContain("Plain mode is the default human output");
    expect(commands).toContain("Dashboard mode is opt-in human rendering");
  });
});

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(path);
      }
      return entry.isFile() && path.endsWith(".md") ? [path] : [];
    })
  );
  return files.flat().sort();
}

async function listSkillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return listSkillFiles(path);
      }
      return entry.isFile() && entry.name === "SKILL.md" && (await stat(path)).isFile() ? [path] : [];
    })
  );
  return files.flat().sort();
}

function parseFrontmatter(text: string, file: string): Record<string, string | string[]> {
  const match = /^---\n(?<body>[\s\S]*?)\n---/u.exec(text);
  expect(match?.groups?.body, `${relative(rootDir, file)} missing frontmatter`).toBeTruthy();
  return parseYamlDocument(match?.groups?.body ?? "", file);
}

function parseYamlDocument(text: string, file: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let currentList: string | undefined;
  for (const line of text.split("\n")) {
    const listMatch = /^  - (.*)$/u.exec(line);
    if (listMatch && currentList) {
      (result[currentList] as string[]).push(listMatch[1] ?? "");
      continue;
    }
    const keyValue = /^([a-z_]+):(?: (.*))?$/u.exec(line);
    if (!keyValue) {
      currentList = undefined;
      continue;
    }
    const key = keyValue[1] ?? "";
    const value = keyValue[2];
    if (value === undefined) {
      result[key] = [];
      currentList = key;
    } else {
      result[key] = value;
      currentList = undefined;
    }
  }
  return result;
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
