#!/usr/bin/env python
"""Regression check for the skin bake, gloss mask and skin shader patch.

    python -I scripts/check_skin_assets.py

These are the four things the "skin looks like plastic, not Skyrim" fix turns
on, and all four fail silently — a lower-quality bake still renders, a dropped
gloss mask still renders, and the old shader compiled fine while glowing on
the wrong side. So each is asserted against real generated output:

- the albedo bake really is 2048² and still carries micro-detail (mean
  |Laplacian| of the face crop). The previous 1024 q88 bake measured 0.72;
  this floors at 2.5, which 2048 q95 clears at ~4.97 and a quiet regression to
  q88 or 1024 cannot;
- the `_n.dds` alpha survives as a roughness map: 1024², R pinned 255 as an
  ORM texture, G a real multiplier below 1 somewhere (three multiplies
  `roughness` by G, so a uniform 255 map would be a no-op and the whole face
  would share one scalar roughness again);
- the manifest actually names those URLs and they resolve;
- `SkinShader.ts` no longer contains the two constructs that caused the wax:
  the inverted Gaussian (`NdotL * 0.5 + 0.5` fed to `exp`) and the stacked
  dual-lobe Blinn-Phong specular.

Stdlib + Pillow + numpy. Like `check_pack_contract.py`, this reads the active
`asset-source.json` layout and skips cleanly when it is not the pack.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import asset_source  # noqa: E402

ROOT = SCRIPTS.parent
PUBLIC = ROOT / "public"

ALBEDO_SIZE = 2048
MASK_SIZE = 1024
# The 1024 q88 bake the fix replaced measured 0.72 on this crop; 2048 q95
# measures ~4.97. 2.5 sits well clear of both.
MIN_FACE_LAPLACIAN = 2.5
# Face occupies 47 % of the atlas width and sits in the upper-middle.
FACE_CROP = (0.26, 0.28, 0.74, 0.76)

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def resolve(url: object, label: str) -> Path | None:
    if not isinstance(url, str) or not url.startswith("/"):
        failures.append(f"{label}: not an absolute public URL: {url!r}")
        return None
    path = PUBLIC / url.lstrip("/")
    if not path.is_file():
        failures.append(f"{label}: missing {url}")
        return None
    return path


def mean_abs_laplacian(path: Path, crop: tuple[float, float, float, float] | None) -> float:
    from PIL import Image, ImageFilter
    import numpy as np

    im = Image.open(path).convert("L")
    if crop is not None:
        w, h = im.size
        im = im.crop((int(w * crop[0]), int(h * crop[1]), int(w * crop[2]), int(h * crop[3])))
    im = im.resize((512, 512), Image.LANCZOS)
    # Same 3×3 Laplacian the bake was calibrated with; computed in numpy so the
    # number does not depend on Pillow's Kernel normalisation.
    a = np.asarray(im).astype(np.float32)
    lap = np.abs(
        4.0 * a[1:-1, 1:-1]
        - a[:-2, 1:-1] - a[2:, 1:-1] - a[1:-1, :-2] - a[1:-1, 2:]
    )
    return float(lap.mean())


def check_mask(path: Path, label: str) -> None:
    from PIL import Image
    import numpy as np

    im = Image.open(path)
    check(im.size == (MASK_SIZE, MASK_SIZE), f"{label}: size {im.size} != {MASK_SIZE}²")
    a = np.asarray(im.convert("RGB")).astype(np.uint8)
    r, g = a[..., 0], a[..., 1]
    check(int(r.min()) == 255, f"{label}: R is not pinned white (min {int(r.min())})")
    check(int(g.max()) == 255, f"{label}: G never reaches 1.0 (max {int(g.max())})")
    check(int(g.min()) < 240,
          f"{label}: G is uniform ({int(g.min())}..{int(g.max())}) — no per-texel gloss")
    check(int(g.max()) - int(g.min()) >= 24,
          f"{label}: G range {int(g.min())}..{int(g.max())} too narrow to shape a highlight")


def check_shader_source() -> None:
    src = (ROOT / "components" / "scene" / "SkinShader.ts").read_text(encoding="utf-8")
    # The GLSL lives in a JS template literal, so a backtick anywhere inside it
    # — including in a comment — closes the string and the module stops
    # compiling. That has happened twice; it costs a dev-server restart to
    # notice, so it is asserted here.
    chunk = src.split("const SKIN_CHUNK", 1)
    if len(chunk) == 2:
        body = chunk[1].split("`;", 1)[0]
        check("`" not in body[body.find("`") + 1:],
              "SkinShader.ts: backtick inside the GLSL template literal")
    # Strip line comments so the doc block that *describes* the removed bugs
    # does not fail its own check.
    code = "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith(("//", "*", "/*"))
    )
    check("NdotL * 0.5 + 0.5" not in code,
          "SkinShader.ts: inverted-Gaussian wrap ('NdotL * 0.5 + 0.5') is back")
    check(not re.search(r"directSpecular\s*\+=", code),
          "SkinShader.ts: patch adds its own specular again (double-counts GGX)")
    check(re.search(r"directionalLights\s*\[\s*i\s*\]\s*\.color", code) is not None,
          "SkinShader.ts: no longer reads directionalLights[i].color")
    check("getShadow(" in code,
          "SkinShader.ts: skin patch no longer respects shadow maps")
    check("material.diffuseColor" in code,
          "SkinShader.ts: scatter is not multiplied by the albedo")


def main() -> int:
    try:
        cfg = asset_source.load()
    except SystemExit as exc:
        print(f"[x] {exc}", file=sys.stderr)
        return 1
    if cfg["layout"] != "pack":
        print("ok: active layout is mo2; skin bake check not applicable", file=sys.stderr)
        return 0

    check_shader_source()

    out = Path(cfg["out"])
    try:
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[x] cannot read manifest: {exc}", file=sys.stderr)
        return 1

    skin = next((r for r in manifest.get("assets", {}).get("skin", [])
                 if r.get("available") is not False), None)
    body = next((r for r in manifest.get("assets", {}).get("body", [])
                 if r.get("available") is not False), None)
    check(skin is not None, "manifest: no available skin row")
    check(body is not None, "manifest: no available body row")

    for row, label in ((skin, "skin"), (body, "body")):
        if row is None:
            continue
        albedo = resolve(row.get("texture"), f"{label}.texture")
        if albedo is not None:
            from PIL import Image
            size = Image.open(albedo).size
            check(size == (ALBEDO_SIZE, ALBEDO_SIZE),
                  f"{label}: albedo {size} != {ALBEDO_SIZE}²")
        mask = resolve(row.get("roughnessTexture"), f"{label}.roughnessTexture")
        if mask is not None:
            check_mask(mask, f"{label}.roughnessTexture")

    rough_union = (manifest.get("textures") or {}).get("skinRoughness")
    resolve(rough_union, "manifest.textures.skinRoughness")

    if skin is not None and skin.get("texture"):
        albedo = resolve(skin["texture"], "skin.texture")
        if albedo is not None:
            detail = mean_abs_laplacian(albedo, FACE_CROP)
            check(detail >= MIN_FACE_LAPLACIAN,
                  f"skin: face-crop detail {detail:.2f} < {MIN_FACE_LAPLACIAN} "
                  f"(the 1024 q88 bake this replaced measured 0.72)")

    if failures:
        for f in failures:
            print(f"[x] {f}", file=sys.stderr)
        print(f"\n{len(failures)} skin asset failure(s)", file=sys.stderr)
        return 1

    print("ok: skin bake 2048px, gloss masks 1024px, shader patch clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
