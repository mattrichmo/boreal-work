# Skills And Workflows

Workflows are canonical. Skills are thin adapters. Templates shape output artifacts.

## Directory Layout

```text
workflows/
templates/
skills/
```

## Workflow Metadata

Each workflow uses frontmatter with `id`, `title`, `group`, `status`, `risk`, `writes_state`, `requires_workspace`, `allowed_commands`, and `templates`.

## Skill Metadata

Each skill folder is named with the `boreal-` prefix, and the `SKILL.md` frontmatter `name` must match the folder name. This makes installed skills self-identifying in shared Codex or Claude skill lists, for example `boreal-router` and `boreal-sprint-launch`.

`SKILL.md` uses agent-standard YAML frontmatter with only `name` and `description`. Boreal-specific routing metadata lives in `boreal.yaml`:

```yaml
schema_version: boreal.skill.v1
system: boreal
skill: boreal-router
display_name: Boreal Router
workflows:
  - 00-agent/route-request.md
```

Codex UI metadata lives in `agents/openai.yaml`, including `interface.display_name`, `interface.short_description`, and `interface.default_prompt`.

Skill text must reference workflow files and must not duplicate detailed workflow steps.

## Installer Behavior

The installer renders skills into target-specific locations:

- Codex: `<install-root>/skills/<boreal-skill>/SKILL.md`, with `agents/openai.yaml`.
- Claude: `<install-root>/skills/<boreal-skill>/SKILL.md`, without Codex-specific `agents/openai.yaml`.
- Generic skill root: `<install-root>/<boreal-skill>/SKILL.md`, with full Boreal source metadata.

Dry-run mode reports target files and source workflow references without writing.
