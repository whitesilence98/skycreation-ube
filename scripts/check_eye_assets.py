#!/usr/bin/env python
"""Regression check for the eye atlas role rules and the disc measurement.

    python -I scripts/check_eye_assets.py

Covers the two eye-specific pieces that are easy to break silently:

- `index_mo2_assets.eye_map_role`: Koralina's shared `eyenormal` / `eyecubemap` /
  `eyeenvironmentmask` maps must not be offered as selectable irises, while a
  real atlas must stay albedo and the existing COR `_m` / `_g` companions must
  still demote.
- `convert_worker.measure_iris`: a synthetic atlas with a known iris centre and
  radius must measure close to it, and a blank atlas must fall back to the
  canonical fit instead of clamping to a 0.32 radius.

Stdlib + Pillow + numpy (the worker already requires both).
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from convert_worker import measure_iris  # noqa: E402
from index_mo2_assets import classify  # noqa: E402

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


MOD = "Even More Eyes by Koralina"
ROLE_CASES = [
    # (rel, expected kind, expected role, why)
    (r"textures\Koralina\Eyes\albino\Azure.dds", "eyes", "albedo", "iris atlas"),
    (r"textures\Koralina\Eyes\unnatural\Eyes Blue.dds", "eyes", "albedo", "iris atlas"),
    (r"textures\Koralina\Eyes\eyenormal.dds", "eyes", "normal", "shared normal"),
    (r"textures\Koralina\Eyes\eyesnormalmap.dds", "eyes", "normal", "alternate normal spelling"),
    (r"textures\Koralina\Eyes\eyecubemap.dds", "eyes", "specular", "cubemap"),
    (r"textures\Koralina\Eyes\eyeenvironmentmask.dds", "eyes", "specular", "environment mask"),
    (r"textures\Koralina\Eyes\eye_sk.dds", "eyes", "specular", "specular map"),
    (r"textures\!COR\Eyes_ILV\eye01.dds", "eyes", "albedo", "COR iris"),
    (r"textures\!COR\Eyes_ILV\eye01_m.dds", "eyes", "specular", "COR mask"),
    (r"textures\!COR\Eyes_ILV\EyesBlue_g.dds", "eyes", "specular", "COR glow"),
]

for rel, kind, role, why in ROLE_CASES:
    got_kind, got_role = classify(MOD, rel)
    check(got_kind == kind, f"{rel}: kind {got_kind!r} != {kind!r} ({why})")
    check(got_role == role, f"{rel}: role {got_role!r} != {role!r} ({why})")

# A makeup mask is a real makeup atlas role; it must not be demoted by the
# eyes-only rule leaking into makeup classification.
makeup_rel = r"textures\!COR\MakeupOverlays\lips_gloss_m.dds"
got_kind, got_role = classify("UBE 2.0 U0.7", makeup_rel)
check(got_kind == "makeup", f"{makeup_rel}: kind {got_kind!r} != 'makeup' (leaked eye rule)")
check(got_role == "albedo", f"{makeup_rel}: role {got_role!r} != 'albedo' (leaked eye rule)")


def synthetic_atlas(size: int = 512, radius: float = 0.12):
    from PIL import Image, ImageDraw

    im = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(im)
    # sclera island: x 0.30-0.70, y 0.55-0.95 (centre 0.50, 0.75)
    draw.rectangle(
        (int(size * 0.30), int(size * 0.55), int(size * 0.70), int(size * 0.95)),
        fill=(220, 220, 220, 255),
    )
    cx, cy, r = size * 0.5, size * 0.75, size * radius
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(40, 40, 40, 255))
    return im


info = measure_iris(synthetic_atlas())
check(info["measured"] is True, f"synthetic atlas: not measured ({info})")
check(abs(info["cx"] - 0.50) <= 0.02, f"synthetic atlas: cx {info['cx']} != 0.50")
check(abs(info["cy"] - 0.75) <= 0.02, f"synthetic atlas: cy {info['cy']} != 0.75")
check(0.10 <= info["r"] <= 0.14, f"synthetic atlas: r {info['r']} outside 0.10-0.14")
check(info["r"] < 0.20, f"synthetic atlas: r {info['r']} hit the old 0.32-style clamp")

from PIL import Image  # noqa: E402

blank = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
fallback = measure_iris(blank)
check(fallback["measured"] is False, f"blank atlas: measured should be false ({fallback})")
check(
    (fallback["cx"], fallback["cy"], fallback["r"]) == (0.497, 0.754, 0.126),
    f"blank atlas: fallback {fallback} != canonical fit",
)

if failures:
    for f in failures:
        print(f"[x] {f}", file=sys.stderr)
    print(f"\n{len(failures)} eye asset failure(s)", file=sys.stderr)
    raise SystemExit(1)

print(f"ok: eye roles {len(ROLE_CASES)} cases, disc measurement 2 cases")
