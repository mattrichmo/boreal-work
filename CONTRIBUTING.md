# Contributing to Boreal Work

Boreal Work is an early, source-available project. If you found a bug, have a documentation fix, or want to change the code, this is the place to start. Contributions are subject to the [project license](LICENSE).

## Development setup

The repository uses Node.js 22 or newer and pnpm. From a fresh checkout:

```bash
pnpm install
pnpm build
pnpm check
pnpm test
git diff --check
```

Use `pnpm bwrk ...` to run the CLI from the checkout. Use `pnpm install:local` to install that checkout as the local `bwrk` command.

## Making changes

- Keep changes focused and preserve the project boundary.
- Update tests and documentation when behavior, command syntax, persisted records, or JSON output changes.
- Preserve the distinction between canonical records, generated views, and local caches.
- Treat evidence provenance, workspace boundaries, and closeout behavior as public contracts.
- Include the validation commands you ran in the pull request description.

For changes involving storage, compatibility, releases, or agent workflows, read the relevant document in [the documentation index](docs/README.md) first.

## Reporting issues

When reporting a bug, include:

- the expected and actual behavior;
- a minimal reproduction or command sequence;
- the Boreal version and relevant runtime details; and
- sanitized error output or artifacts where applicable.

For a behavior change, explain the problem, the proposed solution, and any compatibility or migration impact.

## Pull requests

Describe the change, why it is needed, and how you checked it. Call out changes to CLI output, schemas, generated documentation, migrations, or release behavior.

Please review the [release guide](docs/release/publishing.md) before changing packaging or publishing behavior, and review the [license](LICENSE) before redistributing the project or release artifacts.
