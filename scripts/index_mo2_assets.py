#!/usr/bin/env python
"""
Catalogue every mesh and texture in the MO2 archive, without decoding any of them.

The sync script (`sync_mo2_assets.py`) curates ~37 files by hand: they are the
ones the manifest ships as defaults, and each has been measured. This script is
the opposite trade — it walks the whole archive and records *what exists*, so
the asset panel can offer categories the curated manifest has never covered
(makeup, tattoo, wrinkle) and the long tail of skins, eyes and hair.

Nothing here opens an image. A DDS decode costs 0.05-0.15 s and there are
26,558 files; the walk itself is ~1 s. So the catalogue stores only facts the
filesystem already knows (name, size, mtime, path) and leaves conversion to
`convert_worker.py`, which runs on demand when the picker actually needs a
pixel.

Usage:
    python -I scripts/index_mo2_assets.py
    python -I scripts/index_mo2_assets.py --mods "D:/Games/Skyrim/MO2_Archive/mods" --out public/assets/mo2
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

# `python -I` deliberately keeps the script's own directory off `sys.path`, so
# the sibling worker has to be reachable explicitly. It is import-safe (its
# `main()` runs only under `__main__`), which lets the indexer and the route
# share one decoder and one visibility measure instead of restating either.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_worker import mesh_geometry, tri_geometry, visibility_against_head  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass


DEFAULT_HEAD_NAME = "ube-2-0-u0-7-ube-femalehead-tangent.json"

# Extensions worth listing. `.tri` and `.nif` are meshes; `.jslot` is a preset;
# everything else here is a texture. Anything outside this set is left out of
# the catalogue entirely rather than dumped into `other` — a list of 20,000
# unrelated `.esp` and `.bsa` files is noise, not coverage.
TEXTURE_EXTS = {".dds", ".png", ".jpg", ".jpeg", ".tga"}
MESH_EXTS = {".nif", ".tri", ".obj"}
PRESET_EXTS = {".jslot"}

# Categories the picker can open, in display order. `other` is the catch-all
# that keeps unclassified but plausible textures reachable instead of dropping
# them — the point of the exercise is "every of it", not "every one I guessed".
#
# The seven mesh kinds are the seven swappable parts of the character; their
# texture counterparts sit beside them. Stems equal kind names so the client's
# `KIND_TO_CATALOGUE` needs no translation table.
KINDS = [
    "headMesh",
    "eyeMesh",
    "lashesMesh",
    "browsMesh",
    "mouthMesh",
    "bodyMesh",
    "hairMesh",
    "skeleton",
    "skin",
    "eyes",
    "lashes",
    "brows",
    "mouth",
    "body",
    "hair",
    "preset",
    "makeup",
    "tattoo",
    "wrinkle",
    "other",
]

MESH_KINDS = frozenset(k for k in KINDS if k.endswith("Mesh"))

# Known degenerate placeholders: COR ships three 3-vertex, 1-triangle `.tri`
# stubs (`hairpg7772`, `hairlinepg7772`, `hairshimeji`) whose real geometry is
# in the matching NIF. They are the only FRTRI files in the archive with a
# vertex count this small, so the test is an exact signature rather than an
# arbitrary V cutoff — any future small-but-valid mesh stays decodable.
DEGENERATE_STUBS = frozenset({"hairpg7772", "hairlinepg7772", "hairshimeji"})

# COR authors its hair in a ground-relative frame: raw `(x, y, z)` is already
# `(x, z, y)` in metres with no 120.73 head offset. That frame is a known fact
# about this one family, not a bounding-box guess, so it is keyed on the path.
COR_HAIR_MARKER = "\\!cor\\hair\\"

# How many bytes of a NIF are scanned for shader texture strings. The block is
# near the front in SSE meshes; 2 MB covers the largest hair with room to spare.
NIF_SCAN_BYTES = 2 * 1024 * 1024
PRINTABLE_RUN = re.compile(rb"[ -~]{4,}")

# Directory fragments that identify a face-texture family. A skin is a skin
# because of where it sits as much as what it is called: a filename match on
# "brow" happily swallows `metalwork01_brown.dds` under `smim\chains`, and one
# on "aged" swallows every `Damaged_*.dds` in a level mod.
#
# Ordered: the first family whose patterns match wins, so the narrow, specific
# ones come before the broad ones. `\tintmasks\` is deliberately *before*
# makeup: Bethesda puts lip tint, dirt and warpaint in that one folder and the
# filename decides which it is.
DIR_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("eyes", ("\\eyes\\", "\\ddseyes\\", "eyes_ilv", "\\eyes_")),
    ("brows", ("\\brows\\",)),
    ("wrinkle", ("\\wrinkle",)),
    ("makeup", (
        "\\overlays\\", "\\makeup", "lipstick", "eyeshadow", "eyeliner", "blush",
        "\\warpaint", "\\tintmask", "\\cotr overlays\\",
    )),
]

# Filename rules, consulted only when the directory says nothing. These are the
# names Bethesda facegen and the big overlay packs actually use. Every pattern
# is a whole-token match (see `_has_token`), not a substring.
FILE_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("eyes", ("eye", "eyes")),
    ("brows", ("brow", "brows")),
    ("wrinkle", ("wrinkle", "wrinkles", "frown", "frownlines")),
    ("makeup", (
        "makeup", "eyeliner", "eyeshadow", "eyeshadows", "lipstick", "lipgloss",
        "blush", "contour",
    )),
    ("tattoo", (
        "tattoo", "tattoos", "warpaint", "freckle", "freckles", "mole", "moles",
        "dirt", "scar", "scars", "overlay", "overlays",
    )),
]

# A head diffuse. `femalehead_d` is the canonical Skyrim head UV; the `_n` and
# `_sk` maps beside it are its normal and specular and belong to the same
# option rather than becoming separate skins.
HEAD_DIFFUSE = ("femalehead_d.dds", "femalehead_n.dds", "femalehead_sk.dds")

# Canonical Skyrim actor textures, by stem. Vanilla body and head diffuses carry
# NO `_d` suffix — `femalebody_1.dds`, `femalehead.dds` — which is why the old
# `_d`-only rules classified every one of them as `other`. The weight suffix is
# part of the name (`femalebody_0/1`, `femalehead_0/1` are the FaceGen head
# variants) and a map suffix follows it (`femalebody_1_msn`).
#
# Body, hands and feet all bind to the *body* slot: they are one continuous skin
# on one atlas, and offering `femalehands_1.dds` as an alternative body map is
# correct — that is what the game does.
CANONICAL_ACTOR_TEXTURE = re.compile(
    r"^(1stperson)?(female|male)(head|body|hands|feet|tail)(_\d+)?$"
)
# The parts whose maps belong to the `skin` slot rather than `body`.
CANONICAL_HEAD_PARTS = frozenset({"head"})

# Textures inside a mod whose name says "hair", or under a `\hair` path, are
# hair atlases. `hg hairdos 2\textures\4uplod-t\bebe.dds` matches neither a
# family directory nor a family filename, and is 578 of the archive's hair
# textures — so the mod-level rule is what makes the category real.
HAIR_MOD_TOKENS = ("hair", "hairdo", "hairdos", "hairstyle", "hairstyles", "wig", "wigs")

# Face overlays only exist in the actor texture tree or a tintmask/decal
# folder. Without this gate the filename rules are catastrophic: `dirt` is the
# first token of SMIM's `dirt01.dds` *and* of `smim_bridge_dirt.dds`, and 202X's
# landscape mud is called `Dirt02FloorAlpha.dds`. The directory is what
# separates a cheek warpaint from a bridge texture that happens to be dirty.
FACE_TREE = (
    "\\actors\\character\\",
    "\\tintmask",
    "\\overlays\\",
    "\\makeup",
    "\\decal",
    "\\warpaint",
    "\\cotr overlays\\",
)

# Concatenated structural tints. Bethesda names these with no separator at all
# (`femaleLowereyesocket.dds`, `skintone.dds`), so a token split cannot see the
# word — the match has to be a substring.
STRUCTURAL_TINT_PARTS = (
    "eyesocket",
    "skintone",
    "femalehead",
)


def _has_token(stem: str, token: str) -> bool:
    """True when `token` appears at a word boundary inside `stem`.

    Plain substring matching is what made `Damaged_basecolor.dds` a wrinkle and
    `metalwork01_brown.dds` a brow. Splitting on the separators facegen filenames
    actually use (`_`, space, `-`, `.`, digits) makes "frown" match
    "femalehead_frownlines" while "aged" no longer matches "Damaged".
    """
    return token in re.split(r"[^a-z]+", stem)


def family_of_dir(rel_lower: str) -> str | None:
    """The category implied by a directory path, or None."""
    for kind, patterns in DIR_RULES:
        if any(p in rel_lower for p in patterns):
            return kind
    return None


def family_of_name(name_lower: str) -> str | None:
    """The category implied by a filename, or None."""
    stem = name_lower.rsplit(".", 1)[0]
    for kind, patterns in FILE_RULES:
        if any(_has_token(stem, p) for p in patterns):
            return kind
    return None


def refine_family(kind: str, name_lower: str) -> str:
    """Split the broad families by what the file actually is.

    A tintmask folder holds lip tint, dirt, freckles and warpaint side by side;
    the directory can only say "this is a face overlay", so the filename has to
    say which. Same for `\\overlays\\`, which is makeup in Koralina's tree and
    freckles in COtR's.
    """
    stem = name_lower.rsplit(".", 1)[0]
    tokens = set(re.split(r"[^a-z]+", stem))

    if kind in ("makeup", "tattoo"):
        if tokens & {"dirt", "scar", "scars", "tattoo", "tattoos", "warpaint",
                     "freckle", "freckles", "mole", "moles"}:
            return "tattoo"
        if tokens & {"wrinkle", "wrinkles", "frown", "frownlines"}:
            return "wrinkle"
        # Structural tint — eye-socket shading, nose reddening, the race's own
        # lip tint. The SkinNerd-style packs drop these in TintMasks next to
        # real makeup, but they are part of the skin bake and are not something
        # the user should be able to toggle. Sent to `other` rather than `skin`
        # so the skin picker only offers head diffuses.
        #
        # Concatenated names have no token boundary, so these are substring
        # tests: `femalelowereyesocket` tokenises to one word, and a token
        # search for "eyesocket" misses it.
        if any(p in stem for p in STRUCTURAL_TINT_PARTS) or tokens & {
            "nose", "cheeks", "cheek", "forehead", "chin", "neck", "socket",
            "lips", "lip",
        }:
            return "other"
        return "makeup"

    return kind


def make_id(kind: str, mod: str, rel: str) -> str:
    """A stable, filename-safe id derived from the full mod-relative path.

    The curated manifest builds ids from `slugify(mod-label)` for hair, which
    collides whenever two files share a basename in different folders — the
    second overwrites the first's transcoded texture and the two options end up
    pointing at one image. A digest of the whole path cannot collide, is safe as
    a cache filename, and survives non-ASCII names (the archive has at least one
    Korean filename, which `slugify` would flatten to "asset").
    """
    digest = hashlib.sha1(f"{mod}\0{rel}".encode("utf-8", "surrogatepass")).hexdigest()
    return f"{kind}-{digest[:16]}"


def read_size(path: Path) -> tuple[int, int] | None:
    """DDS dimensions from the 128-byte header — no decode, no Pillow.

    Reading 20 bytes is ~1000x cheaper than opening the file, which is the whole
    reason the catalogue can cover the archive.
    """
    try:
        with open(path, "rb") as f:
            head = f.read(20)
    except OSError:
        return None
    if len(head) < 20 or head[:4] != b"DDS ":
        return None
    height = int.from_bytes(head[12:16], "little")
    width = int.from_bytes(head[16:20], "little")
    if not (0 < width <= 32768 and 0 < height <= 32768):
        return None
    return (width, height)


def classify(mod: str, rel: str) -> tuple[str, str | None]:
    """(kind, mapRole) for one file.

    `mapRole` distinguishes the albedo of a category from its supporting maps,
    so the picker does not offer a normal map as if it were a skin.
    """
    name = Path(rel).name.lower()
    stem = name.rsplit(".", 1)[0]
    rel_lower = rel.lower()
    path_lower = f"{mod.lower()}\\{rel_lower}"

    if rel_lower.endswith(".jslot"):
        return "preset", None

    if rel_lower.endswith((".nif", ".tri", ".obj")):
        if name == "skeleton.nif" or "skeleton" in name:
            return "skeleton", None
        # `colHead.nif` is a collision body, not a head. Offering 76 meshes of
        # which most are physics proxies would make the picker lie about what
        # it can render.
        if name.startswith("col") or "collision" in name or "colbody" in name:
            return "other", "collision"
        # A morph is a sparse *delta* against a base part: same vertex count,
        # renders as a flat shell if offered as geometry. The delta prefix is
        # what marks it, so check that before the part rules — except when the
        # path says `morphs` but the name carries no prefix, which is how
        # `LashiviousLashesFix.tri` (a real 1,216-vertex lash mesh) is rescued.
        if ("facegenmorphs" in rel_lower or "morphs" in rel_lower) and re.match(
            r"^(brow|ear|expr|eyes|face|lip|nose|pers)_", stem
        ):
            return "other", "morph"
        # BodySlide keeps its authored body shapes as OBJ under `ShapeData`;
        # that is the one decodable body mesh in the archive.
        if rel_lower.endswith(".obj") and ("shapedata" in rel_lower or "bodyslide" in rel_lower):
            return "bodyMesh", None
        part = classify_mesh_part(path_lower, stem)
        if part:
            return part, None
        if "facetint" in name or "mask" in stem.split("_"):
            return "other", "mesh"
        return "other", "mesh"

    if rel_lower.endswith((".dds", ".png", ".tga", ".jpg", ".jpeg")):
        if name in HEAD_DIFFUSE or name.endswith("femalehead_d.dds"):
            if name.endswith("_n.dds"):
                return "skin", "normal"
            if name.endswith("_sk.dds"):
                return "skin", "specular"
            return "skin", "albedo"

        # Canonical actor tree first. `textures\actors\character\female\
        # femalehead.dds` is *the* vanilla head map and has no `_d`; the same
        # folder holds `femalebody_1.dds` and its `_msn`/`_s`/`_sk` companions.
        # Scoped to the actor tree so a level mod's `femalehead.dds`-named
        # texture is never offered as a skin.
        if "\\actors\\character\\" in path_lower:
            canonical = canonical_actor_texture(name)
            if canonical is not None:
                return canonical

        kind = family_of_dir(rel_lower)
        if not kind and any(p in rel_lower for p in FACE_TREE):
            # A filename rule only applies inside a face tree. Outside one,
            # `dirt` means a dirty bridge, not a warpaint.
            kind = family_of_name(name)
        if kind:
            kind = refine_family(kind, name)
            role = "albedo"
            if name.endswith("_n.dds"):
                role = "normal"
            elif name.endswith("_sk.dds") or name.endswith("_s.dds"):
                role = "specular"
            return kind, role

        # The three part families that live in `!COR` / `!UBE` texture trees.
        # `\lashes\` and `\mouth\` are narrow enough to trust outright; a body
        # map is only a body map when the filename says so.
        if "\\lashes\\" in rel_lower:
            return "lashes", map_role_for(name)
        if "\\mouth\\" in rel_lower and (stem.startswith("mouth") or "mouth" in stem):
            return "mouth", map_role_for(name)
        # `_1` was the only weight index the old rule accepted; the canonical
        # pair is `_0` and `_1`, and the hands/feet share the body atlas.
        if re.match(
            r"^(1stperson)?(female|male)(body|hands|feet)(_\d+)?(_d|_n|_sk|_s|_msn|_m|_e)?$",
            stem,
        ) or ("\\body\\" in rel_lower and "body" in stem):
            return "body", map_role_for(name)

        # Hair atlases are the hardest to spot: HG Hairdos names them by style
        # (`bebe.dds`, `kiki.dds`) under `textures\4uplod-t\`, which matches no
        # family pattern at all. The mod folder is the only reliable signal.
        # HairPack02 keeps them under `textures\armor\[dint999]\02 hair\`, so a
        # segment merely *containing* "hair" counts too.
        mod_tokens = set(re.split(r"[^a-z]+", mod.lower()))
        if "\\hair" in rel_lower or re.search(r"\\[^\\]*hair", rel_lower) \
                or (mod_tokens & set(HAIR_MOD_TOKENS)) \
                or any(t.startswith("hair") for t in mod_tokens):
            if not name.endswith(("_n.dds", "_m.dds", "_s.dds", "_sk.dds")):
                return "hair", "albedo"
            return "hair", "normal" if name.endswith("_n.dds") else "specular"

        return "other", "texture"

    return "other", None


def canonical_actor_texture(name: str) -> tuple[str, str] | None:
    """(kind, mapRole) for a vanilla actor map, or None.

    `femalebody_1.dds` → `('body','albedo')`; `femalehead_msn.dds` →
    `('skin','specular')`. The stem is matched after its map suffix is peeled
    off, because the weight index sits between the part and the suffix
    (`femalebody_1_sk`) while a FaceGen head variant has no index at all
    (`femalehead_0`).
    """
    role = map_role_for(name)
    stem = name.rsplit(".", 1)[0]
    for suffix in ("_msn", "_sk", "_n", "_s", "_m", "_d", "_e"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    m = CANONICAL_ACTOR_TEXTURE.match(stem)
    if not m:
        return None
    part = m.group(3)
    return ("skin" if part in CANONICAL_HEAD_PARTS else "body"), role


def map_role_for(name: str) -> str:
    """Albedo / normal / specular for a DDS companion, by suffix.

    `_m` is the multilayer mask (`MouthMap_m.dds`) and `_msn` the
    mask+normal composite — both supporting maps, never an alternate atlas,
    or a mesh's authored mouth would look ambiguous and go unpaired.
    """
    if name.endswith("_n.dds"):
        return "normal"
    if name.endswith(("_sk.dds", "_s.dds", "_m.dds", "_msn.dds")):
        return "specular"
    return "albedo"


def classify_mesh_part(path_lower: str, stem: str) -> str | None:
    """Which swappable part a mesh file is, or None.

    Ordered, first match wins. Brows and lashes come before the head rule so
    `femaleheadbrows.tri` is a brow; the head rule is anchored at the stem start
    so `MouthHumanF` is never a head, and the body rule refuses armor paths
    because BDOR/HairPack ship body-shaped armour pieces.
    """
    if "lash" in path_lower and "mask" not in stem:
        return "lashesMesh"
    if "brow" in path_lower and "mask" not in stem:
        return "browsMesh"
    if re.match(r"^mouth", stem) or "\\mouth\\" in path_lower:
        return "mouthMesh"
    if "\\eyes\\" in path_lower or re.match(r"^(eyes?|lens)(female|male)?", stem):
        return "eyeMesh"
    if re.match(r"^(femalehead|malehead|femaleface|malehead)", stem):
        return "headMesh"
    if re.match(r"^(1stperson)?(female|male)body", stem) and "\\armor\\" not in path_lower:
        return "bodyMesh"
    if "\\hair\\" in path_lower and "\\meshes\\" in path_lower:
        return "hairMesh"
    if re.match(r"^hair\d*$", stem) or "hairline" in stem or re.match(r"^\d+hl", stem) \
            or ("\\hair" in path_lower and "\\armor\\" not in path_lower):
        return "hairMesh"
    return None


def probe_mesh(path: Path, stem: str) -> dict[str, Any]:
    """Header-only decodability facts for one mesh file — never a full open.

    A NIF is decided by its 20-byte signature alone: there is no decoder in this
    project, so it is greyed without reading further. A `.tri` is decided by its
    8-byte signature plus the 56-byte FRTRI header. Nothing here reads geometry;
    the expensive decode is `convert_worker.py`'s job, on demand.
    """
    ext = path.suffix.lower()
    if ext == ".obj":
        return {"decodable": True}
    try:
        with open(path, "rb") as f:
            head = f.read(64)
    except OSError as exc:
        return {"decodable": False, "reason": f"unreadable: {exc.strerror or exc}"}

    if ext == ".nif":
        if not (head.startswith(b"Gamebryo File Format") or head.startswith(b"NetImmerse File Format")):
            return {"decodable": False, "reason": "unrecognised .nif signature"}
        return {"decodable": True}
    if ext == ".tri":
        if head[:5] == b"PIRT":
            ver = head[4:8].decode("ascii", "replace").strip("\0")
            return {"decodable": False, "reason": f"BodySlide {ver} — not FaceGen geometry"}
        if head[:5] != b"FRTRI":
            return {"decodable": False, "reason": "unrecognised .tri signature"}
        if stem.lower() in DEGENERATE_STUBS:
            return {"decodable": False, "reason": "degenerate placeholder (3 vertices)"}
        if len(head) < 8:
            return {"decodable": False, "reason": "truncated .tri header"}
        return {"decodable": True}
    return {"decodable": False, "reason": f"no decoder for {ext}"}


def nif_texture_refs(path: Path) -> list[str]:
    """DDS paths named in a NIF's shader block, without decoding the NIF.

    Shader texture slots are stored as length-prefixed printable strings, so a
    printable-run scan recovers `Textures\\!COR\\Hair\\HairLong.dds`. Only
    called for a `.nif` beside a *decodable* mesh, which keeps this out of the
    indexer's hot path: ~1,700 HG hair NIFs are greyed and never opened.
    """
    try:
        with open(path, "rb") as f:
            raw = f.read(NIF_SCAN_BYTES)
    except OSError:
        return []
    refs: list[str] = []
    for run in PRINTABLE_RUN.findall(raw):
        text = run.decode("ascii", "replace")
        if ".dds" not in text.lower():
            continue
        # A run can hold leading block bytes; take the longest dds-looking tail.
        start = text.lower().rfind("textures\\")
        if start < 0:
            continue
        ref = text[start:]
        end = ref.lower().find(".dds")
        if end < 0:
            continue
        refs.append(ref[: end + 4])
    return refs


def load_modorder(path: Path) -> dict[str, int]:
    """Active mod folder -> priority, from `modlist.txt`.

    Verified against the archive: the **first** line is the highest priority
    (`+...`), and `-...` lines are disabled. Later-enabled mods win a path
    conflict only by sitting above an earlier one, so index 0 is the winner.
    """
    order: dict[str, int] = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return order
    priority = 0
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line[0] == "-":
            continue
        name = line[1:] if line[0] == "+" else line
        if name and name not in order:
            order[name] = priority
            priority += 1
    return order


def resolve_ref(ref: str, providers: dict[str, list[str]],
                modorder: dict[str, int]) -> str | None:
    """The mod that wins `ref` under the load order, or None.

    A reference is `textures\\...`, which every mod that ships it stores at the
    same archive-relative path. Priority 0 is the winner, so the active mod with
    the smallest number takes it. Exact paths can resolve across mods; that is
    the point of a load order.
    """
    key = ref.lower().replace("/", "\\")
    mods = providers.get(key)
    if not mods:
        return None
    if not modorder:
        return mods[0]
    ranked = [(modorder.get(m, 1 << 30), m) for m in mods]
    ranked.sort()
    return ranked[0][1] if ranked[0][0] != 1 << 30 else None


def build_pairing(
    entries: list[dict[str, Any]],
    mods_root: Path,
    modorder: dict[str, int],
) -> None:
    """Fill `pairedTextureId` / `normalId` from authored NIF references.

    Only files already in the catalogue can be named, so a pairing is a
    whitelisted id, never a raw path. A mesh is paired only when its NIF names
    exactly one atlas of the relevant kind; ambiguity leaves it unpaired,
    because a wrong atlas is worse than none the user can pick.
    """
    providers: dict[str, list[str]] = {}
    by_mod_rel: dict[tuple[str, str], dict[str, Any]] = {}
    for kind in ("skin", "eyes", "hair", "lashes", "brows", "mouth", "body"):
        for e in entries_of(entries, kind):
            if e.get("mapRole", "albedo") != "albedo":
                continue
            rel_in_mod = e["rel"][len(e["mod"]) + 1:]
            key = rel_in_mod.lower().replace("/", "\\")
            providers.setdefault(key, []).append(e["mod"])
            by_mod_rel[(e["mod"].lower(), key)] = e

    normals: dict[tuple[str, str], dict[str, Any]] = {}
    for kind in ("skin", "eyes", "hair", "lashes", "brows", "mouth", "body"):
        for e in entries_of(entries, kind):
            if e.get("mapRole") != "normal":
                continue
            rel_in_mod = e["rel"][len(e["mod"]) + 1:]
            normals[(e["mod"].lower(), rel_in_mod.lower().replace("/", "\\"))] = e

    for e in entries:
        if e["kind"] not in MESH_KINDS or e.get("decodable") is False:
            continue
        rel_in_mod = e["rel"][len(e["mod"]) + 1:]
        refs = authored_refs(mods_root, e["mod"], rel_in_mod)
        if not refs:
            continue
        want = TEXTURE_KIND_FOR_MESH[e["kind"]]
        # Unambiguous only: exactly one distinct atlas of this kind across every
        # authored reference. Two candidates (brow variants, a male and female
        # sheet) is a guess, and the panel offers no pairing rather than a
        # wrong one.
        candidates: dict[str, dict[str, Any]] = {}
        for ref in refs:
            mod = resolve_ref(ref, providers, modorder)
            if mod is None:
                continue
            hit = by_mod_rel.get((mod.lower(), ref.lower().replace("/", "\\")))
            if hit is not None and hit["kind"] == want:
                candidates[hit["id"]] = hit
        if len(candidates) != 1:
            continue
        atlas = next(iter(candidates.values()))
        e["pairedTextureId"] = atlas["id"]
        normal_key = (atlas["mod"].lower(),
                      atlas["rel"][len(atlas["mod"]) + 1:].lower().replace(".dds", "_n.dds"))
        normal = normals.get(normal_key)
        if normal is not None:
            atlas["normalId"] = normal["id"]


def authored_refs(mods_root: Path, mod: str, rel_in_mod: str) -> list[str]:
    """Every DDS the author's NIFs for this mesh name, deduped and ordered.

    The sibling `.nif` is the direct answer. A tri without one (`femaleheadbrows
    .tri` beside `FemaleBrows.nif`) is answered by the NIFs in its own directory:
    same author, same part, and ambiguity later simply means "no pairing".
    Only meshes the indexer already judged decodable get here, so the ~1,700
    greyed HG NIFs are never opened.
    """
    base = mods_root / mod
    p = base / rel_in_mod.replace("\\", "/")
    sibling = p.with_suffix(".nif")
    files = [sibling] if sibling.is_file() else sorted(p.parent.glob("*.nif")) if p.parent.is_dir() else []
    seen: list[str] = []
    for f in files:
        for ref in nif_texture_refs(f):
            key = ref.lower().replace("/", "\\")
            if key not in (s.lower() for s in seen):
                seen.append(ref)
    return seen


def entries_of(entries: list[dict[str, Any]], kind: str) -> Iterable[dict[str, Any]]:
    return (e for e in entries if e["kind"] == kind)


TEXTURE_KIND_FOR_MESH = {
    "headMesh": "skin",
    "eyeMesh": "eyes",
    "lashesMesh": "lashes",
    "browsMesh": "brows",
    "mouthMesh": "mouth",
    "bodyMesh": "body",
    "hairMesh": "hair",
}


def iter_files(root: Path) -> Iterable[tuple[str, str, Path]]:
    """(mod, rel, path) for every file in every mod folder.

    `os.walk` rather than `Path.rglob` because the archive contains paths with
    `[`, `]`, `'`, `!`, `#`, `(` and `)` — `glob` treats the brackets as a
    character class and silently misses those trees.
    """
    for entry in sorted(os.scandir(root), key=lambda e: e.name.lower()):
        if not entry.is_dir(follow_symlinks=False):
            continue
        mod = entry.name
        base = Path(entry.path)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            for fn in filenames:
                p = Path(dirpath) / fn
                try:
                    rel = str(p.relative_to(base))
                except ValueError:
                    continue
                yield mod, rel, p


def main() -> int:
    # One active source: pack mode walks the pack as one Data-like tree and
    # writes to its own namespace. Legacy MO2 behaviour below is unchanged.
    import asset_source
    cfg = asset_source.load()
    if cfg["layout"] == "pack":
        import sync_pack_assets
        return sync_pack_assets.catalogue_main(cfg)

    ap = argparse.ArgumentParser(description="Index the MO2 archive without decoding it.")
    # The config is the single source of truth; explicit flags still win.
    ap.add_argument("--mods", default=str(cfg["root"]))
    ap.add_argument("--out", default=str(cfg["out"]))
    ap.add_argument("--quiet", action="store_true")
    default_head_path = cfg["out"] / "head" / DEFAULT_HEAD_NAME
    default_head = str(default_head_path) if default_head_path.is_file() else None
    ap.add_argument(
        "--head",
        default=default_head,
        help="measure each hair mesh's visibility against this head JSON "
             "(e.g. public/assets/mo2/head/ube-2-0-u0-7-ube-femalehead-tangent.json). "
             "Decodes hair meshes; pass empty string to skip the measurement.",
    )
    args = ap.parse_args()

    root = Path(args.mods)
    out = Path(args.out)

    catalogue: dict[str, list[dict[str, Any]]] = {k: [] for k in KINDS}
    all_entries: list[dict[str, Any]] = []
    errors: list[str] = []
    scanned = 0
    skipped = 0
    degenerate = 0
    unreadable_nif = 0
    modorder: dict[str, int] = {}

    if not root.is_dir():
        errors.append(f"mod directory not found: {root}")
    else:
        for mod, rel, path in iter_files(root):
            ext = path.suffix.lower()
            if ext not in TEXTURE_EXTS | MESH_EXTS | PRESET_EXTS:
                skipped += 1
                continue
            scanned += 1

            kind, role = classify(mod, rel)
            try:
                st = path.stat()
            except OSError:
                continue

            entry: dict[str, Any] = {
                "id": make_id(kind, mod, rel),
                "mod": mod,
                "file": path.name,
                "label": path.stem,
                "rel": f"{mod}\\{rel}",
                "bytes": st.st_size,
                "mtime": int(st.st_mtime),
                "kind": kind,
            }
            if role:
                entry["mapRole"] = role

            size = read_size(path) if ext == ".dds" else None
            if size:
                entry["size"] = size

            if kind in MESH_KINDS:
                # The client's `resolveManifest` accepts an archive mesh only
                # when `mapRole === 'mesh'`; collision bodies and morphs live
                # in `other` with their own roles, so this is unambiguous.
                entry["mapRole"] = "mesh"
                probe = probe_mesh(path, path.stem)
                entry.update(probe)
                if probe["decodable"]:
                    entry["meshFrame"] = (
                        "ground"
                        if entry["kind"] == "hairMesh"
                        and COR_HAIR_MARKER in entry["rel"].lower()
                        else "head"
                    )
                elif "degenerate" in probe.get("reason", ""):
                    degenerate += 1
                elif probe.get("reason", "").startswith("NIF") or "nif" in probe.get("reason", "").lower():
                    unreadable_nif += 1

            # A file sitting where a family lives but carrying a name that
            # family does not use (a texture in the tintmask folder that is
            # really an eye) is flagged rather than silently trusted.
            dir_kind = family_of_dir(rel.lower())
            if dir_kind and dir_kind != kind:
                entry["note"] = f"directory suggests {dir_kind}"

            catalogue[kind].append(entry)
            all_entries.append(entry)

    pair_start = dt.datetime.now()
    # The modlist lives beside the configured mods folder, not beside the
    # hard-coded archive; a custom root must resolve its own profile.
    modlist = root.parent / "profiles" / "Default" / "modlist.txt"
    modorder = load_modorder(modlist)
    if modorder:
        build_pairing(all_entries, root, modorder)
    pair_ms = int((dt.datetime.now() - pair_start).total_seconds() * 1000)

    fit_ms = 0
    if args.head:
        # Is a hair mesh authored for this head, or does the head swallow it?
        # Header facts cannot answer that; only the geometry can. Measured once
        # at index time so the picker never offers a tile that renders nothing.
        fit_start = dt.datetime.now()
        head_path = Path(args.head)
        if not head_path.is_file():
            errors.append(f"head geometry not found: {head_path}")
        else:
            measured = 0
            for e in all_entries:
                if e["kind"] != "hairMesh" or e.get("decodable") is False:
                    continue
                try:
                    geo = mesh_geometry(
                        root / e["rel"].replace("\\", "/"), e.get("meshFrame") or "head")
                    e["visibility"] = round(
                        visibility_against_head(geo["positions"], head_path), 4)
                    measured += 1
                except Exception as exc:  # noqa: BLE001 — one bad mesh must not stop the walk
                    errors.append(f"visibility {e['file']}: {type(exc).__name__}: {exc}")
            if not args.quiet:
                print(f"visibility: measured {measured} hair meshes against {head_path.name}")
        fit_ms = int((dt.datetime.now() - fit_start).total_seconds() * 1000)

    out.mkdir(parents=True, exist_ok=True)
    kinds_meta: dict[str, dict[str, Any]] = {}

    # Load order as a lookup for the client's pairing step: index 0 wins.
    tmp = out / "catalogue" / "modorder.json.tmp"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(json.dumps(modorder, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out / "catalogue" / "modorder.json")

    for kind, entries in catalogue.items():
        entries.sort(key=lambda e: (e["mod"].lower(), e["rel"].lower()))
        name = f"{kind}.json"
        target = out / "catalogue" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        # Written through a temp file so a half-written catalogue can never be
        # served: the route handler reads these directly.
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
        tmp.replace(target)
        kinds_meta[kind] = {"count": len(entries), "file": f"catalogue/{name}"}

    root_doc = {
        "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "source": str(root),
        "available": root.is_dir(),
        "scanned": scanned,
        "skipped": skipped,
        "kinds": kinds_meta,
        "mesh": {
            "degenerate": degenerate,
            "nif": unreadable_nif,
            "paired": sum(1 for e in all_entries if e.get("pairedTextureId")),
            "normals": sum(1 for e in all_entries if e.get("normalId")),
        },
        "modorder": {"path": str(modlist), "active": len(modorder)},
        "pairingMs": pair_ms,
        "errors": errors,
    }
    if args.head:
        root_doc["visibilityMs"] = fit_ms
    tmp = out / "catalogue.json.tmp"
    tmp.write_text(json.dumps(root_doc, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out / "catalogue.json")

    if not args.quiet:
        print(f"scanned {scanned} files under {root} ({skipped} irrelevant)")
        for kind in KINDS:
            print(f"  {kind:10s} {kinds_meta[kind]['count']:6d}")
        print(
            f"mesh: {unreadable_nif} NIF, {degenerate} degenerate, "
            f"{root_doc['mesh']['paired']} paired, {root_doc['mesh']['normals']} normals "
            f"({pair_ms} ms)"
        )
        print(f"modorder: {len(modorder)} active mods from {modlist}")
        for e in errors:
            print(f"  ERROR {e}", file=sys.stderr)

    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
