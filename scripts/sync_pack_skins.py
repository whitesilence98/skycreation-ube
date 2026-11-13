#!/usr/bin/env python
"""Transcode all available UBE skin mods from MO2 into web-optimized pack textures.

Reads from D:\\Games\\Skyrim\\MO2_Archive\\mods and outputs to public/assets/preset-pack/
for each skin mod:
  - Head diffuse (2048 WebP)
  - Head normal (1024 PNG)
  - Head gloss/roughness mask (1024 lossless WebP)
  - Body diffuse (2048 WebP, covering body, hands, and feet)
  - Body normal (1024 PNG)
  - Body gloss/roughness mask (1024 lossless WebP)
  - Updates manifest.json and catalogue/skin.json
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from PIL import Image

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from sync_mo2_assets import (
    analyze_skin,
    gloss_mask_from_normal,
    open_dds,
    to_srgb_rgb,
    to_tangent_normal,
)

ROOT = SCRIPTS.parent
PUBLIC = ROOT / "public" / "assets" / "preset-pack"
MODS_DIR = Path(r"D:\Games\Skyrim\MO2_Archive\mods")

SKIN_MOD_SPECS = [
    {
        "id": "skin-diamond-ube",
        "slug": "diamond",
        "label": "Diamond Skin (UBE)",
        "mod": "Diamond Skin UBE - No Armpit Creases",
        "head_d": r"textures\!UBE\head\femalehead_d.dds",
        "head_n": r"textures\!UBE\head\femalehead_n.dds",
        "body_d": r"textures\!UBE\body\femalebody_1_d.dds",
        "body_n": r"textures\!UBE\body\femalebody_1_n.dds",
    },
    {
        "id": "skin-zhizhen-ube",
        "slug": "zhizhen",
        "label": "Zhizhen 8K Skin (UBE)",
        "mod": "Zhizhen's Female Skin 8K UBE",
        "head_d": r"textures\!UBE\Head\femaleHead_d.dds",
        "head_n": r"textures\!UBE\Head\femalehead_n.dds",
        "body_d": r"textures\!UBE\Body\femalebody_1_d.dds",
        "body_n": r"textures\!UBE\Body\femalebody_1_n.dds",
    },
    {
        "id": "skin-sayble-ube",
        "slug": "sayble",
        "label": "Sayble Skin (UBE 2.0)",
        "mod": "Sayble Skin for UBE 2.0",
        "head_d": r"textures\!UBE\Head\femaleHead_d.dds",
        "head_n": r"textures\!UBE\Head\femaleHead_n.dds",
        "body_d": r"textures\!UBE\Body\femalebody_1_d.dds",
        "body_n": r"textures\!UBE\Body\femalebody_1_n.dds",
    },
    {
        "id": "skin-dragokini-ube",
        "slug": "dragokini",
        "label": "Dragokini Skin (UBE)",
        "mod": "Dragokini Skin",
        "head_d": r"textures\!UBE\Head\femaleHead_d.dds",
        "head_n": r"textures\!UBE\Head\femaleHead_n.dds",
        "body_d": r"textures\!UBE\Body\femalebody_1_d.dds",
        "body_n": r"textures\!UBE\Body\femalebody_1_n.dds",
    },
    {
        "id": "skin-dragokini-scaleless",
        "slug": "dragokini_scaleless",
        "label": "Dragokini Scaleless (UBE)",
        "mod": "Dragokini Skin - Scaleless Belly",
        "head_mod": "Dragokini Skin",
        "head_d": r"textures\!UBE\Head\femaleHead_d.dds",
        "head_n": r"textures\!UBE\Head\femaleHead_n.dds",
        "body_d": r"textures\!UBE\Body\femalebody_1_d.dds",
        "body_n": r"textures\!UBE\Body\femalebody_1_n.dds",
    },
    {
        "id": "skin-imperfect-ube",
        "slug": "imperfect",
        "label": "Imperfect Skin (UBE)",
        "mod": "Imperfect Skin - UBE",
        "head_d": r"textures\!UBE\Head\femaleHead_d.dds",
        "head_n_mod": "UBE 2.0 U0.7",
        "head_n": r"textures\!UBE\Head\femalehead_n.dds",
        "body_d": r"textures\!UBE\Body\femalebody_1_d.dds",
        "body_n_mod": "UBE 2.0 U0.7",
        "body_n": r"textures\!UBE\Body\femalebody_1_n.dds",
    },
    {
        "id": "skin-ube-base",
        "slug": "ube_base",
        "label": "UBE 2.0 Standard",
        "mod": "UBE 2.0 U0.7",
        "head_d": r"textures\!UBE\Head\femaleHead_d.dds",
        "head_n": r"textures\!UBE\Head\femalehead_n.dds",
        "body_d": r"textures\!UBE\Body\femalebody_1_d.dds",
        "body_n": r"textures\!UBE\Body\femalebody_1_n.dds",
    },
]


def resolve_path(mod: str, rel: str) -> Path | None:
    p = MODS_DIR / mod / rel
    if p.is_file():
        return p
    # Case insensitive search in parent
    parent = (MODS_DIR / mod / rel).parent
    if parent.is_dir():
        want = Path(rel).name.lower()
        for c in parent.iterdir():
            if c.is_file() and c.name.lower() == want:
                return c
    return None


def transcode_skin_set(spec: dict[str, Any]) -> dict[str, Any] | None:
    slug = spec["slug"]
    mod_name = spec["mod"]
    print(f"\n[>] Processing skin: {spec['label']} ({mod_name})")

    head_mod = spec.get("head_mod", mod_name)
    head_d_path = resolve_path(head_mod, spec["head_d"])
    if not head_d_path:
        print(f"  [!] Missing head diffuse: {head_mod}\\{spec['head_d']}")
        return None

    head_n_mod = spec.get("head_n_mod", head_mod)
    head_n_path = resolve_path(head_n_mod, spec["head_n"]) if spec.get("head_n") else None

    body_d_path = resolve_path(mod_name, spec["body_d"])
    if not body_d_path:
        print(f"  [!] Missing body diffuse: {mod_name}\\{spec['body_d']}")
        return None

    body_n_mod = spec.get("body_n_mod", mod_name)
    body_n_path = resolve_path(body_n_mod, spec["body_n"]) if spec.get("body_n") else None

    skin_dir = PUBLIC / "textures" / "skin"
    body_dir = PUBLIC / "textures" / "body"
    skin_dir.mkdir(parents=True, exist_ok=True)
    body_dir.mkdir(parents=True, exist_ok=True)

    # 1. Head Diffuse (2048 WebP)
    head_dst = skin_dir / f"{slug}_head.webp"
    im_head = open_dds(head_d_path)
    palette = analyze_skin(im_head)
    head_sq = to_srgb_rgb(im_head)
    if head_sq.width != head_sq.height:
        s = min(head_sq.size)
        head_sq = head_sq.crop((
            (head_sq.width - s) // 2, (head_sq.height - s) // 2,
            (head_sq.width + s) // 2, (head_sq.height + s) // 2,
        ))
    head_sq = head_sq.resize((2048, 2048), Image.LANCZOS)
    head_sq.save(head_dst, "WEBP", quality=92, method=6)
    print(f"  [+] Head diffuse: {head_dst.name} ({head_dst.stat().st_size // 1024} KB)")

    # 2. Head Normal & Roughness Mask
    head_normal_url = None
    head_rough_url = None
    if head_n_path:
        head_n_dst = skin_dir / f"{slug}_head_n.png"
        head_im_n = open_dds(head_n_path)
        head_n_img = to_tangent_normal(head_im_n, 1024)
        head_n_img.save(head_n_dst, "PNG", optimize=True)
        head_normal_url = f"/assets/preset-pack/textures/skin/{slug}_head_n.png"

        head_rough_dst = skin_dir / f"{slug}_head_rough.webp"
        head_mask = gloss_mask_from_normal(head_im_n, 1024)
        if head_mask is not None:
            head_mask.save(head_rough_dst, "WEBP", lossless=True, method=4)
            head_rough_url = f"/assets/preset-pack/textures/skin/{slug}_head_rough.webp"
            print(f"  [+] Head rough mask: {head_rough_dst.name}")

    # 3. Body Diffuse (2048 WebP)
    body_dst = body_dir / f"{slug}_body.webp"
    im_body = open_dds(body_d_path)
    body_sq = to_srgb_rgb(im_body)
    if body_sq.width != body_sq.height:
        s = min(body_sq.size)
        body_sq = body_sq.crop((
            (body_sq.width - s) // 2, (body_sq.height - s) // 2,
            (body_sq.width + s) // 2, (body_sq.height + s) // 2,
        ))
    body_sq = body_sq.resize((2048, 2048), Image.LANCZOS)
    body_sq.save(body_dst, "WEBP", quality=92, method=6)
    print(f"  [+] Body diffuse: {body_dst.name} ({body_dst.stat().st_size // 1024} KB)")

    # 4. Body Normal & Roughness Mask
    body_normal_url = None
    body_rough_url = None
    if body_n_path:
        body_n_dst = body_dir / f"{slug}_body_n.png"
        body_im_n = open_dds(body_n_path)
        body_n_img = to_tangent_normal(body_im_n, 1024)
        body_n_img.save(body_n_dst, "PNG", optimize=True)
        body_normal_url = f"/assets/preset-pack/textures/body/{slug}_body_n.png"

        body_rough_dst = body_dir / f"{slug}_body_rough.webp"
        body_mask = gloss_mask_from_normal(body_im_n, 1024)
        if body_mask is not None:
            body_mask.save(body_rough_dst, "WEBP", lossless=True, method=4)
            body_rough_url = f"/assets/preset-pack/textures/body/{slug}_body_rough.webp"
            print(f"  [+] Body rough mask: {body_rough_dst.name}")

    # If diamond, also update default head.webp and body.webp aliases
    if slug == "diamond":
        head_sq.save(skin_dir / "head.webp", "WEBP", quality=92, method=6)
        body_sq.save(body_dir / "body.webp", "WEBP", quality=92, method=6)
        if head_normal_url:
            head_n_img.save(skin_dir / "head_n.png", "PNG", optimize=True)
        if head_rough_url and head_mask is not None:
            head_mask.save(skin_dir / "head_rough.webp", "WEBP", lossless=True, method=4)
        if body_normal_url:
            body_n_img.save(body_dir / "body_n.png", "PNG", optimize=True)
        if body_rough_url and body_mask is not None:
            body_mask.save(body_dir / "body_rough.webp", "WEBP", lossless=True, method=4)

    return {
        "id": spec["id"],
        "mod": mod_name,
        "file": head_d_path.name,
        "label": spec["label"],
        "rel": f"{mod_name}\\{spec['head_d']}",
        "texture": f"/assets/preset-pack/textures/skin/{slug}_head.webp",
        "normalTexture": head_normal_url,
        "roughnessTexture": head_rough_url,
        "bodyTexture": f"/assets/preset-pack/textures/body/{slug}_body.webp",
        "bodyNormalTexture": body_normal_url,
        "bodyRoughnessTexture": body_rough_url,
        "size": list(im_head.size),
        "palette": palette,
        "available": True,
        "mapRole": "albedo",
    }


def main():
    print("=== Transcoding UBE Skin Mods for Preset Pack ===")
    results = []
    for spec in SKIN_MOD_SPECS:
        res = transcode_skin_set(spec)
        if res:
            results.append(res)

    print(f"\n[OK] Successfully transcoded {len(results)} skin sets.")

    # 1. Update manifest.json
    manifest_path = PUBLIC / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.setdefault("assets", {})["skin"] = results
        # Build paired body list
        body_list = []
        for r in results:
            body_list.append({
                "id": r["id"].replace("skin-", "body-"),
                "mod": r["mod"],
                "file": "femalebody_1_d.dds",
                "label": r["label"].replace("Skin", "Body"),
                "rel": r["rel"].replace(r"\Head\femaleHead_d.dds", r"\Body\femalebody_1_d.dds")
                             .replace(r"\head\femalehead_d.dds", r"\body\femalebody_1_d.dds"),
                "texture": r["bodyTexture"],
                "normalTexture": r["bodyNormalTexture"],
                "roughnessTexture": r["bodyRoughnessTexture"],
                "size": [8192, 8192],
                "available": True,
                "mapRole": "albedo",
            })
        manifest["assets"]["body"] = body_list
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("[+] Updated manifest.json assets.skin and assets.body")


if __name__ == "__main__":
    main()
