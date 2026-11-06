#!/usr/bin/env python
"""Producers for the pack-layout source (`layout: "pack"`).

The pack is one Data-like tree (`meshes/`, `textures/`, `hairs/`, `clothes/`),
not a folder of MO2 mods. This module owns both pack jobs:

    python -I scripts/index_mo2_assets.py      # dispatches here when pack
    python scripts/sync_mo2_assets.py          # dispatches here when pack

It writes only under the configured `publicBase` (`/assets/preset-pack`); the
legacy `public/assets/mo2` tree is never read or written. Every write is a
temp-file + `os.replace`, so a half-written catalogue or manifest is never
served. Source paths in generated data are pack-relative; the Windows root
never leaves the config.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import asset_source  # noqa: E402
import pack_paths  # noqa: E402
from index_mo2_assets import (  # noqa: E402
    classify,
    nif_texture_refs,
    probe_mesh,
    read_size,
)

# Kind order mirrors `lib/mo2/types.ts` PICKER_KINDS.
PACK_KINDS = [
    "headMesh", "eyeMesh", "lashesMesh", "browsMesh", "mouthMesh", "bodyMesh",
    "hairMesh", "clothingMesh",
    "skeleton",
    "skin", "eyes", "lashes", "brows", "mouth", "body", "hair", "clothing",
    "preset", "makeup", "tattoo", "wrinkle", "other",
]
PACK_MESH_KINDS = frozenset(k for k in PACK_KINDS if k.endswith("Mesh"))
TEXTURE_KIND_FOR_MESH = {
    "headMesh": "skin", "eyeMesh": "eyes", "lashesMesh": "lashes",
    "browsMesh": "brows", "mouthMesh": "mouth", "bodyMesh": "body",
    "hairMesh": "hair", "clothingMesh": "clothing",
}
TEXTURE_EXTS = {".dds", ".png", ".jpg", ".jpeg", ".tga"}
MESH_EXTS = {".nif", ".tri", ".obj"}
PACK_EXTS = TEXTURE_EXTS | MESH_EXTS | {".jslot"}
# OSD files are BodySlide physics output, not wearable render choices.
IGNORED_EXTS = {".osd"}

# A texture path is classified by the shape slot that references it, not by
# its folder name. BodySlide/BDOR/Caenarvon trees (`ppw`, `pkw`, `Caenarvon`)
# match no legacy family rule, so a supplied DDS would otherwise stay `other`.
TEXTURE_KIND_BY_ROLE = {
    "hair": "hair",
    "skin": "body",
    "clothing": "clothing",
    "accessory": "clothing",
}
SLOT_TO_MAPROLE = {"albedo": "albedo", "normal": "normal"}
REQUIRED_SLOTS = ("albedo", "normal")
OPTIONAL_SLOTS = ("specular", "gloss", "emissive")


# The validated FRTRI bases. The pack's NIF head/eye/lash/brow/mouth meshes are
# not used as standalone geometry: the TRI is the file the app has measured.
PART_MESH_REL = {
    "headMesh": r"meshes\!UBE\Head\FemaleHead.tri",
    "eyeMesh": r"meshes\!UBE\Eyes\eyesfemale.tri",
    "lashesMesh": r"meshes\!UBE\Lashes\EyeFemaleLashes.tri",
    "browsMesh": r"meshes\!UBE\Brows\femaleheadbrows.tri",
    "mouthMesh": r"meshes\!UBE\Mouth\mouthhumanf_tangent.tri",
}
EXPECTED = {
    "headMesh": (11498, 22044),
    "eyeMesh": (1892, 3264),
    "lashesMesh": (1216, 2016),
    "browsMesh": (501, 880),
    "mouthMesh": (9043, 16328),
}

HEAD_D = r"textures\!UBE\Head\femaleHead_d.dds"
HEAD_N = r"textures\!UBE\Head\femalehead_n.dds"
BODY_D = r"textures\!UBE\Body\femalebody_1_d.dds"
BODY_N = r"textures\!UBE\Body\femalebody_1_n.dds"

MISSING_EYE_REASON = (
    "Eye atlases are not in the pack: textures\\!COR\\Eyes_ILV\\eye01.dds "
    "and its _n/_sk companions."
)
MISSING_LASH_REASON = (
    "Lash atlases are not in the pack: textures\\!COR\\Lashes\\*.dds."
)
MISSING_BROW_REASON = (
    "Brow atlases are not in the pack: textures\\!COR\\Brows\\*.dds."
)
MISSING_MOUTH_REASON = (
    "Mouth atlases are not in the pack: textures\\!COR\\Mouth\\MouthMap_d.dds "
    "and its _n/_m companions."
)
MISSING_HAIR_REASON = (
    "BDOR hair atlases are not in the pack (textures\\armor\\[d] bdor\\hair\\...). "
    "Add the referenced DDS files and re-run sync; the NIF stays on demand."
)
MISSING_CLOTHING_REASON = (
    "Outfit atlases are not in the pack: "
    "textures\\Caenarvon\\Cosplay\\ghosted\\3_D.dds, 3_N.dds, 3_M.dds and "
    "textures\\Caenarvon\\cubemap\\GlossBlack_e.dds."
)

# The NIF that authors each facial part's texture refs. When the referenced
# DDS files are supplied, the part becomes a real option instead of a
# permanent unavailable placeholder.
FACIAL_NIF_REL = {
    "eyes": r"meshes\!UBE\Eyes\eyesfemale.nif",
    "lashes": r"meshes\!UBE\Lashes\EyeFemaleLashes.nif",
    "brows": r"meshes\!UBE\Brows\FemaleBrows.nif",
    "mouth": r"meshes\!UBE\Mouth\MouthHumanF_tangent.nif",
}
FACIAL_REASON = {
    "eyes": MISSING_EYE_REASON,
    "lashes": MISSING_LASH_REASON,
    "brows": MISSING_BROW_REASON,
    "mouth": MISSING_MOUTH_REASON,
}


# ── naming / freshness ──────────────────────────────────────────────────────


def pack_root(cfg: dict) -> Path:
    return Path(cfg["root"])


def pack_id(kind: str, rel: str, st: os.stat_result, authored: bool = False) -> str:
    """Stable id; authored NIFs fold in size+mtime so a changed mesh cannot
    keep serving an old converted cache under the same id."""
    key = f"preset-pack\0{kind}\0{rel}"
    if authored:
        key += f"\0{st.st_size}\0{int(st.st_mtime)}"
    return f"{kind}-{hashlib.sha1(key.encode('utf-8', 'surrogatepass')).hexdigest()[:16]}"


def script_cutoff() -> float:
    """Newest producer/config mtime; a cache older than this is rebuilt."""
    files = [
        Path(__file__),
        _SCRIPTS / "asset_source.py",
        _SCRIPTS / "index_mo2_assets.py",
        _SCRIPTS / "convert_worker.py",
        _SCRIPTS / "sync_mo2_assets.py",
        asset_source.CONFIG,
    ]
    newest = 0.0
    for p in files:
        try:
            newest = max(newest, p.stat().st_mtime)
        except OSError:
            pass
    return newest


def is_fresh(src: Path, dst: Path, cutoff: float) -> bool:
    try:
        return dst.is_file() and dst.stat().st_mtime >= max(src.stat().st_mtime, cutoff)
    except OSError:
        return False


def atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def atomic_json(path: Path, data: Any, indent: int | None = 2) -> None:
    atomic_text(path, json.dumps(data, indent=indent, ensure_ascii=False))


def atomic_image(im, path: Path, fmt: str, **kwargs: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    im.save(tmp, fmt, **kwargs)
    os.replace(tmp, path)


def safe_needles(root: str | Path) -> list[str]:
    """Every spelling of the absolute root that must never reach served JSON.

    Pillow and the worker raise messages containing the path they were handed,
    so a failed decode would otherwise publish the Windows layout. Both slash
    directions and the trailing separator are matched case-insensitively.
    """
    text = str(root)
    variants = {text, text.replace("\\", "/"), text.rstrip("\\/"), text.rstrip("/\\").replace("\\", "/")}
    variants = {v for v in variants if v and len(v) >= 3}
    return sorted(variants, key=len, reverse=True)


def scrub(cfg: dict, value: Any, needles: list[str] | None = None) -> Any:
    """Recursively replace the absolute root with the safe source label."""
    needles = needles if needles is not None else safe_needles(cfg["root"])
    if isinstance(value, str):
        for needle in needles:
            value = re.sub(re.escape(needle), cfg["label"], value, flags=re.IGNORECASE)
        return value
    if isinstance(value, list):
        return [scrub(cfg, v, needles) for v in value]
    if isinstance(value, dict):
        return {k: scrub(cfg, v, needles) for k, v in value.items()}
    return value


# ── classification ──────────────────────────────────────────────────────────


def decode_probe(path: Path) -> dict[str, Any]:
    """Actually decode a NIF once, so the catalogue records what the worker can.

    Called only for pack part NIFs. The flat decoder is what
    `runWorker` uses for a non-authored part, so this is the same path a
    request would take — no second opinion to disagree with.
    """
    from convert_worker import nif_geometry

    try:
        geo = nif_geometry(path, "head")
    except Exception as exc:  # noqa: BLE001 — a bad NIF is a row fact, not a crash
        return {"decodable": False, "reason": f"NIF could not be decoded: {exc}"}
    if not geo.get("vertexCount") or not geo.get("triangleCount"):
        return {"decodable": False, "reason": "NIF contains no drawable geometry"}
    return {
        "decodable": True,
        "vertices": geo["vertexCount"],
        "triangles": geo["triangleCount"],
    }


def classify_pack(rel: str, path: Path | None = None) -> tuple[str, str | None, bool]:
    """(kind, mapRole, authored_nif) for one pack-relative path.

    `path` is the file on disk; a part NIF cannot be judged decodable without
    reading its header, and the header is the only thing that separates a real
    lashes mesh from a truncated one.

    The pack stores assets as `<category>/meshes/...` and
    `<category>/textures/...`; classification is about the Data-relative part,
    so the category is stripped first. Hair and clothing mesh subtrees are
    authored regardless of the old family rules.
    """
    p = Path(rel)
    ext = p.suffix.lower()
    parts = rel.split("\\")
    section = parts[0].lower() if parts else ""
    # `head\meshes\!UBE\Head\...` classifies as `meshes\!UBE\Head\...`.
    data_parts = parts[1:] if pack_paths.is_physical(rel) else parts
    data_section = data_parts[0].lower() if data_parts else ""
    data_sub = data_parts[1].lower() if len(data_parts) > 1 else ""
    rest = "\\".join(data_parts[1:])

    # Collision bodies are never selectable character parts, in any folder.
    stem = p.stem.lower()
    if ext == ".nif" and (
        stem.startswith("col") or "collision" in stem or stem.startswith("3bbbcollision")
    ):
        return "other", "collision", False

    # Authored hair/clothing: category layout (`hair/meshes`), the pack's
    # Data-like tree (`meshes\hairs`), and the old MO2 top-level form
    # (`hairs\...`, `clothes\...`).
    hair_section = (
        section == "hairs"
        or (section == "hair" and data_section == "meshes")
        or (data_section == "meshes" and data_sub == "hairs")
    )
    cloth_section = (
        section == "clothes"
        or (section == "clothing" and data_section == "meshes")
        or (data_section == "meshes" and data_sub == "clothes")
    )
    if hair_section and ext == ".nif":
        return "hairMesh", None, True
    if cloth_section and ext == ".nif":
        return "clothingMesh", None, True

    kind, role = classify(data_parts[0] if data_parts else "pack", rest)

    if ext == ".nif" and kind in PACK_MESH_KINDS:
        # Part NIFs used to be demoted wholesale on the belief that only the
        # FRTRI base was decodable. Measured against the pack's own files, the
        # flat decoder reads 78 of 82 NIFs — every `!UBE` lashes/mouth/eye mesh,
        # the outfit, all 19 BDOR hairs and the six CharGen sculpts. What fails
        # is the skeleton (correctly: no geometry) and two truncated Xiaoyu
        # files. So the decision is a per-file probe, not a folder-level rule.
        if path is None:
            return "other", "mesh", False
        probe = probe_mesh(path, p.stem)
        if probe.get("decodable"):
            return kind, None, False
        return "other", "mesh", False
    return kind, role, False


def iter_pack_files(root: Path) -> Iterable[tuple[str, Path, os.stat_result]]:
    root_real = root.resolve()
    for dirpath, dirnames, filenames in os.walk(root_real):
        # Symlinked/junctioned directories could leave the pack.
        dirnames[:] = sorted(d for d in dirnames if _inside(root_real, Path(dirpath, d)))
        for fn in sorted(filenames):
            p = Path(dirpath) / fn
            ext = p.suffix.lower()
            if ext in IGNORED_EXTS or ext not in PACK_EXTS:
                continue
            try:
                st = p.stat()
                rel = str(p.relative_to(root_real)).replace("/", "\\")
            except (OSError, ValueError):
                continue
            if asset_source.resolve_rel(root_real, rel) is None:
                continue
            yield rel, p, st


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    return True


def pack_rel(root: Path, rel: str) -> Path | None:
    """Contained resolve across the category layout; see `pack_paths`.

    A physical `<category>/...` path wins; an old Data-relative path
    (`textures\\!UBE\\Head\\...`) is tried under its mapped category and then
    under any one category. Missing or ambiguous returns None.
    """
    return pack_paths.pack_rel(root, rel)


def normal_key_for(rel: str) -> str:
    """`textures\\x\\10a.dds` → `textures\\x\\10a_n.dds` (same folder)."""
    p = rel.replace("/", "\\")
    stem = p[:-4] if p.lower().endswith(".dds") else p
    if stem.lower().endswith("_d"):
        stem = stem[:-2]
    return (stem + "_n.dds").lower()


WEIGHT_STEM = re.compile(r"^(.*?)_([01])$")


def weight_key(stem: str) -> tuple[str, int] | None:
    """`femalebody_0` → `('femalebody', 0)`; anything else → None.

    Skyrim stores a body as two meshes at weight 0 and 100 over one atlas, and
    the game lerps between them. The index is the last token, so `_1` inside a
    longer name (`femalebody_etc_1`) still parses — and that file is *not* a
    weight pair, which is why the pairing below insists both halves exist.
    """
    m = WEIGHT_STEM.match(stem.lower())
    return (m.group(1), int(m.group(2))) if m else None


def build_weight_pairs(entries: list[dict[str, Any]]) -> int:
    """Join `_0`/`_1` body meshes into a weight pair. Returns how many joined.

    The two halves are only a pair when they are the same topology — same
    indices, same UVs, same normal count — because the renderer lerps
    positions vertex-for-vertex and anything else would tear. Measured on
    CBBE 3BA: 20,542 v / 39,842 t both sides, indices and UVs identical.
    """
    groups: dict[str, dict[int, dict[str, Any]]] = {}
    for e in entries:
        if e.get("kind") != "bodyMesh" or e.get("decodable") is False:
            continue
        key = weight_key(Path(e["file"]).stem)
        if not key or key[1] not in (0, 1):
            continue
        groups.setdefault(key[0], {})[key[1]] = e

    joined = 0
    for stem, halves in groups.items():
        w0, w1 = halves.get(0), halves.get(1)
        if not w0 or not w1:
            continue
        # Both must have decoded with the same counts. A pair that does not
        # match is left as two independent rows rather than blended wrongly.
        if (w0.get("vertices"), w0.get("triangles")) != (w1.get("vertices"), w1.get("triangles")):
            continue
        w0["weightKey"] = stem
        w1["weightKey"] = stem
        w0["weightVariants"] = {"w0": w0["id"], "w1": w1["id"]}
        w1["weightVariants"] = {"w0": w0["id"], "w1": w1["id"]}
        # The `_1` half is the default: Skyrim's own default weight is 1.0.
        w1["weightDefault"] = 1
        joined += 1

    return joined


def build_pairing(entries: list[dict[str, Any]], root: Path) -> None:
    textures = [e for e in entries if e.get("kind") in TEXTURE_KIND_FOR_MESH.values()]
    by_rel = {e["rel"].lower(): e for e in textures}
    # NIFs name Data-relative paths; the rows are stored under their category.
    # A Data path supplied by two categories is ambiguous, exactly as the
    # server treats it: neither row may be picked as the pair.
    virtual: dict[str, dict[str, Any] | None] = {}
    for e in textures:
        key = pack_paths.virtual_rel(e["rel"]).lower()
        virtual[key] = None if key in virtual else e

    for e in entries:
        if e.get("kind") not in PACK_MESH_KINDS or e.get("decodable") is False:
            continue
        path = pack_rel(root, e["rel"])
        if path is None:
            continue
        if path.suffix.lower() == ".nif":
            files = [path]
        elif path.suffix.lower() == ".tri":
            files = sorted(path.parent.glob("*.nif")) if path.parent.is_dir() else []
        else:
            continue
        refs: list[str] = []
        for f in files:
            for ref in nif_texture_refs(f):
                low = ref.lower()
                # A cubemap is a reflection probe, never the diffuse the part
                # samples; treating it as a candidate would make every eye
                # mesh ambiguous.
                if "cubemap" in low:
                    continue
                if low not in {r.lower() for r in refs}:
                    refs.append(ref)

        want = TEXTURE_KIND_FOR_MESH[e["kind"]]
        candidates: dict[str, dict[str, Any]] = {}
        for ref in refs:
            key = ref.replace("/", "\\").lower()
            hit = virtual.get(key)
            if hit is None:
                hit = by_rel.get(key)
            if hit is not None and hit["kind"] == want and hit.get("mapRole", "albedo") == "albedo":
                candidates[hit["id"]] = hit
        if len(candidates) != 1:
            continue
        atlas = next(iter(candidates.values()))
        e["pairedTextureId"] = atlas["id"]
        normal = virtual.get(normal_key_for(pack_paths.virtual_rel(atlas["rel"])))
        if normal is not None and normal.get("mapRole") == "normal":
            atlas["normalId"] = normal["id"]


# ── catalogue ───────────────────────────────────────────────────────────────


def authored_decode(path: Path) -> dict[str, Any]:
    """In-memory authored decode from the peer's `convert_worker`.

    Returns `{groups, materials, positions, indices, ...}`. Raises when the
    worker has no authored path or the layout is unsupported; callers degrade
    to an honest unavailable row rather than guessing at geometry.
    """
    from convert_worker import nif_geometry

    try:
        decoded = nif_geometry(path, "head", authored=True)  # type: ignore[call-arg]
    except TypeError as exc:
        raise RuntimeError("convert_worker has no authored NIF decoder yet") from exc
    if not isinstance(decoded, dict) or not decoded.get("materials"):
        raise RuntimeError("authored decode returned no materials")
    return decoded


def material_roles(materials: list[dict[str, Any]]) -> dict[str, Any]:
    """Body/skin shapes vs garment shapes, from the authored `sourceShape`."""
    body = [m for m in materials if m.get("role") == "skin"]
    clothing = [m for m in materials if m.get("role") in ("clothing", "accessory")]
    return {"body": body, "clothing": clothing}


def material_refs(materials: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Per-role texture refs, deduped, masks/cubemaps kept as optional."""
    out: dict[str, list[str]] = {}
    for m in materials:
        role = str(m.get("role") or "accessory")
        refs = out.setdefault(role, [])
        for slot, ref in (m.get("textureRefs") or {}).items():
            if not ref or not str(ref).lower().endswith(".dds"):
                continue
            key = str(ref).replace("/", "\\")
            if key.lower() not in {r.lower() for r in refs}:
                refs.append(key)
    return out


def required_missing(
    materials: list[dict[str, Any]],
    existing: set[str],
    slots: tuple[str, ...] = REQUIRED_SLOTS,
) -> list[str]:
    """Missing refs for the given slots; specular/gloss/emissive never block."""
    missing: list[str] = []
    for m in materials:
        for slot in slots:
            ref = (m.get("textureRefs") or {}).get(slot)
            if not ref:
                continue
            key = str(ref).replace("/", "\\").lower()
            if key not in existing and key not in {r.lower() for r in missing}:
                missing.append(str(ref))
    return missing


def optional_missing(materials: list[dict[str, Any]], existing: set[str]) -> list[str]:
    missing: list[str] = []
    for m in materials:
        for slot in OPTIONAL_SLOTS:
            ref = (m.get("textureRefs") or {}).get(slot)
            if not ref:
                continue
            key = str(ref).replace("/", "\\").lower()
            if key not in existing and key not in {r.lower() for r in missing}:
                missing.append(str(ref))
    return missing


def canonical_refs(materials: list[dict[str, Any]], root: Path) -> None:
    """Rewrite each supplied texture ref to the file's actual pack rel.

    A NIF keeps naming `textures\\...`; the same file now lives at
    `head\\textures\\...`. Resolving here, before `required_missing` and the
    referenced-texture pass, keeps every lookup keyed on the physical path, so
    one file can never be added as a second row. Unresolvable refs stay as the
    NIF spells them: they are reported missing, never invented.
    """
    for m in materials:
        refs = m.get("textureRefs")
        if not isinstance(refs, dict):
            continue
        for slot, ref in list(refs.items()):
            if not isinstance(ref, str) or not ref.lower().endswith(".dds"):
                continue
            actual = pack_paths.physical_rel(root, ref)
            if actual is not None:
                refs[slot] = actual



def _validate_authored(
    entry: dict[str, Any],
    path: Path,
    existing_rel: dict[str, tuple[Path, os.stat_result]],
    root: Path,
) -> dict[str, list[str]] | None:
    """Decode in memory, validate groups/materials, return per-role refs.

    Nothing is written here: hair is decoded again on demand. A mesh that
    cannot be decoded is greyed with its reason; it is never emitted as a
    ready-looking row. Missing required (albedo/normal) refs make the row
    unavailable now, but the row stays so that adding the DDS files and
    resyncing re-enables it — no hardcoded unavailable state.
    """
    try:
        decoded = authored_decode(path)
    except Exception as exc:  # noqa: BLE001 — one bad mesh must not stop the walk
        entry["decodable"] = False
        entry["reason"] = f"authored decode unavailable: {type(exc).__name__}: {exc}"
        return None

    mats = [m for m in decoded.get("materials") or [] if isinstance(m, dict)]
    groups = list(decoded.get("groups") or [])
    if not mats or not groups:
        entry["decodable"] = False
        entry["reason"] = "authored decode returned no render groups"
        return None
    if entry.get("kind") == "clothingMesh" and not material_roles(mats)["body"]:
        entry["decodable"] = False
        entry["reason"] = "outfit has no identifiable embedded body/skin shape"
        return None

    canonical_refs(mats, root)
    refs = material_refs(mats)
    # Existing rows are keyed by their storage path; the NIF refs were just
    # rewritten to it above, and `existing_rel` already holds those keys.
    albedo_missing = required_missing(mats, set(existing_rel), ("albedo",))
    normal_missing = required_missing(mats, set(existing_rel), ("normal",))
    opt_missing = optional_missing(mats, set(existing_rel))
    entry["decodable"] = True
    entry["meshFrame"] = "head"
    entry["hasBodyShape"] = bool(material_roles(mats)["body"])
    entry["materialCount"] = len(mats)
    entry["groupCount"] = len(groups)
    if albedo_missing:
        # Decodable geometry, but no diffuse atlas. It stays `unavailable` so
        # texture modes still refuse it; `untextured` is the mesh-mode
        # exemption that lets the app draw the shapes flat grey.
        entry["unavailable"] = True
        entry["untextured"] = True
        missing = albedo_missing + [r for r in normal_missing if r.lower() not in {m.lower() for m in albedo_missing}]
        entry["missingTextures"] = missing
        entry["reason"] = f"{len(missing)} required texture(s) missing from the pack"
    elif normal_missing:
        # A normal map is optional at render time; it must not hide a shape.
        opt_missing = normal_missing + opt_missing
    if opt_missing:
        entry["optionalMissingTextures"] = opt_missing
    return refs


def _apply_referenced_textures(
    catalogue: dict[str, list[dict[str, Any]]],
    referenced: dict[str, tuple[str, str]],
    existing_rel: dict[str, tuple[Path, os.stat_result]],
) -> None:
    """Place supplied referenced DDS under the shape role's kind.

    A `ppw` hair atlas is `other` by path alone; the authored material that
    names it is the authority. Existing rows are re-kinded in place, missing
    ones are added (they cannot exist here, but the guard keeps it total).
    """
    by_rel: dict[str, dict[str, Any]] = {
        e["rel"].lower(): e for rows in catalogue.values() for e in rows
    }
    for key, (role, authored_rel) in referenced.items():
        kind = TEXTURE_KIND_BY_ROLE.get(role)
        if kind is None:
            continue
        row = by_rel.get(key)
        if row is not None:
            if row["kind"] != kind:
                old_kind = row["kind"]
                row["referencedKind"] = old_kind
                row["kind"] = kind
                row["id"] = pack_id(kind, row["rel"], existing_rel[row["rel"].lower()][1])
                row["referencedBy"] = authored_rel
                catalogue[old_kind].remove(row)
                catalogue[kind].append(row)
            row.setdefault("referencedBy", authored_rel)
            continue
        hit = existing_rel.get(key)
        if hit is None:
            continue
        path, st = hit
        map_role = "normal" if key.endswith("_n.dds") else "albedo"
        row = {
            "id": pack_id(kind, key, st),
            "mod": pack_paths.pack_mod(key),
            "file": path.name,
            "label": path.stem,
            "rel": key,
            "bytes": st.st_size,
            "mtime": int(st.st_mtime),
            "kind": kind,
            "mapRole": map_role,
            "referencedBy": authored_rel,
        }
        catalogue[kind].append(row)
        by_rel[key] = row


def by_rel_body_normal(catalogue: dict[str, list[dict[str, Any]]], body_row: dict[str, Any] | None) -> str | None:
    if body_row is None:
        return None
    want = normal_key_for(pack_paths.virtual_rel(body_row["rel"])).lower()
    hit = next(
        (e for e in catalogue["body"] if pack_paths.virtual_rel(e["rel"]).lower() == want),
        None,
    )
    return hit["id"] if hit is not None else None


def build_catalogue(cfg: dict) -> int:
    root = pack_root(cfg)
    out = Path(cfg["out"])
    catalogue: dict[str, list[dict[str, Any]]] = {k: [] for k in PACK_KINDS}
    errors: list[str] = []
    diagnostics: list[str] = []
    scanned = skipped = 0

    if not root.is_dir():
        errors.append(f"pack root not found: {root.name}")
    else:
        existing_rel: dict[str, tuple[Path, os.stat_result]] = {}
        referenced: dict[str, tuple[str, str]] = {}
        # Lowercased shape rel -> the albedo its skin-role material names. The
        # flat NIF scan can miss refs past its read window; the authored decode
        # already has them, so pairing does not have to decode again.
        skin_albedo: dict[str, str] = {}
        raw: list[tuple[str, Path, os.stat_result]] = []
        for rel, path, st in iter_pack_files(root):
            raw.append((rel, path, st))
            existing_rel[rel.lower()] = (path, st)
            scanned += 1

        for rel, path, st in raw:
            ext = path.suffix.lower()
            kind, role, authored = classify_pack(rel, path)
            if ext not in PACK_EXTS:
                skipped += 1
                continue
            entry: dict[str, Any] = {
                "id": pack_id(kind, rel, st, authored),
                "mod": pack_paths.pack_mod(rel),
                "file": path.name,
                "label": path.stem,
                "rel": rel,
                "bytes": st.st_size,
                "mtime": int(st.st_mtime),
                "kind": kind,
            }
            if ext == ".jslot":
                from sync_mo2_assets import parse_jslot_morphs

                try:
                    data = json.loads(path.read_text(encoding="utf-8-sig"))
                    if not isinstance(data, dict) or not isinstance(data.get("morphs"), dict):
                        raise ValueError("expected a RaceMenu morphs object")
                    custom = data["morphs"].get("custom") or []
                    if not isinstance(custom, list) or any(
                        not isinstance(c, dict) or not isinstance(c.get("name"), str)
                        or not isinstance(c.get("value"), (int, float))
                        or not math.isfinite(c["value"]) for c in custom
                    ):
                        raise ValueError("invalid custom morph list")
                    parsed = parse_jslot_morphs(path)
                    if parsed.get("error"):
                        raise ValueError(parsed["error"])
                    entry.update(parsed)
                    entry["available"] = True
                except (ValueError, TypeError, AttributeError, KeyError, OverflowError) as exc:
                    entry.update(available=False, unavailable=True, reason=f"Invalid preset: {exc}")
            if role:
                entry["mapRole"] = role
            if ext == ".dds":
                size = read_size(path)
                if size:
                    entry["size"] = size
            if authored:
                entry["authored"] = True

            if kind in PACK_MESH_KINDS:
                entry["mapRole"] = "mesh"
                stem_lower = path.stem.lower()
                if path.suffix.lower() == ".tri" and "chargen" in stem_lower:
                    entry["decodable"] = False
                    entry["reason"] = "CharGen variant — not a standalone render choice"
                elif path.suffix.lower() == ".nif" and authored:
                    refs = _validate_authored(entry, path, existing_rel, root)
                    if refs:
                        for role, role_refs in refs.items():
                            for ref in role_refs:
                                referenced.setdefault(ref.lower(), (role, rel))
                        skin_refs = refs.get("skin") or []
                        albedo = next((r for r in skin_refs if r.lower().endswith("_d.dds")), None)
                        if albedo:
                            skin_albedo[rel.lower()] = albedo.lower()
                else:
                    probe = probe_mesh(path, path.stem)
                    # `probe_mesh` only reads the 64-byte signature, which is
                    # enough to refuse a PIRT `.tri` but not to promise a NIF
                    # will decode: Xiaoyu's two files and Nini's sculpt carry a
                    # valid Gamebryo header and still fail in the worker. The
                    # pack is small (82 NIFs, 23 s to decode them all), so the
                    # producer decodes once here and records the truth. This is
                    # what keeps a greyed row greyed and a working one usable.
                    if probe.get("decodable") and path.suffix.lower() == ".nif":
                        probe = decode_probe(path)
                    entry.update(probe)
                    if probe.get("decodable"):
                        entry["meshFrame"] = (
                            "ground"
                            if kind == "hairMesh" and "\\!cor\\hair\\" in rel.lower()
                            else "head"
                        )

            catalogue[kind].append(entry)
            seen = {e["id"] for e in catalogue[kind][:-1]}
            if entry["id"] in seen:
                errors.append(f"duplicate id {entry['id']} in {kind}")

        _apply_referenced_textures(catalogue, referenced, existing_rel)
        _ensure_facial_rows(catalogue, existing_rel, root)
        # The bodyMesh catalogue row is derived from the outfit, not a pack file.
        if not catalogue["bodyMesh"]:
            body_src = next(
                (e for e in catalogue["clothingMesh"]
                 if e.get("hasBodyShape") and e.get("decodable") is not False),
                None,
            )
            if body_src is not None:
                body_atlas = skin_albedo.get(body_src["rel"].lower())
                body_row = next(
                    (e for e in catalogue["body"]
                     if e["rel"].lower() == body_atlas and (e.get("mapRole") or "albedo") == "albedo"),
                    None,
                ) if body_atlas else None
                body_pair = body_row["id"] if body_row is not None else None
                body_normal = by_rel_body_normal(catalogue, body_row)
                if body_row is not None and body_normal is not None:
                    body_row["normalId"] = body_normal
                catalogue["bodyMesh"].append({
                    "id": f"bodyMesh-from-{body_src['id']}",
                    "mod": body_src["mod"],
                    "file": body_src["file"],
                    "label": f"{body_src['label']} (embedded body)",
                    "rel": body_src["rel"],
                    "bytes": body_src["bytes"],
                    "mtime": body_src["mtime"],
                    "kind": "bodyMesh",
                    "mapRole": "mesh",
                    "decodable": True,
                    "meshFrame": "head",
                    "authored": True,
                    "onDemand": True,
                    # The converted JSON is the whole outfit; this marker is what
                    # the server filters on to answer with the body shape only.
                    "geometryRole": "skin",
                    "derivedFrom": body_src["id"],
                    # The pair is the body atlas the skin shape names, never the
                    # outfit's clothing atlas.
                    **({"pairedTextureId": body_pair} if body_pair else {}),
                })

    all_entries = [e for rows in catalogue.values() for e in rows]
    weight_pairs = build_weight_pairs(all_entries)
    if root.is_dir():
        build_pairing(all_entries, root)

    if not catalogue["preset"]:
        diagnostics.append("No .jslot presets in the pack (SKSE/Plugins/CharGen/Presets is empty).")
    if not catalogue["skeleton"]:
        diagnostics.append("No skeleton NIF in the pack; skeleton is unavailable.")
    if not catalogue["hair"]:
        diagnostics.append(
            "No hair atlases supplied yet; hair meshes render untextured until the DDS files are added."
        )
    if not catalogue["clothing"]:
        diagnostics.append(
            "No clothing atlases supplied yet; the outfit renders untextured until its DDS files are added."
        )
    if not catalogue["bodyMesh"]:
        diagnostics.append("No standalone body mesh in the pack; clothing must supply its embedded body shape.")

    out.mkdir(parents=True, exist_ok=True)
    atomic_json(out / "catalogue" / "modorder.json", {}, indent=None)

    kinds_meta: dict[str, dict[str, Any]] = {}
    for kind in PACK_KINDS:
        rows = scrub(cfg, catalogue[kind])
        rows.sort(key=lambda e: e["rel"].lower())
        atomic_json(out / "catalogue" / f"{kind}.json", rows)
        kinds_meta[kind] = {"count": len(rows), "file": f"catalogue/{kind}.json"}

    doc = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "source": cfg["label"],
        "sourceId": cfg["id"],
        "sourceLayout": cfg["layout"],
        "sourceKey": cfg["sourceKey"],
        "available": root.is_dir(),
        "scanned": scanned,
        "skipped": skipped,
        "kinds": kinds_meta,
        "weightPairs": weight_pairs,
        "mesh": {
            "authored": sum(1 for e in all_entries if e.get("authored")),
            "paired": sum(1 for e in all_entries if e.get("pairedTextureId")),
            "normals": sum(1 for e in all_entries if e.get("normalId")),
            "missingTextures": sum(1 for e in all_entries if e.get("missingTextures")),
        },
        "modorder": {"active": 0},
        "diagnostics": diagnostics,
        "errors": errors,
    }
    atomic_json(out / "catalogue.json", scrub(cfg, doc))

    print(f"scanned {scanned} pack files under {root.name} ({skipped} irrelevant)")
    for kind in PACK_KINDS:
        print(f"  {kind:12s} {kinds_meta[kind]['count']:5d}")
    for d in diagnostics:
        print(f"  note: {d}")
    for err in errors:
        print(f"  ERROR {err}", file=sys.stderr)
    return 0 if not errors else 1


# ── manifest / prebakes ─────────────────────────────────────────────────────


def _read_entries(out: Path, kind: str) -> list[dict[str, Any]]:
    try:
        return json.loads((out / "catalogue" / f"{kind}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def _unavailable(kind_label: str, reason: str) -> dict[str, Any]:
    return {
        "id": f"{kind_label.lower().replace(' ', '-')}-unavailable",
        "mod": "preset-pack",
        "file": "",
        "label": kind_label,
        "rel": "",
        "available": False,
        "reason": reason,
    }


def _prebake_geometry(cfg: dict, cutoff: float, diagnostics: list[str]) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """Write the five validated FRTRI bases; returns rows keyed by kind + urls."""
    from convert_worker import tri_geometry  # local: keeps catalogue import light

    root = pack_root(cfg)
    out = Path(cfg["out"])
    rows: dict[str, dict[str, Any]] = {}
    urls: dict[str, str] = {}
    for kind, virtual in PART_MESH_REL.items():
        try:
            src = pack_rel(root, virtual)
            if src is None or not src.is_file():
                raise FileNotFoundError(f"{virtual} is missing from the pack")
            # The catalogue and every manifest row name the file as stored
            # (`head\meshes\...`), not the Data path the NIF era used.
            rel = pack_paths.physical_rel(root, virtual) or virtual
            st = src.stat()
            mesh_id = pack_id(kind, rel, st)
            dst = out / "meshes" / f"{mesh_id}.json"
            if not is_fresh(src, dst, cutoff):
                geo = tri_geometry(src, "head")
                want_v, want_t = EXPECTED[kind]
                if geo["vertexCount"] != want_v or geo["triangleCount"] != want_t:
                    raise ValueError(
                        f"{rel}: {geo['vertexCount']} verts / {geo['triangleCount']} tris, "
                        f"expected {want_v} / {want_t}"
                    )
                positions = geo["positions"]
                if len(positions) != want_v * 3 or any(abs(v) > 3.0 for v in positions):
                    raise ValueError(f"{rel}: implausible bounds")
                atomic_json(dst, geo, indent=None)
            url = f"{cfg['publicBase']}/meshes/{mesh_id}.json"
            urls[kind] = url
            rows[kind] = {
                "id": mesh_id,
                "mod": pack_paths.pack_mod(rel),
                "file": src.name,
                "label": f"{src.stem} (FRTRI base)",
                "rel": rel,
                "meshUrl": url,
                "isRealMesh": True,
                "meshFrame": "head",
            }
            print(f"[+] {kind:12s} {rel} -> meshes/{mesh_id}.json")
        except Exception as exc:  # noqa: BLE001 — one bad part must not abort sync
            diagnostics.append(f"{kind} unavailable: {exc}")
            print(f"[!] {kind} failed: {exc}", file=sys.stderr)
    return rows, urls


def _prebake_presets(cfg: dict, cutoff: float, diagnostics: list[str]) -> tuple[list[dict], list[dict]]:
    """Prefer a same-name exported face; otherwise replay a validated host sculpt."""
    import math
    from convert_worker import nif_geometry, tri_geometry
    from sync_mo2_assets import apply_sculpt

    root, out = pack_root(cfg), Path(cfg["out"])
    presets = json.loads((out / "catalogue" / "preset.json").read_text(encoding="utf-8"))
    heads: list[dict] = []
    exports: dict[str, dict] = {}
    sources = list(iter_pack_files(root))
    for rel, src, st in sources:
        if src.suffix.lower() != ".nif" or "chargen" not in [p.lower() for p in src.parts]:
            continue
        try:
            geo = nif_geometry(src, frame="head", authored=True)
            groups = [g for g in geo["groups"] if re.search(
                r"femalehead", str(geo["materials"][g["materialIndex"]]["sourceShape"]), re.I
            ) and not re.search(r"brow", str(geo["materials"][g["materialIndex"]]["sourceShape"]), re.I)]
            if len(groups) != 1:
                raise ValueError("export must contain exactly one female head shape")
            group = groups[0]
            indices = geo["indices"][group["start"]:group["start"] + group["count"]]
            used = sorted(set(indices))
            remap = {v: i for i, v in enumerate(used)}
            head = {
                key: [geo[key][v * width + axis] for v in used for axis in range(width)]
                for key, width in (("positions", 3), ("normals", 3), ("uvs", 2))
            }
            head.update(indices=[remap[v] for v in indices], vertexCount=len(used), triangleCount=len(indices) // 3)
            if not all(math.isfinite(v) and abs(v) < 3 for v in head["positions"]):
                raise ValueError("invalid exported head bounds")
            mesh_id = pack_id("headMesh", rel, st, authored=True) + "-face"
            atomic_json(out / "meshes" / f"{mesh_id}.json", head, indent=None)
            material = geo["materials"][group["materialIndex"]]
            albedo = str((material.get("textureRefs") or {}).get("albedo") or "")
            virtual = albedo.replace("/", chr(92))
            if not virtual.lower().startswith("textures" + chr(92)):
                virtual = "textures" + chr(92) + virtual
            head_atlas = pack_rel(root, virtual) if albedo else None
            canonical_atlas = pack_rel(root, HEAD_D)
            row = {
                "id": mesh_id, "mod": pack_paths.pack_mod(rel), "file": src.name,
                "label": f"{src.stem} (RaceMenu export)", "rel": rel,
                "meshUrl": f"{cfg['publicBase']}/meshes/{mesh_id}.json", "isRealMesh": True,
                "meshFrame": "head", "origin": "racemenu-export", "available": True,
                "headTextureMissing": head_atlas is None or head_atlas != canonical_atlas,
                "bytes": st.st_size, "nodes": [], "version": "BSDynamicTriShape",
                "shapes": {"vertexCount": head["vertexCount"], "triangleCount": head["triangleCount"]},
            }
            heads.append(row)
            exports[src.stem.casefold()] = row
        except (ValueError, OSError, KeyError, IndexError, TypeError) as exc:
            diagnostics.append(f"RaceMenu export {src.name} unavailable: {exc}")

    for preset in presets:
        if preset.get("available") is False:
            continue
        src = pack_rel(root, preset["rel"])
        if src is None:
            continue
        # ponytail: exact stems only; aliases need explicit provenance, not similar geometry.
        stem = src.stem.casefold()
        export = exports.get(stem) or (exports.get("nini") if stem == "[3ba] nini" else None)
        if export:
            export["sculptSource"] = src.name
            preset["label"] = f"{src.stem} (RaceMenu export)"
            preset["geometrySource"] = "racemenu-export"
            continue
        try:
            data = json.loads(src.read_text(encoding="utf-8-sig"))
            morphs = data.get("morphs") or {}
            blocks = [b for b in (morphs.get("sculpt") or []) if isinstance(b, dict)
                      and "head" in str(b.get("host", "")).lower()
                      and "brow" not in str(b.get("host", "")).lower()]
            if not blocks:
                preset["geometrySource"] = "morphs-only"
                preset["label"] = f"{src.stem} (morphs only; no baked head)"
                continue
            divisor = float(morphs.get("sculptDivisor", 0))
            if not math.isfinite(divisor) or divisor <= 0:
                raise ValueError("invalid sculpt divisor")
            baked = None
            host_path = None
            for block in blocks:
                host = str(block.get("host", "")).replace("/", chr(92))
                if not host.lower().endswith(".tri"):
                    raise ValueError("invalid sculpt host")
                # Resolve the complete virtual host, never a same-basename foreign head.
                candidate = pack_rel(root, "meshes" + chr(92) + host)
                if candidate is None:
                    raise ValueError(f"sculpt host absent: {host}")
                if host_path is not None and host_path != candidate:
                    raise ValueError("multiple distinct head hosts")
                host_path = candidate
                if baked is None:
                    baked = tri_geometry(candidate, "head")
                if block.get("vertices") != baked["vertexCount"]:
                    raise ValueError("sculpt host vertex count mismatch")
                points = block.get("data") or []
                for point in points:
                    if (not isinstance(point, list) or len(point) != 4
                            or type(point[0]) is not int or not 0 <= point[0] < baked["vertexCount"]
                            or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point[1:])):
                        raise ValueError("invalid sculpt vertex delta")
                baked = apply_sculpt(baked, points, divisor)
            if baked is None:
                continue
            mesh_id = preset["id"] + "-sculpt"
            atomic_json(out / "meshes" / f"{mesh_id}.json", baked, indent=None)
            heads.append({
                "id": mesh_id, "mod": preset["mod"], "file": src.name,
                "label": f"{src.stem} (sculpt only; approximate)", "rel": preset["rel"],
                "meshUrl": f"{cfg['publicBase']}/meshes/{mesh_id}.json", "isRealMesh": True,
                "meshFrame": "head", "sculptSource": src.name, "origin": "sculpt-replay",
                "available": True,
                "shapes": {"vertexCount": baked["vertexCount"], "triangleCount": baked["triangleCount"]},
            })
            preset["geometrySource"] = "sculpt-replay"
            preset["label"] = f"{src.stem} (sculpt only; approximate)"
        except (ValueError, OSError, KeyError, IndexError, TypeError, OverflowError) as exc:
            preset["geometrySource"] = "morphs-only"
            preset["label"] = f"{src.stem} (no baked head)"
            diagnostics.append(f"Preset {src.name}: {exc}")
    return presets, heads


def _prebake_skin(cfg: dict, cutoff: float, diagnostics: list[str]) -> dict[str, Any] | None:
    from sync_mo2_assets import analyze_skin, open_dds, to_srgb_rgb, to_tangent_normal

    root = pack_root(cfg)
    out = Path(cfg["out"])
    diffuse = pack_rel(root, HEAD_D)
    if diffuse is None:
        diagnostics.append("Head diffuse is missing from the pack; skin is unavailable.")
        return None
    rel = pack_paths.physical_rel(root, HEAD_D) or HEAD_D
    try:
        im = open_dds(diffuse)
        size = list(im.size)
        palette = analyze_skin(im)
        dst = out / "textures" / "skin" / "head.webp"
        if not is_fresh(diffuse, dst, cutoff):
            sq = to_srgb_rgb(im)
            if sq.width != sq.height:
                s = min(sq.size)
                sq = sq.crop(((sq.width - s) // 2, (sq.height - s) // 2,
                              (sq.width + s) // 2, (sq.height + s) // 2))
            atomic_image(sq.resize((1024, 1024), 1), dst, "WEBP", quality=88, method=6)
        normal_url = None
        normal_src = pack_rel(root, HEAD_N)
        if normal_src is not None:
            n_dst = out / "textures" / "skin" / "head_n.png"
            if not is_fresh(normal_src, n_dst, cutoff):
                atomic_image(to_tangent_normal(open_dds(normal_src), 1024), n_dst, "PNG", optimize=True)
            normal_url = f"{cfg['publicBase']}/textures/skin/head_n.png"
        print(f"[+] skin  {diffuse.name} {tuple(size)} -> textures/skin/head.webp")
        return {
            "id": pack_id("skin", rel, diffuse.stat()),
            "mod": pack_paths.pack_mod(rel),
            "file": diffuse.name,
            "label": "Diamond head diffuse",
            "rel": rel,
            "texture": f"{cfg['publicBase']}/textures/skin/head.webp",
            "normalTexture": normal_url,
            "size": size,
            "palette": palette,
        }
    except Exception as exc:  # noqa: BLE001
        diagnostics.append(f"skin unavailable: {exc}")
        print(f"[!] skin failed: {exc}", file=sys.stderr)
        return None


def _prebake_body(cfg: dict, cutoff: float, diagnostics: list[str]) -> dict[str, Any] | None:
    from sync_mo2_assets import open_dds, to_srgb_rgb, to_tangent_normal

    root = pack_root(cfg)
    out = Path(cfg["out"])
    diffuse = pack_rel(root, BODY_D)
    if diffuse is None:
        diagnostics.append("Body diffuse is missing from the pack; body texture is unavailable.")
        return None
    rel = pack_paths.physical_rel(root, BODY_D) or BODY_D
    try:
        im = open_dds(diffuse)
        dst = out / "textures" / "body" / "body.webp"
        if not is_fresh(diffuse, dst, cutoff):
            rgba = to_srgb_rgb(im)
            atomic_image(rgba.resize((1024, 1024), 1), dst, "WEBP", quality=88, method=6)
        normal_url = None
        normal_src = pack_rel(root, BODY_N)
        if normal_src is not None:
            n_dst = out / "textures" / "body" / "body_n.png"
            if not is_fresh(normal_src, n_dst, cutoff):
                atomic_image(to_tangent_normal(open_dds(normal_src), 1024), n_dst, "PNG", optimize=True)
            normal_url = f"{cfg['publicBase']}/textures/body/body_n.png"
        print(f"[+] body  {diffuse.name} {tuple(im.size)} -> textures/body/body.webp")
        return {
            "id": pack_id("body", rel, diffuse.stat()),
            "mod": pack_paths.pack_mod(rel),
            "file": diffuse.name,
            "label": "Diamond body diffuse",
            "rel": rel,
            "texture": f"{cfg['publicBase']}/textures/body/body.webp",
            "normalTexture": normal_url,
            "size": list(im.size),
        }
    except Exception as exc:  # noqa: BLE001
        diagnostics.append(f"body texture unavailable: {exc}")
        print(f"[!] body failed: {exc}", file=sys.stderr)
        return None


def _prebake_body_mesh(cfg: dict, cutoff: float, diagnostics: list[str]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Extract the outfit's embedded body shape into bodyMesh.

    An authored decode carries the body/skin shape separately from the garment
    (the peer emits `role: "skin"` with its own group). Re-slicing that group
    into its own positions/indices lets the body render even while every
    garment atlas is still missing, instead of hiding it behind one unavailable
    outfit row.

    Returns `(manifest row, body geometry doc)`, or `(None, extra)` where extra
    describes why it is unavailable.
    """
    out = Path(cfg["out"])
    rows = _read_entries(out, "clothingMesh")
    candidates = [e for e in rows if e.get("hasBodyShape") and e.get("decodable") is not False]
    if not candidates:
        return None, {
            "reason": "No outfit with an identifiable embedded body shape in the pack.",
        }
    entry = candidates[0]
    src = pack_rel(pack_root(cfg), entry["rel"])
    if src is None:
        return None, {"reason": f"Outfit source is missing or outside the pack: {entry['rel']}"}
    try:
        decoded = authored_decode(src)
        mats = [m for m in decoded.get("materials") or [] if isinstance(m, dict)]
        body_idx = [i for i, m in enumerate(mats) if m.get("role") == "skin"]
        if not body_idx:
            raise ValueError("no skin-role material")
        bi = body_idx[0]
        groups = [g for g in decoded.get("groups") or [] if g.get("materialIndex") == bi]
        if not groups:
            raise ValueError("skin material has no group")

        # Reindex the body triangles into a standalone mesh.
        remap: dict[int, int] = {}
        positions: list[float] = []
        normals: list[float] = []
        uvs: list[float] = []
        indices: list[int] = []
        src_pos = decoded["positions"]
        src_nrm = decoded.get("normals") or []
        src_uv = decoded.get("uvs") or []
        src_idx = decoded["indices"]
        src_skin_i = decoded.get("skinIndex") or []
        src_skin_w = decoded.get("skinWeight") or []
        skin_index: list[int] = []
        skin_weight: list[float] = []
        for g in groups:
            start, count = int(g["start"]), int(g["count"])
            for t in range(start, start + count, 3):
                for vi in src_idx[t : t + 3]:
                    if vi not in remap:
                        remap[vi] = len(remap)
                        positions.extend(src_pos[vi * 3 : vi * 3 + 3])
                        if src_nrm:
                            normals.extend(src_nrm[vi * 3 : vi * 3 + 3])
                        if src_uv:
                            uvs.extend(src_uv[vi * 2 : vi * 2 + 2])
                        if src_skin_i:
                            # The body is the outfit's skin-role shape; its
                            # weights must survive the reindex or the extracted
                            # body would draw in bind pose while the garment
                            # follows the skeleton.
                            skin_index.extend(src_skin_i[vi * 4 : vi * 4 + 4])
                            skin_weight.extend(src_skin_w[vi * 4 : vi * 4 + 4])
                    indices.append(remap[vi])
        body_doc = {
            "vertexCount": len(remap),
            "triangleCount": len(indices) // 3,
            "positions": positions,
            "normals": normals,
            "uvs": uvs,
            "indices": indices,
            "meshFrame": "head",
            "source": entry["rel"],
            "sourceShape": mats[bi].get("sourceShape"),
        }
        if decoded.get("bones"):
            body_doc["bones"] = decoded["bones"]
            body_doc["skinIndex"] = skin_index
            body_doc["skinWeight"] = skin_weight
        st = src.stat()
        mesh_id = pack_id("bodyMesh", entry["rel"], st, authored=True)
        dst = out / "meshes" / f"{mesh_id}.json"
        if not is_fresh(src, dst, cutoff):
            atomic_json(dst, body_doc, indent=None)
        url = f"{cfg['publicBase']}/meshes/{mesh_id}.json"
        print(f"[+] bodyMesh  {entry['file']} skin shape -> meshes/{mesh_id}.json")
        return {
            "id": mesh_id,
            "mod": entry["mod"],
            "file": entry["file"],
            "label": f"{entry['label']} (embedded body)",
            "rel": entry["rel"],
            "catalogueId": f"bodyMesh-from-{entry['id']}",
            "meshUrl": url,
            "isRealMesh": True,
            "meshFrame": "head",
            "bodyFromClothing": True,
            "geometryRole": "skin",
        }, None
    except Exception as exc:  # noqa: BLE001
        diagnostics.append(f"bodyMesh unavailable: {exc}")
        print(f"[!] bodyMesh failed: {exc}", file=sys.stderr)
        return None, {"reason": f"The outfit's embedded body shape could not be extracted: {exc}"}


def _prebake_weight_body(cfg: dict, cutoff: float, diagnostics: list[str]) -> dict[str, Any] | None:
    """The canonical `femalebody_0`/`_1` pair, as the default body mesh.

    This is the shape Skyrim's own Data folder has, and it is the only body
    that can carry a live weight slider. It wins over the outfit's embedded
    body whenever both halves are present, because a real weight pair is a
    strictly better body than one frozen shape.
    """
    out = Path(cfg["out"])
    rows = [
        e for e in _read_entries(out, "bodyMesh")
        if e.get("weightVariants") and e.get("decodable") is not False
    ]
    if not rows:
        return None
    # Canonical order, not file order. The pack can hold several genuine
    # `_0`/`_1` pairs — `femalebody`, `1stpersonfemalebody`, `femalebodyastrid`
    # — and only one of them is the character's body. The plain `femalebody`
    # pair is the one Skyrim itself equips; anything else (a first-person
    # duplicate, a named NPC) must never become the default.
    def body_rank(e: dict[str, Any]) -> tuple[int, int]:
        key = str(e.get("weightKey") or "")
        preferred = 0 if key == "femalebody" else 1 if key.startswith("1stperson") else 2
        return (preferred, -int(e.get("weightDefault") or 0))

    entry = sorted(rows, key=body_rank)[0]
    root = pack_root(cfg)
    src = pack_rel(root, entry["rel"])
    if src is None:
        diagnostics.append(f"Weight body source is missing or outside the pack: {entry['rel']}")
        return None
    try:
        from convert_worker import nif_geometry  # local: keeps catalogue import light

        w0_id, w1_id = entry["weightVariants"]["w0"], entry["weightVariants"]["w1"]
        # Both halves are prebaked to static JSON, the same way every other
        # shipped mesh is: the pack contract forbids an `/api/...` route in a
        # manifest URL, and a body that only exists behind a running converter
        # would be missing from a static deploy.
        urls: dict[str, str] = {}
        for half in (w0_id, w1_id):
            row = next((e for e in _read_entries(out, "bodyMesh") if e["id"] == half), None)
            if row is None:
                raise ValueError(f"paired half {half} is not in the catalogue")
            half_src = pack_rel(root, row["rel"])
            if half_src is None:
                raise ValueError(f"{row['rel']} is missing from the pack")
            mesh_id = pack_id("bodyMesh", row["rel"], half_src.stat())
            dst = out / "meshes" / f"{mesh_id}.json"
            if not is_fresh(half_src, dst, cutoff):
                geo = nif_geometry(half_src, "head")
                if not geo.get("vertexCount") or not geo.get("triangleCount"):
                    raise ValueError(f"{row['rel']} decoded to no geometry")
                atomic_json(dst, geo, indent=None)
            urls[half] = f"{cfg['publicBase']}/meshes/{mesh_id}.json"
        print(f"[+] bodyMesh  {src.name} weight pair -> {entry['weightKey']}")
        return {
            "id": entry["id"],
            "mod": entry.get("mod") or "meshes",
            "file": src.name,
            "label": f"{entry['label']} (weight pair)",
            "rel": entry["rel"],
            "catalogueId": entry["id"],
            # The default half, for any code path that only knows `meshUrl`.
            "meshUrl": urls[w1_id],
            "weightVariants": {"w0": urls[w0_id], "w1": urls[w1_id]},
            "weightKey": entry["weightKey"],
            "isRealMesh": True,
            "meshFrame": "head",
        }
    except Exception as exc:  # noqa: BLE001
        diagnostics.append(f"Weight body unavailable: {exc}")
        print(f"[!] weight body failed: {exc}", file=sys.stderr)
        return None


def _facial_refs(root: Path, kind: str) -> tuple[str, str | None]:
    """The pack NIF's authored albedo and its `_n` companion, if it names one.

    Returned in the pack's storage spelling (`head\\textures\\...`) so the key
    matches the catalogue row; a ref the pack does not supply keeps the NIF's
    Data spelling and is reported missing.
    """
    src = pack_rel(root, FACIAL_NIF_REL[kind])
    if src is None:
        return "", None
    try:
        refs = nif_texture_refs(src)
    except Exception:  # noqa: BLE001 — a broken NIF means "nothing supplied"
        return "", None

    def usable(ref: str) -> bool:
        low = ref.lower()
        return low.endswith(".dds") and "cubemap" not in low and not any(
            low.endswith(suffix) for suffix in ("_n.dds", "_sk.dds", "_m.dds", "_e.dds")
        )

    def stored(ref: str) -> str:
        return pack_paths.physical_rel(root, ref) or ref.replace("/", "\\")

    albedo = next((r for r in refs if usable(r)), "")
    if not albedo:
        return "", None
    normal = next((r for r in refs if r.lower() == normal_key_for(albedo)), None)
    return stored(albedo), stored(normal) if normal else None


def _ensure_facial_rows(
    catalogue: dict[str, list[dict[str, Any]]],
    existing_rel: dict[str, tuple[Path, os.stat_result]],
    root: Path,
) -> None:
    """Give a supplied facial atlas the kind its NIF says it fills.

    A DDS dropped into a folder legacy `classify` calls `other` would otherwise
    never join the eye/lash/brow/mouth list, and the manifest row built from it
    would carry an id no catalogue entry has.
    """
    by_rel = {e["rel"].lower(): e for rows in catalogue.values() for e in rows}
    for kind in FACIAL_NIF_REL:
        for rel in filter(None, _facial_refs(root, kind)):
            key = rel.lower()
            hit = existing_rel.get(key)
            if hit is None:
                continue
            path, st = hit
            row = by_rel.get(key)
            if row is not None:
                if row["kind"] != kind:
                    old_kind = row["kind"]
                    row["referencedKind"] = old_kind
                    row["kind"] = kind
                    row["id"] = pack_id(kind, row["rel"], st)
                    catalogue[old_kind].remove(row)
                    catalogue[kind].append(row)
                continue
            row = {
                "id": pack_id(kind, rel, st),
                "mod": pack_paths.pack_mod(rel),
                "file": path.name,
                "label": path.stem,
                "rel": rel,
                "bytes": st.st_size,
                "mtime": int(st.st_mtime),
                "kind": kind,
                "mapRole": "normal" if key.endswith("_n.dds") else "albedo",
                "referencedBy": FACIAL_NIF_REL[kind],
            }
            catalogue[kind].append(row)
            by_rel[key] = row


def _prebake_skeleton(cfg: dict, diagnostics: list[str]) -> dict[str, Any] | None:
    """The pack's skeleton NIF, reported as a bone map.

    A skeleton has no renderable geometry: its value is the node names and the
    hierarchy a pose editor needs to name bones by. The catalogue already
    classifies any `*skeleton*.nif` as `skeleton`; this turns the indexed row
    into the manifest entry the HUD reads, so supplying the NIF in the pack
    enables it without any code change.
    """
    out = Path(cfg["out"])
    rows = [
        e for e in _read_entries(out, "skeleton")
        if e.get("rel") and (e.get("file") or "").lower().endswith(".nif")
    ]
    if not rows:
        return None
    e = rows[0]
    root = Path(cfg["root"])
    path = pack_rel(root, e["rel"])
    if path is None or not path.is_file():
        diagnostics.append("The pack's skeleton NIF is indexed but not readable.")
        return None
    try:
        nodes = _skeleton_bones(path)
    except Exception as exc:  # noqa: BLE001 - a bad NIF must not fail the sync
        diagnostics.append(f"The pack's skeleton NIF could not be read: {exc}")
        return None
    if not nodes:
        diagnostics.append("The pack's skeleton NIF names no bones.")
        return None
    return {
        "id": e["id"],
        "mod": e.get("mod") or "preset-pack",
        "file": e["file"],
        "label": e.get("label") or path.stem,
        "rel": e["rel"],
        "bytes": e.get("bytes"),
        "nodes": nodes,
        "available": True,
    }


def _skeleton_bones(path: Path) -> list[str]:
    """`NPC *` node names from a skeleton NIF, in hierarchy order.

    Only names: a pose editor addresses bones by name, and the bind transforms
    it needs come from the mesh that is being posed, not from this file.
    """
    import convert_worker as cw

    nif = cw._nif_parse(path)
    parents = cw._nif_parents(nif)
    children = {p for p in parents if p >= 0}
    roots = [
        i for i, t in enumerate(nif["types"])
        if t == "NiNode" and i not in children
    ]
    names: list[str] = []

    def walk(i: int) -> None:
        name = cw._nif_name(nif, i)
        if name.startswith("NPC "):
            names.append(name)
        for j in range(len(nif["types"])):
            if parents.get(j) == i:
                walk(j)

    for r in roots:
        walk(r)
    return names


def _prebake_facial(cfg: dict, cutoff: float, diagnostics: list[str]) -> dict[str, dict[str, Any]]:
    """Facial rows derived from the pack's own NIF refs.

    Absent DDS files keep the row unavailable (with the missing paths), but the
    check is re-run every sync: supplying the maps enables the row — nothing
    here is hardcoded to "missing forever".
    """
    from sync_mo2_assets import (
        analyze_eye, measure_eye_atlas, open_dds, to_srgb_rgb, to_tangent_normal,
    )

    root = pack_root(cfg)
    out = Path(cfg["out"])
    rows: dict[str, dict[str, Any]] = {}
    for kind in FACIAL_NIF_REL:
        albedo, normal = _facial_refs(root, kind)
        # The NIF's spelling is not the file's: reuse the catalogue row's rel
        # and id so a case-sensitive mount still opens it and the manifest id
        # is the one the picker can find.
        catalogued = {
            e["rel"].lower(): e for e in _read_entries(out, kind)
            if (e.get("mapRole") or "albedo") == "albedo"
        }
        row_hit = catalogued.get(albedo.lower()) if albedo else None
        if row_hit is not None:
            albedo = row_hit["rel"]
        if normal:
            normal_row = next(
                (e for e in _read_entries(out, kind) if e["rel"].lower() == normal.lower()),
                None,
            )
            if normal_row is not None:
                normal = normal_row["rel"]
        src = pack_rel(root, albedo) if albedo else None
        # The diffuse is the map the part cannot render without; a normal or
        # mask being absent is a diagnostic, never a permanent block.
        normal_src = pack_rel(root, normal) if normal else None
        if src is None:
            rows[kind] = {
                "id": f"{kind}-unavailable",
                "mod": "preset-pack",
                "file": "",
                "label": kind.capitalize(),
                "rel": "",
                "available": False,
                "reason": FACIAL_REASON[kind],
                **({"missingTextures": [albedo]} if albedo else {}),
            }
            continue
        try:
            im = open_dds(src)
            dst = out / "textures" / kind / f"{kind}.webp"
            if not is_fresh(src, dst, cutoff):
                atomic_image(to_srgb_rgb(im), dst, "WEBP", quality=90, method=6)
            normal_url = None
            if normal_src is not None:
                n_dst = out / "textures" / kind / f"{kind}_n.png"
                if not is_fresh(normal_src, n_dst, cutoff):
                    atomic_image(to_tangent_normal(open_dds(normal_src), 1024), n_dst,
                                 "PNG", optimize=True)
                normal_url = f"{cfg['publicBase']}/textures/{kind}/{kind}_n.png"
            row: dict[str, Any] = {
                "id": pack_id(kind, albedo, src.stat()),
                "mod": pack_paths.pack_mod(albedo),
                "file": src.name,
                "label": src.stem,
                "rel": albedo,
                "texture": f"{cfg['publicBase']}/textures/{kind}/{kind}.webp",
                "normalTexture": normal_url,
                "size": list(im.size),
            }
            if kind == "eyes":
                analysis = analyze_eye(im)
                row.update({"iris": analysis["iris"], "mean": analysis["mean"],
                            "atlas": measure_eye_atlas(im)})
            rows[kind] = row
            print(f"[+] {kind:8s} {albedo} -> textures/{kind}/{kind}.webp")
        except Exception as exc:  # noqa: BLE001
            diagnostics.append(f"{kind} unavailable: {exc}")
            rows[kind] = {
                "id": f"{kind}-unavailable", "mod": "preset-pack", "file": "",
                "label": kind.capitalize(), "rel": "", "available": False,
                "reason": f"{FACIAL_REASON[kind]} ({exc})",
            }
    return rows


def _authored_rows(cfg: dict, kind: str, reason: str) -> tuple[list[dict[str, Any]], int]:
    """Catalogue rows for on-demand hair/clothing NIFs (never prebaked)."""
    out = Path(cfg["out"])
    catalogued = _read_entries(out, kind)
    rows: list[dict[str, Any]] = []
    unavailable = 0
    for e in catalogued:
        if e.get("decodable") is False:
            row = {
                "id": e["id"], "mod": e["mod"], "file": e["file"], "label": e["label"],
                "rel": e["rel"], "catalogueId": e["id"], "authored": True,
                "onDemand": True, "available": False, "decodable": False,
                "reason": e.get("reason") or reason,
            }
            rows.append(row)
            unavailable += 1
            continue
        missing = e.get("missingTextures") or []
        row: dict[str, Any] = {
            "id": e["id"],
            "mod": e["mod"],
            "file": e["file"],
            "label": e["label"],
            "rel": e["rel"],
            "catalogueId": e["id"],
            "authored": True,
            "onDemand": True,
            "meshFrame": "head",
        }
        if e.get("hasBodyShape"):
            row["hasBodyShape"] = True
        if e.get("optionalMissingTextures"):
            row["optionalMissingTextures"] = e["optionalMissingTextures"]
        if e.get("untextured") is True:
            # Still not texture-complete (available:false keeps defaults and
            # texture modes honest), but the app may convert and draw its
            # geometry in mesh mode with a flat grey material.
            unavailable += 1
            row.update({
                "available": False,
                "untextured": True,
                "reason": f"Required textures missing from the pack: {', '.join(missing[:3])}"
                          + (" …" if len(missing) > 3 else ""),
                "missingTextures": missing,
            })
        else:
            row["available"] = True
        rows.append(row)
    return rows, unavailable


def build_manifest(cfg: dict) -> int:
    root = pack_root(cfg)
    out = Path(cfg["out"])
    cutoff = script_cutoff()
    diagnostics: list[str] = []
    errors: list[str] = []

    manifest: dict[str, Any] = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "source": cfg["label"],
        "sourceId": cfg["id"],
        "sourceLayout": cfg["layout"],
        "sourceKey": cfg["sourceKey"],
        "available": root.is_dir(),
        "textures": {},
        "errors": errors,
        "diagnostics": diagnostics,
    }
    if not root.is_dir():
        diagnostics.append("Pack root is not available on this machine.")
        atomic_json(out / "manifest.json", scrub(cfg, manifest))
        print(f"[!] {root.name} not found — wrote an unavailable manifest", file=sys.stderr)
        return 1

    meshes, mesh_urls = _prebake_geometry(cfg, cutoff, diagnostics)
    presets, preset_heads = _prebake_presets(cfg, cutoff, diagnostics)
    skin = _prebake_skin(cfg, cutoff, diagnostics)
    body = _prebake_body(cfg, cutoff, diagnostics)
    facial = _prebake_facial(cfg, cutoff, diagnostics)
    weight_body = _prebake_weight_body(cfg, cutoff, diagnostics)
    body_mesh, body_mesh_extra = _prebake_body_mesh(cfg, cutoff, diagnostics)
    hair_rows, hair_missing = _authored_rows(cfg, "hairMesh", MISSING_HAIR_REASON)
    clothing_rows, clothing_missing = _authored_rows(cfg, "clothingMesh", MISSING_CLOTHING_REASON)
    skeleton_row = _prebake_skeleton(cfg, diagnostics)

    assets: dict[str, list[dict[str, Any]]] = {
        "skin": [skin] if skin else [_unavailable("Skin", "The pack's head diffuse is missing.")],
        "body": [body] if body else [],
        "eyes": [facial["eyes"]],
        "lashes": [facial["lashes"]],
        "brows": [facial["brows"]],
        "mouth": [facial["mouth"]],
        "hair": [_unavailable("Hair", MISSING_HAIR_REASON)],
        "clothing": [_unavailable("Clothing", MISSING_CLOTHING_REASON)],
        "skeleton": [skeleton_row] if skeleton_row else [
            _unavailable("Skeleton", "The pack contains no skeleton NIF.")
        ],
        "preset": presets or [_unavailable("Preset", "The pack contains no .jslot presets.")],
        # The canonical pair wins: it is the shape Skyrim itself ships and the
        # only body that can carry a live weight slider.
        "bodyMesh": [weight_body] if weight_body else [body_mesh] if body_mesh else [_unavailable(
            "Body mesh",
            (body_mesh_extra or {}).get(
                "reason",
                "The pack ships no standalone female body mesh; clothing uses its embedded body shape.",
            ),
        )],
        "hairMesh": hair_rows,
        "clothingMesh": clothing_rows,
        "headMesh": ([meshes["headMesh"]] if "headMesh" in meshes else []) + preset_heads,
        "eyeMesh": [meshes["eyeMesh"]] if "eyeMesh" in meshes else [],
        "lashesMesh": [meshes["lashesMesh"]] if "lashesMesh" in meshes else [],
        "browsMesh": [meshes["browsMesh"]] if "browsMesh" in meshes else [],
        "mouthMesh": [meshes["mouthMesh"]] if "mouthMesh" in meshes else [],
    }
    if skin is None:
        assets["skin"] = [_unavailable("Skin", "The pack's head diffuse is missing.")]

    mods: dict[str, str | None] = {}
    for kind, rows in assets.items():
        row = next((r for r in rows if r.get("available") is not False and r.get("rel")), None)
        mods[kind] = row["rel"] if row else None
    textures: dict[str, str] = {}
    if skin:
        textures["skin"] = skin["texture"]
        if skin.get("normalTexture"):
            textures["normal"] = skin["normalTexture"]
    if "headMesh" in mesh_urls:
        textures["headMesh"] = mesh_urls["headMesh"]
    manifest["textures"] = textures
    manifest["mods"] = mods

    if skin:
        manifest["skinSource"] = {"file": skin["file"], "size": skin["size"]}
        manifest["skin"] = skin["palette"]
    if "headMesh" in meshes:
        rel = meshes["headMesh"]["rel"]
        src = pack_rel(root, rel)
        if src is None:
            diagnostics.append(f"headMesh metadata unavailable: {rel} is missing from the pack")
        else:
            try:
                st = src.stat()
                manifest["headMesh"] = {
                    "file": src.name,
                    "version": "FRTRI003",
                    "bytes": st.st_size,
                    "nodes": [],
                    "shapes": {
                        "vertexCount": EXPECTED["headMesh"][0],
                        "triangleCount": EXPECTED["headMesh"][1],
                    },
                    "meshUrl": mesh_urls["headMesh"],
                    "isRealMesh": True,
                }
            except OSError as exc:
                diagnostics.append(f"headMesh metadata unavailable: {exc}")

    if skeleton_row:
        manifest["skeleton"] = {
            "file": skeleton_row["file"],
            "version": "NIF SSE",
            "bytes": skeleton_row.get("bytes"),
            "nodes": skeleton_row["nodes"],
            "isGltf": False,
        }

    manifest["assets"] = assets

    diagnostics.extend([
        "Skin and body maps are the pack's Diamond set; Imperfect Skin is not present in the pack.",
        "Facial part geometry uses the pack's FRTRI bases; authored part NIFs are metadata only.",
        "Hair and clothing NIFs are decoded on demand; no hair geometry is prebaked.",
    ])
    absent = [k for k, row in facial.items() if row.get("available") is False]
    if absent:
        diagnostics.append(
            f"{', '.join(absent)} texture(s) referenced by the pack are absent; "
            "those rows are reported, not substituted."
        )
    if hair_missing:
        diagnostics.append(f"{hair_missing} hair NIF(s) render untextured until their DDS atlases are added.")
    if clothing_missing:
        diagnostics.append(f"{clothing_missing} clothing NIF(s) render untextured until their DDS atlases are added.")

    atomic_json(out / "manifest.json", scrub(cfg, manifest))
    print(f"\n[=] wrote {out / 'manifest.json'}")
    for d in diagnostics:
        print(f"  note: {d}")
    return 0


# ── entrypoints ─────────────────────────────────────────────────────────────


def catalogue_main(cfg: dict) -> int:
    return build_catalogue(cfg)


def sync_main(cfg: dict) -> int:
    return build_manifest(cfg)


def main() -> int:
    ap = argparse.ArgumentParser(description="Build pack catalogue and manifest.")
    ap.add_argument("--catalogue", action="store_true", help="catalogue only")
    args = ap.parse_args()
    cfg = asset_source.load()
    if cfg["layout"] != "pack":
        print("asset-source.json layout is not 'pack'; nothing to do.", file=sys.stderr)
        return 0
    if args.catalogue:
        return catalogue_main(cfg)
    code = catalogue_main(cfg)
    return sync_main(cfg) or code


if __name__ == "__main__":
    raise SystemExit(main())
