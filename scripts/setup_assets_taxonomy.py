#!/usr/bin/env python3
"""
scripts/setup_assets_taxonomy.py

Sets up the modular, data-driven directory taxonomy under public/assets/
according to the Asset Architecture Plan. Non-destructive: organizes folders
while maintaining backward-compatible paths.
"""

import os
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ASSETS = REPO_ROOT / "public" / "assets"

TAXONOMY_DIRS = [
    # Core Base Foundation
    "core/skeleton",
    "core/base-mesh",
    "core/default-textures",
    
    # BodySlide & Morph Subsystem
    "bodyslide/sliders",
    "bodyslide/data",
    "bodyslide/presets",
    
    # Wardrobe (Outfits, Armor, Clothes)
    "wardrobe/meshes",
    "wardrobe/textures",
    "wardrobe/morphs",
    
    # Salon (Hairstyles, Brows, Lashes, Eyes)
    "salon/hair",
    "salon/brows",
    "salon/lashes",
    "salon/eyes",
    "salon/thumbnails",
    
    # Styling (Makeup, Tattoos, Skin)
    "styling/makeup",
    "styling/tattoos",
    "styling/skin",
    
    # Characters (Presets, Face Morphs/Sculpts)
    "characters/presets",
    "characters/sculpts",
    
    # Stage & Environment
    "stage/poses",
    "stage/lighting",
    "stage/hdr",
    
    # Cache
    "cache",
]

def setup_directories():
    print(f"Creating data-driven asset directory taxonomy under {PUBLIC_ASSETS}...")
    for rel_dir in TAXONOMY_DIRS:
        target_dir = PUBLIC_ASSETS / rel_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        print(f"  [OK] public/assets/{rel_dir}")

def organize_bodyslide_assets():
    """Organize BodySlide assets into sliders, data, and presets while preserving root backward-compatibility."""
    bs_root = PUBLIC_ASSETS / "bodyslide"
    if not bs_root.exists():
        return

    # Sliders (XML / OSP definitions)
    for fname in ["0NecocoSliders.xml", "1ube.xml", "UBE SE 2.0 - Necoco Body.osp"]:
        src = bs_root / fname
        if src.is_file():
            dst = bs_root / "sliders" / fname
            if not dst.exists():
                shutil.copy2(src, dst)
                print(f"  [COPY] {fname} -> bodyslide/sliders/{fname}")

    # Binary Morph Data (.osd)
    for fname in ["UBE SE 2.0 - Necoco Body.osd"]:
        src = bs_root / fname
        if src.is_file():
            dst = bs_root / "data" / fname
            if not dst.exists():
                # On Windows, copy or create hardlink
                try:
                    os.link(src, dst)
                    print(f"  [HARDLINK] {fname} -> bodyslide/data/{fname}")
                except Exception:
                    shutil.copy2(src, dst)
                    print(f"  [COPY] {fname} -> bodyslide/data/{fname}")

    print("BodySlide assets organized successfully.")

def main():
    setup_directories()
    organize_bodyslide_assets()
    print("\nAsset taxonomy setup complete!")

if __name__ == "__main__":
    main()
