#!/usr/bin/env python3
"""
Extracts paired facial smile and speech/viseme morph deltas from Skyrim UBE's
authored FRTRI003 expression `.tri` files (`John/EXPR_FemaleHead.tri` and
`Wick/Mouth/EXPR_MouthHumanF.tri`) into a compact sparse JSON bundle
(`public/assets/morphs/head/ube-facial-expressions.json`).

Coordinate convention (aligned with `lib/morphs/triParser.ts` and `eyeBlinkMorphs.ts`):
- Facing +Z, +Y up: `+X` is character's anatomical left, `-X` is right.
- `Smile_right` deforms `+X` (`mouthSmileLeft`), `Smile_left` deforms `-X` (`mouthSmileRight`).
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

NIF_TO_RENDER_SCALE = 0.01288
EPSILON = 5e-5  # 0.05 mm threshold keeps sparse expression payload compact cleanly

EXPRESSION_SPEC: list[tuple[str, str]] = [
    # Smiles
    ("mouthSmileLeft", "Smile_right"),
    ("mouthSmileRight", "Smile_left"),
    ("smile", "Smile"),
    ("smallSmile", "Small_smile"),
    ("closedSmile", "ClosedSmile_topless"),
    ("moodHappy", "MoodHappy"),
    # Speech / Visemes
    ("jawOpen", "BigAah"),
    ("viseme_aa", "Aah"),
    ("viseme_E", "Eh"),
    ("viseme_O", "Oh"),
    ("viseme_U", "OohQ"),
    ("viseme_I", "Eee"),
    ("viseme_PP", "BMP"),
    ("viseme_FF", "FV"),
]


def read_tri_morphs(path: Path, wanted: set[str]) -> tuple[int, dict[str, list[tuple[float, float, float]]]]:
    data = path.read_bytes()
    if data[:5] != b"FRTRI":
        raise ValueError(f"Unexpected TRI header in {path}: {data[:8]!r}")

    vcount, n_tris, n_quads, _a, _b, n_uv, _flags, n_stat, _n_mod, mod_v, _x, _y, _z, _w = struct.unpack(
        "<14I", data[8:64]
    )
    offset = 64 + vcount * 12 + mod_v * 12 + n_tris * 12 + n_quads * 16 + n_uv * 8 + n_tris * 12 + n_quads * 16

    morphs: dict[str, list[tuple[float, float, float]]] = {}
    for _ in range(n_stat):
        name_len = struct.unpack("<I", data[offset : offset + 4])[0]
        offset += 4
        name = data[offset : offset + name_len].rstrip(b"\x00").decode("latin1", "replace")
        offset += name_len
        scale = struct.unpack("<f", data[offset : offset + 4])[0]
        offset += 4
        raw = struct.unpack(f"<{vcount * 3}h", data[offset : offset + vcount * 6])
        offset += vcount * 6

        if name in wanted:
            deltas: list[tuple[float, float, float]] = []
            for i in range(vcount):
                dx_sky = raw[i * 3] * scale * NIF_TO_RENDER_SCALE
                dy_sky = raw[i * 3 + 1] * scale * NIF_TO_RENDER_SCALE
                dz_sky = raw[i * 3 + 2] * scale * NIF_TO_RENDER_SCALE
                deltas.append((dx_sky, dz_sky, dy_sky))
            morphs[name] = deltas

    missing = wanted - set(morphs.keys())
    if missing:
        raise KeyError(f"Missing morphs {sorted(missing)} in {path}")
    return vcount, morphs


def to_sparse(deltas: list[tuple[float, float, float]]) -> dict[str, list[int | float]]:
    indices: list[int] = []
    packed: list[float] = []
    for i, (dx, dy, dz) in enumerate(deltas):
        if math.sqrt(dx * dx + dy * dy + dz * dz) <= EPSILON:
            continue
        indices.append(i)
        packed.extend((round(dx, 6), round(dy, 6), round(dz, 6)))
    return {"indices": indices, "deltas": packed}


def extract_bundle(mods_root: Path) -> dict[str, object]:
    morphs_root = mods_root / "UBE 2.0 U0.7" / "meshes" / "actors" / "character" / "facegenmorphs" / "morphs"
    head_tri = morphs_root / "John" / "EXPR_FemaleHead.tri"
    mouth_tri = morphs_root / "Wick" / "Mouth" / "EXPR_MouthHumanF.tri"

    wanted = {tri_name for _, tri_name in EXPRESSION_SPEC}
    head_vc, head_morphs = read_tri_morphs(head_tri, wanted)
    mouth_vc, mouth_morphs = read_tri_morphs(mouth_tri, wanted)

    head_out = {export_name: to_sparse(head_morphs[tri_name]) for export_name, tri_name in EXPRESSION_SPEC}
    mouth_out = {export_name: to_sparse(mouth_morphs[tri_name]) for export_name, tri_name in EXPRESSION_SPEC}

    return {
        "version": 1,
        "source": "UBE 2.0 John/EXPR_FemaleHead.tri + Wick/Mouth/EXPR_MouthHumanF.tri",
        "names": [export_name for export_name, _ in EXPRESSION_SPEC],
        "head": {"vertexCount": head_vc, "morphs": head_out},
        "mouth": {"vertexCount": mouth_vc, "morphs": mouth_out},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract UBE facial expression & viseme deltas.")
    ap.add_argument("--mods", type=Path, default=Path(r"D:\Games\Skyrim\MO2_Archive\mods"))
    ap.add_argument("--out", type=Path, default=Path("public/assets/morphs/head/ube-facial-expressions.json"))
    args = ap.parse_args()

    bundle = extract_bundle(args.mods)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
