#!/usr/bin/env python
"""Read the single active asset source configuration.

The app, the server and every producer agree on one `asset-source.json` at the
repo root. Nothing else may hard-code the archive or the output namespace.

    python -I scripts/asset_source.py

Stdlib only, so it loads under `python -I`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "asset-source.json"
LAYOUTS = ("pack", "mo2")


def source_key(root: str | Path) -> str:
    """sha256 of the normalized absolute root, first 16 hex chars.

    Forward slashes, casefolded, no trailing slash — the exact algorithm the
    server repeats so stale output from a different root is rejected instead of
    served. The root itself never leaves the process.
    """
    try:
        absolute = Path(root).resolve()
    except OSError:
        absolute = Path(root)
    norm = str(absolute).replace("\\", "/").rstrip("/").casefold()
    return hashlib.sha256(norm.encode("utf-8", "surrogatepass")).hexdigest()[:16]


def resolve_rel(root: str | Path, rel: str) -> Path | None:
    """Resolve a pack-relative path and prove it stays inside `root`.

    `resolve()` follows junctions and symlinks (both exist on Windows), so a
    planted link cannot turn a catalogue row into an arbitrary file read.
    Returns None when the path escapes or does not exist.
    """
    try:
        root_real = Path(root).resolve()
        candidate = (root_real / rel.replace("\\", "/")).resolve()
        candidate.relative_to(root_real)
    except (OSError, ValueError):
        return None
    return candidate if candidate.is_file() else None


def load(path: Path = CONFIG) -> dict:
    """Validated config plus the resolved output directory and safe label.

    `root` is never written into generated JSON; only the directory basename is
    used as the user-facing source label.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"cannot read {path.name}: {exc}")

    layout = raw.get("layout")
    if layout not in LAYOUTS:
        raise SystemExit(f"{path.name}: layout must be one of {LAYOUTS}")
    root = raw.get("root")
    if not isinstance(root, str) or not Path(root).is_absolute():
        raise SystemExit(f"{path.name}: root must be an absolute path")
    public_base = raw.get("publicBase")
    if not isinstance(public_base, str) or not re.fullmatch(r"/assets/[a-z0-9-]+", public_base):
        raise SystemExit(f"{path.name}: publicBase must be one /assets namespace")
    expected_base = "/assets/preset-pack" if layout == "pack" else "/assets/mo2"
    if public_base != expected_base:
        raise SystemExit(f"{path.name}: pack and legacy assets need separate namespaces")

    # The server lets MO2_MODS_ROOT override the config root for the legacy
    # layout only; mirror that so producer and server hash the same root.
    if layout == "mo2":
        override = os.environ.get("MO2_MODS_ROOT")
        if override is not None:
            root = override
    root_path = Path(root)
    out = ROOT / "public" / public_base.lstrip("/")
    return {
        "layout": layout,
        "id": "preset-pack" if layout == "pack" else "mo2",
        # Fixed labels, matching `lib/mo2/assetSource.ts`: a renamed folder must
        # not silently desync the served name, and the folder name never leaks.
        "label": "Skyrim Preset For App" if layout == "pack" else "MO2",
        "root": root_path,
        "sourceKey": source_key(root_path),
        "publicBase": public_base,
        "out": out,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Print the active asset source.")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    cfg = load()
    print(json.dumps({
        "layout": cfg["layout"],
        "id": cfg["id"],
        "label": cfg["label"],
        "sourceKey": cfg["sourceKey"],
        "root": str(cfg["root"]),
        "publicBase": cfg["publicBase"],
        "out": str(cfg["out"]),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
