# Boreal Work Installation

The installed command is `bwrk`.

## Update the global CLI

After the GitHub repository is public, update the machine-level CLI from the
repository's `main` branch:

```bash
bwrk update self \
  --repo-url https://github.com/mattrichmo/boreal-work.git \
  --ref main \
  --json

bwrk install codex --scope user --json
bwrk install claude --scope user --json   # optional

bwrk version --json
bwrk install status --json
```

To update only the latest published npm package instead:

```bash
npm install -g @boreal/cli@latest
```

## Update an existing Boreal project

Run these commands inside each already-initialized project:

```bash
cd /path/to/existing-repo

bwrk update repo --json
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

bwrk install --yes --json
bwrk sync refresh --strict --json
bwrk doctor --strict --json
bwrk prime --json

git add -A
git commit -m "Initialize Boreal workspace"
git push -u origin main
```

`bwrk install --yes` creates the project runtime, the default child `memory/`
repository, and project-scoped Codex skills.

## Add a project to the global dashboard

Initialize the machine-level registry once:

```bash
bwrk global init --registry-root ~/.boreal/global --json
```

Then link a project from its own directory:

```bash
bwrk global link . --name "New Repo" --json
bwrk global status --json
```

## Source checkout development

When running the current checkout directly, use the local source command:

```bash
pnpm install
pnpm build
pnpm bwrk --help
```

`bwrk update self` fetches and builds the configured upstream repository; it
does not install the current uncommitted working tree.
