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
    "hairMesh", "clothingMesh",
]
TEXTURE_KINDS = ["skin", "eyes", "lashes", "brows", "mouth", "body", "hair", "clothing"]
PAIR = {
    "headMesh": "skin", "eyeMesh": "eyes", "lashesMesh": "lashes",
    "browsMesh": "brows", "mouthMesh": "mouth", "bodyMesh": "body",
    "hairMesh": "hair", "clothingMesh": "clothing",
}
# Kinds the pack genuinely cannot supply; a ready-looking row would be a lie.
EXPECTED_UNAVAILABLE = ["eyes", "lashes", "brows", "mouth"]
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
    for kind, rows in assets.items():
        for e in rows:
            for key in ("meshUrl", "texture", "normalTexture", "discTexture"):
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
