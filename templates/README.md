# Templates

Most files in this directory are human-readable Markdown output contracts used by workflows. They do not write canonical state. Use CLI commands for state, then use Markdown templates for summaries, plans, handoffs, or reports.

`templates/work-structures/*.yaml` is the separate work-structure template namespace. These YAML files declare reusable Boreal work trees for `bwrk template list|show|validate|capture|run`; running one creates normal work records, dependency edges, labels, source references, and optional task bindings.
