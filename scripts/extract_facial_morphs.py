#!/usr/bin/env python3
"""
Extracts paired facial expression morph deltas (Mood, Modifier, Phoneme, Extras)
from Skyrim UBE's authored FRTRI003 expression `.tri` files across all 5 facial parts:
- Head (`John/EXPR_FemaleHead.tri` — mapped to both 11,498 and 11,761 seam-split verts)
- Mouth (`Wick/Mouth/EXPR_MouthHumanF.tri` — 9,043 verts)
- Eyes (`Wick/Eyes/EXPR_EyesFemale.tri` — 1,892 verts)
- Lashes (`Wick/faceparts/EXPR_EyeFemaleLashes.tri` — 1,216 verts)
- Brows (`Wick/faceparts/EXPR_FemaleBrows.tri` — 501 verts)
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path
import numpy as np

NIF_TO_RENDER_SCALE = 0.01288
EPSILON = 1.5e-4

# Canonical export id -> source .tri morph name (handles minor spelling differences across parts)
EXPR_MAPPINGS: list[tuple[str, str]] = [
    # Smiles & Expressions
    ("mouthSmileLeft", "Smile_right"),
    ("mouthSmileRight", "Smile_left"),
    ("smile", "Smile"),
    ("smallSmile", "Small_smile"),
    ("closedSmile", "ClosedSmile_topless"),
    ("wideSmile", "WideSmile_topless"),
    ("kiss", "Kiss"),
    ("puckeringLips", "Puckering_Lips"),
    ("bitingLips", "Biting_lips"),
    ("openedLips", "Opened_lips"),
    ("lick", "Lick"),
    ("yawning", "Yawning"),
    ("tired", "Tired"),
    ("stress", "Stress"),
    ("skeptical", "Skeptical"),
    ("ahegao", "Ahegao"),
    # Moods (RaceMenu Mood tab)
    ("moodHappy", "MoodHappy"),
    ("moodAnger", "MoodAnger"),
    ("moodDisgusted", "MoodDisgusted"),
    ("moodFear", "MoodFear"),
    ("moodPuzzled", "MoodPuzzled"),
    ("moodSad", "MoodSad"),
    ("moodSurprised", "MoodSurprised"),
    # Modifiers (RaceMenu Modifier tab)
    ("browUpLeft", "BrowUpRight"),
    ("browUpRight", "BrowUpLeft"),
    ("browDownLeft", "BrowDownRight"),
    ("browDownRight", "BrowDownLeft"),
    ("browInLeft", "BrowInRight"),
    ("browInRight", "BrowInLeft"),
    ("squintLeft", "SquintRight"),
    ("squintRight", "SquintLeft"),
    ("lookUp", "LookUp"),
    ("lookDown", "LookDown"),
    ("lookLeft", "LookRight"),
    ("lookRight", "LookLeft"),
    # Phonemes / Speech Visemes (RaceMenu Phoneme tab)
    ("jawOpen", "BigAah"),
    ("viseme_aa", "Aah"),
    ("viseme_O", "Oh"),
    ("viseme_E", "Eh"),
    ("viseme_U", "OohQ"),
    ("viseme_I", "Eee"),
    ("viseme_PP", "BMP"),
    ("viseme_FF", "FV"),
    ("phoneme_ChJSh", "ChJSh"),
    ("phoneme_DST", "DST"),
    ("phoneme_I", "I"),
    ("phoneme_K", "K"),
    ("phoneme_N", "N"),
    ("phoneme_R", "R"),
    ("phoneme_Th", "Th"),
    ("phoneme_W", "W"),
]


def read_tri(path: Path) -> tuple[int, np.ndarray, dict[str, np.ndarray]]:
    data = path.read_bytes()
    if data[:5] != b"FRTRI":
        raise ValueError(f"Unexpected TRI header in {path}: {data[:8]!r}")

    vcount, n_tris, n_quads, _a, _b, n_uv, flags, n_stat, _n_mod, mod_v, _x, _y, _z, _w = struct.unpack(
        "<14I", data[8:64]
    )
    base_sky = np.frombuffer(data, dtype="<f4", count=vcount * 3, offset=64).reshape(vcount, 3)
    base_three = np.stack([base_sky[:, 0], base_sky[:, 2], base_sky[:, 1]], axis=1) * NIF_TO_RENDER_SCALE

    offset = 64 + vcount * 12 + mod_v * 12 + n_tris * 12 + n_quads * 16 + n_uv * 8 + n_tris * 12 + n_quads * 16
    if (flags & 1) == 0:
        # Handle TRI files without triangle UV index block
        offset = 64 + vcount * 12 + mod_v * 12 + n_tris * 12 + n_quads * 16 + n_uv * 8

    morphs: dict[str, np.ndarray] = {}
    for _ in range(n_stat):
        name_len = struct.unpack("<I", data[offset : offset + 4])[0]
        offset += 4
        name = data[offset : offset + name_len].rstrip(b"\x00").decode("latin1", "replace")
        offset += name_len
        scale = struct.unpack("<f", data[offset : offset + 4])[0]
        offset += 4
        raw = np.frombuffer(data, dtype="<i2", count=vcount * 3, offset=offset).reshape(vcount, 3).astype(np.float32)
        offset += vcount * 6

        deltas = np.stack([raw[:, 0], raw[:, 2], raw[:, 1]], axis=1) * (scale * NIF_TO_RENDER_SCALE)
        morphs[name] = deltas

    return vcount, base_three, morphs


def build_11761_map(tri_base: np.ndarray, head_11761_path: Path) -> list[int]:
    hm = json.loads(head_11761_path.read_text(encoding="utf-8"))
    hp = np.array(hm["positions"], dtype=np.float32).reshape(-1, 3)
    shifted = tri_base - (tri_base.max(axis=0) - hp.max(axis=0))
    idxs = np.empty(len(hp), dtype=np.int32)
    dists = np.empty(len(hp), dtype=np.float32)
    for i in range(0, len(hp), 512):
        chunk = hp[i : i + 512]
        d2 = ((chunk[:, None, :] - shifted[None, :, :]) ** 2).sum(axis=2)
        best = d2.argmin(axis=1)
        idxs[i : i + 512] = best
        dists[i : i + 512] = np.sqrt(d2[np.arange(len(chunk)), best])
    print(f"Mapped {len(hp)} -> {len(tri_base)} verts (max_err={dists.max():.6f}m)")
    return idxs.tolist()


def to_sparse(deltas: np.ndarray) -> dict[str, list[int | float]]:
    mags = np.sqrt((deltas * deltas).sum(axis=1))
    mask = mags > EPSILON
    indices = np.nonzero(mask)[0].tolist()
    packed = np.round(deltas[mask], 4).reshape(-1).tolist()
    return {"indices": indices, "deltas": packed}


def extract_bundle(mods_root: Path, head_11761_path: Path) -> dict[str, object]:
    morphs_root = mods_root / "UBE 2.0 U0.7" / "meshes" / "actors" / "character" / "facegenmorphs" / "morphs"
    parts_paths = {
        "head": morphs_root / "John" / "EXPR_FemaleHead.tri",
        "mouth": morphs_root / "Wick" / "Mouth" / "EXPR_MouthHumanF.tri",
        "eyes": morphs_root / "Wick" / "Eyes" / "EXPR_EyesFemale.tri",
        "lashes": morphs_root / "Wick" / "faceparts" / "EXPR_EyeFemaleLashes.tri",
        "brows": morphs_root / "Wick" / "faceparts" / "EXPR_FemaleBrows.tri",
    }

    loaded: dict[str, tuple[int, np.ndarray, dict[str, np.ndarray]]] = {
        k: read_tri(p) for k, p in parts_paths.items()
    }

    head_vc, head_base, _ = loaded["head"]
    seam_map_11761 = build_11761_map(head_base, head_11761_path)

    out_parts: dict[str, dict[str, object]] = {}
    for part_key, (vc, _, morph_dict) in loaded.items():
        part_morphs: dict[str, object] = {}
        for export_name, tri_name in EXPR_MAPPINGS:
            arr = morph_dict.get(tri_name)
            if arr is None and tri_name == "MoodSurprised":
                arr = morph_dict.get("MoodSurprise")
            if arr is None and tri_name == "DialogueSurprised":
                arr = morph_dict.get("DialogueSurprise")
            if arr is None:
                continue
            sp = to_sparse(arr)
            if sp["indices"]:
                part_morphs[export_name] = sp
        out_parts[part_key] = {"vertexCount": vc, "morphs": part_morphs}

    return {
        "version": 2,
        "source": "UBE 2.0 EXPR_* across Head/Mouth/Eyes/Lashes/Brows",
        "names": [export_name for export_name, _ in EXPR_MAPPINGS],
        "headSeamMap11761": seam_map_11761,
        "head": out_parts["head"],
        "mouth": out_parts["mouth"],
        "eyes": out_parts["eyes"],
        "lashes": out_parts["lashes"],
        "brows": out_parts["brows"],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract full UBE RaceMenu expression deltas.")
    ap.add_argument("--mods", type=Path, default=Path(r"D:\Games\Skyrim\MO2_Archive\mods"))
    ap.add_argument(
        "--head-ref",
        type=Path,
        default=Path("public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json"),
    )
    ap.add_argument("--out", type=Path, default=Path("public/assets/morphs/head/ube-facial-expressions.json"))
    args = ap.parse_args()

    bundle = extract_bundle(args.mods, args.head_ref)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
