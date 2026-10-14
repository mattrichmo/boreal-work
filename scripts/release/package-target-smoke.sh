#!/bin/sh
set -eu

archive=${1:?usage: package-target-smoke.sh ARCHIVE TARGET}
target=${2:?usage: package-target-smoke.sh ARCHIVE TARGET}
case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-gnu) ;;
  *) echo "package target smoke: unsupported declared target: $target" >&2; exit 2 ;;
esac
case "$(uname -s):$(uname -m)" in
  Darwin:arm64|Darwin:aarch64) actual_target=aarch64-apple-darwin ;;
  Darwin:x86_64|Darwin:amd64) actual_target=x86_64-apple-darwin ;;
  Linux:x86_64|Linux:amd64) actual_target=x86_64-unknown-linux-gnu ;;
  *)
    echo "package target smoke: unsupported qualification host: $(uname -s) $(uname -m)" >&2
    exit 2
    ;;
esac
[ "$target" = "$actual_target" ] || {
  echo "package target smoke: refusing to qualify $target on $actual_target host" >&2
  exit 2
}
case "$(basename "$archive")" in
  bwrk-v*-"$target".tar.gz) ;;
  *) echo "package target smoke: archive does not match target $target: $archive" >&2; exit 2 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$script_dir/../.." && pwd -P)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/boreal-target-smoke.XXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
prefix="$scratch/prefix"
BOREAL_GLOBAL_ROOT="$scratch/global"
BOREAL_NODE="$scratch/missing-node"
BOREAL_NODE_BINARY="$scratch/missing-node"
BOREAL_INSTALL_UI=plain
BOREAL_INSTALL_TUI=0
export BOREAL_GLOBAL_ROOT BOREAL_NODE BOREAL_NODE_BINARY BOREAL_INSTALL_UI BOREAL_INSTALL_TUI

sh "$root/install.sh" --archive "$archive" --prefix "$prefix" --yes --no-dashboard

python3 - "$prefix/share/boreal/release.json" "$prefix/bin/bwrk" "$target" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

manifest_path, binary, target = sys.argv[1:]
manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
if manifest.get("target") != target:
    raise SystemExit(f"installed manifest target mismatch: {manifest.get('target')!r} != {target!r}")
api = manifest["contracts"]["api_version"]
version = manifest["version"]
actual = subprocess.run([binary, "--version"], check=True, text=True, capture_output=True).stdout.strip()
prefix = f"bwrk {version} (api {api}"
if not actual.startswith(prefix):
    raise SystemExit(f"installed CLI version does not match release.json: {actual!r}")
PY

[ -s "$BOREAL_GLOBAL_ROOT/global.sqlite" ] || {
  echo "package target smoke: installer did not provision the per-user Global database" >&2
  exit 1
}

"$prefix/bin/bwrk" global project add --name "Target smoke" --json > "$scratch/project.json"
"$prefix/bin/bwrk" dashboard global --json > "$scratch/dashboard.json"
python3 - "$scratch/dashboard.json" <<'PY'
import json
import sys
from pathlib import Path

dashboard = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
projects = dashboard.get("data", {}).get("projects")
if not isinstance(projects, list) or not any(
    isinstance(project, dict) and project.get("name") == "Target smoke"
    for project in projects
):
    raise SystemExit("Global dashboard JSON did not include the created project")
PY

# Force provisioning to reject an explicitly selected Global root after the
# package files publish. The installer must restore those files and leave the
# invoking user's separately selected Global database untouched.
python3 - "$prefix/bin/bwrk" "$BOREAL_GLOBAL_ROOT/global.sqlite" "$scratch" <<'PY'
import hashlib
import sys
from pathlib import Path

binary, database, scratch = map(Path, sys.argv[1:])
def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
(Path(scratch) / "before-binary.sha256").write_text(digest(binary), encoding="ascii")
(Path(scratch) / "before-global.sha256").write_text(digest(database), encoding="ascii")
PY
blocked_global_root="$scratch/global-root-is-a-file"
: > "$blocked_global_root"
if BOREAL_GLOBAL_ROOT="$blocked_global_root" sh "$root/install.sh" \
  --archive "$archive" --prefix "$prefix" --yes --no-dashboard; then
  echo "package target smoke: installer unexpectedly succeeded with an invalid Global root" >&2
  exit 1
fi
python3 - "$prefix/bin/bwrk" "$BOREAL_GLOBAL_ROOT/global.sqlite" "$scratch" <<'PY'
import hashlib
import sys
from pathlib import Path

binary, database, scratch = map(Path, sys.argv[1:])
root = Path(scratch)
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
if digest(binary) != (root / "before-binary.sha256").read_text(encoding="ascii"):
    raise SystemExit("package rollback did not restore the previous executable bytes")
if digest(database) != (root / "before-global.sha256").read_text(encoding="ascii"):
    raise SystemExit("failed package update changed the invoking user's Global database")
PY

echo "package target smoke: PASS ($target)"
