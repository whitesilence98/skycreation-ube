#!/usr/bin/env python
"""Decode the pack's authored NIFs and assert the render contract.

    python -I scripts/check_nif_authored.py [pack-root]

Stdlib only. Exercises `convert_worker.nif_geometry(..., authored=True)`
directly against every hair and outfit NIF in the pack, so a regression in
the decoder fails here before any asset is generated.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import convert_worker  # noqa: E402

ROLES = {"skin", "hair", "clothing", "accessory"}
SLOTS = {"albedo", "normal", "specular", "gloss", "emissive"}
PROXY_PREFIXES = ("col", "virtualground", "collision")


def pack_relative(ref: str) -> bool:
    low = ref.lower()
    return (
        bool(ref)
        and low.endswith(".dds")
        and not low.startswith(("\\", "/", ".."))
        and ":" not in ref
        and "://" not in ref
    )


def check(mesh: dict, label: str) -> None:
    assert mesh.get("authored") is True, f"{label}: not authored"
    v, t = mesh["vertexCount"], mesh["triangleCount"]
    assert v > 0 and t > 0, f"{label}: empty geometry"
    assert len(mesh["positions"]) == v * 3, f"{label}: positions length"
    assert len(mesh["normals"]) == v * 3, f"{label}: normals length"
    assert len(mesh["uvs"]) == v * 2, f"{label}: uvs length"
    assert len(mesh["indices"]) == t * 3, f"{label}: indices length"
    assert all(math.isfinite(c) for c in mesh["positions"]), f"{label}: non-finite position"
    assert max(abs(c) for c in mesh["positions"]) < 3.0, f"{label}: implausible span"
    assert min(mesh["indices"]) >= 0 and max(mesh["indices"]) < v, f"{label}: index out of range"
    assert mesh.get("bones"), f"{label}: missing skeleton"
    assert len(mesh["skinIndex"]) == len(mesh["skinWeight"]) == v * 4, f"{label}: skin length"
    assert all(0 <= i < len(mesh["bones"]) for i in mesh["skinIndex"]), f"{label}: skin index"
    for i in range(v):
        w = mesh["skinWeight"][i * 4:i * 4 + 4]
        assert all(math.isfinite(x) and x >= 0 for x in w), f"{label}: invalid weights"
        assert abs(sum(w) - 1) < 0.0001, f"{label}: weights not normalized"

    groups, mats = mesh["groups"], mesh["materials"]
    assert groups and mats and len(groups) == len(mats), f"{label}: group/material count"
    idx = mesh["indices"]
    end = 0
    next_vertex = 0  # shapes are concatenated in group order
    for g in groups:
        assert g["start"] == end, f"{label}: groups not contiguous at {end}"
        assert g["count"] > 0 and g["count"] % 3 == 0, f"{label}: group not triangle-aligned"
        assert 0 <= g["materialIndex"] < len(mats), f"{label}: bad materialIndex"
        # Each shape's triangles must index that shape's own vertices, never a
        # neighbouring shape's. A missing vertex_base shows up here as a
        # max index below the range start for every group after the first.
        span = idx[g["start"] : g["start"] + g["count"]]
        assert min(span) >= next_vertex, (
            f"{label}: group {g['materialIndex']} indexes below its vertex range "
            f"({min(span)} < {next_vertex})"
        )
        next_vertex = max(span) + 1
        end += g["count"]
    assert end == len(idx), f"{label}: groups do not cover indices"
    assert {g["materialIndex"] for g in groups} == set(range(len(mats))), f"{label}: unused material"

    for m in mats:
        name = str(m.get("name") or "")
        assert name, f"{label}: unnamed material"
        assert not name.lower().startswith(PROXY_PREFIXES), f"{label}: proxy leaked as {name}"
        assert m.get("role") in ROLES, f"{label}: bad role {m.get('role')!r}"
        assert isinstance(m.get("doubleSided"), bool), f"{label}: doubleSided not bool"
        if "alphaTest" in m:
            assert 0.0 <= float(m["alphaTest"]) <= 1.0, f"{label}: alphaTest out of range"
        refs = m.get("textureRefs")
        assert isinstance(refs, dict) and refs, f"{label}: no textureRefs"
        for slot, ref in refs.items():
            assert slot in SLOTS, f"{label}: unexpected texture slot {slot}"
            if ref is not None:
                assert pack_relative(ref), f"{label}: textureRef not pack-relative DDS: {ref}"


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\Games\Skyrim\Skyrim Preset For App")
    hairs = sorted({p for folder in ("hairs", "hair") for p in (root / folder).rglob("*.nif")})
    clothes = sorted({p for folder in ("clothes", "clothing") for p in (root / folder).rglob("*.nif")})
    hairs = [p for p in hairs if not p.stem.lower().startswith(PROXY_PREFIXES) and "collision" not in p.stem.lower()]
    clothes = [p for p in clothes if not p.stem.lower().startswith(PROXY_PREFIXES) and "collision" not in p.stem.lower()]
    # The catalogue names which authored layouts this pack can actually decode.
    import json
    catalogue = SCRIPTS.parent / "public/assets/preset-pack/catalogue"
    supported = {
        e["rel"].lower() for kind in ("hairMesh", "clothingMesh")
        for e in json.loads((catalogue / f"{kind}.json").read_text(encoding="utf-8"))
        if e.get("decodable") is not False
    }
    hairs = [p for p in hairs if str(p.relative_to(root)).lower() in supported]
    clothes = [p for p in clothes if str(p.relative_to(root)).lower() in supported]
    assert hairs, f"no hair NIFs under {root / 'hairs'}"
    assert clothes, f"no outfit NIFs under {root / 'clothes'}"

    for path in hairs:
        check(convert_worker.nif_geometry(path, "head", authored=True), path.name)

    for path in clothes:
        mesh = convert_worker.nif_geometry(path, "ground", authored=True)
        check(mesh, path.name)
        roles = {m["role"] for m in mesh["materials"]}
        assert roles & {"clothing", "accessory"}, f"{path.name}: garments not recognised"

    parts = sorted((root / "body").rglob("*_tangent_[01].nif"))
    assert parts, "no body/hands/feet weight pairs"
    for path in parts:
        mesh = convert_worker.nif_geometry(path, "head", authored=True)
        check(mesh, path.name)
        assert {m["role"] for m in mesh["materials"]} == {"skin"}, path.name
        if path.stem.endswith("_0"):
            other = convert_worker.nif_geometry(path.with_name(path.name.replace("_0.nif", "_1.nif")), "head", authored=True)
            for key in ("indices", "skinIndex", "skinWeight", "bones") + (() if "body_tangent" in path.stem else ("uvs",)):
                assert mesh[key] == other[key], f"{path.name}: pair {key} mismatch"

    print(f"ok: authored decode {len(hairs)} hair + {len(clothes)} outfit + {len(parts)} body-part NIF(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
