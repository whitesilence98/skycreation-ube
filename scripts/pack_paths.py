#!/usr/bin/env python
"""Resolve references across the pack's category layout.

The pack was regrouped into `<category>/meshes/...` and
`<category>/textures/...` (nested Data paths kept). Authored NIFs still name
shader textures Data-relative (`textures\\...`), and the producer's validated
constants are written that way too, so every lookup has to answer both
spellings.

Resolution order:

1. a path that already exists as written (the physical layout),
2. the same Data path under the category its old section maps to,
3. the same Data path under any other category.

Exactly one hit resolves; none or several return None. Containment is strict,
so `..`, absolute paths and links leaving the pack are refused.

Stdlib only (`python -I` safe), so the contract checker can share it.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import asset_source  # noqa: E402

# The pack's storage categories. `meshes`/`textures` underneath them are the
# Data sections; a category itself is never a shader path.
CATEGORIES = (
    "body", "brows", "clothing", "eyes", "hair", "head", "lashes",
    "mouth", "overlays", "presets", "shared", "skeleton",
)
_DATA_SECTIONS = frozenset({"meshes", "textures", "skse"})

# Old `meshes\!UBE\<part>` folders and the category each became.
_UBE_MESH_CATEGORY = {
    "head": "head", "eyes": "eyes", "brows": "brows", "lashes": "lashes",
    "mouth": "mouth", "armor": "clothing",
}
# Old `textures\!UBE\<folder>` folders. Unlisted folders are overlays:
# Custom_Scars, Gash, Paint and [spaz490] all carry face/body decals.
_UBE_TEXTURE_CATEGORY = {
    "head": "head", "head ao": "head", "body": "body", "nails": "body",
    "custom_scars": "overlays", "gash": "overlays", "paint": "overlays",
    "[spaz490]": "overlays",
}
_HAIR_TEXTURE_SECTIONS = frozenset({"armor", "xiaoyu hair"})
_SHARED_TEXTURE_SECTIONS = frozenset({"cubemaps", "chaosblade"})


def normalize_rel(rel: object) -> str | None:
    """One canonical pack-relative spelling, or None when it cannot be safe.

    Refuses empty, rooted, drive-qualified and parent-traversing input before
    the filesystem is touched, so a candidate is always a plain path join.
    """
    if not isinstance(rel, str):
        return None
    text = rel.replace("/", "\\").strip()
    if not text or text.startswith("\\") or ":" in text:
        return None
    parts = [p for p in text.split("\\") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    return "\\".join(parts)


def is_physical(rel: str) -> bool:
    """True for `category/meshes|textures|SKSE/...`, the grouped layout."""
    parts = rel.replace("/", "\\").split("\\")
    return (
        len(parts) > 1
        and parts[0].lower() in CATEGORIES
        and parts[1].lower() in _DATA_SECTIONS
    )


def virtual_rel(rel: object) -> str:
    """The Data-relative spelling of a physical row (`head\\textures\\...`)."""
    norm = normalize_rel(rel)
    if norm is None:
        return str(rel).replace("/", "\\")
    parts = norm.split("\\")
    if is_physical(norm):
        parts = parts[1:]
    return "\\".join(parts)


def pack_mod(rel: object) -> str:
    """The old top-level section (`meshes`, `textures`, `SKSE`) of a row."""
    norm = normalize_rel(rel)
    if norm is None:
        return "pack"
    parts = norm.split("\\")
    if is_physical(norm):
        return parts[1]
    return parts[0] if parts else "pack"


def _legacy_candidates(rel: str) -> list[str]:
    """Physical candidates for an old Data-relative path, by known mapping."""
    parts = rel.split("\\")
    low = [p.lower() for p in parts]
    out: list[str] = []
    if low[0] == "meshes":
        if len(parts) > 2 and low[1] in ("hairs", "clothes"):
            category = "hair" if low[1] == "hairs" else "clothing"
            out.append("\\".join([category, "meshes", *parts[2:]]))
        elif len(parts) > 2 and low[1] == "!ube":
            category = _UBE_MESH_CATEGORY.get(low[2], "body")
            out.append("\\".join([category, *parts]))
        elif len(parts) > 1 and low[1] == "actors":
            out.append("\\".join(["skeleton", *parts]))
    elif low[0] == "textures":
        if len(parts) > 2 and low[1] == "!ube":
            category = _UBE_TEXTURE_CATEGORY.get(low[2], "overlays")
            out.append("\\".join([category, *parts]))
        elif len(parts) > 1 and low[1] in _HAIR_TEXTURE_SECTIONS:
            out.append("\\".join(["hair", *parts]))
        elif len(parts) > 2 and low[1] == "caenarvon":
            if low[2] == "cosplay":
                out.append("\\".join(["clothing", *parts]))
            elif low[2] in ("halo", "cubemap"):
                out.append("\\".join(["shared", *parts]))
        elif len(parts) > 1 and low[1] in _SHARED_TEXTURE_SECTIONS:
            out.append("\\".join(["shared", *parts]))
    elif low[0] == "skse":
        out.append("\\".join(["presets", *parts]))
    return out


def _actual_rel(root: Path, path: Path) -> str | None:
    try:
        return str(path.resolve().relative_to(root)).replace("/", "\\")
    except (OSError, ValueError):
        return None


def pack_rel(root: Path, rel: str) -> Path | None:
    """Contained path for either spelling; None when missing or ambiguous.

    A physical path wins outright, because it already names one file. An old
    Data path is tried under its mapped category and then under every
    category; two different hits mean the reference is ambiguous, and a wrong
    atlas is worse than none.
    """
    norm = normalize_rel(rel)
    if norm is None:
        return None
    root_real = Path(root).resolve()
    direct = asset_source.resolve_rel(root_real, norm)
    if direct is not None:
        return direct
    # A category path is the authoritative spelling: it either exists or the
    # file is gone. Falling back would let a stale row resolve into another
    # category's tree.
    if is_physical(norm):
        return None

    hits: dict[str, Path] = {}
    candidates = _legacy_candidates(norm)
    candidates += [f"{category}\\{norm}" for category in CATEGORIES]
    for candidate in candidates:
        path = asset_source.resolve_rel(root_real, candidate)
        if path is None:
            continue
        actual = _actual_rel(root_real, path)
        if actual is not None:
            hits[actual.casefold()] = path
    return next(iter(hits.values())) if len(hits) == 1 else None


def physical_rel(root: Path, rel: str) -> str | None:
    """The on-disk, category-prefixed rel for a reference, or None."""
    path = pack_rel(root, rel)
    if path is None:
        return None
    return _actual_rel(Path(root).resolve(), path)
