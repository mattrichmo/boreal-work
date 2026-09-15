#!/usr/bin/env bash

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

for required_path in Cargo.toml Cargo.lock project/spec/validate_contracts.py apps/tui/package.json; do
  if [[ ! -e "$PACKAGE_ROOT/$required_path" ]]; then
    echo "standalone check: missing required path: $required_path" >&2
    exit 2
  fi
done

TEMP_BASE=${TMPDIR:-/tmp}
CHECK_ROOT=$(mktemp -d "${TEMP_BASE%/}/boreal-work-v2-standalone.XXXXXX")
CHECKOUT="$CHECK_ROOT/checkout"
mkdir -- "$CHECKOUT"

cleanup() {
  rm -rf -- "$CHECK_ROOT"
}
trap cleanup EXIT HUP INT TERM

case "$CHECK_ROOT" in
  "$PACKAGE_ROOT"|"$PACKAGE_ROOT"/*)
    echo "standalone check: temporary checkout overlaps the package root" >&2
    exit 2
    ;;
esac

echo "standalone check: copying package to $CHECKOUT"
tar -C "$PACKAGE_ROOT" \
  --exclude='./target' \
  --exclude='./scripts/validation/concurrency/target' \
  --exclude='./node_modules' \
  --exclude='*/__pycache__' \
  --exclude='./.DS_Store' \
  -cf - . | tar -C "$CHECKOUT" -xf -

cd -- "$CHECKOUT"

failures=()

run_check() {
  local label=$1
  shift
  echo "standalone check: $label"
  if "$@"; then
    return 0
  fi
  failures+=("$label")
  echo "standalone check: FAILED — $label" >&2
}

run_check "contract fixtures" python3 project/spec/validate_contracts.py
run_check "Rust formatting" cargo fmt --all -- --check
run_check "Rust workspace tests" cargo test --workspace --locked --offline
run_check "Rust workspace clippy" cargo clippy --workspace --all-targets --locked --offline -- -D warnings
run_check "TUI typecheck" npm run typecheck --prefix apps/tui
run_check "TUI tests" npm test --prefix apps/tui

if ((${#failures[@]} > 0)); then
  echo "standalone check: FAIL (${#failures[@]} check(s) failed): ${failures[*]}" >&2
  exit 1
fi

echo "standalone check: PASS (temporary checkout removed on exit)"
