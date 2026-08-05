#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: install.sh [--repo|--machine] [--from-github] [--global|--no-global] [--yes] [--no-link]

Installs the bundled bwrk dist artifact.

One-line install (no checkout needed):
  curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/main/install.sh | bash

Modes:
  default        Install or upgrade the machine bwrk binary, then offer manager-registry/link steps.
  --machine      Install or upgrade the machine bwrk binary only.
  --repo         Add bwrk as a dev dependency in the current repo and verify pnpm bwrk.
  --from-github  Clone the source repo, build, and install (automatic when run via curl).
                 Use --ref <branch|tag> and --repo-url <url> to override the source.
                 Already-installed users can run: bwrk update self

Options:
  --global         Non-interactively accept global manager registry setup (not agent skills).
  --no-global      Skip global manager-registry setup and repo linking.
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
from_github=false
github_ref="${BOREAL_UPDATE_REF:-}"
github_repo_url="${BOREAL_UPDATE_REPO_URL:-https://github.com/mattrichmo/boreal-work.git}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd -P || pwd -P)"
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
    --from-github)
      from_github=true
      ;;
    --ref)
      require_value "$@"
      github_ref="$2"
      shift
      ;;
    --repo-url)
      require_value "$@"
      github_repo_url="$2"
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

bootstrap_from_github() {
  local stage
  for tool in git node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "install.sh: --from-github requires $tool on PATH" >&2
      exit 1
    fi
  done
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      corepack enable pnpm >/dev/null 2>&1 || true
    fi
    if ! command -v pnpm >/dev/null 2>&1; then
      echo "install.sh: --from-github requires pnpm (try: corepack enable pnpm)" >&2
      exit 1
    fi
  fi

  stage="$(mktemp -d "${TMPDIR:-/tmp}/bwrk-install.XXXXXX")"
  trap 'rm -rf "$stage"' EXIT

  echo "Fetching Boreal from $github_repo_url${github_ref:+ ($github_ref)} ..."
  if [ -n "$github_ref" ]; then
    git clone --quiet --depth 1 --branch "$github_ref" "$github_repo_url" "$stage/src"
  else
    git clone --quiet --depth 1 "$github_repo_url" "$stage/src"
  fi

  echo "Building bwrk (pnpm install + build) ..."
  (cd "$stage/src" && pnpm install --frozen-lockfile --silent && pnpm build >/dev/null)

  echo "Handing off to the built installer ..."
  local forwarded_args=()
  case "$mode" in
    machine) forwarded_args+=(--machine) ;;
    repo) forwarded_args+=(--repo) ;;
  esac
  case "$global_override" in
    yes) forwarded_args+=(--global) ;;
    no) forwarded_args+=(--no-global) ;;
  esac
  [ "$assume_yes" = true ] && forwarded_args+=(--yes)
  [ "$link_repo" = false ] && forwarded_args+=(--no-link)
  [ -n "$registry_root" ] && forwarded_args+=(--registry-root "$registry_root")
  BOREAL_INSTALL_BIN_DIR="$bin_dir" BOREAL_INSTALL_LIB_DIR="$lib_dir" \
    bash "$stage/src/install.sh" ${forwarded_args[@]+"${forwarded_args[@]}"}
  exit $?
}

main() {
  if [ "$from_github" = true ]; then
    bootstrap_from_github
  elif [ ! -f "$dist_dir/index.js" ] && [ ! -f "$script_dir/package.json" ]; then
    # Running outside a checkout (e.g. curl | bash) with no built dist: bootstrap.
    bootstrap_from_github
  fi
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
  local target_dist bin_path version version_json transaction_id manifest_path
  transaction_id="${BOREAL_INSTALL_TRANSACTION_ID:-$(node -e 'console.log(require("crypto").randomUUID())')}"
  bin_dir="$(resolve_path "$bin_dir")"
  lib_dir="$(resolve_path "$lib_dir")"
  target_dist="$lib_dir/dist"
  bin_path="$bin_dir/bwrk"
  manifest_path="$lib_dir/install-manifest.json"

  mkdir -p "$bin_dir" "$lib_dir"
  copy_dist "$target_dist"
  write_machine_shim "$bin_path" "$target_dist/index.js"

  version="$("$bin_path" --version)"
  version_json="$("$bin_path" --no-delegate --version --json)"
  printf '%s\n' "$version_json" > "$manifest_path.tmp"
  node -e 'const fs=require("fs"); const [input,output,transactionId,operation,repoUrl,ref,binaryPath,bundlePath]=process.argv.slice(1); const doc=JSON.parse(fs.readFileSync(input,"utf8")); if (doc?.ok !== true || typeof doc.data?.build?.buildSha !== "string") process.exit(1); const data=doc.data; fs.writeFileSync(output,JSON.stringify({schemaVersion:"boreal.install.manifest.v1",transactionId,operation,status:"committed",installedAt:new Date().toISOString(),source:{repoUrl:repoUrl||undefined,ref:ref||undefined},binaryPath,bundlePath,identity:{name:data.name,version:data.version,installChannel:data.installChannel,build:data.build}},null,2)+"\n");' "$manifest_path.tmp" "$manifest_path.tmp.final" "$transaction_id" "${BOREAL_INSTALL_PROVENANCE_OPERATION:-install.machine}" "${BOREAL_INSTALL_SOURCE_REPO_URL:-}" "${BOREAL_INSTALL_SOURCE_REF:-}" "$bin_path" "$target_dist"
  mv "$manifest_path.tmp.final" "$manifest_path"
  rm -f "$manifest_path.tmp"
  echo "Installed bwrk machine binary: $bin_path"
  echo "Installed bwrk bundle: $target_dist"
  echo "Verification: $version"
  echo "Transaction: $transaction_id"
  echo "Provenance: $manifest_path"
  echo "Next steps:"
  echo "  project setup: bwrk install --yes"
  echo "  user-wide Codex skills: bwrk install codex --scope user"
  echo "  user-wide Claude skills: bwrk install claude --scope user"
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
