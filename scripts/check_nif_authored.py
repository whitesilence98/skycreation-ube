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
    hairs = sorted((root / "hairs").rglob("*.nif"))
    clothes = sorted((root / "clothes").rglob("*.nif"))
    assert hairs, f"no hair NIFs under {root / 'hairs'}"
    assert clothes, f"no outfit NIFs under {root / 'clothes'}"

    for path in hairs:
        check(convert_worker.nif_geometry(path, "head", authored=True), path.name)

    for path in clothes:
        mesh = convert_worker.nif_geometry(path, "ground", authored=True)
        check(mesh, path.name)
        roles = {m["role"] for m in mesh["materials"]}
        assert "skin" in roles, f"{path.name}: embedded body not recognised as skin"
        assert "clothing" in roles, f"{path.name}: garments not recognised as clothing"

    print(f"ok: authored decode {len(hairs)} hair + {len(clothes)} outfit NIF(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
