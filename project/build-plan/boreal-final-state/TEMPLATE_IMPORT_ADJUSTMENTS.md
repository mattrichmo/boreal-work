# Template import adjustments

The original pack template is preserved at `BOREAL_TEMPLATE.json`. The staged
`.boreal/templates/boreal-final-state-v1.json` copy is adapted for Boreal v2's
task-only dependency graph: milestone and sprint dependency arrays are empty.
Their predecessor gates are already listed on each non-gate task in the sprint,
and each sprint's `t90` gate depends on all tasks in that sprint. This keeps the
sequence represented through task edges while avoiding unsupported container
edges. Task-level dependencies and all other work fields are preserved.

The first apply attempt was rejected atomically with
`dependency_requires_direct_tasks`; it created no work records.
