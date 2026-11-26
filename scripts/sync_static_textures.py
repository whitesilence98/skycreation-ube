#!/usr/bin/env python
"""Pre-bake texture-only catalogue categories into static WebP/PNG assets.

Reads the active pack catalogue (`public/assets/preset-pack/catalogue/<kind>.json`)
for texture-only categories (`skin`, `body`, `eyes`, `brows`, `lashes`, `mouth`,
`makeup`, `tattoo`), decodes their `.dds` sources from the configured pack root
once into `public/assets/preset-pack/textures/<kind>/`, and records resolved
static `/assets/preset-pack/textures/...` URLs directly in each catalogue JSON.

Once pre-baked, the client loads thumbnails, atlases, iris discs, tangent
normals, and tintmask alphas straight from Next.js static files without calling
`/api/mo2/convert` or running Python at runtime.

Usage:
    python -I scripts/sync_static_textures.py
    python -I scripts/sync_static_textures.py --kinds eyes makeup tattoo
    python -I scripts/sync_static_textures.py --force
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import asset_source  # noqa: E402
import convert_worker  # noqa: E402
from sync_mo2_assets import open_dds  # noqa: E402

TEXTURE_ONLY_KINDS = (
    "skin",
    "body",
    "eyes",
    "brows",
    "lashes",
    "mouth",
    "makeup",
    "tattoo",
)


def _open_image(src: Path) -> Image.Image:
    try:
        im = Image.open(src)
        im.load()
        return im
    except Exception:
        return open_dds(src)


def _is_fresh(dst: Path, src_mtime: float, worker_mtime: float, force: bool) -> bool:
    if force or not dst.is_file():
        return False
    try:
        st = dst.stat()
        return st.st_size > 0 and st.st_mtime >= src_mtime and st.st_mtime >= worker_mtime
    except OSError:
        return False


def _save_atomic(im: Image.Image, dst: Path, kind_fmt: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f"{dst.name}.{os.getpid()}.tmp")
    try:
        if kind_fmt == "webp_atlas":
            im.save(tmp, "WEBP", quality=95, method=4)
        elif kind_fmt == "webp_thumb":
            im.save(tmp, "WEBP", quality=86, method=4)
        elif kind_fmt == "webp_disc":
            im.save(tmp, "WEBP", quality=94, method=4)
        elif kind_fmt == "png":
            im.save(tmp, "PNG", optimize=True)
        else:
            raise ValueError(f"unknown format {kind_fmt}")
        os.replace(tmp, dst)
    except Exception:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise


def _build_alpha_mask(im: Image.Image) -> Image.Image:
    rgba = convert_worker.to_rgba(im)
    arr_rgba = np.array(rgba)
    arr_a = arr_rgba[:, :, 3]
    a_min, a_max, a_mean = int(arr_a.min()), int(arr_a.max()), float(arr_a.mean())
    has_genuine_alpha = a_min < 25 and a_max > 120 and 5 < a_mean < 245

    if has_genuine_alpha:
        raw_cov = arr_a
    else:
        raw_cov = np.array(rgba.convert("L"))

    floor = float(np.percentile(raw_cov, 5))
    if floor > 0:
        cleaned = np.maximum(0, raw_cov.astype(np.float32) - floor)
        max_val = float(cleaned.max())
        cleaned = (cleaned / max_val * 255.0).astype(np.uint8) if max_val > 0 else cleaned.astype(np.uint8)
    else:
        cleaned = np.where(raw_cov < 8, 0, raw_cov).astype(np.uint8)

    out_mask = Image.new("RGBA", rgba.size, (255, 255, 255, 0))
    out_mask.putalpha(Image.fromarray(cleaned))
    return convert_worker.downscale(out_mask, convert_worker.ALBEDO_MAX)


def _process_entry(
    kind: str,
    entry: dict[str, Any],
    root: Path,
    out_dir: Path,
    public_base: str,
    worker_mtime: float,
    force: bool,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    eid = entry["id"]
    role = entry.get("mapRole", "albedo")
    rel = entry.get("rel", "")
    src = asset_source.resolve_rel(root, rel)
    if src is None or entry.get("unavailable") or entry.get("available") is False:
        return eid, {}, {"status": "skipped"}

    src_mtime = src.stat().st_mtime
    tex_dir = out_dir / "textures" / kind
    base_url = f"{public_base}/textures/{kind}"
    urls: dict[str, str] = {}
    meta: dict[str, Any] = {"status": "cached"}
    im: Image.Image | None = None

    def get_im() -> Image.Image:
        nonlocal im
        if im is None:
            im = _open_image(src)
        return im

    if role == "normal":
        normal_dst = tex_dir / f"{eid}-normal.png"
        if not _is_fresh(normal_dst, src_mtime, worker_mtime, force):
            out = convert_worker.downscale(get_im().convert("RGB"), convert_worker.ALBEDO_MAX)
            _save_atomic(out, normal_dst, "png")
            meta["status"] = "built"
        urls["normal"] = f"{base_url}/{normal_dst.name}"
        return eid, urls, meta

    if role != "albedo":
        return eid, {}, {"status": "skipped"}

    atlas_dst = tex_dir / f"{eid}-atlas.webp"
    thumb_dst = tex_dir / f"{eid}-thumb.webp"
    if not _is_fresh(atlas_dst, src_mtime, worker_mtime, force):
        rgba = convert_worker.downscale(convert_worker.to_rgba(get_im()), convert_worker.ATLAS_MAX)
        _save_atomic(rgba, atlas_dst, "webp_atlas")
        meta["status"] = "built"
    urls["atlas"] = f"{base_url}/{atlas_dst.name}"

    if not _is_fresh(thumb_dst, src_mtime, worker_mtime, force):
        thumb = convert_worker.to_rgba(get_im()).copy()
        thumb.thumbnail((convert_worker.THUMB_PX, convert_worker.THUMB_PX), Image.LANCZOS)
        _save_atomic(thumb, thumb_dst, "webp_thumb")
        meta["status"] = "built"
    urls["thumb"] = f"{base_url}/{thumb_dst.name}"

    if kind == "eyes":
        disc_dst = tex_dir / f"{eid}-disc.webp"
        if not _is_fresh(disc_dst, src_mtime, worker_mtime, force):
            src_im = get_im()
            info = convert_worker.measure_iris(src_im)
            w, h = src_im.size
            side = max(16, int(min(w, h) * min(0.9, info["r"] * 2.4)))
            cx, cy = int(info["cx"] * w), int(info["cy"] * h)
            x0 = max(0, min(w - side, cx - side // 2))
            y0 = max(0, min(h - side, cy - side // 2))
            crop = src_im.crop((x0, y0, x0 + side, y0 + side)).convert("RGB").resize((256, 256), Image.LANCZOS)
            _save_atomic(crop, disc_dst, "webp_disc")
            meta["irisInfo"] = info
            meta["status"] = "built"
        urls["disc"] = f"{base_url}/{disc_dst.name}"

    if kind in ("makeup", "tattoo"):
        alpha_dst = tex_dir / f"{eid}-alpha.png"
        if not _is_fresh(alpha_dst, src_mtime, worker_mtime, force):
            alpha_im = _build_alpha_mask(get_im())
            _save_atomic(alpha_im, alpha_dst, "png")
            meta["status"] = "built"
        urls["alpha"] = f"{base_url}/{alpha_dst.name}"

    return eid, urls, meta


def _atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description="Pre-bake texture-only pack categories to static assets.")
    ap.add_argument(
        "--kinds",
        nargs="+",
        choices=TEXTURE_ONLY_KINDS,
        default=list(TEXTURE_ONLY_KINDS),
        help="Texture kinds to pre-bake statically (default: all 8 texture-only kinds).",
    )
    ap.add_argument("--force", action="store_true", help="Re-encode all static textures even when up to date.")
    ap.add_argument("--workers", type=int, default=min(8, max(2, os.cpu_count() or 4)), help="Worker threads.")
    args = ap.parse_args()

    cfg = asset_source.load()
    if cfg["layout"] != "pack":
        print(f"[!] Active layout is {cfg['layout']!r}; expected 'pack'.", file=sys.stderr)
        return 1

    root = Path(cfg["root"])
    out_dir = Path(cfg["out"])
    public_base = cfg["publicBase"]
    if not root.is_dir():
        print(f"[!] Pack root missing: {root}", file=sys.stderr)
        return 1

    worker_mtime = Path(convert_worker.__file__).stat().st_mtime
    t0 = time.perf_counter()
    total_built = 0
    total_cached = 0
    total_errors = 0

    for kind in args.kinds:
        cat_path = out_dir / "catalogue" / f"{kind}.json"
        if not cat_path.is_file():
            print(f"[skip] {kind}: {cat_path} not found")
            continue

        entries: list[dict[str, Any]] = json.loads(cat_path.read_text(encoding="utf-8"))
        k_t0 = time.perf_counter()
        results: dict[str, dict[str, str]] = {}
        iris_meta: dict[str, dict[str, Any]] = {}
        built = 0
        cached = 0
        errors = 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = {
                pool.submit(_process_entry, kind, e, root, out_dir, public_base, worker_mtime, args.force): e
                for e in entries
            }
            for fut in concurrent.futures.as_completed(futs):
                e = futs[fut]
                try:
                    eid, urls, meta = fut.result()
                    if urls:
                        results[eid] = urls
                    if "irisInfo" in meta:
                        iris_meta[eid] = meta["irisInfo"]
                    if meta.get("status") == "built":
                        built += 1
                    elif meta.get("status") == "cached":
                        cached += 1
                except Exception as exc:
                    errors += 1
                    print(f"[!] {kind}/{e.get('id')} ({e.get('file')}): {exc}", file=sys.stderr)

        # Propagate normal URL onto albedo entries that name a normalId.
        for e in entries:
            eid = e["id"]
            if eid in results:
                urls = dict(results[eid])
                nid = e.get("normalId")
                if nid and nid in results and "normal" in results[nid]:
                    urls["normal"] = results[nid]["normal"]
                e["urls"] = urls
                if kind == "eyes" and eid in iris_meta:
                    e["atlas"] = iris_meta[eid]
            elif "urls" in e:
                del e["urls"]

        _atomic_json(cat_path, entries)
        dt_k = time.perf_counter() - k_t0
        total_built += built
        total_cached += cached
        total_errors += errors
        print(f"[ok] {kind:<8} entries={len(entries):<4} built={built:<4} cached={cached:<4} errors={errors} ({dt_k:.2f}s)")

    elapsed = time.perf_counter() - t0
    print(f"\nDone in {elapsed:.2f}s — built={total_built}, cached={total_cached}, errors={total_errors}")
    return 1 if total_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
