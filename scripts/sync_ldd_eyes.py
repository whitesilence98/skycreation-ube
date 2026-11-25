#!/usr/bin/env python
"""Sync and transcode LDD - PBR Eyes for (UBE) 4K into the preset pack.

Reads from:
  D:\\Games\\Skyrim\\MO2_Archive\\mods\\LDD - PBR Eyes for (UBE) 4K 193617 1.0 2026

Outputs to public/assets/preset-pack/:
  - meshes/ldd_*.json               (Eyes_Inner_1..4, Glow variants, Outer, Wetness, Shadow)
  - textures/eyes/ldd/*.webp        (1024px WebP iris diffuse + 128px thumbs + glow masks)
  - textures/eyes/ldd/eye_n_*.png   (1024px tangent-space family normals + Wetness normal)
  - textures/eyes/ldd/eye_rough_*.webp (512px roughness extracted from RMAOS Green channel)
  - catalogue/eyeMesh.json          (updated idempotently)
  - catalogue/eyes.json             (updated idempotently)
"""

from __future__ import annotations

import io
import json
import re
import struct
import sys
from pathlib import Path
from typing import Any

from PIL import Image

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from convert_worker import nif_geometry  # noqa: E402
from sync_mo2_assets import measure_eye_atlas, to_tangent_normal  # noqa: E402

ROOT = SCRIPTS.parent
PUBLIC_PACK = ROOT / "public" / "assets" / "preset-pack"
MOD_DIR = Path(r"D:\Games\Skyrim\MO2_Archive\mods\LDD - PBR Eyes for (UBE) 4K 193617 1.0 2026")
MESH_SRC = MOD_DIR / "Meshes" / "LDD" / "EyesUBE"
TEX_SRC = MOD_DIR / "Textures" / "PBR" / "LDD" / "EyesUBE"

MESH_OUT = PUBLIC_PACK / "meshes"
TEX_OUT = PUBLIC_PACK / "textures" / "eyes" / "ldd"
THUMB_OUT = TEX_OUT / "thumbs"
CAT_DIR = PUBLIC_PACK / "catalogue"

# DX10 sRGB formats unsupported natively by Pillow; linear counterparts decode identically
_DX10_SRGB_TO_LINEAR = {72: 71, 75: 74, 78: 77, 99: 98}


def open_dds_compat(path: Path) -> Image.Image:
    try:
        im = Image.open(path)
        im.load()
        return im
    except NotImplementedError:
        raw = bytearray(path.read_bytes())
        if len(raw) >= 148 and raw[:4] == b"DDS " and raw[84:88] == b"DX10":
            dxgi = struct.unpack_from("<I", raw, 128)[0]
            if dxgi in _DX10_SRGB_TO_LINEAR:
                struct.pack_into("<I", raw, 128, _DX10_SRGB_TO_LINEAR[dxgi])
                im = Image.open(io.BytesIO(raw))
                im.load()
                return im
        raise


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def pretty_eye_label(stem: str) -> str:
    # Eye_1_lightblue_d -> [1] Lightblue
    clean = re.sub(r"_d$", "", stem, flags=re.I)
    m = re.match(r"^Eye_(\d+)_(.+)$", clean, flags=re.I)
    if m:
        grp, rest = m.group(1), m.group(2).replace("_", " ").title()
        return f"LDD {grp} · {rest}"
    return f"LDD · {clean.replace('_', ' ').title()}"


def eye_group_number(filename: str) -> str:
    m = re.match(r"^Eye_(\d+)_", filename, flags=re.I)
    return m.group(1) if m else "1"


def export_meshes() -> list[dict[str, Any]]:
    MESH_OUT.mkdir(parents=True, exist_ok=True)
    cat_entries: list[dict[str, Any]] = []

    nif_files = sorted(MESH_SRC.glob("*.nif"))
    for nif_path in nif_files:
        stem = nif_path.stem
        if stem.lower().startswith("lens_dummy"):
            continue
        slug = slugify(stem)
        out_name = f"ldd_{slug}.json"
        out_path = MESH_OUT / out_name

        geo = nif_geometry(nif_path, frame="head", authored=True)
        payload = {
            "positions": [round(float(x), 5) for x in geo["positions"]],
            "normals": [round(float(x), 4) for x in geo["normals"]],
            "uvs": [round(float(x), 5) for x in geo["uvs"]],
            "indices": geo["indices"],
            "groups": geo.get("groups", []),
            "materials": geo.get("materials", []),
            "vertexCount": len(geo["positions"]) // 3,
            "triangleCount": len(geo["indices"]) // 3,
        }
        out_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

        # Only register selectable eyeball meshes in eyeMesh.json (keep Outer/Wetness/Shadow as auxiliary shells)
        if stem.lower().startswith("eyes_inner"):
            label = stem.replace("Eyes_Inner_", "LDD Eye ").replace("Glow", "Glow ")
            cat_entries.append({
                "id": f"eyeMesh-ldd-{slug}",
                "mod": "LDD PBR Eyes (UBE)",
                "file": nif_path.name,
                "label": label,
                "rel": f"Meshes\\LDD\\EyesUBE\\{nif_path.name}",
                "bytes": nif_path.stat().st_size,
                "mtime": int(nif_path.stat().st_mtime),
                "kind": "eyeMesh",
                "mapRole": "mesh",
                "decodable": True,
                "vertices": payload["vertexCount"],
                "triangles": payload["triangleCount"],
                "meshFrame": "head",
                "meshUrl": f"/assets/preset-pack/meshes/{out_name}",
            })
            print(f"  [mesh] {nif_path.name} -> {out_name} ({payload['vertexCount']} verts)")
        else:
            print(f"  [shell] {nif_path.name} -> {out_name} ({payload['vertexCount']} verts)")

    return cat_entries


def export_textures() -> list[dict[str, Any]]:
    TEX_OUT.mkdir(parents=True, exist_ok=True)
    THUMB_OUT.mkdir(parents=True, exist_ok=True)

    # 1. Family normals (Eye_n_1..4.dds -> eye_n_1..4.png)
    family_normals: dict[str, str] = {}
    for g in ("1", "2", "3", "4"):
        p = TEX_SRC / f"Eye_n_{g}.dds"
        if p.is_file():
            dst = TEX_OUT / f"eye_n_{g}.png"
            im = open_dds_compat(p)
            to_tangent_normal(im, 1024).save(dst, "PNG", optimize=True)
            family_normals[g] = f"/assets/preset-pack/textures/eyes/ldd/{dst.name}"
            print(f"  [normal] {p.name} -> {dst.name}")

    # 2. Family RMAOS roughness (Green channel of Eye_rmaos_1..4.dds -> eye_rough_1..4.webp)
    family_rough: dict[str, str] = {}
    for g in ("1", "2", "3", "4"):
        p = TEX_SRC / f"Eye_rmaos_{g}.dds"
        if p.is_file():
            dst = TEX_OUT / f"eye_rough_{g}.webp"
            im = open_dds_compat(p).convert("RGBA")
            _, green, _, _ = im.split()
            rough_rgb = Image.merge("RGB", (green, green, green)).resize((512, 512), Image.LANCZOS)
            rough_rgb.save(dst, "WEBP", quality=88)
            family_rough[g] = f"/assets/preset-pack/textures/eyes/ldd/{dst.name}"
            print(f"  [rough]  {p.name} -> {dst.name}")

    # 3. Auxiliary Wetness / Shadow shells
    wet_d = TEX_SRC / "Wetness_d.dds"
    if wet_d.is_file():
        im = open_dds_compat(wet_d).convert("RGBA").resize((512, 512), Image.LANCZOS)
        im.save(TEX_OUT / "wetness_d.webp", "WEBP", quality=90)
    wet_n = TEX_SRC / "Wetness_n.dds"
    if wet_n.is_file():
        im = open_dds_compat(wet_n)
        to_tangent_normal(im, 512).save(TEX_OUT / "wetness_n.png", "PNG", optimize=True)
    shd_d = TEX_SRC / "Shadow_d.dds"
    if shd_d.is_file():
        im = open_dds_compat(shd_d).convert("RGBA").resize((512, 512), Image.LANCZOS)
        im.save(TEX_OUT / "shadow_d.webp", "WEBP", quality=90)

    # 4. Glow masks (*_g.dds)
    glow_urls: dict[str, str] = {}
    for g_path in sorted(TEX_SRC.glob("*_g.dds")):
        g_slug = slugify(g_path.stem)
        dst = TEX_OUT / f"{g_slug}.webp"
        try:
            im = open_dds_compat(g_path).convert("RGB").resize((512, 512), Image.LANCZOS)
            im.save(dst, "WEBP", quality=88)
            glow_urls[g_path.stem.lower()] = f"/assets/preset-pack/textures/eyes/ldd/{dst.name}"
        except Exception as exc:
            print(f"  [warn] glow {g_path.name}: {exc}")

    # 5. All 123 Eye_*_d.dds iris diffuses
    diffuse_files = sorted(
        p for p in TEX_SRC.glob("Eye_*_d.dds")
        if p.name.lower() != "eye_o_d.dds"
    )
    cat_entries: list[dict[str, Any]] = []
    for idx, d_path in enumerate(diffuse_files, 1):
        stem = d_path.stem
        slug = slugify(stem)
        grp = eye_group_number(d_path.name)
        tex_dst = TEX_OUT / f"{slug}.webp"
        thumb_dst = THUMB_OUT / f"{slug}.webp"

        im = open_dds_compat(d_path).convert("RGBA")
        iris_info = measure_eye_atlas(im)
        im_1024 = im.resize((1024, 1024), Image.LANCZOS)
        im_1024.save(tex_dst, "WEBP", quality=90, method=4)

        # Thumbnail cropped around measured iris when valid, otherwise centered square
        w, h = im.size
        cx = float(iris_info.get("atlas", {}).get("cx", 0.5)) * w
        cy = float(iris_info.get("atlas", {}).get("cy", 0.5)) * h
        r = max(float(iris_info.get("atlas", {}).get("r", 0.14)) * w * 1.45, w * 0.16)
        box = (
            max(0, int(cx - r)),
            max(0, int(cy - r)),
            min(w, int(cx + r)),
            min(h, int(cy + r)),
        )
        crop = im.crop(box) if (box[2] - box[0] > 16 and box[3] - box[1] > 16) else im
        crop.resize((128, 128), Image.LANCZOS).save(thumb_dst, "WEBP", quality=85)

        entry: dict[str, Any] = {
            "id": f"eyes-ldd-{slug}",
            "mod": "LDD PBR Eyes (UBE)",
            "file": d_path.name,
            "label": pretty_eye_label(stem),
            "rel": f"Textures\\PBR\\LDD\\EyesUBE\\{d_path.name}",
            "bytes": d_path.stat().st_size,
            "mtime": int(d_path.stat().st_mtime),
            "kind": "eyes",
            "mapRole": "albedo",
            "available": True,
            "size": [1024, 1024],
            "texture": f"/assets/preset-pack/textures/eyes/ldd/{tex_dst.name}",
            "thumbnailUrl": f"/assets/preset-pack/textures/eyes/ldd/thumbs/{thumb_dst.name}",
            "eyeMeshId": f"eyeMesh-ldd-eyes_inner_{grp}",
            "iris": iris_info.get("iris", "#755a50"),
            "mean": iris_info.get("mean", "#7e6b62"),
            "atlas": iris_info.get("atlas", {"cx": 0.5, "cy": 0.5, "r": 0.136, "measured": False}),
        }
        if grp in family_normals:
            entry["normalTexture"] = family_normals[grp]
        if grp in family_rough:
            entry["roughnessTexture"] = family_rough[grp]

        # Match optional glow mask (e.g., Eye_1_demonblue_d -> eye_1_blue_g)
        base_g_key = re.sub(r"_d$", "_g", stem.lower())
        if base_g_key in glow_urls:
            entry["emissiveTexture"] = glow_urls[base_g_key]

        cat_entries.append(entry)
        if idx % 25 == 0 or idx == len(diffuse_files):
            print(f"  [iris] {idx}/{len(diffuse_files)} transcoded ({d_path.name})")

    return cat_entries


def merge_catalogue(cat_path: Path, prefix: str, new_entries: list[dict[str, Any]]) -> None:
    existing = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.is_file() else []
    kept = [e for e in existing if not str(e.get("id", "")).startswith(prefix)]
    merged = kept + new_entries
    cat_path.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    print(f"[+] Updated {cat_path.name}: {len(kept)} existing + {len(new_entries)} LDD = {len(merged)} total")


def main() -> int:
    if not MOD_DIR.is_dir():
        print(f"[!] LDD Eyes mod not found at: {MOD_DIR}", file=sys.stderr)
        return 1
    print("=== Syncing LDD - PBR Eyes for (UBE) 4K ===")
    mesh_entries = export_meshes()
    eye_entries = export_textures()
    merge_catalogue(CAT_DIR / "eyeMesh.json", "eyeMesh-ldd-", mesh_entries)
    merge_catalogue(CAT_DIR / "eyes.json", "eyes-ldd-", eye_entries)
    print("[OK] LDD PBR Eyes sync complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
