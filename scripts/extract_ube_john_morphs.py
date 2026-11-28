#!/usr/bin/env python3
"""
Copies UBE 2.0 `John/*.tri` and `Wick/*/*.tri` binary FRTRI003 morph packs
into `public/assets/morphs/ube/` (compact int16 binary format parsed directly
by `lib/morphs/triParser.ts`) and generates `public/assets/morphs/ube/index.json`.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
from pathlib import Path

from extract_facial_morphs import build_11761_map, read_tri


CATEGORIES: list[dict[str, object]] = [
    {
        "id": "pers",
        "label": "Face Presets & Race",
        "headTri": "John/PERS_FemaleHead.tri",
        "companions": {
            "eyes": "Wick/Eyes/PERS_EyesFemale.tri",
            "lashes": "Wick/faceparts/PERS_EyeFemaleLashes.tri",
            "brows": "Wick/faceparts/PERS_FemaleBrows.tri",
            "mouth": "Wick/Mouth/PERS_MouthHumanF.tri",
        },
    },
    {
        "id": "face",
        "label": "Face, Cheeks & Chin",
        "headTri": "John/FACE_FemaleHead.tri",
        "companions": {
            "eyes": "Wick/Eyes/FACE_EyesFemale.tri",
            "lashes": "Wick/faceparts/FACE_EyeFemaleLashes.tri",
            "brows": "Wick/faceparts/FACE_FemaleBrows.tri",
            "mouth": "Wick/Mouth/FACE_MouthHumanF.tri",
        },
    },
    {
        "id": "brow",
        "label": "Brows & Forehead",
        "headTri": "John/BROW_FemaleHead.tri",
        "companions": {
            "lashes": "Wick/faceparts/BROW_EyeFemaleLashes.tri",
            "brows": "Wick/faceparts/BROW_FemaleBrows.tri",
        },
    },
    {
        "id": "eyes",
        "label": "Eyes, Lids & Pupils",
        "headTri": "John/EYES_FemaleHead.tri",
        "companions": {
            "eyes": "Wick/Eyes/EYES_EyesFemale.tri",
            "lashes": "Wick/faceparts/EYES_EyeFemaleLashes.tri",
            "brows": "Wick/faceparts/EYES_FemaleBrows.tri",
        },
    },
    {
        "id": "nose",
        "label": "Nose & Nostrils",
        "headTri": "John/Nose_FemaleHead.tri",
        "companions": {
            "brows": "Wick/faceparts/NOSE_FemaleBrows.tri",
        },
    },
    {
        "id": "lip",
        "label": "Lips & Cupid's Bow",
        "headTri": "John/LIP_FemaleHead.tri",
        "companions": {
            "mouth": "Wick/Mouth/LIP_MouthHumanF.tri",
        },
    },
    {
        "id": "ear",
        "label": "Ears & Elf Ears",
        "headTri": "John/EAR_FemaleHead.tri",
        "companions": {},
    },
]


def check_tri_header(path: Path) -> None:
    d = path.read_bytes()
    vcount, n_tris, n_quads, _a, _b, n_uv, flags, n_stat, n_mod, mod_v, _x, _y, _z, _w = struct.unpack("<14I", d[8:64])
    if n_quads != 0 or mod_v != 0:
        raise ValueError(f"{path.name} has quads={n_quads} mod_v={mod_v} incompatible with simple triParser")


def humanize_morph(name: str) -> str:
    clean = re.sub(r"^(?:EYES|FACE|LIP|EAR|NOSE|BROW|PERS|NEW)_", "", name)
    clean = clean.replace("_", " ")
    clean = re.sub(r"(?<=[a-z])(?=[A-Z0-9])", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def collect_ini_sliders(mods_root: Path, known_morphs: dict[str, str]) -> dict[str, list[str]]:
    """
    Parses RaceMenu CharGen INI slider definitions (`SliderName = sect, Slider, NegMorph, PosMorph`)
    across UBE 2.0 so `.jslot` custom morphs use exact authored polarity instead of suffix heuristics.
    """
    by_lower = {k.lower(): k for k in known_morphs}
    ube_dir = mods_root / "UBE 2.0 U0.7"
    if not ube_dir.exists():
        return {}

    def resolve_tri(raw: str) -> str:
        s = raw.strip()
        if not s or s.lower() == "none":
            return ""
        return by_lower.get(s.lower(), "")

    ini_sliders: dict[str, list[str]] = {}
    for ini_path in sorted(ube_dir.rglob("*.ini")):
        for line in ini_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if "=" not in line:
                continue
            lhs, rhs = line.split("=", 1)
            parts = [p.strip() for p in rhs.split(",")]
            if len(parts) < 4 or parts[1].lower() != "slider":
                continue
            neg_name = resolve_tri(parts[2])
            pos_name = resolve_tri(parts[3])
            if neg_name or pos_name:
                ini_sliders[lhs.strip()] = [neg_name, pos_name]
    return ini_sliders


def main() -> int:
    ap = argparse.ArgumentParser(description="Stage UBE John/*.tri morph packs & index.")
    ap.add_argument("--mods", type=Path, default=Path(r"D:\Games\Skyrim\MO2_Archive\mods"))
    ap.add_argument(
        "--head-ref",
        type=Path,
        default=Path("public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json"),
    )
    ap.add_argument("--out-dir", type=Path, default=Path("public/assets/morphs/ube"))
    args = ap.parse_args()

    morphs_root = args.mods / "UBE 2.0 U0.7" / "meshes" / "actors" / "character" / "facegenmorphs" / "morphs"
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # Remove old oversized per-category JSON files if present
    for old in args.out_dir.glob("*.json"):
        if old.name != "index.json":
            old.unlink()

    seam_map: list[int] | None = None
    index_categories: list[dict[str, object]] = []
    morph_to_category: dict[str, str] = {}

    for cat in CATEGORIES:
        cat_id = str(cat["id"])
        src_head = morphs_root / str(cat["headTri"])
        check_tri_header(src_head)
        _vc, head_base, head_morphs = read_tri(src_head)
        if seam_map is None:
            seam_map = build_11761_map(head_base, args.head_ref)

        dst_head_name = f"{cat_id}_head.tri"
        shutil.copy2(src_head, args.out_dir / dst_head_name)
        files_map: dict[str, str] = {"head": f"/assets/morphs/ube/{dst_head_name}"}

        for c_part, c_rel in (cat["companions"] or {}).items():  # type: ignore[union-attr]
            c_src = morphs_root / str(c_rel)
            if c_src.exists():
                check_tri_header(c_src)
                dst_comp_name = f"{cat_id}_{c_part}.tri"
                shutil.copy2(c_src, args.out_dir / dst_comp_name)
                files_map[str(c_part)] = f"/assets/morphs/ube/{dst_comp_name}"

        names = sorted(head_morphs.keys(), key=lambda s: humanize_morph(s).lower())
        sliders = [{"name": n, "label": humanize_morph(n)} for n in names]
        for n in names:
            morph_to_category[n] = cat_id

        index_categories.append({
            "id": cat_id,
            "label": cat["label"],
            "count": len(names),
            "files": files_map,
            "sliders": sliders,
        })
        print(f"Staged {cat_id}: {len(names)} morphs, files={list(files_map.keys())}")

    ini_sliders = collect_ini_sliders(args.mods, morph_to_category)

    index_payload = {
        "version": 1,
        "headSeamMap11761": seam_map or [],
        "categories": index_categories,
        "morphToCategory": morph_to_category,
        "iniSliders": ini_sliders,
    }
    index_file = args.out_dir / "index.json"
    index_file.write_text(json.dumps(index_payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {index_file} ({index_file.stat().st_size / 1024:.1f} KB, {len(ini_sliders)} INI sliders)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
