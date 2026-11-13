#!/usr/bin/env python
"""Import the UBE, Zhizhen and Koralina eyes assets into the pack.

    python -I scripts/import_facial_assets.py                 # preview
    python -I scripts/import_facial_assets.py --apply         # copy + verify

Source roots are read-only; nothing is written there. Every destination is
checked before a byte moves:

- an absent destination is copied from the source bytes and its sha256 and
  mtime are verified against the source afterwards,
- an identical destination (same sha256) is skipped, not rewritten, so a
  re-run is a no-op and the file's timestamp survives,
- a destination that differs is refused and reported. The pack contract says a
  different file is never overwritten; resolving that is a human decision.

The mapping preserves each category's original Data-relative subtree, exactly
as `organize_pack.destination` does for the pre-category layout:

    textures/!COR/Eyes_ILV/eye01.dds      -> eyes/textures/!COR/Eyes_ILV/eye01.dds
    textures/!COR/Lashes/x.dds            -> lashes/textures/!COR/Lashes/x.dds
    meshes/actors/.../Zhizheneyesfemale.nif -> eyes/meshes/actors/.../Zhizheneyesfemale.nif
    textures/actors/character/ddseyes/x.dds -> eyes/textures/actors/character/ddseyes/x.dds

Koralina keeps its whole `textures\\` subtree under `eyes`:

    textures/Koralina/Eyes/blue/Azure.dds -> eyes/textures/Koralina/Eyes/blue/Azure.dds

`!COR/MakeupOverlays`, `!COR/TintMasks` and `!COR/Warpaints` are deliberately
out of scope: they are overlay categories, not eye/lash/brow/mouth assets.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

# `!COR\<folder>` inside textures -> the pack category that owns it. Folders not
# listed here are overlay families and are not imported by this script.
COR_TEXTURE_CATEGORY = {
    "eyes": "eyes",
    "eyes_ilv": "eyes",
    "lashes": "lashes",
    "brows": "brows",
    "brows_ilv": "brows",
    "mouth": "mouth",
}

DEFAULT_UBE = Path(r"D:\Games\Skyrim\MO2_Archive\mods\UBE 2.0 U0.7")
DEFAULT_ZHIZHEN = Path(r"D:\Games\Skyrim\MO2_Archive\mods\Zhizhen Eyes")
DEFAULT_KORALINA = Path(r"D:\Games\Skyrim\MO2_Archive\mods\Even More Eyes by Koralina")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ube_sources(root: Path) -> list[tuple[Path, str]]:
    """(source, pack-relative destination) for the UBE facial textures."""
    out: list[tuple[Path, str]] = []
    tree = root / "textures" / "!COR"
    if not tree.is_dir():
        raise SystemExit(f"UBE texture tree missing: {tree}")
    for folder in sorted(tree.iterdir()):
        if not folder.is_dir():
            continue
        category = COR_TEXTURE_CATEGORY.get(folder.name.lower())
        if category is None:
            continue
        for src in sorted(folder.rglob("*")):
            if not src.is_file() or src.suffix.lower() != ".dds":
                continue
            rel = src.relative_to(root)  # textures\!COR\<folder>\<name>
            out.append((src, "\\".join((category, *rel.parts))))
    return out


def zhizhen_sources(root: Path) -> list[tuple[Path, str]]:
    """(source, pack-relative destination) for the Zhizhen eye meshes and maps.

    Every Zhizhen file belongs to the `eyes` category: the meshes are eye
    geometry and the maps are eye atlases. The cubemap keeps its own
    `actors\\cubemaps` subtree rather than being folded into
    `shared\\textures\\cubemaps` — the NIF names `textures\\cubemaps\\EyeCubeMap.dds`,
    which is a *different* Data path, and inventing a match would be a guess.
    """
    out: list[tuple[Path, str]] = []
    meshes = root / "meshes"
    textures = root / "textures"
    for tree, exts in ((meshes, {".nif"}), (textures, {".dds"})):
        if not tree.is_dir():
            raise SystemExit(f"Zhizhen tree missing: {tree}")
        for src in sorted(tree.rglob("*")):
            if not src.is_file() or src.suffix.lower() not in exts:
                continue
            rel = src.relative_to(root)  # meshes\... / textures\...
            out.append((src, "\\".join(("eyes", *rel.parts))))
    return out


def koralina_sources(root: Path) -> list[tuple[Path, str]]:
    """(source, pack-relative destination) for the Koralina eye textures.

    Every DDS under the mod's `textures\\` tree goes to the `eyes` category with
    its subtree intact. That includes the four shared maps at `Eyes\\` root
    (`eyenormal`, `eyecubemap`, `eyeenvironmentmask`, `eye_sk`): the mod is
    imported whole, and the indexer's role rules keep them out of the picker.
    The `.esp` and `meta.ini` at the mod root are not pack assets.
    """
    out: list[tuple[Path, str]] = []
    textures = root / "textures"
    if not textures.is_dir():
        raise SystemExit(f"Koralina texture tree missing: {textures}")
    for src in sorted(textures.rglob("*")):
        if not src.is_file() or src.suffix.lower() != ".dds":
            continue
        rel = src.relative_to(root)  # textures\Koralina\Eyes\...
        out.append((src, "\\".join(("eyes", *rel.parts))))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Import facial assets into the pack.")
    ap.add_argument("--pack", type=Path, required=True, help="pack root (read/write)")
    ap.add_argument("--ube", type=Path, default=DEFAULT_UBE, help="UBE mod root (read-only)")
    ap.add_argument("--zhizhen", type=Path, default=DEFAULT_ZHIZHEN, help="Zhizhen mod root (read-only)")
    ap.add_argument("--koralina", type=Path, default=DEFAULT_KORALINA, help="Koralina eye mod root (read-only)")
    ap.add_argument("--apply", action="store_true", help="copy for real; default is a preview")
    args = ap.parse_args()

    pack = args.pack.resolve(strict=True)
    if not (pack / "README.md").is_file():
        raise SystemExit(f"{pack} does not look like the asset pack (no README.md)")
    for label, root in (("--ube", args.ube), ("--zhizhen", args.zhizhen), ("--koralina", args.koralina)):
        if not root.resolve().is_dir():
            raise SystemExit(f"{label} is not a directory: {root}")

    pairs = (
        ube_sources(args.ube.resolve())
        + zhizhen_sources(args.zhizhen.resolve())
        + koralina_sources(args.koralina.resolve())
    )

    plan: list[tuple[Path, Path, str]] = []
    same = 0
    conflicts: list[tuple[Path, Path]] = []
    for src, rel in pairs:
        dst = pack / rel.replace("\\", "/")
        try:
            dst.resolve().relative_to(pack)
        except (OSError, ValueError):
            raise SystemExit(f"refusing a destination outside the pack: {dst}")
        if dst.exists():
            if not dst.is_file():
                raise SystemExit(f"destination is not a file: {dst}")
            if sha256(src) == sha256(dst):
                same += 1
                continue
            conflicts.append((src, dst))
            continue
        plan.append((src, dst, rel))

    print(f"  {len(plan)} to copy, {same} already identical, {len(conflicts)} conflicting")
    for src, dst, rel in plan:
        print(f"  + {rel}")
    for src, dst in conflicts:
        print(f"  ! REFUSED (different file already there): {dst}", file=sys.stderr)

    if conflicts:
        print(
            f"\n{len(conflicts)} destination(s) hold a different file. Nothing was "
            "overwritten; resolve those by hand and re-run.",
            file=sys.stderr,
        )
        return 1

    if not args.apply:
        print("\npreview only — pass --apply to copy")
        return 0

    for src, dst, _rel in plan:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)  # copy2 keeps the source mtime
        if sha256(src) != sha256(dst):
            raise SystemExit(f"hash mismatch after copy: {dst}")
        if os.stat(src).st_mtime_ns != dst.stat().st_mtime_ns:
            raise SystemExit(f"timestamp not preserved: {dst}")

    print(f"\n[=] imported {len(plan)} file(s) into {pack.name}; {same} were already identical")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
