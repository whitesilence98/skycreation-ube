#!/usr/bin/env python3
"""
convert_skyrim_poses.py

Extracts and converts Skyrim SE Havok (.hkx) pose packs (Halo Poser 1.8, GomaPeroPoses)
into lightweight web JSON pose tracks for cc-kit-react.

Pipeline:
1. Parse Poser Hotkeys Plus JSON and FNIS list catalogs to discover poses and metadata.
2. For each pose:
   a. Convert 64-bit SSE HKX to 32-bit LE HKX using tools/poser/hkxc.exe
   b. Export NetImmerse Keyframe (.kf) using tools/poser/hkxcmd.exe with skeleton_female_win32.hkx
   c. Parse .kf using pyffi to extract bone rotation quaternions (x, y, z, w) and COM translations
   d. Write compressed JSON pose track to public/assets/preset-pack/poses/<pack>/<pose_id>.json
3. Generate manifest.json summarizing all packs, categories, and pose IDs.
"""

import os
import sys
import json
import re
import shutil
import subprocess
import tempfile
import time

# PyFFI compatibility fix for Python 3.13 (time.clock was removed)
time.clock = time.perf_counter
import pyffi.formats.nif as nif

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_DIR = os.path.join(WORKSPACE_ROOT, "tools", "poser")
HKXC_EXE = os.path.join(TOOLS_DIR, "hkxc.exe")
HKXCMD_EXE = os.path.join(TOOLS_DIR, "hkxcmd.exe")
SKELETON_HKX = os.path.join(TOOLS_DIR, "skeleton_female_win32.hkx")

OUT_POSES_DIR = os.path.join(WORKSPACE_ROOT, "public", "assets", "preset-pack", "poses")

MO2_MODS_DIR = r"D:\Games\Skyrim\MO2_Archive\mods"
POSER_HOTKEYS_DATA_DIR = os.path.join(MO2_MODS_DIR, "Poser Hotkeys Plus", "SKSE", "Plugins", "PoserHotKeys", "PoserData")

PACKS_CONFIG = [
    {
        "id": "halos",
        "name": "Halo Poser 1.8",
        "json_path": os.path.join(POSER_HOTKEYS_DATA_DIR, "HalosPoser.json"),
        "fnis_paths": [
            os.path.join(MO2_MODS_DIR, "Halo Poser 1.8", "meshes", "actors", "character", "animations", "HalosPoser", "FNIS_HalosPoser_List.txt"),
            os.path.join(MO2_MODS_DIR, "Halo Poser 1.8", "meshes", "actors", "character", "animations", "HalosPoser2", "FNIS_HalosPoser2_List.txt"),
        ],
        "anim_dirs": [
            os.path.join(MO2_MODS_DIR, "Halo Poser 1.8", "meshes", "actors", "character", "animations", "HalosPoser"),
            os.path.join(MO2_MODS_DIR, "Halo Poser 1.8", "meshes", "actors", "character", "animations", "HalosPoser2"),
        ]
    },
    {
        "id": "gomapero",
        "name": "GomaPero Poses",
        "json_path": os.path.join(POSER_HOTKEYS_DATA_DIR, "GomaPeroPero1.json"),
        "fnis_paths": [
            os.path.join(MO2_MODS_DIR, "GomaPeroPoses", "meshes", "actors", "character", "animations", "GomaPeroPero1", "FNIS_GomaPeroPero1_List.txt"),
        ],
        "anim_dirs": [
            os.path.join(MO2_MODS_DIR, "GomaPeroPoses", "meshes", "actors", "character", "animations", "GomaPeroPero1"),
        ]
    }
]


def parse_fnis_lists(fnis_paths):
    """Parses FNIS list files to map anim events to hkx filenames."""
    mapping = {}
    for fnis_file in fnis_paths:
        if not os.path.exists(fnis_file):
            continue
        with open(fnis_file, "r", encoding="latin1") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("'"):
                    continue
                parts = line.split()
                if len(parts) >= 3:
                    event = parts[-2]
                    hkx = parts[-1]
                    if hkx.lower().endswith(".hkx"):
                        mapping[event.lower()] = hkx
    return mapping


def find_hkx_file(filename, anim_dirs):
    """Finds the actual path of an hkx file in the provided directories."""
    fn_lower = filename.lower()
    for adir in anim_dirs:
        if not os.path.exists(adir):
            continue
        for root, _, files in os.walk(adir):
            for f in files:
                if f.lower() == fn_lower:
                    return os.path.join(root, f)
    return None


def convert_hkx_to_kf(hkx_path, temp_dir):
    """Converts 64-bit HKX to 32-bit HKX, then exports to KF."""
    win32_hkx = os.path.join(temp_dir, "temp_win32.hkx")
    kf_path = os.path.join(temp_dir, "temp.kf")

    # Step 1: hkxc.exe convert -i <hkx> -o <win32_hkx> -v win32
    cmd1 = [HKXC_EXE, "convert", "-i", hkx_path, "-o", win32_hkx, "-v", "win32"]
    res1 = subprocess.run(cmd1, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res1.returncode != 0 or not os.path.exists(win32_hkx):
        return None

    # Step 2: hkxcmd.exe ExportKF <skel.hkx> <anim.hkx> <anim.kf>
    cmd2 = [HKXCMD_EXE, "ExportKF", SKELETON_HKX, win32_hkx, kf_path]
    res2 = subprocess.run(cmd2, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res2.returncode != 0 or not os.path.exists(kf_path):
        return None

    return kf_path


def parse_kf_transforms(kf_path):
    """Extracts bone rotations and translations from a KF file."""
    with open(kf_path, "rb") as f:
        data = nif.NifFormat.Data()
        data.read(f)
        if not data.roots:
            return None

        root = data.roots[0]
        bones = {}
        for block in root.controlled_blocks:
            name = block.node_name.decode("latin1")
            interp = block.interpolator
            if not interp:
                continue

            rot = None
            trans = None

            if hasattr(interp, "data") and interp.data:
                d = interp.data
                if hasattr(d, "quaternion_keys") and len(d.quaternion_keys) > 0:
                    k = d.quaternion_keys[0].value
                    rot = [round(float(k.x), 5), round(float(k.y), 5), round(float(k.z), 5), round(float(k.w), 5)]
                if hasattr(d, "translations") and len(d.translations.keys) > 0:
                    k = d.translations.keys[0].value
                    trans = [round(float(k.x), 4), round(float(k.y), 4), round(float(k.z), 4)]

            if rot is None and hasattr(interp, "rotation"):
                r = interp.rotation
                rot = [round(float(r.x), 5), round(float(r.y), 5), round(float(r.z), 5), round(float(r.w), 5)]
            if trans is None and hasattr(interp, "translation"):
                t = interp.translation
                trans = [round(float(t.x), 4), round(float(t.y), 4), round(float(t.z), 4)]

            # Only keep translation for root / COM / pelvis to preserve character placement
            bone_data = {}
            if rot is not None:
                bone_data["q"] = rot
            if trans is not None and any(p in name for p in ["COM", "Pelv", "Root", "Translate"]):
                bone_data["t"] = trans

            if bone_data:
                bones[name] = bone_data

        return bones


def process_pack(pack_cfg, max_per_category=5, total_max=60):
    """Processes poses from a mod pack."""
    pack_id = pack_cfg["id"]
    pack_name = pack_cfg["name"]
    print(f"\n=== Processing Pack: {pack_name} ({pack_id}) ===")

    if not os.path.exists(pack_cfg["json_path"]):
        print(f"Warning: PoserData JSON not found: {pack_cfg['json_path']}")
        return [], []

    fnis_map = parse_fnis_lists(pack_cfg["fnis_paths"])
    print(f"Found {len(fnis_map)} anim-event mappings in FNIS lists.")

    with open(pack_cfg["json_path"], "r", encoding="utf-8") as f:
        data = json.load(f)

    pack_out_dir = os.path.join(OUT_POSES_DIR, pack_id)
    os.makedirs(pack_out_dir, exist_ok=True)

    string_list = data.get("stringList", {})
    categories = []
    poses_meta = []

    # Identify categories
    cat_keys = [k for k in string_list.keys() if k != "packnames"]

    with tempfile.TemporaryDirectory() as temp_dir:
        count = 0
        for cat_key in cat_keys:
            cat_name = cat_key.strip()
            entries = string_list[cat_key]
            if not isinstance(entries, list):
                continue

            categories.append(cat_name)
            cat_count = 0

            for entry in entries:
                if total_max and count >= total_max:
                    break
                if max_per_category and cat_count >= max_per_category:
                    break

                # Entry format: "Label|AnimEvent"
                parts = entry.split("|")
                label = parts[0].strip()
                event = parts[1].strip() if len(parts) > 1 else ""

                if not event:
                    continue

                hkx_name = fnis_map.get(event.lower())
                if not hkx_name:
                    continue

                hkx_file = find_hkx_file(hkx_name, pack_cfg["anim_dirs"])
                if not hkx_file:
                    continue

                # Generate clean pose ID
                safe_event = re.sub(r"[^a-zA-Z0-9_-]", "", event).lower()
                pose_id = f"{pack_id}_{safe_event}"

                # Convert to KF
                kf_path = convert_hkx_to_kf(hkx_file, temp_dir)
                if not kf_path:
                    continue

                bones = parse_kf_transforms(kf_path)
                if not bones:
                    continue

                # Write pose JSON
                pose_payload = {
                    "id": pose_id,
                    "name": label,
                    "pack": pack_id,
                    "category": cat_name,
                    "event": event,
                    "boneCount": len(bones),
                    "bones": bones
                }

                out_json_file = os.path.join(pack_out_dir, f"{pose_id}.json")
                with open(out_json_file, "w", encoding="utf-8") as out_f:
                    json.dump(pose_payload, out_f, separators=(",", ":"))

                poses_meta.append({
                    "id": pose_id,
                    "name": label,
                    "pack": pack_id,
                    "category": cat_name,
                    "file": f"{pack_id}/{pose_id}.json",
                    "boneCount": len(bones)
                })

                cat_count += 1
                count += 1
                print(f"[{count}] Extracted: {label} ({event}) -> {len(bones)} bones")

            if total_max and count >= total_max:
                break

    print(f"Pack {pack_name} complete: {len(poses_meta)} poses extracted.")
    return categories, poses_meta


def main():
    os.makedirs(OUT_POSES_DIR, exist_ok=True)
    all_packs_meta = []
    all_poses_meta = {}

    # Built-in poses metadata (from lib/character/poses.ts)
    all_packs_meta.append({
        "id": "builtin",
        "name": "Built-in",
        "categories": ["Basic"],
        "count": 5
    })
    builtin_poses = [
        {"id": "rest", "name": "REST", "pack": "builtin", "category": "Basic", "note": "Relaxed A-pose bind pose."},
        {"id": "relaxed", "name": "RELAXED", "pack": "builtin", "category": "Basic", "note": "Arms drawn in, weight settled."},
        {"id": "hands-on-hips", "name": "HIPS", "pack": "builtin", "category": "Basic", "note": "Elbows out, hands resting at the waist."},
        {"id": "contrapposto", "name": "CONTRA", "pack": "builtin", "category": "Basic", "note": "Weight on one leg, hips and shoulders tilted."},
        {"id": "side-glance", "name": "GLANCE", "pack": "builtin", "category": "Basic", "note": "Head turned and tipped, body relaxed."}
    ]
    for bp in builtin_poses:
        all_poses_meta[bp["id"]] = bp

    for pack_cfg in PACKS_CONFIG:
        # Convert first 35 poses per pack as curated starter set
        cats, poses = process_pack(pack_cfg, max_per_category=6, total_max=36)
        all_packs_meta.append({
            "id": pack_cfg["id"],
            "name": pack_cfg["name"],
            "categories": cats,
            "count": len(poses)
        })
        for p in poses:
            all_poses_meta[p["id"]] = p

    # Write manifest.json
    manifest = {
        "version": 1,
        "defaultPoseId": "rest",
        "packs": all_packs_meta,
        "poses": all_poses_meta
    }

    manifest_path = os.path.join(OUT_POSES_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDone! Manifest written to {manifest_path}")
    print(f"Total poses registered: {len(all_poses_meta)}")


if __name__ == "__main__":
    main()
