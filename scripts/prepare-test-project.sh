#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
workspace_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
project_root="$workspace_root/test-project"
state_root="$project_root/.boreal"
bin_root="$state_root/bin"
lib_root="$state_root/lib/boreal"
tui_root="$workspace_root/apps/tui"
tui_dist="$tui_root/dist"
tui_install_root="$lib_root/tui"
release_binary="$workspace_root/target/release/bwrk"
local_binary="$bin_root/bwrk"
local_versioned_binary="$bin_root/bwrk-v2"
database="$state_root/boreal.sqlite"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to build and run the Boreal dashboard TUI, but 'node' was not found on PATH" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the Boreal dashboard TUI, but 'npm' was not found on PATH" >&2
  exit 1
fi

if [ -x "$tui_root/node_modules/.bin/tsc" ]; then
  typescript_compiler="$tui_root/node_modules/.bin/tsc"
elif command -v tsc >/dev/null 2>&1; then
  typescript_compiler=$(command -v tsc)
else
  echo "the TypeScript compiler is unavailable; restore the existing offline npm setup before preparing the test project" >&2
  exit 1
fi

mkdir -p "$bin_root" "$lib_root"

echo "Checking the Boreal v2 dashboard TUI (offline)"
if ! npm_config_offline=true npm --prefix "$tui_root" run typecheck; then
  echo "dashboard TUI typecheck failed; check the existing offline npm/TypeScript setup in $tui_root" >&2
  exit 1
fi

echo "Building the Boreal v2 dashboard TUI"
if ! "$typescript_compiler" --project "$tui_root/tsconfig.json"; then
  echo "dashboard TUI compilation failed with $typescript_compiler" >&2
  exit 1
fi

if [ ! -d "$tui_dist" ]; then
  echo "dashboard TUI build did not produce the compiled dist tree: $tui_dist" >&2
  exit 1
fi

if [ ! -s "$tui_dist/entrypoint.js" ]; then
  echo "dashboard TUI build did not produce a usable entrypoint: $tui_dist/entrypoint.js" >&2
  exit 1
fi

echo "Installing the compiled dashboard TUI"
mkdir -p "$tui_install_root"
cp -R "$tui_dist/." "$tui_install_root/"

if [ ! -s "$tui_install_root/entrypoint.js" ]; then
  echo "packaged dashboard entrypoint is missing or empty: $tui_install_root/entrypoint.js" >&2
  exit 1
fi

find "$tui_dist" -type f -print | while IFS= read -r source_file; do
  relative_path=${source_file#"$tui_dist"/}
  installed_file="$tui_install_root/$relative_path"
  if [ ! -f "$installed_file" ]; then
    echo "packaged dashboard artifact is missing: $installed_file" >&2
    exit 1
  fi
  if ! cmp -s "$source_file" "$installed_file"; then
    echo "packaged dashboard artifact does not match its build output: $installed_file" >&2
    exit 1
  fi
done

echo "Building Boreal v2 CLI"
cargo build --release --locked --offline -p boreal-cli --manifest-path "$workspace_root/Cargo.toml"

if [ ! -f "$release_binary" ]; then
  echo "release binary was not produced: $release_binary" >&2
  exit 1
fi

install -m 755 "$release_binary" "$local_binary"
install -m 755 "$release_binary" "$local_versioned_binary"

if [ ! -f "$database" ]; then
  echo "Initializing test-project database"
  "$local_versioned_binary" init test-project --db "$database" --actor bootstrap --json
else
  echo "Keeping existing test-project database"
fi

version=$("$local_versioned_binary" --version)
if [ "$version" != "bwrk 0.2.0 (api 2)" ]; then
  echo "unexpected local CLI version: $version" >&2
  exit 1
fi

if ! cmp -s "$release_binary" "$local_binary"; then
  echo "local bwrk install does not match the release binary" >&2
  exit 1
fi

if ! cmp -s "$release_binary" "$local_versioned_binary"; then
  echo "local bwrk-v2 install does not match the release binary" >&2
  exit 1
fi

echo "Checking local status projection"
"$local_versioned_binary" status test-project --db "$database" --json >/dev/null

if command -v sqlite3 >/dev/null 2>&1; then
  integrity=$(sqlite3 "$database" 'PRAGMA integrity_check;')
  if [ "$integrity" != "ok" ]; then
    echo "SQLite integrity check failed: $integrity" >&2
    exit 1
  fi
fi

echo "Boreal v2 test-project is ready"
echo "  root: $project_root"
echo "  cli:  $local_binary"
echo "  tui:  $tui_install_root/entrypoint.js"
echo "  db:   $database"
echo "  next: cd $project_root && source .boreal/activate.sh"
echo "        bwrk dashboard test-project --db \"\$BOREAL_TEST_DB\""
