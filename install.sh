#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: install.sh [--repo|--machine] [--global|--no-global] [--yes] [--no-link]

Installs the bundled bwrk dist artifact.

Modes:
  default      Install or upgrade the machine bwrk binary, then offer global/link steps.
  --machine   Install or upgrade the machine bwrk binary only.
  --repo      Add bwrk as a dev dependency in the current repo and verify pnpm bwrk.

Options:
  --global         Non-interactively accept global-manager setup when prompted.
  --no-global      Skip global-manager setup and repo linking.
  --yes, -y        Accept prompts non-interactively.
  --no-link        Skip linking the current repo to an existing registry.
  --bin-dir DIR    Machine binary directory. Defaults to BOREAL_INSTALL_BIN_DIR or ~/.local/bin.
  --lib-dir DIR    Machine install directory. Defaults to BOREAL_INSTALL_LIB_DIR or ~/.local/share/boreal/bwrk.
  --registry-root DIR
                   Registry root override. Defaults to BOREAL_PROJECT_REGISTRY_ROOT or the platform app-state path.
  --package-spec SPEC
                   Repo dependency spec. Defaults to a repo-local package built from apps/cli/dist.
USAGE
}

mode="default"
global_override="prompt"
assume_yes=false
link_repo=true

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
dist_dir="${BOREAL_INSTALL_DIST_DIR:-$script_dir/apps/cli/dist}"
bin_dir="${BOREAL_INSTALL_BIN_DIR:-${HOME:-}/.local/bin}"
lib_dir="${BOREAL_INSTALL_LIB_DIR:-${XDG_DATA_HOME:-${HOME:-}/.local/share}/boreal/bwrk}"
registry_root="${BOREAL_PROJECT_REGISTRY_ROOT:-}"
package_spec="${BOREAL_INSTALL_PACKAGE_SPEC:-}"

require_value() {
  if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [[ "${2:-}" == --* ]]; then
    echo "install.sh: $1 requires a value" >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      if [ "$mode" != "default" ]; then
        echo "install.sh: choose only one mode" >&2
        exit 2
      fi
      mode="repo"
      ;;
    --machine)
      if [ "$mode" != "default" ]; then
        echo "install.sh: choose only one mode" >&2
        exit 2
      fi
      mode="machine"
      ;;
    --global)
      if [ "$global_override" = "no" ]; then
        echo "install.sh: cannot combine --global and --no-global" >&2
        exit 2
      fi
      global_override="yes"
      ;;
    --no-global)
      if [ "$global_override" = "yes" ]; then
        echo "install.sh: cannot combine --global and --no-global" >&2
        exit 2
      fi
      global_override="no"
      ;;
    --yes|-y)
      assume_yes=true
      ;;
    --no-link)
      link_repo=false
      ;;
    --bin-dir)
      require_value "$@"
      bin_dir="$2"
      shift
      ;;
    --lib-dir)
      require_value "$@"
      lib_dir="$2"
      shift
      ;;
    --registry-root)
      require_value "$@"
      registry_root="$2"
      shift
      ;;
    --package-spec)
      require_value "$@"
      package_spec="$2"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "install.sh: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

main() {
  require_dist
  registry_root="$(resolve_registry_root "$registry_root")"
  registry_file="$registry_root/registry/projects.json"

  case "$mode" in
    default)
      install_machine_binary
      maybe_handle_global_setup
      maybe_link_current_repo "machine"
      ;;
    machine)
      install_machine_binary
      echo "Machine install complete; skipped global manager prompts."
      ;;
    repo)
      install_repo_dependency
      maybe_link_current_repo "repo"
      ;;
  esac
}

require_dist() {
  if [ ! -f "$dist_dir/index.js" ]; then
    echo "install.sh: missing bundled CLI at $dist_dir/index.js" >&2
    echo "Run pnpm build or set BOREAL_INSTALL_DIST_DIR to a built dist directory." >&2
    exit 1
  fi
}

install_machine_binary() {
  local target_dist bin_path version
  bin_dir="$(resolve_path "$bin_dir")"
  lib_dir="$(resolve_path "$lib_dir")"
  target_dist="$lib_dir/dist"
  bin_path="$bin_dir/bwrk"

  mkdir -p "$bin_dir" "$lib_dir"
  copy_dist "$target_dist"
  write_machine_shim "$bin_path" "$target_dist/index.js"

  version="$("$bin_path" --version)"
  echo "Installed bwrk machine binary: $bin_path"
  echo "Installed bwrk bundle: $target_dist"
  echo "Verification: $version"
}

install_repo_dependency() {
  local spec version
  if [ ! -f "package.json" ]; then
    echo "install.sh --repo must run from a repo with package.json" >&2
    exit 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "install.sh --repo requires pnpm on PATH" >&2
    exit 1
  fi

  spec="$package_spec"
  if [ -z "$spec" ]; then
    prepare_repo_package_artifact
    spec="file:.boreal/bwrk-package"
  fi

  if [[ "$spec" == file:* ]]; then
    pnpm add -D "$spec" --offline
  else
    pnpm add -D "$spec"
  fi

  version="$(pnpm bwrk --version)"
  echo "Installed bwrk repo dev dependency: $spec"
  echo "Verification: $version"
}

prepare_repo_package_artifact() {
  local artifact_dir package_name package_version
  artifact_dir=".boreal/bwrk-package"
  package_name="$(json_string "$script_dir/apps/cli/package.json" "name" "@boreal/cli")"
  package_version="$(json_string "$script_dir/apps/cli/package.json" "version" "$(json_string "$script_dir/package.json" "version" "0.0.0")")"

  mkdir -p "$artifact_dir"
  copy_dist "$artifact_dir/dist"
  cat > "$artifact_dir/package.json" <<EOF
{
  "name": "$package_name",
  "version": "$package_version",
  "type": "module",
  "bin": {
    "bwrk": "./dist/index.js"
  }
}
EOF
}

copy_dist() {
  local target_dist
  target_dist="$1"
  rm -rf "$target_dist"
  mkdir -p "$target_dist"
  cp -R "$dist_dir/." "$target_dist/"
  chmod 755 "$target_dist/index.js"
}

write_machine_shim() {
  local bin_path entrypoint quoted_entrypoint
  bin_path="$1"
  entrypoint="$2"
  quoted_entrypoint="$(shell_quote "$entrypoint")"
  {
    echo "#!/bin/sh"
    echo "# Generated by Boreal install.sh."
    printf 'exec %s "$@"\n' "$quoted_entrypoint"
  } > "$bin_path"
  chmod 755 "$bin_path"
}

maybe_handle_global_setup() {
  local count
  if [ "$global_override" = "no" ]; then
    echo "Global manager setup skipped by --no-global."
    return
  fi

  if registry_exists; then
    count="$(registry_project_count)"
    echo "Global manager registry already exists ($count project(s) linked): $registry_file"
    return
  fi

  if [ "$global_override" = "yes" ] || confirm "Set up the global manager (cross-repo boards, inbox, next queue)? [Y/n]" "yes"; then
    echo "Global manager first-run bootstrap is not implemented by install.sh yet; run bwrk global init when sprint G1 lands."
  else
    echo "Global manager setup skipped."
  fi
}

maybe_link_current_repo() {
  local runner
  runner="$1"

  if [ "$global_override" = "no" ]; then
    echo "Repo link skipped by --no-global."
    return
  fi
  if [ "$link_repo" = false ]; then
    echo "Repo link skipped by --no-link."
    return
  fi
  if ! registry_exists; then
    if [ "$runner" = "repo" ]; then
      echo "Global manager registry not found; repo install did not create global state."
    fi
    return
  fi
  if ! is_initialized_boreal_workspace; then
    echo "Current directory is not an initialized Boreal workspace; skipped registry link."
    return
  fi
  if [ "$assume_yes" = true ] || confirm "Link this repo to the global manager registry? [Y/n]" "yes"; then
    run_registry_add "$runner"
  else
    echo "Repo link skipped."
  fi
}

run_registry_add() {
  local runner
  runner="$1"
  case "$runner" in
    repo)
      pnpm bwrk registry add --workspace "$PWD" --registry-root "$registry_root" --json >/dev/null
      ;;
    machine)
      "$bin_dir/bwrk" registry add --workspace "$PWD" --registry-root "$registry_root" --json >/dev/null
      ;;
    *)
      echo "install.sh: unknown registry runner: $runner" >&2
      exit 2
      ;;
  esac
  echo "Linked current repo to global manager registry: $registry_file"
}

registry_exists() {
  [ -f "$registry_file" ]
}

registry_project_count() {
  node -e 'const fs = require("fs"); try { const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log(Array.isArray(doc.entries) ? doc.entries.length : 0); } catch { console.log(0); }' "$registry_file"
}

is_initialized_boreal_workspace() {
  [ -f ".boreal/project.json" ] || return 1
  if grep -q '"storage"[[:space:]]*:[[:space:]]*"objects-v1"' ".boreal/project.json"; then
    [ -f ".boreal/log/events.jsonl" ] || [ -d ".boreal/objects" ]
    return
  fi
  [ -f ".boreal/runtime/state.json" ]
}

confirm() {
  local prompt default answer
  prompt="$1"
  default="$2"
  if [ "$assume_yes" = true ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "Prompt skipped because stdin is not a TTY; pass --yes to accept defaults."
    return 1
  fi
  read -r -p "$prompt " answer
  if [ -z "$answer" ]; then
    [ "$default" = "yes" ]
    return
  fi
  case "$answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_registry_root() {
  local explicit platform
  explicit="$1"
  if [ -n "$explicit" ]; then
    resolve_path "$explicit"
    return
  fi
  platform="$(uname -s)"
  if [ "$platform" = "Darwin" ]; then
    resolve_path "${HOME:-}/Library/Application Support/Boreal"
    return
  fi
  resolve_path "${XDG_STATE_HOME:-${HOME:-}/.local/state}/boreal"
}

resolve_path() {
  node -e 'const path = require("path"); console.log(path.resolve(process.argv[1]));' "$1"
}

json_string() {
  node -e 'const fs = require("fs"); const file = process.argv[1]; const key = process.argv[2]; const fallback = process.argv[3]; try { const value = JSON.parse(fs.readFileSync(file, "utf8"))[key]; console.log(typeof value === "string" && value.length > 0 ? value : fallback); } catch { console.log(fallback); }' "$1" "$2" "$3"
}

shell_quote() {
  printf "'"
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

main
