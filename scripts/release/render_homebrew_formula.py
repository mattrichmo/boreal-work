#!/usr/bin/env python3
"""Render a Homebrew formula from built release archives."""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TARGET_KEYS = {
    "aarch64-apple-darwin": "SHA256_AARCH64_APPLE_DARWIN",
    "x86_64-apple-darwin": "SHA256_X86_64_APPLE_DARWIN",
    "x86_64-unknown-linux-gnu": "SHA256_X86_64_UNKNOWN_LINUX_GNU",
}
SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--archive",
        action="append",
        required=True,
        metavar="TARGET=PATH",
        help="release archive mapping; repeat once for each supported target",
    )
    parser.add_argument(
        "--template",
        type=Path,
        default=ROOT / "packaging/homebrew/boreal.rb.template",
    )
    args = parser.parse_args()
    if not SEMVER.fullmatch(args.version):
        parser.error(f"version is not semver: {args.version!r}")

    checksums: dict[str, str] = {}
    for item in args.archive:
        target, separator, raw_path = item.partition("=")
        if not separator or target not in TARGET_KEYS or not raw_path:
            parser.error(f"archive must be TARGET=PATH for a supported target: {item!r}")
        path = Path(raw_path).resolve()
        if not path.is_file():
            parser.error(f"release archive does not exist: {path}")
        if target in checksums:
            parser.error(f"duplicate target: {target}")
        checksums[TARGET_KEYS[target]] = sha256(path)

    missing = sorted(set(TARGET_KEYS.values()) - set(checksums))
    if missing:
        parser.error("missing archive mappings: " + ", ".join(missing))

    content = args.template.read_text(encoding="utf-8").replace("{{VERSION}}", args.version)
    for key, value in checksums.items():
        content = content.replace("{{" + key + "}}", value)
    if "{{" in content or "}}" in content:
        parser.error("template contains unresolved placeholders")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
