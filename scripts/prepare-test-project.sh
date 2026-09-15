#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
workspace_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
project_root="$workspace_root/test-project"
state_root="$project_root/.boreal"
bin_root="$state_root/bin"
release_binary="$workspace_root/target/release/boreal-cli"
local_binary="$bin_root/bwrk"
local_versioned_binary="$bin_root/bwrk-v2"
database="$state_root/boreal.sqlite"

mkdir -p "$bin_root"

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
if [ "$version" != "bwrk 2" ]; then
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
echo "  db:   $database"
echo "  next: cd $project_root && source .boreal/activate.sh"
