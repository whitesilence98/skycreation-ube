#!/usr/bin/env python
"""Package non-Git runtime assets into split ZIP archives for Google Drive sharing.

Outputs archives into `share/` with paths relative to the repository root so
teammates can extract directly into the repo root without nested-folder drift.
"""

from __future__ import annotations

import argparse
import os
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ASSETS = ROOT / "public" / "assets"
SHARE_DIR = ROOT / "share"


@dataclass(frozen=True)
class ArchiveSpec:
    name: str
    source_dir: Path
    description: str
    exclude_top: frozenset[str] = frozenset()
    include_only_top: frozenset[str] = frozenset()


ARCHIVE_SPECS: tuple[ArchiveSpec, ...] = (
    ArchiveSpec(
        name="1-preset-pack-core.zip",
        source_dir=PUBLIC_ASSETS / "preset-pack",
        exclude_top=frozenset({"cache"}),
        description="Required pack assets: 7 baked skins, meshes, poses, catalogues, manifest",
    ),
    ArchiveSpec(
        name="2-mo2.zip",
        source_dir=PUBLIC_ASSETS / "mo2",
        description="Recommended fallback meshes and MO2 catalogue/cache",
    ),
    ArchiveSpec(
        name="3-preset-pack-cache-base.zip",
        source_dir=PUBLIC_ASSETS / "preset-pack" / "cache",
        exclude_top=frozenset({"hair", "hairMesh"}),
        description="Pre-cached eyes, brows, lashes, makeup, tattoos, clothing, head, skin",
    ),
    ArchiveSpec(
        name="4-preset-pack-cache-hair.zip",
        source_dir=PUBLIC_ASSETS / "preset-pack" / "cache",
        include_only_top=frozenset({"hair", "hairMesh"}),
        description="Optional large NIF hair cache (thumbnails and decoded meshes)",
    ),
)

# Already-compressed media files gain little from deflate; store directly for speed.
STORE_EXTS = frozenset({".webp", ".png", ".jpg", ".jpeg", ".glb", ".zip"})


def iter_spec_files(spec: ArchiveSpec) -> list[Path]:
    """Collect sorted files matching the archive specification."""
    if not spec.source_dir.is_dir():
        return []

    files: list[Path] = []
    for entry in sorted(spec.source_dir.iterdir(), key=lambda p: p.name.lower()):
        name = entry.name
        if spec.include_only_top and name not in spec.include_only_top:
            continue
        if name in spec.exclude_top:
            continue

        if entry.is_file():
            files.append(entry)
        elif entry.is_dir():
            for dirpath, _, filenames in os.walk(entry):
                dp = Path(dirpath)
                for fname in sorted(filenames):
                    files.append(dp / fname)
    return files


def build_archive(spec: ArchiveSpec, out_dir: Path, compresslevel: int) -> tuple[Path, int, int]:
    """Write one ZIP archive atomically via a temp file and return (path, count, bytes)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    final_path = out_dir / spec.name
    tmp_path = out_dir / f".{spec.name}.tmp"

    files = iter_spec_files(spec)
    if not files:
        raise FileNotFoundError(f"No files found for {spec.name} under {spec.source_dir}")

    try:
        with zipfile.ZipFile(
            tmp_path,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=compresslevel,
            allowZip64=True,
        ) as zf:
            for file_path in files:
                arcname = file_path.relative_to(ROOT).as_posix()
                compress_type = (
                    zipfile.ZIP_STORED
                    if file_path.suffix.lower() in STORE_EXTS
                    else zipfile.ZIP_DEFLATED
                )
                zf.write(file_path, arcname=arcname, compress_type=compress_type)
        tmp_path.replace(final_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    return final_path, len(files), final_path.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description="Create split runtime asset ZIPs in share/.")
    parser.add_argument("--out", type=Path, default=SHARE_DIR, help="Output directory")
    parser.add_argument("--level", type=int, default=3, help="Deflate compression level (1-9)")
    parser.add_argument(
        "--skip-hair-cache",
        action="store_true",
        help="Skip 4-preset-pack-cache-hair.zip",
    )
    args = parser.parse_args()

    for spec in ARCHIVE_SPECS:
        if args.skip_hair_cache and spec.name == "4-preset-pack-cache-hair.zip":
            print(f"[skip] {spec.name}")
            continue
        out_path, count, size_bytes = build_archive(spec, args.out, args.level)
        size_mb = size_bytes / (1024 * 1024)
        print(f"[ok] {out_path.name}: {count} files, {size_mb:.2f} MB")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
