#!/usr/bin/env python
"""Assert the generated pack output obeys the contract the app relies on.

Run after `npm run sync:assets` / `npm run sync:index` in pack mode:

    python -I scripts/check_pack_contract.py

Stdlib only. This checks real generated output under the active
`asset-source.json` namespace, and never touches `public/assets/mo2`.
Non-zero exit on the first broken invariant, with the offending id or path on
stderr.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import asset_source  # noqa: E402
import pack_paths  # noqa: E402

ROOT = SCRIPTS.parent
PUBLIC = ROOT / "public"
PACK_MESH_KINDS = [
    "headMesh", "eyeMesh", "lashesMesh", "browsMesh", "mouthMesh", "bodyMesh",
    "handsMesh", "feetMesh", "hairMesh", "clothingMesh",
]
TEXTURE_KINDS = ["skin", "eyes", "lashes", "brows", "mouth", "body", "hair", "clothing"]
PAIR = {
    "headMesh": "skin", "eyeMesh": "eyes", "lashesMesh": "lashes",
    "browsMesh": "brows", "mouthMesh": "mouth", "bodyMesh": "body",
    "handsMesh": "body", "feetMesh": "body",
    "hairMesh": "hair", "clothingMesh": "clothing",
}
# Kinds the pack genuinely cannot supply; a ready-looking row would be a lie.
# Eyes, lashes, brows and mouth left this list when `import_facial_assets.py`
# brought COR's facial maps into the pack — they now resolve like any other
# atlas, so the check below only polices rows that *do* claim unavailability.
EXPECTED_UNAVAILABLE: list[str] = []
# Kinds whose atlas the pack must now supply: the four facial parts are drawn
# by `HeadModel` from these rows, and a row that lost its maps draws grey.
FACIAL_TEXTURE_KINDS = ["eyes", "lashes", "brows", "mouth"]
LEGACY_BASE = "/assets/mo2"

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        failures.append(f"cannot read {path}: {exc}")
        return None


def pack_relative(rel: object) -> bool:
    if not isinstance(rel, str) or not rel:
        return False
    low = rel.lower().replace("/", "\\")
    if low.startswith("\\") or low.startswith("..") or ":" in low:
        return False
    return True


def root_needles(root: object) -> list[str]:
    text = str(root)
    variants = {text, text.replace("\\", "/"), text.rstrip("\\/"), text.rstrip("/\\").replace("\\", "/")}
    return [v for v in variants if v and len(v) >= 3]


def leaks_root(value: object, needles: list[str]) -> bool:
    """Recursive, case-insensitive: a JSON-escaped backslash still counts."""
    if isinstance(value, str):
        low = value.lower().replace("\\\\", "\\").replace("/", "\\")
        return any(n.lower().replace("/", "\\") in low for n in needles)
    if isinstance(value, list):
        return any(leaks_root(v, needles) for v in value)
    if isinstance(value, dict):
        return any(leaks_root(v, needles) for v in value.values())
    return False


def check_url(url: object, out: Path, public_base: str, label: str) -> None:
    if url is None:
        return
    check(isinstance(url, str), f"{label}: url is not a string")
    if not isinstance(url, str):
        return
    check(url.startswith("/"), f"{label}: url {url} is not absolute")
    check(not url.lower().startswith(LEGACY_BASE), f"{label}: legacy URL {url}")
    check(url.startswith(public_base + "/"), f"{label}: {url} outside {public_base}")
    target = PUBLIC / url.lstrip("/")
    check(target.is_file(), f"{label}: missing {url}")


def check_mesh_geometry(doc: dict, label: str) -> None:
    for key in ("vertexCount", "triangleCount", "positions", "normals", "uvs", "indices"):
        check(key in doc, f"{label}: missing {key}")
    if not all(k in doc for k in ("vertexCount", "triangleCount", "positions", "indices")):
        return
    v, t = doc["vertexCount"], doc["triangleCount"]
    pos, idx = doc["positions"], doc["indices"]
    check(isinstance(v, int) and v > 0 and t > 0, f"{label}: empty geometry")
    check(len(pos) == v * 3, f"{label}: positions {len(pos)} != {v * 3}")
    check(len(idx) == t * 3, f"{label}: indices {len(idx)} != {t * 3}")
    finite = all(isinstance(c, (int, float)) and math.isfinite(c) for c in pos[: v * 3])
    check(finite, f"{label}: non-finite position")
    if finite and pos:
        span = max(abs(c) for c in pos)
        check(span < 3.0, f"{label}: implausible coordinate span {span:.2f} m")
    if idx:
        check(min(idx) >= 0 and max(idx) < v, f"{label}: index out of range")

    if doc.get("authored"):
        check(doc.get("authored") is True, f"{label}: authored must be boolean")
        groups, mats = doc.get("groups"), doc.get("materials")
        check(isinstance(groups, list) and groups, f"{label}: authored mesh has no groups")
        check(isinstance(mats, list) and mats, f"{label}: authored mesh has no materials")
        if isinstance(groups, list):
            end = 0
            used = set()
            for g in groups:
                check(isinstance(g, dict), f"{label}: group is not an object")
                if not isinstance(g, dict):
                    continue
                check(all(isinstance(g.get(k), int) for k in ("start", "count", "materialIndex")),
                      f"{label}: group fields")
                start, count, mi = g.get("start", -1), g.get("count", 0), g.get("materialIndex", -1)
                check(start >= end, f"{label}: groups overlap/unsorted at {start}")
                check(start + count <= len(idx), f"{label}: group {start}+{count} out of bounds")
                check(start % 3 == 0 and count % 3 == 0, f"{label}: group not triangle-aligned")
                check(isinstance(mats, list) and 0 <= mi < len(mats), f"{label}: materialIndex {mi}")
                used.add(mi)
                end = start + count
            check(used == set(range(len(mats))), f"{label}: unused materials {set(range(len(mats))) - used}")
        for m in mats or []:
            check(isinstance(m, dict), f"{label}: material is not an object")
            if not isinstance(m, dict):
                continue
            check(isinstance(m.get("name"), str) and m["name"], f"{label}: material name")
            check(m.get("role") in ("skin", "hair", "clothing", "accessory"),
                  f"{label}: material role {m.get('role')}")
            refs = m.get("textureRefs")
            check(isinstance(refs, dict), f"{label}: material textureRefs")
            for slot, ref in (refs or {}).items():
                check(slot in ("albedo", "normal", "specular", "gloss", "emissive"),
                      f"{label}: texture slot {slot}")
                if ref is not None:
                    # A NIF's own spelling is Data-relative (`textures\...`);
                    # the catalogue stores the category path. Both are
                    # pack-relative and both must stay inside the pack.
                    check(pack_relative(ref) and ref.lower().endswith(".dds") and LEGACY_BASE not in ref,
                          f"{label}: textureRef {ref} is not a pack-relative DDS")


def main() -> int:
    try:
        cfg = asset_source.load()
    except SystemExit as exc:
        print(f"[x] {exc}", file=sys.stderr)
        return 1
    if cfg["layout"] != "pack":
        print("ok: active layout is mo2; pack contract not applicable", file=sys.stderr)
        return 0

    out = Path(cfg["out"])
    public_base = cfg["publicBase"]
    source_id = cfg["id"]
    source_layout = cfg["layout"]
    manifest = load(out / "manifest.json") or {}
    catalogue_doc = load(out / "catalogue.json") or {}

    # ── source identity and no absolute roots ────────────────────────────────
    for name, doc in (("manifest", manifest), ("catalogue", catalogue_doc)):
        check(doc.get("sourceId") == source_id, f"{name}: sourceId {doc.get('sourceId')}")
        check(doc.get("sourceLayout") == source_layout, f"{name}: sourceLayout {doc.get('sourceLayout')}")
        check(doc.get("source") == cfg["label"], f"{name}: source label {doc.get('source')!r}")
        check(doc.get("sourceKey") == cfg["sourceKey"], f"{name}: sourceKey {doc.get('sourceKey')} != config")
        check(isinstance(doc.get("diagnostics"), list), f"{name}: diagnostics must be a list")
    check(manifest.get("available") is True, "manifest: source not available")
    needles = root_needles(cfg["root"])
    for name, doc in (("manifest", manifest), ("catalogue", catalogue_doc)):
        check(not leaks_root(doc, needles), f"{name}: absolute root leaked")
    check(LEGACY_BASE not in json.dumps(manifest), "manifest: legacy /assets/mo2 URL")
    check(LEGACY_BASE not in json.dumps(catalogue_doc), "catalogue: legacy /assets/mo2 URL")

    # ── catalogue files ─────────────────────────────────────────────────────
    kinds_meta = catalogue_doc.get("kinds") or {}
    kinds: dict[str, list[dict]] = {}
    for kind, meta in kinds_meta.items():
        check((out / meta.get("file", "")).is_file(), f"catalogue: {kind} file missing")
        rows = load(out / "catalogue" / f"{kind}.json")
        if rows is None:
            continue
        check(meta.get("count") == len(rows), f"catalogue: {kind} count {meta.get('count')} != {len(rows)}")
        check(not leaks_root(rows, needles), f"catalogue {kind}: absolute root leaked")
        kinds[kind] = rows
        ids = [e.get("id") for e in rows]
        check(len(ids) == len(set(ids)), f"catalogue: {kind} duplicate ids")
        for e in rows:
            check(e.get("kind") == kind, f"catalogue {kind}: {e.get('id')} has kind {e.get('kind')}")
            check(pack_relative(e.get("rel")), f"catalogue {kind}: {e.get('id')} rel not pack-relative: {e.get('rel')}")
            check("\\" in str(e.get("rel")) or "/" in str(e.get("rel")),
                  f"catalogue {kind}: {e.get('id')} rel has no folder")
            if not e.get("available", True) or e.get("unavailable"):
                continue
            check(pack_paths.pack_rel(Path(cfg["root"]), e["rel"]) is not None,
                  f"catalogue {kind}: {e.get('id')} source missing")
            if e.get("reason"):
                check(e.get("decodable") is False or e.get("unavailable") is True,
                      f"catalogue {kind}: {e.get('id')} has a reason but no unavailable flag")

    # ── mesh rows are decodable or greyed with a reason ──────────────────────
    for kind in PACK_MESH_KINDS:
        for e in kinds.get(kind, []):
            check(e.get("mapRole") == "mesh", f"{kind}: {e.get('id')} mapRole != mesh")
            if e.get("decodable") is False or e.get("unavailable"):
                check(bool(e.get("reason")), f"{kind}: {e.get('id')} unavailable without a reason")
            else:
                check(e.get("meshFrame") in ("head", "ground"),
                      f"{kind}: {e.get('id')} decodable without a frame")
                if e.get("missingTextures"):
                    failures.append(f"{kind}: {e.get('id')} available with missingTextures")

    # ── `untextured` means decodable geometry with absent albedo atlases ─────
    # The producer's exemption is narrow on purpose: only a row whose geometry
    # decodes cleanly may be served in mesh mode without textures. Anything
    # undecodable must never carry it, and a row with no missing files must not
    # either — that would be a lie about why it renders grey.
    for kind, rows in kinds.items():
        for e in rows:
            if e.get("untextured") is not True:
                continue
            check(kind in PACK_MESH_KINDS, f"{kind}: {e.get('id')} claims untextured")
            check(e.get("decodable") is not False,
                  f"{kind}: {e.get('id')} is untextured but undecodable")
            check(e.get("unavailable") is True,
                  f"{kind}: {e.get('id')} untextured without unavailable")
            check(bool(e.get("missingTextures")),
                  f"{kind}: {e.get('id')} untextured without missingTextures")
            check(bool(e.get("reason")), f"{kind}: {e.get('id')} untextured without a reason")
            check(e.get("meshFrame") in ("head", "ground"),
                  f"{kind}: {e.get('id')} untextured without a frame")

    # ── authored NIFs are on demand, with pack-relative rel ───────────────────
    for kind in ("hairMesh", "clothingMesh"):
        want = "hair" if kind == "hairMesh" else "clothing"
        for e in kinds.get(kind, []):
            if e.get("decodable") is False:
                continue
            check(e.get("authored") is True, f"{kind}: {e.get('id')} is not marked authored")
            check("meshUrl" not in e, f"{kind}: {e.get('id')} must not claim a prebaked mesh")
            parts = [p.lower() for p in str(e["rel"]).split("\\")]
            # Three layouts are valid: the category pack (`hair\meshes\…`), the
            # pack's old Data-like tree (`meshes\hairs\…`) and the legacy MO2
            # shape (`hairs\…`, `clothes\…`).
            if parts[0] in ("hairs", "clothes"):
                section = parts[0]
            elif parts[0] in ("hair", "clothing") and len(parts) > 1 and parts[1] == "meshes":
                section = parts[0]
            elif parts[0] == "clothing" and len(parts) > 2 and parts[1] in pack_paths.CLOTHING_SLOTS and parts[2] == "meshes":
                section = parts[0]
            elif parts[0] == "meshes" and len(parts) > 1:
                section = parts[1]
            else:
                section = ""
            check(section in ("hairs", "clothes", "hair", "clothing"),
                  f"{kind}: {e.get('id')} outside a hair/clothing mesh tree: {e['rel']}")
            check(section in (want, "hairs" if want == "hair" else "clothes"),
                  f"{kind}: {e.get('id')} under the wrong category: {e['rel']}")

    # ── collision bodies never appear as a selectable mesh kind ──────────────
    for kind in PACK_MESH_KINDS:
        for e in kinds.get(kind, []):
            stem = str(e.get("file", "")).lower()
            check(e.get("mapRole") != "collision", f"{kind}: {e.get('id')} is a collision body")
            check(not (stem.startswith("col") or "collision" in stem),
                  f"{kind}: {e.get('id')} looks like collision geometry")

    # ── pairing and normals are catalogue ids of the right kind ──────────────
    ids = {kind: {e["id"] for e in rows} for kind, rows in kinds.items()}
    for kind, target in PAIR.items():
        for e in kinds.get(kind, []):
            pair = e.get("pairedTextureId")
            if pair is not None:
                check(pair in ids.get(target, set()), f"{kind} {e['id']}: pair {pair} not a {target} id")
    for kind in TEXTURE_KINDS:
        for e in kinds.get(kind, []):
            normal = e.get("normalId")
            if normal is not None:
                check(normal in ids.get(kind, set()), f"{kind} {e['id']}: normalId {normal} not in {kind}")

    # ── manifest assets: URLs exist, unavailable rows are honest ────────────
    assets = manifest.get("assets") or {}
    for kind in PACK_MESH_KINDS:
        check(assets.get(kind), f"manifest.assets.{kind} is empty")
    for kind in EXPECTED_UNAVAILABLE:
        rows = assets.get(kind) or []
        check(rows, f"manifest.assets.{kind} is empty")
        for e in rows:
            if e.get("available") is False:
                check(bool(e.get("reason")), f"manifest {kind}: unavailable row without reason")
    # The facial atlases are in the pack now, so the default row of each must
    # actually name both maps. A row that silently regressed to "no texture"
    # would still pass every generic URL check below (a missing key is skipped)
    # and draw the part in flat grey, which is the bug this guards.
    for kind in FACIAL_TEXTURE_KINDS:
        row = next((e for e in (assets.get(kind) or []) if e.get("available") is not False), None)
        check(row is not None, f"manifest.assets.{kind}: no available row")
        if row is None:
            continue
        check(bool(row.get("texture")), f"manifest {kind}: available row names no albedo")
        check(bool(row.get("normalTexture")), f"manifest {kind}: available row names no normal map")
    for kind, rows in assets.items():
        for e in rows:
            for key in ("meshUrl", "texture", "normalTexture", "discTexture", "roughnessTexture"):
                check_url(e.get(key), PUBLIC, public_base, f"manifest {kind}[{e.get('id')}].{key}")

    for key, url in (manifest.get("textures") or {}).items():
        check_url(url, PUBLIC, public_base, f"manifest.textures.{key}")
    for kind in PACK_MESH_KINDS:
        first = (assets.get(kind) or [{}])[0]
        if first.get("available") is not False:
            check_url(first.get("meshUrl"), PUBLIC, public_base, f"manifest {kind}[0].meshUrl")
            check("catalogueId" not in first or first["catalogueId"] in ids.get(kind, set()),
                  f"manifest {kind}[0]: catalogueId not a catalogue id")
    for kind, rows in assets.items():
        for e in rows:
            cid = e.get("catalogueId")
            if cid is not None:
                check(cid in ids.get(kind, set()), f"manifest {kind}: catalogueId {cid} not in catalogue")

    # ── manifest `untextured` rows stay honest about what they can serve ────
    # `available:false` keeps defaults and every texture mode refusing them;
    # `onDemand` + `catalogueId` is what lets mesh mode resolve the geometry.
    for kind, rows in assets.items():
        for e in rows:
            if e.get("untextured") is not True:
                continue
            check(kind in PACK_MESH_KINDS, f"manifest {kind}: {e.get('id')} claims untextured")
            check(e.get("available") is False,
                  f"manifest {kind}: {e.get('id')} untextured but available")
            check(e.get("onDemand") is True,
                  f"manifest {kind}: {e.get('id')} untextured without onDemand")
            check(e.get("catalogueId") in ids.get(kind, set()),
                  f"manifest {kind}: {e.get('id')} untextured without a catalogue id")
            check(e.get("decodable") is not False,
                  f"manifest {kind}: {e.get('id')} untextured but undecodable")
            check(bool(e.get("reason")), f"manifest {kind}: {e.get('id')} untextured without a reason")
            check("meshUrl" not in e, f"manifest {kind}: {e.get('id')} untextured claims a meshUrl")
            for key in ("texture", "normalTexture"):
                check(e.get(key) is None,
                      f"manifest {kind}: {e.get('id')} untextured names a {key}")

    # Presets must be discoverable and every successful bake must select real geometry.
    preset_rows = assets.get("preset") or []
    check(len(preset_rows) == len(kinds.get("preset", [])), "preset catalogue/manifest count mismatch")
    for e in preset_rows:
        if e.get("available") is False:
            check(bool(e.get("reason")), f"invalid preset {e.get('file')} lacks reason")
            continue
        check(isinstance(e.get("morphs"), list), f"preset {e.get('file')} lacks morphs")
        matches = [h for h in assets.get("headMesh", []) if h.get("sculptSource") == e.get("file")]
        if e.get("geometrySource") in ("racemenu-export", "sculpt-replay"):
            check(len(matches) == 1, f"preset {e.get('file')} does not have exactly one baked head")
        for head in matches:
            doc = load(PUBLIC / head["meshUrl"].lstrip("/")) or {}
            check_mesh_geometry(doc, head["label"])
            check(doc.get("vertexCount") == head.get("shapes", {}).get("vertexCount"),
                  f"preset {e.get('file')} baked vertex count mismatch")
            if head.get("origin") == "racemenu-export":
                # Re-decode through the real authored path and compare the
                # *head* group's declared count, not merely "some dynamic
                # shape's count" — a decoder that grabbed the mouth or hair
                # shape would still have passed the looser test.
                from convert_worker import nif_geometry
                source = pack_paths.pack_rel(Path(cfg["root"]), head["rel"])
                geo = nif_geometry(source, frame="head", authored=True)
                head_groups = [
                    g for g in geo["groups"]
                    if re.search(r"femalehead", str(geo["materials"][g["materialIndex"]]["sourceShape"]), re.I)
                    and not re.search(r"brow", str(geo["materials"][g["materialIndex"]]["sourceShape"]), re.I)
                ]
                check(len(head_groups) == 1,
                      f"export {head['file']} does not have exactly one female head shape")
                if len(head_groups) == 1:
                    g = head_groups[0]
                    referenced = len(set(geo["indices"][g["start"]:g["start"] + g["count"]]))
                    check(doc.get("vertexCount") == referenced,
                          f"export {head['file']} head vertex mismatch: "
                          f"{doc.get('vertexCount')} != {referenced} referenced")
                    check(doc.get("triangleCount") == g["count"] // 3,
                          f"export {head['file']} head triangle mismatch")
                    check(all(math.isfinite(v) for v in geo["positions"]),
                          f"export {head['file']} decoded non-finite head position")
    check(any(h.get("origin") == "racemenu-export" for h in assets.get("headMesh", [])),
          "no RaceMenu exports decoded")
    check(any(h.get("origin") == "sculpt-replay" for h in assets.get("headMesh", [])),
          "no sculpt replay baked")

    # Presets that carry the same `morphs` are the same face under different
    # names, so they must resolve to the same kind of geometry. They diverged
    # once: only `Iced Coffee.jslot` matched the pack's export and its byte-
    # identical `Default.jslot` fell back to a sculpt replay that moved the
    # mesh by 0.12 mm — the base head, not the export it copies.
    faces: dict[str, set[str]] = {}
    for e in preset_rows:
        if e.get("available") is False:
            continue
        source = pack_paths.pack_rel(Path(cfg["root"]), e["rel"])
        if source is None:
            continue
        morphs = (json.loads(source.read_text(encoding="utf-8-sig")) or {}).get("morphs")
        if not isinstance(morphs, dict):
            continue
        canon = json.dumps(morphs, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        faces.setdefault(hashlib.sha1(canon.encode("utf-8")).hexdigest(), set()).add(
            str(e.get("geometrySource")))
    for digest, origins in faces.items():
        check(len(origins) == 1,
              f"presets sharing face {digest[:12]} resolve differently: {sorted(origins)}")

    # Every canonical body part is weighted in the same head-centred frame.
    for kind in ("bodyMesh", "handsMesh", "feetMesh"):
        row = (assets.get(kind) or [{}])[0]
        variants = row.get("weightVariants") or {}
        check(set(variants) == {"w0", "w1"}, f"{kind}: missing weight pair")
        docs = []
        for half, url in variants.items():
            check_url(url, PUBLIC, public_base, f"{kind}.{half}")
            doc = load(PUBLIC / url.lstrip("/"))
            if not isinstance(doc, dict):
                continue
            docs.append(doc)
            v = doc["vertexCount"]
            check(bool(doc.get("bones")), f"{kind}.{half}: missing skeleton")
            check(len(doc.get("skinIndex", [])) == v * 4, f"{kind}.{half}: skinIndex length")
            check(len(doc.get("skinWeight", [])) == v * 4, f"{kind}.{half}: skinWeight length")
            check(row.get("meshFrame") == "head", f"{kind}: wrong frame")
        if len(docs) == 2:
            for key in ("indices", "skinIndex", "skinWeight", "bones") + (() if kind == "bodyMesh" else ("uvs",)):
                check(docs[0].get(key) == docs[1].get(key), f"{kind}: pair {key} differs")

    # ── garments pair, classify, and list one row per garment ────────────────
    # Clothing ships the same `_0`/`_1` halves as the body, so the pair must be
    # joined (or the WEIGHT slider would move the body out from under the
    # garment) and the manifest must list the `_1` half only (or the picker
    # would offer every garment twice). The classifier is what filters the
    # picker by slot; a garment without one would vanish from EQUIPMENT.
    EQUIP_SLOTS = set(pack_paths.CLOTHING_SLOTS) | {"full"}
    for e in kinds.get("clothingMesh", []):
        if e.get("decodable") is False:
            continue
        check(e.get("equipSlot") in EQUIP_SLOTS,
              f"clothingMesh {e.get('id')} ({e.get('file')}): equipSlot {e.get('equipSlot')!r}")
        half = re.search(r"_([01])\.nif$", str(e.get("file", "")), re.I)
        if not half:
            continue
        check(bool(e.get("weightKey")), f"clothingMesh {e.get('id')}: _0/_1 stem without weightKey")
        variants = e.get("weightVariants") or {}
        check(set(variants) == {"w0", "w1"},
              f"clothingMesh {e.get('id')}: {e.get('file')} has no joined weight pair")
        check(e.get("weightDefault") == (1 if half.group(1) == "1" else None),
              f"clothingMesh {e.get('id')}: only the _1 half may be the default half")
        for side, other in (("w0", "0"), ("w1", "1")):
            twin = next((o for o in kinds.get("clothingMesh", []) if o["id"] == variants.get(side)), None)
            if twin is None:
                check(False, f"clothingMesh {e.get('id')}: {side} is not a catalogue id")
                continue
            check(bool(re.search(rf"_{other}\.nif$", str(twin.get("file")), re.I)),
                  f"clothingMesh {e.get('id')}: {side} names {twin.get('file')}")
            check(twin.get("equipSlot") == e.get("equipSlot"),
                  f"clothingMesh {e.get('id')}: pair halves disagree on equipSlot")
    for e in assets.get("clothingMesh") or []:
        if e.get("weightKey") and not e.get("weightDefault"):
            check(False, f"manifest clothingMesh {e.get('id')}: {e.get('file')} is a non-default pair half")
        if e.get("equipSlot") is not None:
            check(e.get("equipSlot") in EQUIP_SLOTS,
                  f"manifest clothingMesh {e.get('id')}: equipSlot {e.get('equipSlot')!r}")

    # ── every prebaked mesh JSON is valid ────────────────────────────────────
    for path in sorted((out / "meshes").glob("*.json")):

        doc = load(path)
        if isinstance(doc, dict):
            check_mesh_geometry(doc, f"mesh {path.name}")

    # ── the outfit does not duplicate a body mesh ────────────────────────────
    for e in kinds.get("clothingMesh", []):
        check(e.get("kind") != "bodyMesh", f"clothingMesh {e.get('id')} is a body mesh")
        for group in e.get("groups") or []:
            check(group.get("role") != "proxy", f"clothingMesh {e.get('id')} still has proxies")

    # ── the derived body entry tells the server which shapes to keep ─────────
    for e in kinds.get("bodyMesh", []):
        if e.get("onDemand"):
            check(e.get("geometryRole") == "skin",
                  f"bodyMesh {e.get('id')}: on-demand row without geometryRole=skin")
            check(e.get("decodable") is not False,
                  f"bodyMesh {e.get('id')}: on-demand row marked undecodable")

    if failures:
        for f in failures:
            print(f"[x] {f}", file=sys.stderr)
        print(f"\n{len(failures)} pack contract failure(s)", file=sys.stderr)
        return 1

    print(
        "ok: pack " + ", ".join(f"{k}={len(v)}" for k, v in sorted(kinds.items()))
        + f"; diagnostics={len(manifest.get('diagnostics') or [])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
