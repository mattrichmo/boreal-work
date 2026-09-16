#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$script_dir/../.." && pwd -P)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/boreal-package-smoke.XXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM

python3 "$root/scripts/release/build_release.py" --output-dir "$scratch/release"
archive=$(find "$scratch/release" -maxdepth 1 -type f -name '*.tar.gz' -print -quit)
[ -n "$archive" ] || { echo "package smoke: archive missing" >&2; exit 1; }

sh "$root/install.sh" --archive "$archive" --prefix "$scratch/prefix"
version=$("$scratch/prefix/bin/bwrk" --version)
manifest_identity=$(python3 - "$scratch/prefix/share/boreal/release.json" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(manifest["version"] + "|" + manifest["contracts"]["api_version"])
PY
)
manifest_version=${manifest_identity%%|*}
manifest_api=${manifest_identity#*|}
[ "$version" = "bwrk $manifest_version (api $manifest_api)" ] || {
  echo "package smoke: unexpected version: $version" >&2
  exit 1
}
[ -s "$scratch/prefix/lib/boreal/tui/entrypoint.js" ]
[ -s "$scratch/prefix/share/boreal/release.json" ]
python3 - "$scratch/prefix/share/boreal/release.json" "$scratch/prefix" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
prefix = Path(sys.argv[2])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
identity_input = {key: value for key, value in manifest.items() if key != "artifact_identity"}
expected_identity = "sha256:" + hashlib.sha256(
    (json.dumps(identity_input, sort_keys=True, separators=(",", ":")) + "\n").encode()
).hexdigest()
assert manifest["artifact_identity"] == expected_identity
for asset in manifest["assets"]:
    path = prefix / asset["path"]
    digest = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    assert path.is_file() and digest == asset["sha256"], asset["path"]
print("package smoke: release manifest and asset digests verified")
PY

echo "package smoke: PASS ($archive)"
