#!/usr/bin/env python3
"""
Extracts clean unilateral eye blink morph deltas (`BlinkLeft_alt` and
`BlinkRight_alt`) from Skyrim UBE's authored FRTRI003 `.tri` expression files
(`FemaleHead.tri` and `EyeFemaleLashes.tri`) into a compact sparse JSON bundle
(`public/assets/morphs/head/ube-eye-blink.json`).

Coordinate convention (aligned with `lib/morphs/triParser.ts` and `lib/head/rig.ts`):
- Facing +Z, +Y up: `+X` is character's anatomical left (`eyeBlinkLeft`),
  `-X` is character's anatomical right (`eyeBlinkRight`).
- In UBE's `.tri` files, `BlinkRight_alt` deforms `+X` cleanly (zero bleed),
  and `BlinkLeft_alt` deforms `-X` cleanly (zero bleed).
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

NIF_TO_RENDER_SCALE = 0.01288
EPSILON = 1e-6

# Symmetric eyelid margin vertex pairs on the 11,498-vertex UBE head mesh
HEAD_LEFT_UPPER = 3279   # +X pupil-center upper lid margin
HEAD_LEFT_LOWER = 3331   # +X pupil-center lower lid margin
HEAD_RIGHT_UPPER = 312   # -X pupil-center upper lid margin
HEAD_RIGHT_LOWER = 362   # -X pupil-center lower lid margin


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
                # Skyrim (X right/left, Y forward, Z up) -> Three.js (X, Z_up -> Y, Y_fwd -> Z)
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
    ube_root = mods_root / "UBE 2.0 U0.7" / "meshes" / "!UBE"
    head_tri = ube_root / "Head" / "FemaleHead.tri"
    lashes_tri = ube_root / "Lashes" / "EyeFemaleLashes.tri"

    wanted = {"BlinkLeft_alt", "BlinkRight_alt"}
    head_vc, head_morphs = read_tri_morphs(head_tri, wanted)
    lash_vc, lash_morphs = read_tri_morphs(lashes_tri, wanted)

    # +X = character anatomical left (`eyeBlinkLeft` in ARKit/MetaHuman)
    head_left_deltas = head_morphs["BlinkRight_alt"]
    # -X = character anatomical right (`eyeBlinkRight` in ARKit/MetaHuman)
    head_right_deltas = head_morphs["BlinkLeft_alt"]

    left_closing = abs(head_left_deltas[HEAD_LEFT_UPPER][1]) + abs(head_left_deltas[HEAD_LEFT_LOWER][1])
    right_closing = abs(head_right_deltas[HEAD_RIGHT_UPPER][1]) + abs(head_right_deltas[HEAD_RIGHT_LOWER][1])

    return {
        "version": 1,
        "source": "UBE 2.0 FemaleHead.tri + EyeFemaleLashes.tri (BlinkLeft_alt / BlinkRight_alt)",
        "head": {
            "vertexCount": head_vc,
            "landmarks": {
                "left": {
                    "upper": HEAD_LEFT_UPPER,
                    "lower": HEAD_LEFT_LOWER,
                    "baseClosingGap": round(left_closing, 6),
                },
                "right": {
                    "upper": HEAD_RIGHT_UPPER,
                    "lower": HEAD_RIGHT_LOWER,
                    "baseClosingGap": round(right_closing, 6),
                },
            },
            "eyeBlinkLeft": to_sparse(head_left_deltas),
            "eyeBlinkRight": to_sparse(head_right_deltas),
        },
        "lashes": {
            "vertexCount": lash_vc,
            "eyeBlinkLeft": to_sparse(lash_morphs["BlinkRight_alt"]),
            "eyeBlinkRight": to_sparse(lash_morphs["BlinkLeft_alt"]),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract UBE eye blink deltas to sparse JSON.")
    ap.add_argument("--mods", type=Path, default=Path(r"D:\Games\Skyrim\MO2_Archive\mods"))
    ap.add_argument("--out", type=Path, default=Path("public/assets/morphs/head/ube-eye-blink.json"))
    args = ap.parse_args()

    bundle = extract_bundle(args.mods)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out} ({size_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
