#!/usr/bin/env python
"""Copy makeup DDS assets from MO2 mods archive into Skyrim Preset For App overlays."""

import os
import shutil
from pathlib import Path

MO2_MODS = Path(r"D:\Games\Skyrim\MO2_Archive\mods")
TARGET_OVERLAYS = Path(r"D:\Games\Skyrim\Skyrim Preset For App\overlays\textures\Actors\Character\Overlays")

MAKEUP_MODS = [
    "Even More Makeup",
    "Ancient Beauty Makeup UBE 4K",
    "Lovely Makeup 2",
    "Lovely Makeup 3 - UBE - 4K",
    "Pretty Makeup - UBE",
    "[Nini] Tintmasks"
]

TARGET_OVERLAYS.mkdir(parents=True, exist_ok=True)

copied = 0
skipped = 0

for mod_name in MAKEUP_MODS:
    mod_dir = MO2_MODS / mod_name
    if not mod_dir.is_dir():
        print(f"[!] Mod dir not found: {mod_dir}")
        continue
    
    # Walk all .dds files
    for root, _, files in os.walk(mod_dir):
        for f in files:
            if not f.lower().endswith(".dds"):
                continue
            src = Path(root) / f
            # Determine relative subfolder (e.g. Blushes, Eyeshadows, Lips)
            rel_parts = src.relative_to(mod_dir).parts
            # Clean up destination name to avoid collisions across mods
            # Keep folder structure under mod prefix
            dest_rel = Path(mod_name) / Path(*rel_parts[1:] if rel_parts[0].lower() in ('textures', 'textures\\') else rel_parts)
            dest = TARGET_OVERLAYS / dest_rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            
            if dest.exists() and dest.stat().st_size == src.stat().st_size:
                skipped += 1
            else:
                shutil.copy2(src, dest)
                copied += 1

print(f"[+] Done copying makeup assets: {copied} copied, {skipped} already identical.")
