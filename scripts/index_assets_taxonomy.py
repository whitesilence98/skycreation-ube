#!/usr/bin/env python3
"""
scripts/index_assets_taxonomy.py

Generates an index manifest for the modular public/assets/ taxonomy.
Inspects core, bodyslide, wardrobe, salon, styling, characters, and stage domains.
Supports deep recursive folder structures for complex asset packs (e.g. wardrobe, ShapeData).
"""

import json
from pathlib import Path
from datetime import datetime, timezone

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ASSETS = REPO_ROOT / "public" / "assets"
OUT_MANIFEST = PUBLIC_ASSETS / "taxonomy-manifest.json"

DOMAINS = [
    "core",
    "bodyslide",
    "wardrobe",
    "salon",
    "styling",
    "characters",
    "stage",
]

def scan_domain(domain_name: str) -> dict:
    domain_path = PUBLIC_ASSETS / domain_name
    if not domain_path.exists():
        return {"available": False, "subcategories": {}, "itemCount": 0}

    subcats = {}
    total_files = 0

    # 1. Capture root-level files in domain folder if any
    root_files = [
        f.name
        for f in domain_path.iterdir()
        if f.is_file() and not f.name.startswith(".")
    ]
    if root_files:
        subcats["_root"] = {
            "count": len(root_files),
            "samples": root_files[:5],
        }
        total_files += len(root_files)

    # 2. Recursively index subdirectories
    for item in sorted(domain_path.iterdir()):
        if item.is_dir():
            rec_files = [
                str(f.relative_to(item)).replace("\\", "/")
                for f in item.rglob("*")
                if f.is_file() and not f.name.startswith(".")
            ]
            subcats[item.name] = {
                "count": len(rec_files),
                "samples": rec_files[:5],
            }
            total_files += len(rec_files)

    return {
        "available": True,
        "subcategories": subcats,
        "itemCount": total_files,
    }

def main():
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "schemaVersion": "1.1.0",
        "root": "/assets",
        "domains": {},
    }

    print("--- Scanning Modular Asset Taxonomy ---")
    for dom in DOMAINS:
        manifest["domains"][dom] = scan_domain(dom)
        count = manifest["domains"][dom]["itemCount"]
        num_sub = len(manifest["domains"][dom]["subcategories"])
        print(f"Domain '{dom}': {count} indexed items across {num_sub} subcategories.")

    with OUT_MANIFEST.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nSaved updated taxonomy manifest to {OUT_MANIFEST}")

if __name__ == "__main__":
    main()
