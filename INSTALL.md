# Boreal Work Installation

The installed command is `bwrk`.

## Install or update the CLI

After publishing the npm package, the shortest machine install is:

```bash
npm install -g @boreal/cli
bwrk --version
```

For the GitHub bootstrap path, install or update from the public repository:

```bash
bwrk upgrade --machine \
  --repo-url https://github.com/mattrichmo/boreal-work.git \
  --ref main \
  --json
```

Check the installed integration roots with:

```bash
bwrk integrations status --json
```

## Update an existing Boreal project

Run these commands inside each already-initialized project:

```bash
cd /path/to/existing-repo

bwrk upgrade --project --json
bwrk sync refresh --strict --json
bwrk doctor --strict --json
bwrk prime --json
```

## Initialize a new repository

```bash
mkdir -p /path/to/new-repo
cd /path/to/new-repo

git init
git branch -M main
git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git

bwrk setup --yes --json
bwrk sync refresh --strict --json
bwrk doctor --strict --json
bwrk prime --json

git add -A
git commit -m "Initialize Boreal workspace"
git push -u origin main
```

`bwrk setup --yes` creates the project runtime, the default child `memory/`
repository, and project-scoped Codex skills.

## Add a project to the global dashboard

Initialize the machine-level registry once:

```bash
bwrk global init --registry-root ~/.boreal/global --json
```

Then link a project from its own directory:

```bash
bwrk global link . --name "New Repo" --json
bwrk view --global
```

## Source checkout development

When running the current checkout directly, use the local source command:

```bash
pnpm install
pnpm build
pnpm bwrk --help
```

`bwrk upgrade --machine` fetches and builds the configured upstream repository;
it does not install the current uncommitted working tree. `bwrk setup` and
`bwrk view` are the preferred public commands; `install`, `dashboard`, and
`update self|repo` remain compatibility and advanced commands.

## License

Boreal Work is available under the PolyForm Noncommercial License 1.0.0.
Commercial use requires separate written permission. See [LICENSE](LICENSE)
for the complete terms.
