#!/usr/bin/env python
"""Assert the MO2 catalogue and manifest obey the contract the app relies on.

Run after `npm run sync:index && npm run sync:assets`:

    python -I scripts/check_mo2_contract.py

Stdlib only. Non-zero exit on the first broken invariant, with the offending
id or path on stderr. This checks *real* generated output, not fixtures, so a
stale or half-written catalogue fails here instead of in the browser.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MO2 = ROOT / "public" / "assets" / "mo2"
CAT = MO2 / "catalogue"

MESH_KINDS = ["headMesh", "eyeMesh", "lashesMesh", "browsMesh", "mouthMesh", "bodyMesh", "hairMesh"]
TEXTURE_KINDS = ["skin", "eyes", "lashes", "brows", "mouth", "body", "hair"]
# Every mesh kind pairs with one texture kind; the ids must stay inside them.
PAIR = {
    "headMesh": "skin", "eyeMesh": "eyes", "lashesMesh": "lashes", "browsMesh": "brows",
    "mouthMesh": "mouth", "bodyMesh": "body", "hairMesh": "hair",
}

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        failures.append(f"cannot read {path.name}: {exc}")
        return None


def main() -> int:
    kinds = {k: load(CAT / f"{k}.json") or [] for k in MESH_KINDS + TEXTURE_KINDS}
    order = load(CAT / "modorder.json") or {}
    manifest = load(MO2 / "manifest.json") or {}

    # ── every mesh carries a decodability verdict, and a reason when greyed ──
    for kind in MESH_KINDS:
        for e in kinds[kind]:
            check(e.get("kind") == kind, f"{kind}: {e.get('id')} has kind {e.get('kind')}")
            # `resolveManifest` accepts an archive mesh only when the role says
            # mesh; a row without it silently falls back to the offline default.
            check(e.get("mapRole") == "mesh", f"{kind}: {e['id']} mapRole {e.get('mapRole')} != mesh")
            if e.get("decodable") is False:
                check(bool(e.get("reason")), f"{kind}: {e['id']} is not decodable but has no reason")
            else:
                check(
                    e.get("meshFrame") in ("head", "ground"),
                    f"{kind}: {e['id']} is decodable but has no meshFrame",
                )

    # ── the known degenerate stubs are greyed and nothing else tiny is ──────
    flagged = {
        Path(e["rel"]).stem.lower()
        for kind in MESH_KINDS for e in kinds[kind]
        if e.get("decodable") is False and "degenerate" in e.get("reason", "")
    }
    check(
        flagged == {"hairpg7772", "hairlinepg7772", "hairshimeji"},
        f"degenerate set drifted: {sorted(flagged)}",
    )

    # ── COR hair is ground-frame, everything else head-frame ────────────────
    for e in kinds["hairMesh"]:
        if e.get("decodable") is False:
            continue
        is_cor = "\\!cor\\hair\\" in e["rel"].lower()
        want = "ground" if is_cor else "head"
        check(e.get("meshFrame") == want, f"hairMesh {e['rel']}: frame {e.get('meshFrame')} != {want}")

    # ── pairing ids are catalogue ids of the right kind, never raw paths ────
    ids = {kind: {e["id"] for e in kinds[kind]} for kind in kinds}
    for kind in MESH_KINDS:
        target = PAIR[kind]
        for e in kinds[kind]:
            pair = e.get("pairedTextureId")
            if pair is not None:
                check(pair in ids[target], f"{kind} {e['id']}: pairedTextureId {pair} not a {target} id")
    for kind in TEXTURE_KINDS:
        for e in kinds[kind]:
            normal = e.get("normalId")
            if normal is not None:
                check(normal in ids[kind], f"{kind} {e['id']}: normalId {normal} not in {kind}")

    # ── ids are unique per kind (they are the cache filename) ───────────────
    for kind in kinds:
        seen = [e["id"] for e in kinds[kind]]
        check(len(seen) == len(set(seen)), f"{kind}: duplicate ids")

    # ── load order really was read, first line highest priority ─────────────
    check(len(order) > 50, f"modorder.json has only {len(order)} active mods")
    check(
        order.get("UBE 2.0 U0.7", 10**6) < order.get("COR MAIN - CBBE SE", 10**6),
        "modorder: UBE must outrank COR (first modlist line wins)",
    )

    # ── the manifest's offline defaults exist and cover every category ──────
    assets = manifest.get("assets") or {}
    # Every kind ships the UBE default except head skin and body, which wear
    # Imperfect Skin - UBE (PREFERRED_DEFAULT in sync_mo2_assets.py), and hair,
    # which keeps the HG atlas because UBE ships no hair of its own.
    want_mod = {
        "hair": "UBE 2.0 U0.7",
        "skin": "Imperfect Skin - UBE",
        "body": "Imperfect Skin - UBE",
    }
    for kind in MESH_KINDS + TEXTURE_KINDS:
        rows = assets.get(kind) or []
        if not rows:
            failures.append(f"manifest.assets.{kind} is empty")
            continue
        first = rows[0]
        expected = want_mod.get(kind, "UBE 2.0 U0.7")
        if kind not in ("hair", "hairMesh"):
            check(first.get("mod") == expected, f"manifest {kind}[0] must use {expected}")
        if kind == "hair":
            check(first.get("file") == "90sBebe.dds", "default hair must keep HG 90sBebe")
        check("id" in first and "rel" in first, f"manifest {kind}[0] missing id/rel")
        for url_key in ("meshUrl", "texture", "normalTexture"):
            url = first.get(url_key)
            if url:
                check(
                    (MO2 / url.replace("/assets/mo2/", "")).is_file(),
                    f"manifest {kind}[0].{url_key} -> missing {url}",
                )

    # ── shipped prebakes decode to the expected shape ───────────────────────
    for rel, verts in (
        ("body/ube-body.json", 29298),
        ("mouth/ube-mouth.json", 9043),
        ("eyes/ube-lashes.json", 1216),
        ("brows/ube-brows.json", 501),
    ):
        geo = load(MO2 / rel)
        if geo:
            check(geo.get("vertexCount") == verts, f"{rel}: {geo.get('vertexCount')} verts, want {verts}")
            check(len(geo.get("indices", [])) == 3 * geo.get("triangleCount", 0), f"{rel}: index count mismatch")

    # ── COR hair frame puts it on the head, not at the feet ─────────────────
    src = Path(r"D:\Games\Skyrim\MO2_Archive\mods") / "COR MAIN - CBBE SE" / "Meshes" / "!COR" / "Hair" / "hair01.tri"
    if src.is_file():
        sys.path.insert(0, str(ROOT / "scripts"))
        from convert_worker import tri_geometry  # noqa: E402

        geo = tri_geometry(src, "ground")
        ys = geo["positions"][1::3]
        check(-0.3 < min(ys) < 0.3 and -0.3 < max(ys) < 0.3,
              f"COR hair01 ground frame y range {min(ys):.2f}..{max(ys):.2f}")

        # The file's own z decides the frame: this COR mesh is scalp-relative
        # even though the catalogue once guessed "head" for it, and the guess
        # put the hair 1.7 m below the head. Whichever frame is asked for, the
        # result has to land on the head — that is the property, not the label.
        for frame in ("head", "ground"):
            got = tri_geometry(src, frame)["positions"][1::3]
            check(-0.3 < min(got) < 0.3 and -0.3 < max(got) < 0.3,
                  f"COR hair01 asked for {frame!r} landed at y "
                  f"{min(got):.2f}..{max(got):.2f}, off the head")

        # A genuine head-frame mesh must still be offset by the FaceGen origin
        # when the file says so, or the auto-detect would be ignoring good data.
        hsrc = (Path(r"D:\Games\Skyrim\MO2_Archive\mods") / "[Dint999] HairPack02 SSE 1.12 (base)"
                / "meshes" / "armor" / "[dint999]" / "02 Hair" / "male" / "hairS" / "22" / "1HL22.tri")
        if hsrc.is_file():
            hy = tri_geometry(hsrc, "head")["positions"][1::3]
            check(-0.3 < min(hy) < 0.3 and -0.3 < max(hy) < 0.3,
                  f"Dint999 head-frame hair landed at y {min(hy):.2f}..{max(hy):.2f}")

    if failures:
        for f in failures:
            print(f"[x] {f}", file=sys.stderr)
        print(f"\n{len(failures)} contract failure(s)", file=sys.stderr)
        return 1

    print(
        "ok: "
        + ", ".join(f"{k}={len(kinds[k])}" for k in MESH_KINDS + TEXTURE_KINDS)
        + f"; modorder={len(order)}; paired={sum(1 for k in MESH_KINDS for e in kinds[k] if e.get('pairedTextureId'))}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
