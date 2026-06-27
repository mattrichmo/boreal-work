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

Each skill declares the workflow files it can route to. Skill text must reference workflow files and must not duplicate detailed workflow steps.

## Installer Behavior

The installer should render skills for Codex and Claude into a selected install root. Dry-run mode reports target files and source workflow references without writing.
