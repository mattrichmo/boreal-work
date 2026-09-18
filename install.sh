#!/bin/sh
set -eu

# Install or update Boreal from a verified release archive.  When no release is
# published yet, --from-source (and the stdin bootstrap fallback) builds the
# current source checkout/repository and installs the same archive layout.

REPOSITORY="${BOREAL_REPOSITORY:-mattrichmo/boreal-work}"
if [ -n "${BOREAL_PREFIX:-}" ]; then
  PREFIX=$BOREAL_PREFIX
elif [ -n "${HOME:-}" ]; then
  PREFIX="$HOME/.local"
else
  PREFIX=""
fi
REQUESTED_VERSION="${BOREAL_VERSION:-}"
AUTO_SELECTED_RELEASE=0
LOCAL_ARCHIVE=""
SOURCE_INSTALL=0
SOURCE_REF="${BOREAL_SOURCE_REF:-main}"
SCRIPT_DIR=""
RUNNING_FROM_STDIN=1
TEMP_ROOT=""
INSTALL_STAGE=""
BACKUP_ROOT=""
ROLLBACK_NEEDED=0

case "${0##*/}" in
  install.sh)
    if [ -f "$0" ]; then
      SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
      RUNNING_FROM_STDIN=0
    fi
    ;;
esac

die() {
  echo "boreal install: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh [--version VERSION] [--prefix PATH] [--archive PATH]
                  [--from-source] [--ref REF]

Installs or updates Boreal. The default prefix is ~/.local; use
--prefix /usr/local when a system-wide installation is desired. Running the
script again replaces the existing CLI and TUI atomically.

With no arguments, the script installs the latest verified release. If this
script is piped from GitHub before a release exists, it falls back to building
the requested source ref. Use --from-source to select that path explicitly.

Environment:
  BOREAL_VERSION       release version, for example 0.2.0
  BOREAL_PREFIX        installation prefix
  BOREAL_REPOSITORY    GitHub owner/repository
  BOREAL_SOURCE_REF    source branch or tag, default main
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || die "--version requires a value"
      REQUESTED_VERSION=$2
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || die "--prefix requires a value"
      PREFIX=$2
      shift 2
      ;;
    --archive)
      [ "$#" -ge 2 ] || die "--archive requires a value"
      LOCAL_ARCHIVE=$2
      shift 2
      ;;
    --from-source)
      SOURCE_INSTALL=1
      shift
      ;;
    --ref)
      [ "$#" -ge 2 ] || die "--ref requires a value"
      SOURCE_REF=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (use --help)"
      ;;
  esac
done

bootstrap_from_source() {
  source_root=""
  source_temp=""
  source_target=""
  source_version=""
  source_output=""
  source_archive=""

  if [ "$RUNNING_FROM_STDIN" -eq 0 ] \
    && [ -f "$SCRIPT_DIR/Cargo.toml" ] \
    && [ -d "$SCRIPT_DIR/crates/cli" ] \
    && [ -d "$SCRIPT_DIR/apps/tui" ]; then
    source_root=$SCRIPT_DIR
    echo "Building Boreal from the current checkout ..."
  else
    command -v git >/dev/null 2>&1 || die "--from-source requires git"
    source_temp=$(mktemp -d "${TMPDIR:-/tmp}/boreal-source-install.XXXXXX")
    trap 'rm -rf "$source_temp"' EXIT HUP INT TERM
    echo "Fetching Boreal source ($SOURCE_REF) ..."
    git clone --quiet --depth 1 --branch "$SOURCE_REF" \
      "https://github.com/$REPOSITORY.git" "$source_temp/src" \
      || die "could not fetch Boreal source ref: $SOURCE_REF"
    source_root="$source_temp/src"
  fi

  for tool in cargo rustc node npm python3 tsc; do
    command -v "$tool" >/dev/null 2>&1 || die "--from-source requires $tool on PATH"
  done

  source_target=$(rustc -vV | sed -n 's/^host: //p')
  [ -n "$source_target" ] || die "could not determine the Rust host target"
  source_version=$(sed -n \
    '/^\[workspace\.package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p;}' \
    "$source_root/Cargo.toml")
  [ -n "$source_version" ] || die "could not determine the Boreal workspace version"
  source_output=$(mktemp -d "${TMPDIR:-/tmp}/boreal-source-release.XXXXXX")
  trap 'rm -rf "$source_temp" "$source_output"' EXIT HUP INT TERM

  cargo build --manifest-path "$source_root/Cargo.toml" \
    --release --locked -p boreal-cli --bin bwrk
  npm --prefix "$source_root/apps/tui" run build
  python3 "$source_root/scripts/release/build_release.py" \
    --root "$source_root" \
    --version "$source_version" \
    --output-dir "$source_output" \
    --skip-build

  source_archive="$source_output/bwrk-v${source_version}-${source_target}.tar.gz"
  [ -f "$source_archive" ] || die "source build did not produce a release archive"
  set +e
  sh "$source_root/install.sh" --archive "$source_archive" --prefix "$PREFIX"
  status=$?
  set -e
  rm -rf "$source_temp" "$source_output"
  trap - EXIT HUP INT TERM
  exit "$status"
}

case "$PREFIX" in
  ""|/)
    die "refusing an empty or root installation prefix"
    ;;
esac

if [ -n "$LOCAL_ARCHIVE" ]; then
  [ -f "$LOCAL_ARCHIVE" ] || die "archive does not exist: $LOCAL_ARCHIVE"
  ARCHIVE_PATH=$(CDPATH= cd -- "$(dirname -- "$LOCAL_ARCHIVE")" && pwd -P)/$(basename -- "$LOCAL_ARCHIVE")
  ARCHIVE_NAME=$(basename -- "$ARCHIVE_PATH")
elif [ "$SOURCE_INSTALL" -eq 1 ]; then
  bootstrap_from_source
else
  command -v curl >/dev/null 2>&1 || die "curl is required to download a release"
  [ -n "${HOME:-}" ] || [ -n "${BOREAL_PREFIX:-}" ] || die "HOME is unset; pass --prefix"

  case "$(uname -s)" in
    Darwin)
      case "$(uname -m)" in
        arm64|aarch64) TARGET=aarch64-apple-darwin ;;
        x86_64|amd64) TARGET=x86_64-apple-darwin ;;
        *) die "unsupported macOS architecture: $(uname -m)" ;;
      esac
      ;;
    Linux)
      case "$(uname -m)" in
        x86_64|amd64) TARGET=x86_64-unknown-linux-gnu ;;
        *) die "unsupported Linux architecture: $(uname -m)" ;;
      esac
      ;;
    *) die "unsupported operating system: $(uname -s)" ;;
  esac

  if [ -z "$REQUESTED_VERSION" ]; then
    AUTO_SELECTED_RELEASE=1
    if ! latest_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest"); then
      bootstrap_from_source
    fi
    latest_tag=${latest_url##*/}
    [ -n "$latest_tag" ] || die "could not determine the latest GitHub release"
    REQUESTED_VERSION=${latest_tag#v}
  else
    REQUESTED_VERSION=${REQUESTED_VERSION#v}
  fi

  ARCHIVE_NAME="bwrk-v${REQUESTED_VERSION}-${TARGET}.tar.gz"
  ARCHIVE_PATH=""
fi

if [ "$AUTO_SELECTED_RELEASE" -eq 1 ]; then
  RELEASE_URL="https://github.com/$REPOSITORY/releases/download/v${REQUESTED_VERSION}"
  if ! curl -fsSL -o /dev/null "$RELEASE_URL/$ARCHIVE_NAME" \
    || ! curl -fsSL -o /dev/null "$RELEASE_URL/SHA256SUMS"; then
    echo "No compatible v2 release was found for ${REQUESTED_VERSION}; building the source ref ${SOURCE_REF} instead ..." >&2
    bootstrap_from_source
  fi
fi

if [ -z "$REQUESTED_VERSION" ]; then
  case "$ARCHIVE_NAME" in
    bwrk-v*.tar.gz)
      archive_version=${ARCHIVE_NAME#bwrk-v}
      archive_version=${archive_version%.tar.gz}
      for known_target in \
        aarch64-apple-darwin \
        x86_64-apple-darwin \
        x86_64-unknown-linux-gnu \
        aarch64-unknown-linux-gnu; do
        case "$archive_version" in
          *-"$known_target") archive_version=${archive_version%-$known_target} ; break ;;
        esac
      done
      REQUESTED_VERSION=$archive_version
      ;;
    *) die "cannot infer release version from archive name: $ARCHIVE_NAME" ;;
  esac
fi

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/boreal-install.XXXXXX")
cleanup() {
  status=$?
  if [ "$ROLLBACK_NEEDED" -eq 1 ]; then
    rm -f "$PREFIX/bin/bwrk" 2>/dev/null || true
    rm -rf "$PREFIX/lib/boreal/tui" 2>/dev/null || true
    rm -f "$PREFIX/share/boreal/release.json" 2>/dev/null || true
    rm -f "$PREFIX/share/boreal/LICENSE" 2>/dev/null || true
    rm -f "$PREFIX/share/boreal/install.sh" 2>/dev/null || true
    if [ -e "$BACKUP_ROOT/bin/bwrk" ]; then
      mv "$BACKUP_ROOT/bin/bwrk" "$PREFIX/bin/bwrk" 2>/dev/null || true
    fi
    if [ -d "$BACKUP_ROOT/lib/boreal/tui" ]; then
      mv "$BACKUP_ROOT/lib/boreal/tui" "$PREFIX/lib/boreal/tui" 2>/dev/null || true
    fi
    if [ -f "$BACKUP_ROOT/share/boreal/release.json" ]; then
      mv "$BACKUP_ROOT/share/boreal/release.json" "$PREFIX/share/boreal/release.json" 2>/dev/null || true
    fi
    if [ -f "$BACKUP_ROOT/share/boreal/LICENSE" ]; then
      mv "$BACKUP_ROOT/share/boreal/LICENSE" "$PREFIX/share/boreal/LICENSE" 2>/dev/null || true
    fi
    if [ -f "$BACKUP_ROOT/share/boreal/install.sh" ]; then
      mv "$BACKUP_ROOT/share/boreal/install.sh" "$PREFIX/share/boreal/install.sh" 2>/dev/null || true
    fi
  fi
  if [ -n "$INSTALL_STAGE" ]; then rm -rf "$INSTALL_STAGE"; fi
  if [ -n "$BACKUP_ROOT" ]; then rm -rf "$BACKUP_ROOT"; fi
  if [ -n "$TEMP_ROOT" ]; then rm -rf "$TEMP_ROOT"; fi
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

if [ -z "$LOCAL_ARCHIVE" ]; then
  ARCHIVE_PATH="$TEMP_ROOT/$ARCHIVE_NAME"
  RELEASE_URL="https://github.com/$REPOSITORY/releases/download/v${REQUESTED_VERSION}"
  curl -fsSL "$RELEASE_URL/$ARCHIVE_NAME" -o "$ARCHIVE_PATH"
  curl -fsSL "$RELEASE_URL/SHA256SUMS" -o "$TEMP_ROOT/SHA256SUMS"
  if command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA=$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA=$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')
  else
    die "shasum or sha256sum is required to verify the release"
  fi
  EXPECTED_SHA=$(awk -v name="$ARCHIVE_NAME" '$2 == name {print $1; exit}' "$TEMP_ROOT/SHA256SUMS")
  [ -n "$EXPECTED_SHA" ] || die "SHA256SUMS does not contain $ARCHIVE_NAME"
  [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "checksum verification failed for $ARCHIVE_NAME"
fi

ARCHIVE_ROOT_NAME=${ARCHIVE_NAME%.tar.gz}
archive_listing="$TEMP_ROOT/archive.list"
LC_ALL=C tar -tzf "$ARCHIVE_PATH" >"$archive_listing" || die "cannot read release archive"
while IFS= read -r archive_member; do
  case "$archive_member" in
    "$ARCHIVE_ROOT_NAME"|"$ARCHIVE_ROOT_NAME"/*) ;;
    *) die "release archive contains an unexpected path: $archive_member" ;;
  esac
  case "$archive_member" in
    /*|../*|*/../*|*/..|..) die "release archive contains a path traversal: $archive_member" ;;
  esac
done <"$archive_listing"
LC_ALL=C tar -xzf "$ARCHIVE_PATH" -C "$TEMP_ROOT"
PACKAGE_ROOT="$TEMP_ROOT/$ARCHIVE_ROOT_NAME"
[ -d "$PACKAGE_ROOT" ] || die "release archive has no package root"
[ -x "$PACKAGE_ROOT/bin/bwrk" ] || die "release archive has no executable bin/bwrk"
[ ! -L "$PACKAGE_ROOT/bin/bwrk" ] || die "release archive binary must not be a symlink"
[ -s "$PACKAGE_ROOT/lib/boreal/tui/entrypoint.js" ] || die "release archive has no compiled TUI"
[ "$(find "$PACKAGE_ROOT/lib/boreal/tui" -type l -print -quit)" = "" ] || die "release archive TUI must not contain symlinks"
[ -s "$PACKAGE_ROOT/share/boreal/release.json" ] || die "release archive has no release manifest"
[ ! -L "$PACKAGE_ROOT/share/boreal/release.json" ] || die "release manifest must not be a symlink"
[ -s "$PACKAGE_ROOT/share/boreal/LICENSE" ] || die "release archive has no license"
[ ! -L "$PACKAGE_ROOT/share/boreal/LICENSE" ] || die "release license must not be a symlink"
[ -s "$PACKAGE_ROOT/share/boreal/install.sh" ] || die "release archive has no updater"
[ ! -L "$PACKAGE_ROOT/share/boreal/install.sh" ] || die "release updater must not be a symlink"

mkdir -p "$PREFIX/bin" "$PREFIX/lib/boreal" "$PREFIX/share/boreal"
INSTALL_STAGE=$(mktemp -d "$PREFIX/.bwrk-install.XXXXXX")
mkdir -p "$INSTALL_STAGE/bin" "$INSTALL_STAGE/lib/boreal" "$INSTALL_STAGE/share/boreal"
cp "$PACKAGE_ROOT/bin/bwrk" "$INSTALL_STAGE/bin/bwrk"
chmod 755 "$INSTALL_STAGE/bin/bwrk"
cp -R "$PACKAGE_ROOT/lib/boreal/tui" "$INSTALL_STAGE/lib/boreal/tui"
cp "$PACKAGE_ROOT/share/boreal/release.json" "$INSTALL_STAGE/share/boreal/release.json"
cp "$PACKAGE_ROOT/share/boreal/LICENSE" "$INSTALL_STAGE/share/boreal/LICENSE"
cp "$PACKAGE_ROOT/share/boreal/install.sh" "$INSTALL_STAGE/share/boreal/install.sh"
chmod 755 "$INSTALL_STAGE/share/boreal/install.sh"

BACKUP_ROOT="$PREFIX/.bwrk-backup.$$"
mkdir -p "$BACKUP_ROOT/bin" "$BACKUP_ROOT/lib/boreal" "$BACKUP_ROOT/share/boreal"
ROLLBACK_NEEDED=1
if [ -e "$PREFIX/bin/bwrk" ] || [ -L "$PREFIX/bin/bwrk" ]; then mv "$PREFIX/bin/bwrk" "$BACKUP_ROOT/bin/bwrk"; fi
if [ -e "$PREFIX/lib/boreal/tui" ] || [ -L "$PREFIX/lib/boreal/tui" ]; then mv "$PREFIX/lib/boreal/tui" "$BACKUP_ROOT/lib/boreal/tui"; fi
if [ -e "$PREFIX/share/boreal/release.json" ] || [ -L "$PREFIX/share/boreal/release.json" ]; then mv "$PREFIX/share/boreal/release.json" "$BACKUP_ROOT/share/boreal/release.json"; fi
if [ -e "$PREFIX/share/boreal/LICENSE" ] || [ -L "$PREFIX/share/boreal/LICENSE" ]; then mv "$PREFIX/share/boreal/LICENSE" "$BACKUP_ROOT/share/boreal/LICENSE"; fi
if [ -e "$PREFIX/share/boreal/install.sh" ] || [ -L "$PREFIX/share/boreal/install.sh" ]; then mv "$PREFIX/share/boreal/install.sh" "$BACKUP_ROOT/share/boreal/install.sh"; fi
mv "$INSTALL_STAGE/bin/bwrk" "$PREFIX/bin/bwrk"
mv "$INSTALL_STAGE/lib/boreal/tui" "$PREFIX/lib/boreal/tui"
mv "$INSTALL_STAGE/share/boreal/release.json" "$PREFIX/share/boreal/release.json"
mv "$INSTALL_STAGE/share/boreal/LICENSE" "$PREFIX/share/boreal/LICENSE"
mv "$INSTALL_STAGE/share/boreal/install.sh" "$PREFIX/share/boreal/install.sh"
ROLLBACK_NEEDED=0

echo "Boreal ${REQUESTED_VERSION} installed to $PREFIX"
echo "  binary: $PREFIX/bin/bwrk"
echo "  TUI:    $PREFIX/lib/boreal/tui/entrypoint.js"
if ! command -v node >/dev/null 2>&1; then
  echo "  note: Node.js is not on PATH; CLI commands work, but bwrk dashboard needs Node.js" >&2
fi
case ":${PATH:-}:" in
  *":$PREFIX/bin:"*) ;;
  *) echo "  add $PREFIX/bin to PATH to invoke bwrk" ;;
esac
