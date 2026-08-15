# Contributing to Boreal Work

Thanks for taking an interest in Boreal Work. This repository is an early, source-available project. Bug reports, documentation improvements, design discussion, and code contributions are welcome within the [project license](LICENSE).

## Development setup

The repository uses Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm build
pnpm check
pnpm test
git diff --check
```

Use `pnpm bwrk ...` to run the CLI from the current checkout. Use `pnpm install:local` when you need to install that checkout as the local `bwrk` command rather than using a versioned machine install.

## Making changes

- Keep changes focused and preserve the local-first project boundary.
- Update tests and documentation when behavior, command syntax, persisted records, or JSON output changes.
- Preserve the distinction between canonical records, generated views, and local caches.
- Treat evidence provenance, workspace boundaries, and closeout behavior as public contracts.
- Include the validation commands you ran in the pull request description.

For changes involving storage, compatibility, release behavior, or agent workflows, read the relevant document in [the documentation index](docs/README.md) before editing the implementation.

## Reporting issues

A useful issue includes:

- the expected and actual behavior;
- a minimal reproduction or command sequence;
- the Boreal version and relevant runtime details; and
- sanitized error output or artifacts where applicable.

For a proposed behavior change, explain the problem it addresses, the alternatives considered, and any compatibility or migration impact.

## Pull requests

Describe the change, why it is needed, and how it was verified. Call out changes to CLI contracts, schemas, generated documentation, migration behavior, or license and release boundaries so they can receive focused review.

Please review the [release guide](docs/release/publishing.md) before changing packaging or publishing behavior, and review the [license](LICENSE) before redistributing the project or release artifacts.
