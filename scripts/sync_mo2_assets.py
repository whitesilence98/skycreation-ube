#!/usr/bin/env python
"""
MO2 → web asset bridge for the character-creation HUD.

Reads the Skyrim Special Edition mod archive (default
``D:\\Games\\Skyrim\\MO2_Archive\\mods``) and produces everything the web app
needs from the *real* assets:

  public/assets/mo2/skin/<id>.webp     head diffuses, converted from .dds
  public/assets/mo2/eyes/<id>.webp     iris atlases, converted from .dds
  public/assets/mo2/hair/<id>.webp     hair diffuses, converted from .dds
  public/assets/mo2/manifest.json      one option per category, plus palette,
                                       blemishes, RaceMenu morphs, bone names

Every candidate that exists on disk becomes a selectable option in the HUD's
asset panel; the first of each category is also flattened into the single-value
fields (`textures.skin`, `mods.skin`, …) as the default. Nothing is copied
wholesale — the archive is ~81 GB, so only the textures the viewport can wear
are transcoded, and a `webp` newer than its source is left alone on re-runs.

Usage:
    python scripts/sync_mo2_assets.py
    python scripts/sync_mo2_assets.py --mods "D:/Games/Skyrim/MO2_Archive/mods" --out public/assets/mo2
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import struct
import sys
from pathlib import Path
from typing import Any

# Windows consoles default to cp1252 and explode on the arrows/box glyphs below.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install pillow")

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("numpy is required:  pip install numpy")


# ── candidate sources ───────────────────────────────────────────────────────
#
# Each list is ordered: the first entry that exists is the default, and every
# entry that exists becomes an option the asset panel can switch to.
#
# The skins are all providers of the *same* canonical diffuse,
# `textures\!UBE\Head\femaleHead_d.dds` — only the mod that wins that path
# differs. They have to stay in this family: ATLAS_FIT in
# lib/head/faceTexture.ts is a least-squares fit to that UV layout, so a Fair
# Skin / CBBE head map would project its eyes and mouth onto the wrong part of
# the mesh.
SKIN_CANDIDATES = [
    (r"UBE 2.0 U0.7", r"textures\!UBE\Head\femaleHead_d.dds"),
    (r"Sayble Skin for UBE 2.0", r"textures\!UBE\Head\femaleHead_d.dds"),
    (r"Zhizhen's Female Skin 8K UBE", r"textures\!UBE\Head\femaleHead_d.dds"),
    (r"Imperfect Skin - UBE", r"textures\!UBE\Head\femaleHead_d.dds"),
    (r"Diamond Skin UBE - No Armpit Creases", r"textures\!UBE\head\femalehead_d.dds"),
    (r"Dragokini Skin", r"textures\!UBE\Head\femaleHead_d.dds"),
]
# One or two representatives per family. These atlases do *not* share a UV
# layout — COR's eyeball island starts ~6 % lower than Zhizhen's — which is why
# measure_eye_atlas() runs per texture instead of reusing one constant.
#
# UBE's eye atlas leads; other families remain selectable.
EYE_CANDIDATES = [
    # UBE is the default wherever it ships, so its own eye atlas leads.
    (r"UBE 2.0 U0.7", r"textures\!COR\Eyes_ILV\eye01.dds", "UBE Eye 01"),
    (r"Koralina's Mystic Eyes", r"Textures\Koralina\Eyes\01_Green.dds", "Mystic Green"),
    (r"Koralina's Mystic Eyes", r"Textures\Koralina\Eyes\02_Blue.dds", "Mystic Blue"),
    (r"Zhizhen Eyes", r"textures\actors\character\ddseyes\ZhizhenEyes1.dds", "Zhizhen 1"),
    (r"Zhizhen Eyes", r"textures\actors\character\ddseyes\ZhizhenEyes20.dds", "Zhizhen 20"),
    (r"Even More Eyes by Koralina", r"textures\Koralina\Eyes\albino\Blind Albino.dds", "Blind Albino"),
    (r"COR MAIN - CBBE SE", r"Textures\!COR\Eyes\EyesBlue.dds", "COR Blue"),
]
# HG Hairdos names its textures by style, so these are picked by hand. The
# hair cards sample five fixed UV windows (see HAIR_WINDOWS below); an atlas
# that is blank there renders as a white sheet, which is what `usable` records.
HAIR_CANDIDATES = [
    (r"HG Hairdos 2", r"textures\4uplod-T\90sBebe.dds", "90sBebe"),
    (r"HG Hairdos 2", r"textures\4uplod-T\Kiki.dds", "Kiki"),
    (r"HG Hairdos 2", r"textures\4uplod-T\Ash.dds", "Ash"),
    (r"HG Hairdos 2", r"textures\4uplod-T\Regina.dds", "Regina"),
    (r"HG Hairdos 2", r"textures\4uplod-T\Seraph.dds", "Seraph"),
    (r"HG Hairdos 2", r"textures\4uplod-T\Emmy.dds", "Emmy"),
    (r"HG Hairdos 2", r"textures\4uplod-T\2\x\Cicada.dds", "Cicada"),
]
HEAD_MESH_CANDIDATES = [
    # UBE is the default head: it is the base every UBE preset was sculpted on,
    # and the user asked for UBE mesh + texture defaults. COR stays second.
    (r"UBE 2.0 U0.7", r"meshes\!UBE\Head\FemaleHead_tangent.nif", "UBE FemaleHead tangent"),
    (r"COR MAIN - CBBE SE", r"Meshes\!COR\Head\FemaleHead.nif", "COR FemaleHead"),
    # RaceMenu's own face exports. CharGen drops one <name>.nif beside each
    # <name>.jslot: a skinned BSFadeNode carrying NPC Head [Head], the
    # BSFaceGenNiNodeSkinned and a BSDynamicTriShape, i.e. the sculpted head
    # itself rather than a shared base mesh. Same block family as the two
    # above, so they are reported the same way — the value here is that the
    # picker can name the head that a chosen preset was exported with, which
    # the two shared base meshes cannot tell you.
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Frau.nif", "Frau head"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Iced Coffee.nif", "Iced Coffee head"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Jianmo.nif", "Jianmo head"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Nini.nif", "Nini head"),
]
# Which option a freshly opened app wears, per category. The candidate lists
# above decide the order the picker *shows*; this decides the default. It is
# applied after the options are built, because ids carry the candidate index
# (`imperfect-skin-ube-3`): promoting a skin by moving it up a list would
# rename every prebake under `public/assets/mo2/` and orphan the old files.
#
# Head and body both default to Imperfect Skin - UBE.
PREFERRED_DEFAULT = {
    "skin": r"Imperfect Skin - UBE",
    "body": r"Imperfect Skin - UBE",
}

# Imperfect Skin ships only the diffuse. `!UBE\Head\femalehead_n.dds` is
# authored for the exact UV layout every SKIN_CANDIDATES entry provides, so the
# promoted default borrows that relief rather than dropping to the Sobel
# fallback in lib/head/faceTexture.ts — the albedo is what the user picked, the
# normal is shared geometry detail.
SKIN_NORMAL_FALLBACK = "/assets/mo2/skin/ube-2-0-u0-7-0-n.png"

SKELETON_CANDIDATES = [
    (r"XP32 Maximum Skeleton Special Extended",
     r"meshes\actors\character\character assets female\skeleton_female.nif", "XP32 female"),
    (r"XP32 Maximum Skeleton Special Extended",
     r"meshes\actors\character\character assets\skeleton.nif", "XP32"),
]
PRESET_CANDIDATES = [
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\Frau.jslot", "Frau"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\Frau (Old Preset).jslot", "Frau (old)"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\Frau Indoor.jslot", "Frau Indoor"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\Ice Coffee LanXin.jslot", "Ice Coffee LanXin"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\LanXin-UBE.jslot", "LanXin UBE"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\[3BA] Nini.jslot", "Nini"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\Ice Coffee White.jslot", "Ice Coffee White"),
    (r"All My UBE Preset", r"SKSE\Plugins\CharGen\Presets\Iced Coffee.jslot", "Iced Coffee"),
    (r"Zhizhen2023 RaceManu preset", r"SKSE\Plugins\CharGen\Presets\zhizhen-2023.jslot", "Zhizhen 2023"),
]

# The five UV windows the hair cards sample, in atlas UV. Mirrored from
# lib/head/hair.ts CARDS (u0/u1/v0/v1). A candidate whose mean luminance in
# these windows is near white would paint as an opaque cream sheet.
HAIR_WINDOWS = [
    (0.530, 0.617, 0.60, 0.87),
    (0.632, 0.733, 0.60, 0.87),
    (0.741, 0.833, 0.60, 0.87),
    (0.392, 0.420, 0.08, 0.52),
    (0.455, 0.477, 0.60, 0.87),
]


def candidates(root: Path, entries: list[tuple[str, str]] | list[tuple[str, str, str]]):
    """Existing (path, rel, mod[, label]) tuples, in list order."""
    out = []
    for entry in entries:
        mod, rel = entry[0], entry[1]
        p = root / mod / rel
        if p.is_file():
            out.append((p, rel, mod) + tuple(entry[2:]))
    return out


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "asset"


def promote(rows: list[dict[str, Any]], mod: str | None) -> list[dict[str, Any]]:
    """Move the row whose `mod` matches to the front, keeping the rest in order.

    Defaults are read off `[0]` throughout the app and this script, but the
    candidate lists order by *pick quality*, and several ids are derived from
    a candidate's index (`imperfect-skin-ube-3`). Reordering the candidate
    list would therefore rename every prebake; moving the built row does not
    touch its id, texture or palette. A `mod` that matches nothing leaves the
    list alone, so an archive without that mod still syncs.
    """
    if not mod:
        return rows
    want = mod.casefold()
    for i, row in enumerate(rows):
        if str(row.get("mod", "")).casefold() == want:
            return [row, *rows[:i], *rows[i + 1:]]
    return rows


# This script's own mtime, so a change to how an asset is transcoded
# invalidates the cached outputs it produced.
SELF_MTIME = Path(__file__).stat().st_mtime


def is_fresh(src: Path, dst: Path) -> bool:
    """True when `dst` is newer than both the source and this script.

    The script term matters: changing how hair is transcoded (shipping its
    alpha, say) leaves every existing output *newer than the DDS*, so a check
    against the source alone would keep serving files encoded the old way
    until the user's mods happened to update.
    """
    try:
        out = dst.stat().st_mtime
        return dst.is_file() and out >= src.stat().st_mtime and out >= SELF_MTIME
    except OSError:
        return False


def open_dds(path: Path) -> Image.Image:
    """Decode a DDS (BC1/BC3/BC5/BC7 all supported by Pillow's DDS plugin)."""
    im = Image.open(path)
    im.load()
    return im


def to_srgb_rgb(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (18, 14, 11, 255))
        im = Image.alpha_composite(bg, im)
    return im.convert("RGB")


def normal_map_beside(diffuse: Path) -> Path | None:
    """The `*_n.dds` tangent-space normal that ships beside a head diffuse.

    Case varies by mod (`femaleHead_n.dds` vs `femalehead_n.dds`) and Windows
    is case-insensitive, but this has to work when the archive is mounted
    case-sensitively too, so the directory is globbed and matched by lowercased
    name rather than by constructing the path.
    """
    want = diffuse.name.lower().replace("_d.dds", "_n.dds")
    try:
        for p in diffuse.parent.iterdir():
            if p.is_file() and p.name.lower() == want:
                return p
    except OSError:
        return None
    return None


def to_tangent_normal(im: Image.Image, size: int) -> Image.Image:
    """Lossless RGB normal map, *not* passed through `to_srgb_rgb`.

    A normal map is a vector field, not a colour: compositing it against the
    dark background (as `to_srgb_rgb` does for skin) and converting to sRGB
    would both corrupt the vectors, and lossy WebP would add faceting under a
    specular light. So: straight RGB passthrough, RGB not RGBA (BC5 decodes
    with a synthetic blue in some readers), Lanczos resize, and the caller
    saves it as PNG.
    """
    rgb = im.convert("RGB")
    if rgb.size != (size, size):
        rgb = rgb.resize((size, size), Image.LANCZOS)
    return rgb


def hair_rgba(im: Image.Image) -> tuple[Image.Image, bool]:
    """Straight RGBA plus whether the source really carries transparency.

    Hair atlases are DXT3, which always has a 4-bit alpha channel, and that
    alpha — not the luminance — is what shapes the cards in game. Compositing
    it away (which `to_srgb_rgb` does, correctly, for skin) turned every
    option into a full-bleed sheet: `Emmy` rendered as a cream slab because
    its alpha never reached the browser. Keep it, and report whether it is
    anything more than opaque so the client knows which path to take.
    """
    rgba = im.convert("RGBA")
    a = np.asarray(rgba.getchannel("A"))
    return rgba, bool(a.min() < 250)


def analyze_skin(im: Image.Image) -> dict[str, Any]:
    """Extract palette, lip colour and freckle/blemish anchors from the diffuse."""
    w, h = im.size
    small = im.resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32)

    # face occupies the middle of a Skyrim head map
    fy0, fy1 = int(h * 0.0) or 0, 1024
    fx0, fx1 = 280, 760
    face = a[int(1024 * 0.22) : int(1024 * 0.68), fx0:fx1]

    lum = face.mean(axis=2)
    # ignore the black surround of the UV shells
    mask = lum > 38
    pix = face[mask] if mask.any() else face.reshape(-1, 3)

    mean = pix.mean(axis=0)
    p10 = np.percentile(pix, 12, axis=0)
    p90 = np.percentile(pix, 88, axis=0)
    p50 = np.percentile(pix, 50, axis=0)

    # lips: warm/red-biased band around the mouth of the projected face
    ly0, ly1 = int(1024 * 0.53), int(1024 * 0.62)
    lx0, lx1 = int(1024 * 0.44), int(1024 * 0.56)
    lipbox = a[ly0:ly1, lx0:lx1]
    ll = lipbox.reshape(-1, 3)
    redness = ll[:, 0] - (ll[:, 1] + ll[:, 2]) / 2
    lip_mask = redness > np.percentile(redness, 68)
    lips = ll[lip_mask].mean(axis=0) if lip_mask.any() else np.array([150, 92, 88])

    # blemishes: local darkening vs a blurred reference, non-max suppressed
    blurred = np.asarray(
        small.filter(ImageFilter.GaussianBlur(radius=9))
    ).astype(np.float32)
    diff = blurred.mean(axis=2) - a.mean(axis=2)
    diff[: int(1024 * 0.18)] = 0
    diff[int(1024 * 0.7) :] = 0
    diff[:, :fx0 + 40] = 0
    diff[:, fx1 - 40 :] = 0
    diff[a.mean(axis=2) < 45] = 0

    flat = diff.ravel()
    order = np.argsort(flat)[::-1]
    picked: list[tuple[int, int, float]] = []
    taken = np.zeros_like(diff, dtype=bool)
    for idx in order[:14000]:
        y, x = divmod(int(idx), 1024)
        v = float(flat[idx])
        if v <= 3.5 or len(picked) >= 260:
            break
        y0s, y1s = max(0, y - 5), min(1024, y + 6)
        x0s, x1s = max(0, x - 5), min(1024, x + 6)
        if taken[y0s:y1s, x0s:x1s].any():
            continue
        taken[y0s:y1s, x0s:x1s] = True
        picked.append((x, y, v))

    blemishes = [
        {"x": round(x / 1023, 4), "y": round(y / 1023, 4), "a": round(min(1.0, v / 26.0), 3)}
        for x, y, v in picked
    ]

    def hexrgb(v: np.ndarray) -> str:
        r, g, b = [int(max(0, min(255, round(c)))) for c in v[:3]]
        return f"#{r:02x}{g:02x}{b:02x}"

    return {
        "mean": hexrgb(mean),
        "shadow": hexrgb(p10),
        "mid": hexrgb(p50),
        "highlight": hexrgb(p90),
        "lip": hexrgb(lips),
        "blemishes": blemishes,
        "blemishCount": len(blemishes),
        "faceBox": {"x0": fx0 / 1024, "x1": fx1 / 1024, "y0": fy0 / 1024, "y1": fy1 / 1024},
    }


def analyze_eye(im: Image.Image) -> dict[str, Any]:
    small = to_srgb_rgb(im).resize((512, 512), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32)
    lum = a.mean(axis=2)
    mask = (lum > 26) & (lum < 235)
    pix = a[mask] if mask.any() else a.reshape(-1, 3)
    mx = pix.max(axis=1)
    mn = pix.min(axis=1)
    sat = (mx - mn) / np.maximum(1.0, mx)
    vivid = pix[sat > np.percentile(sat, 80)]
    iris = vivid.mean(axis=0) if vivid.size else pix.mean(axis=0)

    def hexrgb(v: np.ndarray) -> str:
        r, g, b = [int(max(0, min(255, round(c)))) for c in v[:3]]
        return f"#{r:02x}{g:02x}{b:02x}"

    return {"iris": hexrgb(iris), "mean": hexrgb(pix.mean(axis=0))}


def measure_eye_atlas(im: Image.Image) -> dict[str, Any]:
    """Where the eyeball island sits in this atlas, in UV.

    `paintFaceFeatures` blits a square crop around the iris into the painted
    eye aperture, so it needs the island's centre and the iris radius. Both
    move between mods: every atlas here keeps the eye in the lower half, but
    COR's island starts at v ≈ .48 while Zhizhen's and Koralina's start at
    .42. Measuring beats hard-coding one mod's numbers for all of them.

    The radius comes from a radial luminance profile — the iris and pupil are
    darker than the sclera, so the largest radius whose ring is mostly dark is
    the iris edge. Zhizhen measures .158 and COR .165, against the .126 that
    was previously hard-coded.
    """
    rgb = to_srgb_rgb(im)
    a = np.asarray(rgb).astype(np.float32)
    h, w = a.shape[:2]
    lum = a.mean(axis=2)

    # Island mask: alpha when the atlas has a real one (most eye mods do),
    # luminance otherwise. Below 42 % is lash strips and empty space.
    arr = np.asarray(im)
    if arr.ndim == 3 and arr.shape[2] == 4 and arr[:, :, 3].min() < 200:
        mask = arr[:, :, 3] > 110
    else:
        mask = lum > 22
    mask = mask.copy()
    mask[: int(h * 0.42), :] = False

    ys, xs = np.nonzero(mask)
    if xs.size < 1000:
        return {"cx": 0.497, "cy": 0.754, "r": 0.126, "measured": False}
    cx = float(xs.mean()) / w
    cy = float(ys.mean()) / h

    sclera = float(np.percentile(lum[mask], 78))
    px, py = cx * w, cy * h
    theta = np.linspace(0, 2 * np.pi, 180, endpoint=False)
    radius = 0.0
    for step in range(20, 220):
        rr = step / 1000.0 * w
        sx = (px + rr * np.cos(theta)).astype(int)
        sy = (py + rr * np.sin(theta)).astype(int)
        ok = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
        if ok.sum() < 90:
            break
        if float((lum[sy[ok], sx[ok]] < 0.72 * sclera).mean()) >= 0.70:
            radius = step / 1000.0

    plausible = 0.06 <= radius <= 0.20 and 0.3 <= cx <= 0.7 and 0.5 <= cy <= 0.9
    if not plausible:
        return {"cx": 0.497, "cy": 0.754, "r": 0.126, "measured": False}
    return {"cx": round(cx, 4), "cy": round(cy, 4), "r": round(radius, 4), "measured": True}


# The three authoring groups the hair cards fall into, and the rect each was
# measured inside on 90sBebe. A card is re-mapped by scaling its *offset inside
# its group* into whatever block that group picked on this atlas.
HAIR_GROUPS = {
    "curtain": {
        "env": (0.530, 0.833, 0.60, 0.87),
        "cards": [
            (0.530, 0.617, 0.60, 0.87),
            (0.632, 0.733, 0.60, 0.87),
            (0.741, 0.833, 0.60, 0.87),
        ],
    },
    "fringe": {
        "env": (0.264, 0.288, 0.08, 0.52),
        "cards": [
            (0.264, 0.281, 0.09, 0.50),
            (0.267, 0.284, 0.08, 0.52),
            (0.270, 0.287, 0.10, 0.48),
            (0.273, 0.288, 0.08, 0.51),
            (0.264, 0.280, 0.12, 0.46),
            (0.266, 0.282, 0.12, 0.46),
            (0.271, 0.288, 0.08, 0.51),
            (0.268, 0.285, 0.10, 0.48),
            (0.265, 0.282, 0.08, 0.52),
        ],
    },
    "wisp": {
        "env": (0.455, 0.477, 0.60, 0.87),
        "cards": [(0.455, 0.477, 0.60, 0.87)],
    },
}


def find_hair_blocks(alpha: "np.ndarray", grid: int = 128, min_frac: float = 0.003):
    """Connected opaque regions on an atlas, in normalised UV.

    Hair atlases are not one layout scaled: Regina carries seven separate
    blocks, Kiki four, Cicada three. Scaling the whole envelope onto one of
    them drags two thirds of the cards onto blank space, so the blocks are
    found first and each card group is fitted to the one it suits best.
    """
    h, w = alpha.shape
    small = np.asarray(
        Image.fromarray((alpha * 255).astype(np.uint8)).resize(
            (grid, grid), Image.BILINEAR
        )
    ).astype(np.float32) / 255.0
    mask = small > 0.25
    seen = np.zeros_like(mask, dtype=bool)
    blocks: list[tuple[float, float, float, float]] = []
    for y in range(grid):
        for x in range(grid):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            cells = []
            while stack:
                cy, cx = stack.pop()
                cells.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < grid and 0 <= nx < grid and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if len(cells) < grid * grid * min_frac:
                continue
            ys = [c[0] for c in cells]
            xs = [c[1] for c in cells]
            blocks.append(
                (
                    min(xs) / grid,
                    (max(xs) + 1) / grid,
                    min(ys) / grid,
                    (max(ys) + 1) / grid,
                )
            )
    return blocks


def remap_hair_card(rect_u, env, block):
    """One card's u-span, placed proportionally inside `block` via `env`."""
    eu0, eu1, _ev0, _ev1 = env
    bu0, bu1, bv0, bv1 = block
    u0, u1 = rect_u
    t0 = (u0 - eu0) / (eu1 - eu0)
    t1 = (u1 - eu0) / (eu1 - eu0)
    return (bu0 + t0 * (bu1 - bu0), bu0 + t1 * (bu1 - bu0), bv0, bv1)


def band_quality(alpha: "np.ndarray", rect) -> float:
    """How much a card would read as strands, 0 when it would not.

    Fine-detail energy, not contrast. `band.std()` was the previous metric and
    it rewards *any* gradient: on Ash the smooth blob at
    ``u 0.469–0.602 / v 0.000–0.406`` scored 0.344 while the actual curly mass
    beside it scored 0.272, so the picker moved the curtains off real fibres
    onto a blank field. Strands are a high-frequency pattern — bright fibres
    separated by dark gaps at the pixel scale — so the score is the mean
    distance from a blurred copy of the band, which is near zero for a smooth
    field however strong its gradient.

    Bands that are almost entirely empty are rejected outright: they sample a
    gutter between blocks, and `alphaTest` turns that into an invisible card.
    There is deliberately no upper bound — a dense curly mass covers 95 %+ of
    its band and is still made of fibres.
    """
    h, w = alpha.shape
    u0, u1, v0, v1 = rect
    x0, x1 = int(u0 * w), max(int(u0 * w) + 1, int(u1 * w))
    y0, y1 = int(v0 * h), max(int(v0 * h) + 1, int(v1 * h))
    band = alpha[y0:y1, x0:x1]
    if band.size < 16:
        return 0.0
    if float((band > 0.18).mean()) < 0.10:
        return 0.0
    im = Image.fromarray((band * 255).astype(np.uint8))
    blur = np.asarray(im.filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255.0
    return float(np.abs(band - blur).mean())


# Fibre detail runs 0–0.2 with this metric. Under this a band is a blank field
# or a flat slab rather than hair, so it is not something a card should sample.
HAIR_MIN = 0.03
# A block a group can be moved onto has to be big enough to hold strands: hair
# runs down v, so a short block is a horizontal sliver with no strand length in
# it, and too narrow a block leaves each card only a few pixels of texture.
HAIR_BLOCK_MIN_U = 0.05
HAIR_BLOCK_MIN_V = 0.15


def _group_score(alpha: "np.ndarray", cards, env, block) -> float:
    """One group's score in a layout, taken at the 25th percentile of its cards.

    Not the minimum. The fringe is eleven narrow strips and a single one
    landing in a gap between fibres is normal — requiring all eleven to pass
    rejected atlases that render perfectly well. A quarter of the cards may be
    weak; the rest still read as hair.
    """
    scores = [
        band_quality(alpha, remap_hair_card((r[0], r[1]), env, block) if block else r)
        for r in cards
    ]
    scores.sort()
    return scores[len(scores) // 4]


def hair_group_blocks(alpha: "np.ndarray") -> dict[str, list[float]]:
    """The block each card group should be fitted to, or {} to keep the authored rects.

    Decided per group, not per atlas, and only when the group is *broken*:
    a group whose authored rects already carry fibre detail keeps them, even if
    some other block scores higher. Those rects were measured on a real atlas
    and are tuned against the card geometry; "a bit more contrast somewhere
    else" is not a reason to trade a known-good layout for a guess, and the
    earlier always-take-the-best rule did exactly that — moving Ash's curtains
    off their own curly mass and collapsing Seraph's wisp from 0.140 to 0.018.

    A group moves only when its authored rect samples essentially nothing,
    which is what happens on atlases laid out with their blocks somewhere else
    entirely (Cicada's cards sample 0 % alpha in the authored windows).
    """
    blocks = [
        b
        for b in find_hair_blocks(alpha)
        if b[1] - b[0] >= HAIR_BLOCK_MIN_U and b[3] - b[2] >= HAIR_BLOCK_MIN_V
    ]
    if not blocks:
        return {}

    out: dict[str, list[float]] = {}
    for name, g in HAIR_GROUPS.items():
        if _group_score(alpha, g["cards"], g["env"], None) >= HAIR_MIN:
            continue

        best_block = None
        best_score = -1.0
        for b in blocks:
            score = _group_score(alpha, g["cards"], g["env"], b)
            if score > best_score:
                best_score, best_block = score, b
        if best_block is not None and best_score >= HAIR_MIN:
            out[name] = [round(v, 4) for v in best_block]
    return out


def hair_usable(alpha: "np.ndarray", groups: dict[str, list[float]]) -> bool:
    """True when every card group would show strands in the layout chosen for it."""
    for name, g in HAIR_GROUPS.items():
        block = groups.get(name)
        if _group_score(alpha, g["cards"], g["env"], block) < HAIR_MIN:
            return False
    return True


def best_cap_window(alpha: "np.ndarray") -> list[float] | None:
    """The most opaque block on an atlas, as `[u0, u1, v0, v1]`.

    The scalp shell has its own opaque material and samples a solid patch of
    the atlas — the authored ``u 0.020–0.110 / v 0.220–0.500`` on 90sBebe.
    Once the cards are re-mapped into a strand window, the shell must not
    follow them there: a strand block is mostly holes, and an `alphaTest: 0`
    material over holes paints a bare skull. So this is scored separately, on
    the opposite criterion — highest coverage, no structure wanted.
    """
    h, w = alpha.shape
    cw, ch = max(8, int(0.16 * w)), max(8, int(0.24 * h))
    step_u = max(4, cw // 2)
    step_v = max(4, ch // 2)

    best: list[float] | None = None
    best_cover = 0.0
    for y0 in range(0, max(1, h - ch + 1), step_v):
        for x0 in range(0, max(1, w - cw + 1), step_u):
            cover = float((alpha[y0 : y0 + ch, x0 : x0 + cw] > 0.95).mean())
            if cover > best_cover:
                best_cover = cover
                best = [
                    round(x0 / w, 4),
                    round((x0 + cw) / w, 4),
                    round(y0 / h, 4),
                    round((y0 + ch) / h, 4),
                ]
    # Nothing genuinely opaque: leave the shell on the canonical block, whose
    # own material is opaque anyway, rather than claim a false measurement.
    if best is None or best_cover < 0.90:
        return None
    return best


def hair_usability(im: Image.Image) -> dict[str, Any]:
    """Whether the cards' UV windows carry strand detail on this atlas.

    Measured through the same transform `buildHairTexture` applies, because
    the raw diffuse is misleading. Hair atlases are DXT3 with a real alpha
    channel, so when one exists that channel *is* the card shape and is used
    directly; the luminance ramp `(l − 0.18) / 0.50` is only the fallback for
    an atlas shipped without transparency.

    Either way a window is usable when it has both mass and mid-tones, and the
    three curtain windows matter most because they are what makes the
    silhouette. `90sBebe` reads 152 in every window as RGB yet covers 2 % /
    25 % / 13 % of the curtain windows; `Cicada` is 0 % in all three and its
    cards are invisible.

    Returns the fixed-window verdict *and* `groups`: the strand block each card
    group was fitted to on this atlas, absent when the authored rects already
    work. The client scales each card's offset inside its group into that
    group's block, which is what lets atlases laid out differently from the
    measured `90sBebe` still produce strands.
    """
    rgba, has_alpha = hair_rgba(im)
    if has_alpha:
        alpha = np.asarray(rgba.getchannel("A")).astype(np.float32) / 255.0
    else:
        a = np.asarray(rgba.convert("RGB")).astype(np.float32)
        lum = a.mean(axis=2) / 255.0
        alpha = np.clip((lum - 0.18) / 0.50, 0, 1)
    h, w = alpha.shape

    cover: list[float] = []
    strata: list[float] = []
    for u0, u1, v0, v1 in HAIR_WINDOWS:
        band = alpha[int(v0 * h) : int(v1 * h), int(u0 * w) : int(u1 * w)]
        cover.append(float((band > 0.18).mean()))
        # Strands run along v, so the alpha has to vary across u. The standard
        # deviation of the per-column means is that variation: a window of
        # solid alpha scores ~0 however much it covers, while a comb of
        # strands scores high.
        strata.append(float(band.mean(axis=0).std()))

    curtains = cover[:3]
    curtain_strata = strata[:3]

    # Verdict comes from what the cards actually sample, in whichever layout
    # wins. The fixed-window numbers above survive only as the picker's
    # readout — they are per-column, so they see straight strands and score
    # every curly atlas 0.
    groups = hair_group_blocks(alpha)
    measured: dict[str, Any] = {}
    if groups:
        measured["groups"] = groups
        # The shell samples a solid patch, not a strand block: a strand block is
        # mostly holes and the shell's material is opaque (`alphaTest: 0`), so
        # following the cards there would paint a bare skull.
        cap = best_cap_window(alpha)
        if cap is not None:
            measured["capWindow"] = cap

    return {
        "usable": bool(hair_usable(alpha, groups)),
        "hasAlpha": has_alpha,
        "curtainCover": [round(c, 3) for c in curtains],
        "strandVariance": [round(s, 3) for s in curtain_strata],
        "coverMin": round(min(cover), 3),
        "coverMax": round(max(cover), 3),
        **measured,
    }


def parse_jslot_morphs(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:  # pragma: no cover
        return {"error": str(exc), "morphs": []}
    morphs = data.get("morphs", {}) or {}
    custom = morphs.get("custom", []) or []
    sculpt = morphs.get("sculpt", []) or []

    points: list[list[Any]] = []
    max_idx = 0
    for s in sculpt:
        for v in s.get("data", []):
            if isinstance(v, list) and len(v) >= 4 and isinstance(v[0], int):
                if v[0] > max_idx:
                    max_idx = v[0]
                points.append([v[0], round(v[1], 3), round(v[2], 3), round(v[3], 3)])

    return {
        "preset": path.name,
        "morphs": [
            {"name": c.get("name"), "value": round(float(c.get("value", 0)), 4)}
            for c in custom
            if c.get("name")
        ],
        "sculpt": {
            "vertexCount": max_idx + 1,
            "pointCount": len(points),
            "points": points[:400],
        },
        "faceTextures": data.get("faceTextures", []),
        "headParts": [
            {"type": hp.get("type"), "form": hp.get("formIdentifier")}
            for hp in data.get("headParts", [])[:8]
        ],
        "actor": data.get("actor", {}),
    }


def read_nif_info(path: Path) -> dict[str, Any]:
    """Cheap NIF probe: version string, node names and shape classes.

    SSE head meshes are Gamebryo 20.2.0.7 with BSDynamicTriShape; they are not
    glTF, so the app reports what was found and keeps a procedural mesh.
    """
    raw = path.read_bytes()
    head = raw[:64].decode("ascii", "replace").split("\n")[0]
    strings = [s.decode("ascii", "replace") for s in re.findall(rb"[ -~]{4,}", raw[:20000])]
    nodes = [s for s in strings if re.match(r"^NPC ", s)][:24]
    classes = {
        c: raw.count(c.encode())
        for c in ("BSDynamicTriShape", "BSTriShape", "BSDismemberSkinInstance", "BSLightingShaderProperty")
    }
    return {
        "file": path.name,
        "version": head,
        "bytes": len(raw),
        "nodes": nodes,
        "shapes": {k: v for k, v in classes.items() if v},
        "isGltf": False,
    }


def find_tri_for_head(root: Path, mod: str, rel: str, p: Path) -> Path | None:
    """Finds the corresponding .tri face mesh file for a given head NIF."""
    beside = p.with_name("FemaleHead.tri")
    if beside.is_file():
        return beside
    parent_tri = p.parent / "FemaleHead.tri"
    if parent_tri.is_file():
        return parent_tri
    ube_tri = root / r"UBE 2.0 U0.7\meshes\!UBE\Head\FemaleHead.tri"
    if ube_tri.is_file():
        return ube_tri
    cor_tri = root / r"COR MAIN - CBBE SE\Meshes\!COR\Head\FemaleHead.tri"
    if cor_tri.is_file():
        return cor_tri
    return None


def apply_sculpt(geo: dict[str, Any], points: list[list[Any]], divisor: float) -> dict[str, Any]:
    """Displaces a parsed head by a RaceMenu sculpt.

    A `.jslot`'s `morphs.sculpt` is a sparse per-vertex delta against the head
    it was authored on: `[index, x, y, z]` in FaceGen centimetres, divided by
    `sculptDivisor` (10000) and swizzled the same way the positions are — so
    the delta is `(x, z, y)` scaled to metres. Applying it is what makes Frau a
    different head from Iced Coffee instead of four aliases of one `.tri`.
    """
    pos = np.array(geo["positions"], dtype=np.float64).reshape((-1, 3))
    if not points or not divisor:
        return geo

    idx = np.array([int(p[0]) for p in points], dtype=np.int64)
    raw = np.array([[float(p[1]), float(p[2]), float(p[3])] for p in points], dtype=np.float64)
    keep = (idx >= 0) & (idx < pos.shape[0])
    idx, raw = idx[keep], raw[keep]

    # Same swizzle and scale the base geometry uses: (x, z, y) * 0.01288.
    delta = np.column_stack([raw[:, 0], raw[:, 2], raw[:, 1]]) / divisor * 0.01288
    np.add.at(pos, idx, delta)

    normals = np.array(geo["normals"], dtype=np.float64).reshape((-1, 3))
    tris = np.array(geo["indices"], dtype=np.int64).reshape((-1, 3))
    v0, v1, v2 = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    face_n = np.cross(v1 - v0, v2 - v0)
    lens = np.linalg.norm(face_n, axis=1, keepdims=True)
    lens[lens == 0] = 1.0
    face_n /= lens
    normals[:] = 0.0
    for i in range(3):
        np.add.at(normals, tris[:, i], face_n)
    nlen = np.linalg.norm(normals, axis=1, keepdims=True)
    nlen[nlen == 0] = 1.0
    normals /= nlen

    out = dict(geo)
    out["positions"] = np.round(pos.flatten(), 5).tolist()
    out["normals"] = np.round(normals.flatten(), 4).tolist()
    moved = float(np.linalg.norm(delta, axis=1).max()) if len(delta) else 0.0
    out["sculpt"] = {
        "vertices": int(len(idx)),
        "maxDisplacement": round(moved, 5),
    }
    return out


def head_sculpt_blocks(path: Path) -> list[dict[str, Any]]:
    """The sculpt blocks that target a head mesh, with their own host name.

    Each block records `host` — the `.tri` it was authored against — so the
    pairing is read from the file rather than guessed from vertex counts. That
    matters for `[3BA] Nini.jslot`, whose head host is a 996-vertex
    `Actors\\Character\\Character Assets\\FemaleHeadCharGen.tri` we do not have.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return []
    morphs = data.get("morphs", {}) or {}
    divisor = float(morphs.get("sculptDivisor", 0) or 0)
    out: list[dict[str, Any]] = []
    for block in morphs.get("sculpt", []) or []:
        host = str(block.get("host", ""))
        if "head" not in host.lower() or "brow" in host.lower():
            continue
        points = [
            v for v in block.get("data", [])
            if isinstance(v, list) and len(v) >= 4 and isinstance(v[0], int)
        ]
        if not points:
            continue
        out.append({
            "host": host,
            "hostName": host.replace("\\", "/").rsplit("/", 1)[-1].lower(),
            "vertices": int(block.get("vertices", 0) or 0),
            "points": points,
            "divisor": divisor,
        })
    return out


def find_tri_by_host(root: Path, host_name: str) -> Path | None:
    """The `.tri` a sculpt block names, by basename, anywhere in the archive.

    Basename rather than the full `host` path: RaceMenu records the path as the
    game resolves it through the VFS (`!UBE\\Head\\…`), which is not a real
    directory on disk — the file lives under `meshes\\!UBE\\Head\\…`.
    """
    for needle in (host_name, "femaleheadchargen.tri"):
        hits: list[Path] = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            for fn in filenames:
                if fn.lower() == needle:
                    hits.append(Path(dirpath) / fn)
            if len(hits) > 8:
                break
        if hits:
            # Prefer a `Head\` folder, then the shortest path: the canonical
            # asset rather than a backup copy.
            hits.sort(key=lambda p: ("\\head\\" not in str(p).lower(), len(str(p))))
            return hits[0]
    return None


def parse_tri_geometry(tri_path: Path, scale: float = 0.01288, center_y: float = 1.0, center_z: float = 120.73) -> dict[str, Any]:
    """Decodes FaceGen FRTRI003 head mesh into Three.js-ready attributes."""
    with open(tri_path, "rb") as f:
        sig = f.read(5)
        ver = f.read(3)
        if sig != b"FRTRI":
            raise ValueError(f"Invalid TRI file signature: {sig} in {tri_path}")
        header = struct.unpack("<14i", f.read(56))
        V = header[0]
        T = header[1]
        num_uvs = header[5]
        raw_verts = struct.unpack(f"<{V*3}f", f.read(V * 3 * 4))
        raw_tris = struct.unpack(f"<{T*3}i", f.read(T * 3 * 4))
        raw_uvs = struct.unpack(f"<{num_uvs*2}f", f.read(num_uvs * 2 * 4))

    verts = np.array(raw_verts, dtype=np.float32).reshape((V, 3))
    tris = np.array(raw_tris, dtype=np.int32).reshape((T, 3))
    uvs = np.array(raw_uvs, dtype=np.float32).reshape((num_uvs, 2))

    x = verts[:, 0] * scale
    y = (verts[:, 2] - center_z) * scale
    z = (verts[:, 1] - center_y) * scale
    three_verts = np.column_stack([x, y, z]).astype(np.float32)

    three_tris = tris[:, [0, 2, 1]].astype(np.int32)

    v0 = three_verts[three_tris[:, 0]]
    v1 = three_verts[three_tris[:, 1]]
    v2 = three_verts[three_tris[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)
    face_lens = np.linalg.norm(face_normals, axis=1, keepdims=True)
    face_lens[face_lens == 0] = 1.0
    face_normals /= face_lens

    vert_normals = np.zeros_like(three_verts)
    for i in range(3):
        np.add.at(vert_normals, three_tris[:, i], face_normals)
    vert_lens = np.linalg.norm(vert_normals, axis=1, keepdims=True)
    vert_lens[vert_lens == 0] = 1.0
    vert_normals /= vert_lens

    three_uvs = np.column_stack([uvs[:, 0], 1.0 - uvs[:, 1]]).astype(np.float32)

    return {
        "vertexCount": V,
        "triangleCount": T,
        "positions": np.round(three_verts.flatten(), 5).tolist(),
        "normals": np.round(vert_normals.flatten(), 4).tolist(),
        "uvs": np.round(three_uvs.flatten(), 5).tolist(),
        "indices": three_tris.flatten().tolist()
    }


# ── part defaults, UBE first ───────────────────────────────────────────────
#
# The picker lists the whole archive from the catalogue; these are only the
# curated `[0]` rows so an offline or freshly cloned app still has every part.
# UBE leads wherever it ships, because the user asked for UBE defaults; hair has
# no UBE mesh, so its texture list keeps HG `90sBebe` first.
#
# `(mod, rel, geometry, texture, normal)`. Geometry and textures are prebaked
# under `public/assets/mo2/`, so no decode happens at sync time.
PART_CANDIDATES = {
    "eyeMesh": [
        (r"UBE 2.0 U0.7", r"meshes\!UBE\Eyes\eyesfemale.tri",
         "/assets/mo2/eyes/ube-eyesfemale.json", None, None),
        (r"COR MAIN - CBBE SE", r"Meshes\!COR\Eyes\eyesfemale.tri",
         "/assets/mo2/eyes/cor-eyesfemale.json", None, None),
    ],
    "lashesMesh": [
        (r"UBE 2.0 U0.7", r"meshes\!UBE\Lashes\EyeFemaleLashes.tri",
         "/assets/mo2/eyes/ube-lashes.json", None, None),
    ],
    "browsMesh": [
        (r"UBE 2.0 U0.7", r"meshes\!UBE\Brows\femaleheadbrows.tri",
         "/assets/mo2/brows/ube-brows.json", None, None),
    ],
    "mouthMesh": [
        (r"UBE 2.0 U0.7", r"meshes\!UBE\Mouth\mouthhumanf_tangent.tri",
         "/assets/mo2/mouth/ube-mouth.json", None, None),
    ],
    "bodyMesh": [
        (r"UBE 2.0 U0.7",
         r"CalienteTools\Bodyslide\ShapeData\UBE SE 2.0 Release Body\untitled.obj",
         "/assets/mo2/body/ube-body.json", None, None),
    ],
    # Optional authored hair; HG procedural cards remain the default.
    # COR geometry uses its explicit scalp-relative `ground` frame.
    "hairMesh": [
        (r"COR MAIN - CBBE SE", r"Meshes\!COR\Hair\hair01.tri",
         "/assets/mo2/hair/cor-hair01.json", None, None),
    ],
    "lashes": [
        (r"UBE 2.0 U0.7", r"textures\!COR\Lashes\EyeFemaleLashes.dds",
         None, "/assets/mo2/eyes/eyelashes.webp", None),
    ],
    "brows": [
        (r"UBE 2.0 U0.7", r"textures\!COR\Brows\FemaleBrow_01.dds",
         None, "/assets/mo2/brows/femalebrow.webp", None),
    ],
    "mouth": [
        # UBE first, as everywhere it ships; COR's `MouthMap.dds` is the
        # fallback the older `mouthmap.webp` prebake came from.
        (r"UBE 2.0 U0.7", r"textures\!COR\Mouth\MouthMap_d.dds",
         None, "/assets/mo2/mouth/ube-mouthmap.webp", None),
        (r"COR MAIN - CBBE SE", r"textures\!COR\Mouth\MouthMap.dds",
         None, "/assets/mo2/mouth/mouthmap.webp", None),
    ],
    "body": [
        (r"UBE 2.0 U0.7", r"textures\!UBE\Body\femalebody_1_d.dds",
         None, "/assets/mo2/body/femalebody.webp", "/assets/mo2/body/femalebody_n.webp"),
        # Imperfect ships no `_n`, so the normal is the one authored for the
        # same `!UBE\Body` UV — the pairing Skyrim itself makes, since a game
        # resolves the diffuse and the normal through independent paths.
        # PREFERRED_DEFAULT promotes this row to the default body skin.
        (r"Imperfect Skin - UBE", r"textures\!UBE\Body\femalebody_1_d.dds",
         None, "/assets/mo2/body/femalebody-imperfect.webp", "/assets/mo2/body/femalebody_n.webp"),
    ],
}


def part_defaults(root: Path, out: Path) -> dict[str, list[dict[str, Any]]]:
    """Curated part rows whose source *and* prebake both exist."""
    lists: dict[str, list[dict[str, Any]]] = {k: [] for k in PART_CANDIDATES}
    for kind, rows in PART_CANDIDATES.items():
        for mod, rel, mesh_url, texture, normal in rows:
            src = root / mod / rel
            if not src.is_file():
                continue
            shipped = [u for u in (mesh_url, texture, normal) if u]
            if any(not (out / u.replace("/assets/mo2/", "")).is_file() for u in shipped):
                continue
            lists[kind].append({
                "id": slugify(f"{mod}-{Path(rel).stem}"),
                "mod": mod,
                "label": Path(rel).stem,
                "file": Path(rel).name,
                "rel": f"{mod}\\{rel}",
                **({"meshUrl": mesh_url} if mesh_url else {}),
                **({"texture": texture} if texture else {}),
                **({"normalTexture": normal} if normal else {}),
            })
    return lists


def main() -> int:
    # Pack mode is a different source shape (one Data-like tree) and is handled
    # by its own producer; the MO2 path below is left untouched.
    if str(Path(__file__).resolve().parent) not in sys.path:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
    import asset_source
    cfg = asset_source.load()
    if cfg["layout"] == "pack":
        import sync_pack_assets
        return sync_pack_assets.sync_main(cfg)

    ap = argparse.ArgumentParser()
    # The config is the single source of truth; explicit flags still win.
    ap.add_argument("--mods", default=str(cfg["root"]))
    ap.add_argument("--out", default=str(cfg["out"]))
    ap.add_argument("--max-size", type=int, default=1024)
    args = ap.parse_args()

    root = Path(args.mods)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "source": str(root),
        "available": root.is_dir(),
        "textures": {},
        "errors": [],
    }

    if not root.is_dir():
        manifest["errors"].append(f"mod directory not found: {root}")
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"[!] {root} not found — wrote an empty manifest")
        return 1

    skins = candidates(root, SKIN_CANDIDATES)
    eyes = candidates(root, EYE_CANDIDATES)
    hairs = candidates(root, HAIR_CANDIDATES)
    heads = candidates(root, HEAD_MESH_CANDIDATES)
    skels = candidates(root, SKELETON_CANDIDATES)
    presets = candidates(root, PRESET_CANDIDATES)

    def rel_of(found) -> str | None:
        """`<mod>\\<rel>`, the form the panel has always shown."""
        return f"{found[0][2]}\\{found[0][1]}" if found else None

    parts = part_defaults(root, out)
    # Curated part rows carry a stable slug id, never the index, so the table
    # can promote them directly; only `skin` has to wait for its rows.
    for kind, preferred in PREFERRED_DEFAULT.items():
        if kind in parts:
            parts[kind] = promote(parts[kind], preferred)

    # The first option of each category is the default; the single-value
    # fields the app has always read keep pointing at it, so nothing that
    # predates the picker breaks.
    manifest["mods"] = {
        "skin": rel_of(skins),
        "eyes": rel_of(eyes),
        "hair": rel_of(hairs),
        "headMesh": rel_of(heads),
        "skeleton": rel_of(skels),
        "preset": rel_of(presets),
        **{kind: rows[0]["rel"] for kind, rows in parts.items() if rows and kind != "hairMesh"},
    }
    manifest["assets"] = {
        "skin": [], "eyes": [], "hair": [], "headMesh": [], "skeleton": [], "preset": [],
        **parts,
    }

    def asset_file(kind: str, label: str) -> tuple[str, Path]:
        slug = slugify(label)
        folder = out / kind
        folder.mkdir(parents=True, exist_ok=True)
        return f"/assets/mo2/{kind}/{slug}.webp", folder / f"{slug}.webp"

    # ── skin ─────────────────────────────────────────────────────────
    # Sayble and Dragokini are 85 MB diffuses and take ~25 s each to decode, so
    # the per-option metadata is cached beside the webp and only recomputed
    # when the source is newer. The other four decode in 0.2 s.
    for idx, (p, rel, mod) in enumerate(skins):
        try:
            url, dst = asset_file("skin", f"{mod}-{idx}")
            meta_path = dst.with_suffix(".json")
            if is_fresh(p, dst) and meta_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                analysis = meta["palette"]
                size = meta["size"]
            else:
                im = open_dds(p)
                analysis = analyze_skin(im)
                size = list(im.size)
                sq = to_srgb_rgb(im)
                if sq.width != sq.height:
                    s = min(sq.size)
                    sq = sq.crop(((sq.width - s) // 2, (sq.height - s) // 2,
                                  (sq.width + s) // 2, (sq.height + s) // 2))
                sq = sq.resize((args.max_size, args.max_size), Image.LANCZOS)
                sq.save(dst, "WEBP", quality=88, method=6)
                meta_path.write_text(
                    json.dumps({"size": size, "palette": analysis}), encoding="utf-8"
                )

            # The tangent-space normal map authored for the *same* head UV as
            # the diffuse. It is the real pore/scar relief the mod ships; the
            # Sobel of the albedo in lib/head/faceTexture.ts is only the
            # fallback for a skin that has none. PNG, because the vectors
            # must be exact.
            normal_src = normal_map_beside(p)
            normal_url: str | None = None
            if normal_src is not None:
                n_url, n_dst = asset_file("skin", f"{mod}-{idx}_n")
                n_url = n_url.replace(".webp", ".png")
                n_dst = n_dst.with_suffix(".png")
                if not is_fresh(normal_src, n_dst):
                    to_tangent_normal(open_dds(normal_src), args.max_size).save(
                        n_dst, "PNG", optimize=True
                    )
                normal_url = n_url

            manifest["assets"]["skin"].append({
                "id": slugify(f"{mod}-{idx}"),
                "mod": mod,
                "file": Path(rel).name,
                "rel": f"{mod}\\{rel}",
                "texture": url,
                "normalTexture": normal_url,
                "size": size,
                "palette": analysis,
            })
            mark = "" if normal_url else "  (no _n.dds)"
            print(f"[+] skin  {p.name:20s} {str(tuple(size)):12s} -> skin/{dst.name}{mark}")
        except Exception as exc:
            manifest["errors"].append(f"skin {mod}: {exc}")
            print(f"[!] skin failed ({mod}): {exc}")

    # ── skin defaults ───────────────────────────────────────────────
    # Ids carry the candidate index (`imperfect-skin-ube-3`), so the promoted
    # default is moved to the front of the *built* list rather than up
    # SKIN_CANDIDATES: a reorder there would rename every prebake and orphan
    # the old files. The single-value fields read by the app follow it.
    skin_rows = manifest["assets"]["skin"]
    skin_rows = promote(skin_rows, PREFERRED_DEFAULT.get("skin"))
    manifest["assets"]["skin"] = skin_rows

    # A diffuse-only skin still has relief to draw: every SKIN_CANDIDATES entry
    # replaces the same `!UBE\Head\femaleHead_d.dds`, so the normal authored
    # for one is authored for all of them. Share the first that ships one
    # instead of falling back to the Sobel of the albedo. Done after the loop
    # so it does not depend on which candidate happens to be first.
    shared_normal = next(
        (row["normalTexture"] for row in skin_rows if row.get("normalTexture")), None
    )
    for row in skin_rows:
        if not row.get("normalTexture") and shared_normal:
            row["normalTexture"] = shared_normal

    if skin_rows:
        first = skin_rows[0]
        manifest["skinSource"] = {"file": first["file"], "size": first["size"]}
        manifest["skin"] = first["palette"]
        manifest["textures"]["skin"] = first["texture"]
        if first.get("normalTexture"):
            manifest["textures"]["normal"] = first["normalTexture"]

    # ── eyes ─────────────────────────────────────────────────────────
    for idx, (p, rel, mod, label) in enumerate(eyes):
        try:
            url, dst = asset_file("eyes", f"{mod}-{idx}")
            im = open_dds(p)
            analysis = analyze_eye(im)
            atlas = measure_eye_atlas(im)
            if not is_fresh(p, dst):
                e = to_srgb_rgb(im).resize((512, 512), Image.LANCZOS)
                e.save(dst, "WEBP", quality=90, method=6)
            analysis["atlas"] = atlas

            disc_url, disc_dst = asset_file("eyes", f"{mod}-{idx}-disc")
            if not is_fresh(p, disc_dst):
                iw, ih = im.size
                cx_px = int(atlas['cx'] * iw)
                cy_px = int(atlas['cy'] * ih)
                r_px = int(atlas['r'] * min(iw, ih) * 1.35)
                box = (max(0, cx_px - r_px), max(0, cy_px - r_px), min(iw, cx_px + r_px), min(ih, cy_px + r_px))
                disc = to_srgb_rgb(im.crop(box)).resize((256, 256), Image.LANCZOS)
                disc.save(disc_dst, "WEBP", quality=92, method=6)
            analysis["discUrl"] = disc_url
            is_cor = "cor" in mod.lower()
            eye_mesh_url = "/assets/mo2/eyes/cor-eyesfemale.json" if is_cor else "/assets/mo2/eyes/ube-eyesfemale.json"
            manifest["assets"]["eyes"].append({
                "id": slugify(f"{mod}-{idx}"),
                "mod": mod,
                "label": label,
                "file": Path(rel).name,
                "rel": f"{mod}" + "\\" + rel,
                "texture": url,
                "size": list(im.size),
                "iris": analysis["iris"],
                "mean": analysis["mean"],
                "atlas": atlas,
                "meshUrl": eye_mesh_url,
                "lashesMeshUrl": "/assets/mo2/eyes/ube-lashes.json",
                "lashesTexture": "/assets/mo2/eyes/eyelashes.webp",
            })
            if idx == 0:
                manifest["eyeSource"] = {"file": p.name, "size": list(im.size)}
                manifest["eye"] = analysis
                manifest["eye"]["meshUrl"] = eye_mesh_url
                manifest["eye"]["lashesMeshUrl"] = "/assets/mo2/eyes/ube-lashes.json"
                manifest["eye"]["lashesTexture"] = "/assets/mo2/eyes/eyelashes.webp"
                manifest["textures"]["eye"] = url
                manifest["textures"]["eyeDisc"] = disc_url
            print(f"[+] eyes  {label:14s} {str(im.size):12s} atlas r={atlas['r']:.3f} -> eyes/{dst.name}")
        except Exception as exc:
            manifest["errors"].append(f"eyes {mod}: {exc}")
            print(f"[!] eyes failed ({mod}): {exc}")

    # ── hair ─────────────────────────────────────────────────────────
    for idx, (p, rel, mod, label) in enumerate(hairs):
        try:
            url, dst = asset_file("hair", f"{mod}-{label}")
            im = open_dds(p)
            score = hair_usability(im)
            if not is_fresh(p, dst):
                rgba, _ = hair_rgba(im)
                rgba.thumbnail((1024, 1024), Image.LANCZOS)
                rgba.save(dst, "WEBP", quality=86, method=6)
            manifest["assets"]["hair"].append({
                "id": slugify(f"{mod}-{label}"),
                "mod": mod,
                "label": label,
                "file": Path(rel).name,
                "rel": f"{mod}" + "\\" + rel,
                "texture": url,
                "size": list(im.size),
                **score,
            })
            if idx == 0:
                manifest["hairSource"] = {"file": p.name, "size": list(im.size)}
                manifest["textures"]["hair"] = url
            mark = "ok " if score["usable"] else "NO-STRAND"
            print(f"[+] hair  {label:14s} {str(im.size):12s} {mark} -> hair/{dst.name}")
        except Exception as exc:
            manifest["errors"].append(f"hair {mod}: {exc}")
            print(f"[!] hair failed ({mod}): {exc}")

    # ── presets, first: the head loop needs their sculpts ────────────
    # Parsed before the heads rather than in their own pass so a head can be
    # emitted once per preset that sculpts it, instead of once per `.nif`.
    preset_sculpts: list[dict[str, Any]] = []
    for pp, prel, pmod, plabel in presets:
        try:
            blocks = head_sculpt_blocks(pp)
            for b in blocks:
                preset_sculpts.append({**b, "preset": pp.name, "label": plabel, "mod": pmod})
            if blocks:
                print(f"[+] sculpt {plabel:16s} host={blocks[0]['hostName']} verts={blocks[0]['vertices']}")
        except Exception as exc:
            manifest["errors"].append(f"sculpt {pmod}: {exc}")

    # Cache each source `.tri` geometry: several presets sculpt the same base,
    # and decoding 11,498 vertices twice per preset is wasted work.
    tri_cache: dict[str, dict[str, Any]] = {}

    # ── head mesh ────────────────────────────────────────────────────
    for idx, (p, rel, mod, label) in enumerate(heads):
        try:
            info = read_nif_info(p)
            tri_path = find_tri_for_head(root, mod, rel, p)
            mesh_url = None
            geo_slug = slugify(f"{mod}-{label}")
            if tri_path and tri_path.is_file():
                geo_dst = out / "head" / f"{geo_slug}.json"
                if not is_fresh(tri_path, geo_dst):
                    geo_data = parse_tri_geometry(tri_path)
                    geo_dst.parent.mkdir(parents=True, exist_ok=True)
                    geo_dst.write_text(json.dumps(geo_data), encoding="utf-8")
                mesh_url = f"/assets/mo2/head/{geo_slug}.json"
                info["meshUrl"] = mesh_url
                info["isRealMesh"] = True
                info["triFile"] = tri_path.name

            manifest["assets"]["headMesh"].append({
                "id": geo_slug,
                "mod": mod,
                "label": label,
                "file": p.name,
                "rel": f"{mod}" + "\\" + rel,
                "bytes": info["bytes"],
                "version": info["version"],
                "nodes": info["nodes"],
                "shapes": info["shapes"],
                "meshUrl": mesh_url,
                "isRealMesh": bool(mesh_url),
            })
            if idx == 0:
                manifest["headMesh"] = info
                if mesh_url:
                    manifest["textures"]["headMesh"] = mesh_url
            mesh_mark = f"-> head/{geo_slug}.json" if mesh_url else "(no .tri)"
            print(f"[+] head  {label:22s} ({info['version']}) {mesh_mark}")
        except Exception as exc:
            manifest["errors"].append(f"headMesh {mod}: {exc}")

    # ── one head per preset sculpt ───────────────────────────────────
    # Four presets used to resolve to four `.nif` paths that all emitted the
    # same shared `FemaleHead.tri`. Here the sculpt is applied and written out
    # under the preset's own name, so the HEAD MESH list is as many genuinely
    # different heads as the archive can support.
    seen_sculpt: set[str] = set()
    for s in preset_sculpts:
        try:
            base = find_tri_by_host(root, s["hostName"])
            if base is None:
                manifest["errors"].append(
                    f"sculpt {s['preset']}: host {s['host']} not found in the archive"
                )
                continue
            key = str(base)
            if key not in tri_cache:
                tri_cache[key] = parse_tri_geometry(base)
            if tri_cache[key]["vertexCount"] != s["vertices"]:
                # Wrong host: the deltas index a different head, so applying
                # them would produce a mangled mesh rather than a face.
                manifest["errors"].append(
                    f"sculpt {s['preset']}: host has {tri_cache[key]['vertexCount']} verts, "
                    f"sculpt expects {s['vertices']} — skipped"
                )
                continue

            # `-sculpt` because `slugify(f"{mod}-{label}-head")` is exactly the
            # slug the `.nif` head for the same preset already used — the two
            # wrote to one path and the last writer won.
            slug = slugify(f"{s['mod']}-{s['label']}-head-sculpt")
            if slug in seen_sculpt:
                continue
            seen_sculpt.add(slug)

            geo = apply_sculpt(tri_cache[key], s["points"], s["divisor"])
            geo_dst = out / "head" / f"{slug}.json"
            geo_dst.parent.mkdir(parents=True, exist_ok=True)
            geo_dst.write_text(json.dumps(geo), encoding="utf-8")

            manifest["assets"]["headMesh"].append({
                "id": slug,
                "mod": s["mod"],
                "label": f"{s['label']} (sculpt)",
                "file": s["preset"],
                "rel": f"{s['mod']}\\{s['preset']}",
                "bytes": geo_dst.stat().st_size,
                "version": "sculpt",
                "nodes": [s["hostName"]],
                "shapes": {"sculpted": s["vertices"]},
                "meshUrl": f"/assets/mo2/head/{slug}.json",
                "isRealMesh": True,
                "sculptSource": s["preset"],
            })
            print(
                f"[+] sculpted head {s['label']:16s} "
                f"max {geo['sculpt']['maxDisplacement'] * 1000:.2f} mm -> head/{slug}.json"
            )
        except Exception as exc:
            manifest["errors"].append(f"sculpted head {s['preset']}: {exc}")

    # ── skeleton ─────────────────────────────────────────────────────
    for idx, (p, rel, mod, label) in enumerate(skels):
        try:
            info = read_nif_info(p)
            manifest["assets"]["skeleton"].append({
                "id": slugify(f"{mod}-{label}"),
                "mod": mod,
                "label": label,
                "file": p.name,
                "rel": f"{mod}" + "\\" + rel,
                "bytes": info["bytes"],
                "version": info["version"],
                "nodes": info["nodes"],
            })
            if idx == 0:
                info["file"] = p.name
                manifest["skeleton"] = info
            print(f"[+] skel  {label:22s} {len(info['nodes'])} NPC nodes")
        except Exception as exc:
            manifest["errors"].append(f"skeleton {mod}: {exc}")

    # ── presets ──────────────────────────────────────────────────────
    for idx, (p, rel, mod, label) in enumerate(presets):
        try:
            parsed = parse_jslot_morphs(p)
            manifest["assets"]["preset"].append({
                "id": slugify(f"{mod}-{label}"),
                "mod": mod,
                "label": label,
                "file": p.name,
                "rel": f"{mod}" + "\\" + rel,
                "morphs": parsed["morphs"],
                "sculpt": parsed["sculpt"],
            })
            if idx == 0:
                manifest["preset"] = parsed
            print(f"[+] presets {label:18s} {len(parsed['morphs'])} morphs")
        except Exception as exc:
            manifest["errors"].append(f"preset {mod}: {exc}")

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\n[=] wrote {out / 'manifest.json'}")
    if manifest["errors"]:
        print(f"[!] {len(manifest['errors'])} issue(s): " + "; ".join(manifest["errors"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
