#!/usr/bin/env python
"""Fast selective asset synchronizer for individual preset pack categories.

Instead of scanning all 8,000+ files in the pack (which takes 30-60s), this script
scopes directory scanning directly to the requested part (e.g. clothing, hair,
presets, body, skin, eyes, lashes, brows, mouth, skeleton, overlays).

Usage:
    python scripts/sync_part.py <part_name> [<part_name2> ...] [options]
    python scripts/sync_part.py clothing
    python scripts/sync_part.py assets/clothing
    python scripts/sync_part.py hair
    python scripts/sync_part.py presets
    python scripts/sync_part.py body
    python scripts/sync_part.py --list
    npm run sync:clothing
    npm run sync:hair
    npm run sync:presets
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import asset_source
import sync_pack_assets
from sync_pack_assets import PARTS, resolve_part


def print_status_table(cfg: dict) -> None:
    root = Path(cfg.get("root", ""))
    out = Path(cfg.get("out", ""))
    cat_dir = out / "catalogue"

    print("=" * 74)
    print("  Skyrim Preset Pack - Fast Part Synchronizer")
    print("=" * 74)
    print(f"  Pack Root:   {root}")
    print(f"  Target Out:  {out}")
    print("-" * 74)
    print(f"  {'PART NAME':<13} {'LABEL / CATEGORY':<28} {'DISK FILES':<12} {'CATALOGUE':<10}")
    print("-" * 74)

    for part_name, info in sorted(PARTS.items()):
        disk_count = 0
        if root.is_dir():
            for sub in info["subdirs"]:
                sub_p = root / sub
                if sub_p.is_dir():
                    disk_count += sum(len(files) for _, _, files in os.walk(sub_p))

        cat_count = 0
        for kind in info["kinds"]:
            kind_file = cat_dir / f"{kind}.json"
            if kind_file.is_file():
                try:
                    import json
                    cat_count += len(json.loads(kind_file.read_text(encoding="utf-8")))
                except Exception:
                    pass

        label = info.get("label", part_name)
        print(f"  {part_name:<13} {label:<28} {disk_count:<12d} {cat_count:<10d}")

    print("=" * 74)
    print("  Commands & Examples:")
    print("    python scripts/sync_part.py clothing       (npm run sync:clothing)")
    print("    python scripts/sync_part.py hair           (npm run sync:hair)")
    print("    python scripts/sync_part.py presets        (npm run sync:presets)")
    print("    python scripts/sync_part.py body           (npm run sync:body)")
    print("    python scripts/sync_part.py skin           (npm run sync:skin)")
    print("    python scripts/sync_part.py eyes           (npm run sync:eyes)")
    print("    python scripts/sync_part.py lashes         (npm run sync:lashes)")
    print("    python scripts/sync_part.py brows          (npm run sync:brows)")
    print("    python scripts/sync_part.py mouth          (npm run sync:mouth)")
    print("    python scripts/sync_part.py skeleton       (npm run sync:skeleton)")
    print("    python scripts/sync_part.py overlays       (npm run sync:overlays)")
    print("    python scripts/sync_part.py all            (full sync)")
    print("=" * 74)


def sync_single_part(cfg: dict, part_name: str, force: bool = False, catalogue_only: bool = False) -> int:
    canonical = resolve_part(part_name)
    if not canonical and part_name.lower() != "all":
        print(f"[!] Unknown part '{part_name}'.", file=sys.stderr)
        print(f"    Available: {', '.join(sorted(PARTS.keys()))}", file=sys.stderr)
        return 1

    part_label = canonical if canonical else "all"

    if canonical == "hair":
        print("\n[i] Hair synchronization is retired:")
        print("    Hairstyles are now managed as standalone .glb files in public/assets/hair/.")
        print("    Use 'scripts/export_hair_nif_to_glb.py' to convert Skyrim NIF hairs to .glb,")
        print("    and register them in 'lib/hairGlbRegistry.ts'.")
        return 0

    t0 = time.perf_counter()
    print(f"\n>>> Starting sync for part: [{part_label.upper()}] ...")

    code = sync_pack_assets.build_catalogue(cfg, part=canonical)
    if code != 0:
        print(f"[!] Catalogue sync failed for {part_label}", file=sys.stderr)
        return code

    if not catalogue_only:
        code = sync_pack_assets.build_manifest(cfg, part=canonical, force=force)
        if code != 0:
            print(f"[!] Manifest build failed for {part_label}", file=sys.stderr)
            return code

    elapsed = time.perf_counter() - t0
    print(f"[OK] Successfully synced '{part_label}' in {elapsed:.2f}s!")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fast selective sync for Skyrim preset pack assets by category."
    )
    parser.add_argument(
        "parts",
        nargs="*",
        help="One or more part names or paths (e.g. clothing, hair, presets, body, assets/clothing, etc.).",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available parts and their current asset counts.",
    )
    parser.add_argument(
        "--catalogue",
        action="store_true",
        help="Sync catalogue only without rebuilding manifest.",
    )
    parser.add_argument(
        "--force",
        "-f",
        action="store_true",
        help="Force rebuild/transcode ignoring cache cutoff timestamps.",
    )

    args = parser.parse_args()
    cfg = asset_source.load()

    if cfg.get("layout") != "pack":
        print("[!] asset-source.json layout is not 'pack'. Nothing to do.", file=sys.stderr)
        return 0

    if args.list or not args.parts:
        print_status_table(cfg)
        return 0

    overall_t0 = time.perf_counter()
    exit_code = 0

    for part_arg in args.parts:
        code = sync_single_part(cfg, part_arg, force=args.force, catalogue_only=args.catalogue)
        if code != 0:
            exit_code = code

    if len(args.parts) > 1:
        total_time = time.perf_counter() - overall_t0
        print(f"\n[ALL DONE] Finished syncing {len(args.parts)} parts in {total_time:.2f}s.")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
