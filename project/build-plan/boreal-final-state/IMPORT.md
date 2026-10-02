# Import into Boreal Work

This ZIP includes the **currently supported Boreal work-template v1 format** at:

```text
.boreal/templates/boreal-final-state-v1.json
```

It imports:

- 1 milestone
- 12 sprint work items
- 76 task work items (including one sprint integration/test task per sprint)
- dependencies
- priorities
- dispatch policies
- labels
- focused/reviewed acceptance profiles

The rich context packets remain under:

```text
project/build-plan/boreal-final-state/
```

## Recommended workflow

Extract the ZIP at the Boreal repository root so both `.boreal/templates/` and `project/build-plan/` land in place.

1. Validate the template:

```sh
bwrk template validate --project PROJECT \
  --input .boreal/templates/boreal-final-state-v1.json --json
```

2. Review a dry run:

```sh
bwrk template run --project PROJECT \
  --input .boreal/templates/boreal-final-state-v1.json \
  --dry-run --json
```

3. Read the current project revision (`bwrk prime --json` or another canonical revision-bearing read), then instantiate atomically:

```sh
bwrk template run --project PROJECT \
  --input .boreal/templates/boreal-final-state-v1.json \
  --apply --prefix boreal-final \
  --expected-revision REVISION --yes --json
```

Created work IDs will be stable under the chosen prefix, for example:

```text
boreal-final-milestone
boreal-final-s00
boreal-final-s00-t01
...
```

## Dispatch

Use Boreal's project execution authority normally after import:

```sh
bwrk work ready --project PROJECT --json
bwrk work parallel --project PROJECT --json
bwrk work show --project PROJECT WORK_ID --json
```

Give an agent the corresponding Markdown task packet before implementation. The imported work description points to that file.

## Important

- `BOREAL_TEMPLATE.json` under the plan folder is a convenience copy. `template run --input` currently requires the import file to be under `.boreal/templates/`.
- This pack does **not** modify application source or live Boreal state by itself.
- `T90` tasks are where sprint integration/testing is concentrated. Do not add per-task ceremony unless a task's output is directly consumed by another task before sprint close.
- Conditional BW-S10 refinement tasks import with `dispatch: paused`; unpause them only if the benchmark/product decision calls for them.
