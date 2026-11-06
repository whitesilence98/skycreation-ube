#!/usr/bin/env python
"""
On-demand transcoder for the MO2 catalogue.

The api route looks up an id in the catalogue, verifies the resolved path stays
inside the archive, then asks this worker to turn one file into one web asset.
Splitting it out means the route stays pure Node and the decode/encode code
stays next to the helpers it shares with `sync_mo2_assets.py`.

Run once per conversion:

    python -I scripts/convert_worker.py --kind skin --mode albedo \\
        --rel "Sayble Skin for UBE 2.0\\textures\\!UBE\\Head\\femaleHead_d.dds" \\
        --mods "D:/Games/Skyrim/MO2_Archive/mods" \\
        --out  "public/assets/mo2/cache/skin/<id>.webp"

Emits one JSON object on stdout describing what was produced. Non-zero exit on
failure, with the reason on stderr and in the JSON.

Modes:
    albedo    skin / hair / makeup / tattoo / wreath — sRGB webp, alpha kept
    normal    tangent-space map — lossless PNG, no sRGB conversion
    alpha     the mask channel alone, greyscale PNG (overlay tintmasks)
    thumb     128 px webp for the picker
    disc      square crop of an eye atlas around its iris
    atlas     full-detail RGBA webp for an authored part atlas (2048 px)
    mesh      decode a FaceGen .tri or BodySlide .obj into Three.js attributes
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install pillow")


THUMB_PX = 128
ALBEDO_MAX = 1024
ATLAS_MAX = 2048

# The two coordinate frames a mesh can be authored in. `head` is FaceGen's
# centimetre grid centred on the head; `ground` is COR's hair frame, whose
# z-up values are already relative to the scalp. Both are explicit, chosen by
# the caller from the catalogue's `meshFrame` — never guessed from a bbox.
FRAMES = {
    "head": {"scale": 0.01288, "center_y": 1.0, "center_z": 120.73},
    "ground": {"scale": 0.01288, "center_y": 0.0, "center_z": 0.0},
}


def to_srgb_rgb(im: Image.Image) -> Image.Image:
    """Composite alpha against the HUD's dark ground, then go RGB.

    Lifted from sync_mo2_assets.py rather than imported: that module runs a
    whole sync on import and takes its own argv. Keeping the 15 lines here is
    what lets the worker be invoked per file.
    """
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (18, 14, 11, 255))
        im = Image.alpha_composite(bg, im)
    return im.convert("RGB")


def to_rgba(im: Image.Image) -> Image.Image:
    return im.convert("RGBA") if im.mode != "RGBA" else im


def downscale(im: Image.Image, max_side: int) -> Image.Image:
    w, h = im.size
    if max(w, h) <= max_side:
        return im
    scale = max_side / max(w, h)
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def save_webp(im: Image.Image, dst: Path, quality: int = 92, method: int = 4) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=quality, method=method)


def save_png(im: Image.Image, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "PNG", optimize=True)


def measure_iris(im: Image.Image) -> dict[str, float]:
    """Coarse iris box on an eye atlas — the same idea as the sync script's.

    Only the alpha or luminance envelope is used, so this is cheap and does not
    need the full per-pixel analysis the sync script runs for its curated eyes.
    Returns normalised centre and radius; the consumer falls back to the
    canonical atlas fit when `measured` is false.
    """
    rgb = im.convert("RGB").resize((256, 256), Image.BILINEAR)
    px = rgb.load()
    # The iris is the darkest broad region; find the column and row of minimum
    # mean luminance over a smoothed grid.
    best = (0.5, 0.5)
    best_v = 1e9
    for gy in range(8, 248, 4):
        acc = 0
        for gx in range(8, 248, 4):
            r, g, b = px[gx, gy]
            acc += r + g + b
        if acc < best_v:
            best_v = acc
            best = (0.5, gy / 256)
    cx = best[0]
    cy = best[1]
    # Radius: the extent of pixels notably darker than the atlas mean.
    mean = sum(px[x, y][0] for y in range(0, 256, 8) for x in range(0, 256, 8)) / 1024
    dark = [
        (x, y)
        for y in range(0, 256, 2)
        for x in range(0, 256, 2)
        if px[x, y][0] < mean * 0.72
    ]
    if len(dark) < 16:
        return {"cx": 0.5, "cy": cy, "r": 0.18, "measured": False}
    xs = [p[0] / 256 for p in dark]
    ys = [p[1] / 256 for p in dark]
    r = max(0.06, min(0.32, 0.5 * (max(xs) - min(xs) + max(ys) - min(ys))))
    return {"cx": (max(xs) + min(xs)) * 0.5, "cy": (max(ys) + min(ys)) * 0.5, "r": r, "measured": True}


def tri_geometry(path: Path, frame: str = "head") -> dict[str, object]:
    """Decode a FaceGen FRTRI003 mesh into Three.js-ready attributes.

    The header is `FRTRI` + 3-char version, then 14 ints. Positions are in
    centimetres, z-up; `frame` says whether they are offset from the FaceGen
    head origin (120.73) or authored relative to the scalp (COR hair).

    The catalogue's `meshFrame` is an indexer guess from the mod name and is
    wrong for at least one COR entry (its `hair01.tri` is labelled `head` while
    the file's z is scalp-relative, which would put the hair 1.7 m below the
    head). The file itself is unambiguous: a head-frame tri carries z around
    120 cm, a ground-frame one around 0. So the geometry decides, and the
    declared frame is only the tie-breaker for a mesh that straddles neither.
    """
    raw = path.read_bytes()
    if raw[:5] != b"FRTRI":
        raise ValueError(f"not a FaceGen .tri: {path.name}")
    header = struct.unpack("<14i", raw[8:64])
    V, T, num_uvs = header[0], header[1], header[5]
    if not (0 < V < 1_000_000 and 0 < T < 2_000_000):
        raise ValueError(f"implausible .tri header in {path.name}: V={V} T={T}")

    off = 64
    verts = struct.unpack_from(f"<{V * 3}f", raw, off)
    off += V * 12
    tris = struct.unpack_from(f"<{T * 3}i", raw, off)
    off += T * 12
    uvs = struct.unpack_from(f"<{num_uvs * 2}f", raw, off) if num_uvs else ()

    zs = verts[2::3]
    mean_z = sum(zs) / len(zs)
    if mean_z > 60:
        frame = "head"
    elif mean_z > -60:
        frame = "ground"
    # else: an already-converted or nonsense file — keep the declared frame.

    conf = FRAMES[frame]
    S, CY, CZ = conf["scale"], conf["center_y"], conf["center_z"]
    positions = [0.0] * (V * 3)
    for i in range(V):
        x, y, z = verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]
        positions[i * 3] = x * S
        positions[i * 3 + 1] = (z - CZ) * S
        positions[i * 3 + 2] = (y - CY) * S

    # FaceGen winds the opposite way to Three.js.
    indices = [0] * (T * 3)
    for i in range(T):
        a, b, c = tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]
        indices[i * 3] = a
        indices[i * 3 + 1] = c
        indices[i * 3 + 2] = b

    uv_out = [0.0] * (V * 2)
    for i in range(min(V, num_uvs)):
        uv_out[i * 2] = uvs[i * 2]
        uv_out[i * 2 + 1] = 1.0 - uvs[i * 2 + 1]

    # Area-weighted vertex normals.
    normals = [0.0] * (V * 3)
    for i in range(T):
        ia, ib, ic = indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]
        ax, ay, az = positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]
        bx, by, bz = positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]
        cx, cy_, cz = positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy_ - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        for ii in (ia, ib, ic):
            normals[ii * 3] += nx
            normals[ii * 3 + 1] += ny
            normals[ii * 3 + 2] += nz
    for i in range(V):
        nx, ny, nz = normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        normals[i * 3] = round(nx / ln, 4)
        normals[i * 3 + 1] = round(ny / ln, 4)
        normals[i * 3 + 2] = round(nz / ln, 4)

    return {
        "vertexCount": V,
        "triangleCount": T,
        "positions": [round(p, 5) for p in positions],
        "normals": normals,
        "uvs": [round(u, 5) for u in uv_out],
        "indices": indices,
    }


_HEAD_CACHE: dict[Path, tuple[float, float, float, dict[tuple[int, int, int], float]]] = {}


def visibility_against_head(mesh_positions: list[float], head_json: Path) -> float:
    """Fraction of a mesh's vertices that sit outside the shipped head.

    A hairstyle authored for the other sex wraps *inside* this head, so the
    head hides almost all of it and the picker would offer a tile that renders
    nothing. That is not a decoding failure and no header can reveal it — the
    only honest test is geometric, against the head the app actually ships.
    """
    head_key = head_json.resolve()
    if head_key not in _HEAD_CACHE:
        head = json.loads(head_key.read_text(encoding="utf-8"))
        hp = head["positions"]
        H = [(hp[i], hp[i + 1], hp[i + 2]) for i in range(0, len(hp), 3)]
        cran = [p for p in H if p[1] > -0.02]
        if not cran:
            raise ValueError("head geometry has no cranium vertices")
        cx = sum(p[0] for p in cran) / len(cran)
        cy = sum(p[1] for p in cran) / len(cran)
        cz = sum(p[2] for p in cran) / len(cran)

        BUCKET = 24
        radius: dict[tuple[int, int, int], float] = {}
        for p in cran:
            vx, vy, vz = p[0] - cx, p[1] - cy, p[2] - cz
            ln = (vx * vx + vy * vy + vz * vz) ** 0.5 or 1.0
            k = (round(vx / ln * BUCKET), round(vy / ln * BUCKET), round(vz / ln * BUCKET))
            if ln > radius.get(k, 0.0):
                radius[k] = ln
        _HEAD_CACHE[head_key] = (cx, cy, cz, radius)

    cx, cy, cz, radius = _HEAD_CACHE[head_key]
    BUCKET = 24

    def head_radius(d: tuple[float, float, float]) -> float:
        kx, ky, kz = (round(d[0] * BUCKET), round(d[1] * BUCKET), round(d[2] * BUCKET))
        best = 0.0
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    v = radius.get((kx + dx, ky + dy, kz + dz))
                    if v is not None and v > best:
                        best = v
        return best

    n = len(mesh_positions) // 3
    if not n:
        return 0.0
    step = max(1, n // 1000)
    visible = 0
    sampled = 0
    for i in range(0, len(mesh_positions), 3 * step):
        vx = mesh_positions[i] - cx
        vy = mesh_positions[i + 1] - cy
        vz = mesh_positions[i + 2] - cz
        if not (math.isfinite(vx) and math.isfinite(vy) and math.isfinite(vz)):
            continue
        ln = (vx * vx + vy * vy + vz * vz) ** 0.5
        if ln < 1e-5:
            sampled += 1
            continue
        if ln > head_radius((vx / ln, vy / ln, vz / ln)) + 0.004:
            visible += 1
        sampled += 1
    return visible / sampled if sampled else 0.0


def obj_geometry(path: Path) -> dict[str, object]:
    """Decode a BodySlide body OBJ into the exact contract the app ships.

    `ube-body.json` was produced by this pipeline and is the reference: vertex
    order is first appearance of a position in the face list, UVs are taken raw
    (not V-flipped), winding is `[0, 2, 1]`, and positions are
    `x*S, (y-120.73)*S, -(z+1.0)*S` with S = 0.01288. Face tokens are
    `v/vt/vn`; the normal indices are ignored because normals are recomputed
    area-weighted from the final geometry, which is what the shipped file does.
    """
    positions: list[float] = []
    uvs: list[float] = []
    raw_v: list[tuple[float, float, float]] = []
    raw_vt: list[tuple[float, float]] = []
    faces: list[list[tuple[int, int]]] = []

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                x, y, z = (float(c) for c in line.split()[1:4])
                raw_v.append((x, y, z))
            elif line.startswith("vt "):
                u, v = (float(c) for c in line.split()[1:3])
                raw_vt.append((u, v))
            elif line.startswith("f "):
                tri: list[tuple[int, int]] = []
                for token in line.split()[1:]:
                    parts = token.split("/")
                    tri.append((int(parts[0]) - 1,
                                int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1))
                faces.append(tri)

    if not raw_v or not faces:
        raise ValueError(f"empty OBJ: {path.name}")

    S, CZ, CY = 0.01288, 120.73, 1.0
    order: dict[int, int] = {}
    indices: list[int] = []
    exact: list[float] = []  # unrounded, for normals: 5 dp quantisation turns
    for tri in faces:         # small triangles degenerate and skews the average
        ids: list[int] = []
        for vi, ti in tri:
            if vi not in order:
                order[vi] = len(order)
                x, y, z = raw_v[vi]
                pos = (x * S, (y - CZ) * S, -(z + CY) * S)
                exact.extend(pos)
                positions.extend(round(c, 5) for c in pos)
                if 0 <= ti < len(raw_vt):
                    u, v = raw_vt[ti]
                    uvs.extend([round(u, 5), round(v, 5)])
                else:
                    uvs.extend([0.0, 0.0])
            ids.append(order[vi])
        if len(ids) == 3:
            indices.extend([ids[0], ids[2], ids[1]])

    V = len(order)
    T = len(indices) // 3
    normals = _vertex_normals(exact, indices, V)
    return {
        "vertexCount": V,
        "triangleCount": T,
        "positions": positions,
        "normals": normals,
        "uvs": uvs,
        "indices": indices,
    }


def _nif_read_string(raw: bytes, off: int) -> tuple[str, int]:
    n = struct.unpack_from("<I", raw, off)[0]
    return raw[off + 4 : off + 4 + n].decode("latin1", "replace"), off + 4 + n


def _nif_parse(path: Path) -> dict[str, object]:
    """Parse the SSE header: block table, string table, decoded block payloads.

    Only the block kinds the authored decoder needs are interpreted here. The
    block offsets come straight from the header's block sizes, so a corrupt
    size cannot shift every later read.
    """
    raw = path.read_bytes()
    if not (raw.startswith(b"Gamebryo File Format") or raw.startswith(b"NetImmerse File Format")):
        raise ValueError(f"not a NIF file: {path.name}")

    pos = raw.find(b"\n") + 1
    _ver, _endian, user_ver, num_blocks, user_ver2 = struct.unpack("<IBIII", raw[pos : pos + 17])
    pos += 17
    for _ in range(3):
        pos += 1 + raw[pos]

    num_types = struct.unpack("<H", raw[pos : pos + 2])[0]
    pos += 2
    types: list[str] = []
    for _ in range(num_types):
        n = struct.unpack("<I", raw[pos : pos + 4])[0]
        pos += 4
        types.append(raw[pos : pos + n].decode("latin1", "replace"))
        pos += n

    type_indices = struct.unpack(f"<{num_blocks}H", raw[pos : pos + num_blocks * 2])
    pos += num_blocks * 2
    sizes = struct.unpack(f"<{num_blocks}I", raw[pos : pos + num_blocks * 4])
    pos += num_blocks * 4

    num_strings = struct.unpack("<I", raw[pos : pos + 4])[0]
    pos += 4
    pos += 4  # max string length
    strings: list[str] = []
    for _ in range(num_strings):
        s, pos = _nif_read_string(raw, pos)
        strings.append(s)
    pos += 4  # group count (unused by SSE block layouts)

    offsets: list[int] = []
    cursor = pos
    for size in sizes:
        offsets.append(cursor)
        cursor += size

    return {
        "raw": raw,
        "user_ver": user_ver,
        "user_ver2": user_ver2,
        "types": [types[t] for t in type_indices],
        "sizes": sizes,
        "strings": strings,
        "offsets": offsets,
    }


def _nif_name(nif: dict, block: int) -> str:
    raw = nif["raw"]
    if block < 0:
        return ""
    ref = struct.unpack_from("<i", raw, nif["offsets"][block])[0]
    strings = nif["strings"]
    return strings[ref] if 0 <= ref < len(strings) else ""


def _nif_net_end(nif: dict, block: int) -> int:
    """Offset just past NiObjectNET: name, extra-data array, controller."""
    raw = nif["raw"]
    off = nif["offsets"][block]
    extras = struct.unpack_from("<I", raw, off + 4)[0]
    return off + 8 + extras * 4 + 4  # + controller ref


def _nif_transform(nif: dict, block: int) -> tuple[tuple[float, ...], float]:
    """AVObject transform as (translation + 9 rotation floats, scale).

    MatTransform serializes translation, then rotation, then scale.
    """
    raw = nif["raw"]
    base = _nif_net_end(nif, block)  # flags
    trans = struct.unpack_from("<3f", raw, base + 4)
    rot = struct.unpack_from("<9f", raw, base + 16)
    scale = struct.unpack_from("<f", raw, base + 52)[0]
    return trans + rot, scale


def _nif_is_identity(nif: dict, block: int) -> bool:
    tr, s = _nif_transform(nif, block)
    if abs(s - 1.0) > 1e-6:
        return False
    if any(abs(v) > 1e-6 for v in tr[:3]):
        return False
    ident = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    return all(abs(tr[3 + i] - ident[i]) <= 1e-6 for i in range(9))


def _nif_parents(nif: dict) -> dict[int, int]:
    raw = nif["raw"]
    parents: dict[int, int] = {}
    for block, kind in enumerate(nif["types"]):
        if kind != "NiNode":
            continue
        base = _nif_net_end(nif, block)
        count = struct.unpack_from("<I", raw, base + 60)[0]
        for i in range(count):
            child = struct.unpack_from("<i", raw, base + 64 + i * 4)[0]
            if 0 <= child < len(nif["types"]):
                parents.setdefault(child, block)
    return parents


def _nif_texture_paths(nif: dict, block: int) -> list[str]:
    """BSShaderTextureSet entries, in the order the game uses them.

    These are inline length-prefixed strings, not string-table references; an
    empty entry is an empty string.
    """
    raw = nif["raw"]
    off = nif["offsets"][block]
    count = struct.unpack_from("<I", raw, off)[0]
    if count > 16:
        raise ValueError(f"implausible texture-set size {count} in {_nif_name(nif, block)}")
    out: list[str] = []
    off += 4
    for _ in range(count):
        s, off = _nif_read_string(raw, off)
        out.append(s)
    return out


def _nif_shader(nif: dict, block: int) -> tuple[list[str], int]:
    """Return (texture slots, shader flags2) for a BSLightingShaderProperty.

    A leading shader-type word precedes NiObjectNET, then the two flag words
    and the UV offset/scale pair. The texture-set ref follows at a fixed
    offset. Any other size/shape is not a layout this decoder understands.
    """
    raw = nif["raw"]
    off = nif["offsets"][block]
    size = nif["sizes"][block]
    extras = struct.unpack_from("<I", raw, off + 8)[0]
    net_end = off + 16 + extras * 4
    if size < net_end - off + 28:
        raise ValueError(f"unsupported shader block size {size}")
    flags2 = struct.unpack_from("<I", raw, net_end + 4)[0]
    tex_ref = struct.unpack_from("<i", raw, net_end + 24)[0]
    if not (0 <= tex_ref < len(nif["types"])) or nif["types"][tex_ref] != "BSShaderTextureSet":
        raise ValueError("unsupported shader layout: no texture set ref")
    return _nif_texture_paths(nif, tex_ref), flags2


def _nif_alpha(nif: dict, block: int) -> tuple[bool, int]:
    if not (0 <= block < len(nif["types"])) or nif["types"][block] != "NiAlphaProperty":
        return False, 0
    raw = nif["raw"]
    off = _nif_net_end(nif, block)
    if nif["sizes"][block] < off - nif["offsets"][block] + 3:
        raise ValueError("unsupported NiAlphaProperty size")
    flags, threshold = struct.unpack_from("<HB", raw, off)
    return bool(flags & 0x200), threshold


def _nif_dynamic_positions(nif: dict, block: int, num_vertices: int) -> list[float]:
    """Inline BSDynamicTriShape positions: one float32 Vector4 per vertex.

    The shape's own vertex data repeats `numVertices` Vector4s (`x, y, z,
    bitangent-X`) at block +124. A zero word and a byte count precede them; the
    count and the block size are checked before any float is trusted, because a
    wrong stride here silently produces a shredded mesh rather than an error.
    """
    raw = nif["raw"]
    off = nif["offsets"][block]
    size = nif["sizes"][block]
    if not (0 < num_vertices < 0x10000):
        raise ValueError("dynamic shape declares no usable vertex count")
    if size < 124 + num_vertices * 16:
        raise ValueError("dynamic shape block is shorter than its vertex data")
    count = struct.unpack_from("<I", raw, off + 120)[0]
    if count != num_vertices * 16:
        raise ValueError("dynamic vertex byte count disagrees with the shape")
    positions: list[float] = []
    for i in range(num_vertices):
        x, y, z, _bitangent_x = struct.unpack_from("<4f", raw, off + 124 + i * 16)
        if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
            raise ValueError("non-finite dynamic vertex position")
        positions.extend((x, y, z))
    return positions


def _nif_partition_geometry(
    nif: dict, block: int, external_positions: list[float] | None = None
) -> tuple[list[float], list[float], list[float], list[list[int]], int, list[tuple]]:
    """Decode one NiSkinPartition into positions, normals, uvs, triangle lists.

    Uses the partition's own vertex descriptor: stride, attribute offsets and
    the presence flags come from it, not from a fixed 20-byte assumption. The
    SSE stream writes `trueTriangles` unconditionally, and those index the
    shape's shared vertex list.

    `external_positions` supplies positions for a BSDynamicTriShape, whose
    partition vertex records carry no position attribute at all; the stream's
    own (zero) position slot is then ignored. When a partition also omits the
    normal attribute — FaceGen heads generated without split normals do — unit
    normals are derived from the shared triangles instead.

    Also returns the skinning block per partition, in the same vertex order as
    the emitted positions: `(p_nv, weights|None, boneBytes|None, boneList,
    vmap|None)`. Weights are four floats per vertex and bone indices four bytes
    per vertex; both are partition-local, and `vmap` maps each partition vertex
    to the shape's shared vertex index.
    """
    raw = nif["raw"]
    off = nif["offsets"][block]
    size = nif["sizes"][block]
    num_parts, data_size, vertex_size = struct.unpack_from("<3I", raw, off)
    desc = struct.unpack_from("<Q", raw, off + 12)[0]
    if not (0 < num_parts < 1024) or vertex_size == 0 or data_size == 0:
        raise ValueError("partition has no vertex data")
    if data_size % vertex_size:
        raise ValueError("partition data size is not a vertex-stride multiple")

    stride = (desc & 0xF) * 4
    flags = (desc >> 44) & 0xFFFF
    if stride != vertex_size:
        raise ValueError(f"partition stride {vertex_size} disagrees with descriptor {stride}")
    has_pos = bool(flags & 0x001)
    has_uv = bool(flags & 0x002)
    has_normal = bool(flags & 0x008)
    required = [("uv", has_uv)]
    if external_positions is None:
        required.insert(0, ("position", has_pos))
        required.append(("normal", has_normal))
    for name, present in required:
        if not present:
            raise ValueError(f"partition is missing the {name} attribute")

    def attr(i: int) -> int:
        return ((desc >> (4 * i + 2)) & 0x3C) if i else 0

    pos_at, uv_at, nrm_at = attr(0), attr(1), attr(3)
    nv = data_size // vertex_size
    if external_positions is not None and len(external_positions) != nv * 3:
        raise ValueError("external positions do not match the partition vertex count")
    positions: list[float] = []
    normals: list[float] = []
    uvs: list[float] = []
    for i in range(nv):
        base = off + 20 + i * vertex_size
        if external_positions is None:
            x, y, z = struct.unpack_from("<3f", raw, base + pos_at)
        else:
            x, y, z = external_positions[i * 3 : i * 3 + 3]
        u, v = struct.unpack_from("<2e", raw, base + uv_at)
        if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
            raise ValueError("non-finite vertex position")
        if not (math.isfinite(u) and math.isfinite(v)):
            raise ValueError("non-finite vertex uv")
        positions.extend((x, y, z))
        uvs.extend((u, v))
        if has_normal:
            nx = raw[base + nrm_at] / 127.5 - 1.0
            ny = raw[base + nrm_at + 1] / 127.5 - 1.0
            nz = raw[base + nrm_at + 2] / 127.5 - 1.0
            normals.extend((nx, ny, nz))

    idx = off + 20 + data_size
    part_tris: list[list[int]] = []
    part_skin: list[tuple] = []
    for _ in range(num_parts):
        p_nv, p_nt, p_nb, p_ns, p_nw = struct.unpack_from("<5H", raw, idx)
        idx += 10
        if p_ns:
            raise ValueError("unsupported triangle strips in partition")
        if p_nv > nv:
            raise ValueError("partition names more vertices than the shape holds")
        bone_list = list(struct.unpack_from(f"<{p_nb}H", raw, idx)) if p_nb else []
        idx += p_nb * 2
        has_vmap = raw[idx]
        idx += 1
        vmap = None
        if has_vmap:
            vmap = list(struct.unpack_from(f"<{p_nv}H", raw, idx))
            idx += p_nv * 2
        has_weights = raw[idx]
        idx += 1
        weights = None
        if has_weights:
            if p_nw != 4:
                raise ValueError(f"unsupported partition weight count {p_nw}")
            weights = list(struct.unpack_from(f"<{p_nv * 4}f", raw, idx))
            idx += p_nv * 16
        has_faces = raw[idx]
        idx += 1
        if has_faces:
            idx += p_nt * 6
        has_bones = raw[idx]
        idx += 1
        bone_bytes = None
        if has_bones:
            bone_bytes = list(raw[idx : idx + p_nv * 4])
            idx += p_nv * 4
        idx += 2 + 8  # lodLevel, globalVB, partition vertex descriptor
        tris = list(struct.unpack_from(f"<{p_nt * 3}H", raw, idx))
        idx += p_nt * 6
        if len(tris) != p_nt * 3:
            raise ValueError("partition triangle data is truncated")
        part_tris.append(tris)
        part_skin.append((p_nv, weights, bone_bytes, bone_list, vmap))

    if idx > off + size:
        raise ValueError("partition overruns its block")

    if not has_normal:
        # FaceGen heads can ship without split normals. Rebuild them from the
        # shared triangles, in the stream's own winding (the caller reverses it
        # afterwards for Three.js), so they agree with the authored surface.
        acc = [0.0] * (nv * 3)
        for tris in part_tris:
            for t in range(0, len(tris) - 2, 3):
                ia, ib, ic = tris[t], tris[t + 1], tris[t + 2]
                ax, ay, az = positions[ia * 3 : ia * 3 + 3]
                bx, by, bz = positions[ib * 3 : ib * 3 + 3]
                cx, cy, cz = positions[ic * 3 : ic * 3 + 3]
                ux, uy, uz = bx - ax, by - ay, bz - az
                vx, vy, vz = cx - ax, cy - ay, cz - az
                nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
                ln = (nx * nx + ny * ny + nz * nz) ** 0.5
                if ln <= 0.0:
                    continue
                for ii in (ia, ib, ic):
                    acc[ii * 3] += nx / ln
                    acc[ii * 3 + 1] += ny / ln
                    acc[ii * 3 + 2] += nz / ln
        normals = []
        for i in range(nv):
            nx, ny, nz = acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]
            ln = (nx * nx + ny * ny + nz * nz) ** 0.5
            if ln <= 0.0:
                nx, ny, nz, ln = 0.0, 0.0, 1.0, 1.0
            normals.extend((nx / ln, ny / ln, nz / ln))

    return positions, normals, uvs, part_tris, nv, part_skin


def _nif_shape_fields(nif: dict, block: int) -> dict[str, object]:
    raw = nif["raw"]
    base = _nif_net_end(nif, block) + 4  # past AVObject flags
    base += 12 + 36 + 4 + 4  # translation, rotation, scale, collision
    bounds = struct.unpack_from("<4f", raw, base)
    skin, shader, alpha = struct.unpack_from("<iii", raw, base + 16)
    desc = struct.unpack_from("<Q", raw, base + 28)[0]
    num_tris, num_verts = struct.unpack_from("<HH", raw, base + 36)
    data_size = struct.unpack_from("<I", raw, base + 40)[0]
    return {
        "bounds": bounds,
        "skin": skin,
        "shader": shader,
        "alpha": alpha,
        "desc": desc,
        "numTriangles": num_tris,
        "numVertices": num_verts,
        "dataSize": data_size,
    }


def _nif_skin_refs(nif: dict, skin: int) -> tuple[int, int]:
    raw = nif["raw"]
    if not (0 <= skin < len(nif["types"])) or nif["types"][skin] not in (
        "NiSkinInstance",
        "BSDismemberSkinInstance",
    ):
        raise ValueError("shape has no skin instance")
    data_ref, partition_ref = struct.unpack_from("<ii", raw, nif["offsets"][skin])
    if not (0 <= partition_ref < len(nif["types"])) or nif["types"][partition_ref] != "NiSkinPartition":
        raise ValueError("shape has no skin partition")
    return data_ref, partition_ref


_PROXY_PREFIXES = ("col", "virtualground", "collision")


def _nif_skin_data(nif: dict, data_ref: int, names: list[str]) -> dict[str, tuple[list[float], list[float], float]]:
    """Per-bone `NiSkinData` entries: `{bone name: (rot 9f, trans 3f, scale)}`.

    Layout, verified byte-for-byte against every authored NIF in the pack:
    rot 9f @0, trans 3f @36, scale 1f @48, numBones @52, hasVertexWeights B @56,
    then each bone entry at @57: 52 bytes of transform, 16 of bound sphere,
    and — when the flag is set — a vertex-count + that many bound vertices.

    The stored transform is the *inverse* bind: `boneWorld × stored` is the
    identity at rest. The caller uses it as a check; the renderer derives its
    own inverses from the node tree, which agrees to ~1e-6 on this pack.
    """
    raw = nif["raw"]
    off = nif["offsets"][data_ref]
    if nif["sizes"][data_ref] < 57:
        raise ValueError("skin data block is truncated")
    num_bones = struct.unpack_from("<I", raw, off + 52)[0]
    if num_bones != len(names):
        raise ValueError(f"skin data names {num_bones} bones, instance names {len(names)}")
    has_vweights = raw[off + 56]
    cur = off + 57
    out: dict[str, tuple[list[float], list[float], float]] = {}
    for i in range(num_bones):
        if cur + 68 > off + nif["sizes"][data_ref]:
            raise ValueError("skin data bone entry is truncated")
        rot = list(struct.unpack_from("<9f", raw, cur))
        trans = list(struct.unpack_from("<3f", raw, cur + 36))
        scale = struct.unpack_from("<f", raw, cur + 48)[0]
        out[names[i]] = (rot, trans, scale)
        cur += 68  # transform + bounding sphere
        if has_vweights:
            count = struct.unpack_from("<H", raw, cur)[0]
            cur += 2 + count * 6
    return out


def _nif_skin_data_weights(nif: dict, data_ref: int) -> list[dict[int, float]]:
    """Per-bone `{shared vertex index: weight}` from `NiSkinData`.

    The same block as `_nif_skin_data`, read for its optional per-bone weight
    list (a u16 count, then count × (u16 vertex index, f32 weight)). Indices are
    already in the shape's shared vertex order, which is what makes this the
    fallback for a partition that ships no weight block of its own.
    """
    raw = nif["raw"]
    off = nif["offsets"][data_ref]
    end = off + nif["sizes"][data_ref]
    if nif["sizes"][data_ref] < 57:
        raise ValueError("skin data block is truncated")
    num_bones = struct.unpack_from("<I", raw, off + 52)[0]
    has_vweights = raw[off + 56]
    cur = off + 57
    out: list[dict[int, float]] = []
    for _ in range(num_bones):
        cur += 68
        weights: dict[int, float] = {}
        if has_vweights:
            if cur + 2 > end:
                raise ValueError("skin data weight list is truncated")
            count = struct.unpack_from("<H", raw, cur)[0]
            cur += 2
            if cur + count * 6 > end:
                raise ValueError("skin data weight list overruns its block")
            for j in range(count):
                vertex, weight = struct.unpack_from("<Hf", raw, cur + j * 6)
                weights[vertex] = weight
            cur += count * 6
        out.append(weights)
    if num_bones and has_vweights and cur != end:
        raise ValueError("skin data block has trailing bytes")
    return out


def _nif_compose(parent: list[float], local: list[float]) -> list[float]:
    """3×4 row-major `parent · local`, column vectors."""
    out = [0.0] * 12
    for r in range(3):
        pr = parent[r * 4 : r * 4 + 3]
        for c in range(3):
            out[r * 4 + c] = pr[0] * local[c] + pr[1] * local[4 + c] + pr[2] * local[8 + c]
        out[r * 4 + 3] = pr[0] * local[3] + pr[1] * local[7] + pr[2] * local[11] + parent[r * 4 + 3]
    return out


def _nif_world(nif: dict, block: int, cache: dict[int, list[float]], parents: dict[int, int]) -> list[float]:
    """World-space 3×4 of one node, in NIF axes and units."""
    if block in cache:
        return cache[block]
    tr, scale = _nif_transform(nif, block)
    trans, rot = tr[:3], tr[3:]
    local = [
        rot[0] * scale, rot[1] * scale, rot[2] * scale, trans[0],
        rot[3] * scale, rot[4] * scale, rot[5] * scale, trans[1],
        rot[6] * scale, rot[7] * scale, rot[8] * scale, trans[2],
    ]
    parent = parents.get(block, -1)
    value = _nif_compose(_nif_world(nif, parent, cache, parents), local) if parent >= 0 else local
    cache[block] = value
    return value


def _nif_bone_tree(nif: dict, roots: list[int]) -> list[dict[str, object]]:
    """The `NiNode` bones reachable from `roots`, as a flat named list.

    Each entry carries its **world rest matrix**, not a local one. The NIFs in
    a pack disagree about hierarchy — an outfit ships the body chain, a
    hairstyle ships the NPC bones flat under `Scene Root` with world transforms
    baked in — so a local transform is only meaningful against the tree it came
    from. World rest is the representation every mesh agrees on (verified to
    ~1e-5 across this pack), and the renderer rebuilds locals from whichever
    hierarchy it adopts.
    """
    parents = _nif_parents(nif)
    children: dict[int, list[int]] = {}
    for block, parent in parents.items():
        if nif["types"][block] == "NiNode":
            children.setdefault(parent, []).append(block)

    cache: dict[int, list[float]] = {}
    out: list[dict[str, object]] = []
    seen: set[int] = set()

    def visit(block: int) -> None:
        if block in seen:
            return
        seen.add(block)
        parent = parents.get(block, -1)
        parent_name = _nif_name(nif, parent) if parent >= 0 and nif["types"][parent] == "NiNode" else None
        out.append(
            {
                "name": _nif_name(nif, block),
                "parent": parent_name or None,
                "world": [round(v, 6) for v in _nif_world(nif, block, cache, parents)],
            }
        )
        for child in children.get(block, []):
            visit(child)

    for root in roots:
        if 0 <= root < len(nif["types"]) and nif["types"][root] == "NiNode":
            visit(root)
    return out



def _nif_role(path: Path, shape_name: str, texture_paths: list[str]) -> str:
    lowered = shape_name.lower()
    joined = " ".join(texture_paths).lower().replace("/", "\\")
    if lowered == "baseshape" or "\\body\\" in joined or "femalebody" in joined:
        return "skin"
    if lowered.startswith("ex_"):
        return "accessory"
    if {"clothes", "clothing"} & {part.lower() for part in path.parts}:
        return "clothing"
    return "hair"


def _nif_authored_geometry(path: Path, frame: str = "head") -> dict[str, object]:
    """Pack NIF decoder: per-shape groups, authored materials, proxy exclusion.

    Deliberately narrow. It handles the SSE `BSTriShape` + `NiSkinPartition`
    layout the pack uses, refuses non-identity node transforms, inline vertex
    data, strips and weighted partitions rather than guessing at them, and
    drops collision/virtual-ground proxies before they can reach the renderer.
    """
    nif = _nif_parse(path)
    if nif["user_ver"] != 12 or nif["user_ver2"] != 100:
        raise ValueError(f"unsupported NIF stream version in {path.name}")

    parents = _nif_parents(nif)
    types = nif["types"]

    shapes: list[dict[str, object]] = []
    for block, kind in enumerate(types):
        if kind not in ("BSTriShape", "BSDynamicTriShape"):
            continue
        name = _nif_name(nif, block)
        if name.lower().startswith(_PROXY_PREFIXES):
            continue  # collision proxies are not renderable geometry
        fields = _nif_shape_fields(nif, block)
        if fields["dataSize"]:
            raise ValueError(f"unsupported inline vertex data in {name or path.name}")
        data_ref, partition = _nif_skin_refs(nif, int(fields["skin"]))
        skin = nif["offsets"][int(fields["skin"])]
        skeleton_root, num_bones = struct.unpack_from("<iI", nif["raw"], skin + 8)
        bone_refs = list(struct.unpack_from(f"<{num_bones}i", nif["raw"], skin + 16))
        bone_names = [_nif_name(nif, ref) for ref in bone_refs]
        shapes.append({
            "block": block, "name": name, "kind": kind, "fields": fields,
            "partition": partition, "dataRef": data_ref,
            "skeletonRoot": skeleton_root,
            "boneRefs": bone_refs, "boneNames": bone_names,
        })

    if not shapes:
        raise ValueError(f"no renderable shapes in {path.name}")

    # A `BSTriShape` is authored in bind space, so anything but an identity
    # placement means the pack is not in the shape this decoder was built for.
    # A `BSDynamicTriShape` is a FaceGen export: its vertices are the race's
    # local part data and the node transform is what puts them in world space
    # (Nini's head is the one export that relies on this), so that placement is
    # applied instead of refused.
    for shape in shapes:
        block = int(shape["block"])
        if shape["kind"] == "BSDynamicTriShape":
            continue
        if not _nif_is_identity(nif, block):
            raise ValueError(f"unsupported non-identity shape transform in {shape['name']}")
        # Only the ancestors a shape is actually parented under place it in
        # bind space; sibling bone nodes are irrelevant to this static pass.
        ancestor = parents.get(block, -1)
        while ancestor >= 0:
            if not _nif_is_identity(nif, ancestor):
                raise ValueError(f"unsupported non-identity node transform above {shape['name']}")
            ancestor = parents.get(ancestor, -1)

    world_cache: dict[int, list[float]] = {}
    decoded = []
    for shape in shapes:
        block = int(shape["block"])
        dynamic = shape["kind"] == "BSDynamicTriShape"
        external: list[float] | None = None
        if dynamic:
            external = _nif_dynamic_positions(nif, block, int(shape["fields"]["numVertices"]))
        positions, normals, uvs, part_tris, _nv, part_skin = _nif_partition_geometry(
            nif, int(shape["partition"]), external
        )
        if dynamic:
            world = _nif_world(nif, block, world_cache, parents)
            rot = [world[0], world[1], world[2], world[4], world[5], world[6], world[8], world[9], world[10]]
            det = (
                rot[0] * (rot[4] * rot[8] - rot[5] * rot[7])
                - rot[1] * (rot[3] * rot[8] - rot[5] * rot[6])
                + rot[2] * (rot[3] * rot[7] - rot[4] * rot[6])
            )
            if not math.isfinite(det) or abs(det) < 1e-12:
                raise ValueError(f"degenerate node transform on {shape['name']}")
            if det < 0.0:
                # A mirrored placement would flip the triangle winding that the
                # rest of this pipeline reverses once, so refuse it explicitly.
                raise ValueError(f"mirrored node transform on {shape['name']}")
            moved: list[float] = []
            for i in range(len(positions) // 3):
                x, y, z = positions[i * 3 : i * 3 + 3]
                moved.extend((
                    rot[0] * x + rot[1] * y + rot[2] * z + world[3],
                    rot[3] * x + rot[4] * y + rot[5] * z + world[7],
                    rot[6] * x + rot[7] * y + rot[8] * z + world[11],
                ))
            positions = moved
            spun: list[float] = []
            for i in range(len(normals) // 3):
                nx, ny, nz = normals[i * 3 : i * 3 + 3]
                spun.extend((
                    rot[0] * nx + rot[1] * ny + rot[2] * nz,
                    rot[3] * nx + rot[4] * ny + rot[5] * nz,
                    rot[6] * nx + rot[7] * ny + rot[8] * nz,
                ))
            normals = spun
            if not all(math.isfinite(v) for v in positions):
                raise ValueError(f"non-finite placed positions on {shape['name']}")
        indices: list[int] = []
        for tris in part_tris:
            for t in range(0, len(tris), 3):
                a, b, c = tris[t], tris[t + 1], tris[t + 2]
                # Authored triangles wind the opposite way to Three.js.
                indices.extend((a, c, b))
        if not indices:
            raise ValueError(f"shape {shape['name']} has no triangles")
        fields = shape["fields"]
        if int(fields["shader"]) < 0:
            if not dynamic:
                # A static shape with no shader is not a layout this decoder
                # has ever accepted; keep that refusal rather than inventing
                # an untextured material for it.
                raise ValueError("unsupported shader layout: no texture set ref")
            # FaceGen writes the lens "dummy" shapes without a shader. They stay
            # in the output as untextured groups so the shape list is complete.
            texture_paths, flags2 = [], 0
        else:
            texture_paths, flags2 = _nif_shader(nif, int(fields["shader"]))
        alpha_cut, threshold = _nif_alpha(nif, int(fields["alpha"]))
        decoded.append(
            {
                "name": shape["name"],
                "block": shape["block"],
                "dynamic": dynamic,
                "positions": positions,
                "normals": normals,
                "uvs": uvs,
                "partSkin": part_skin,
                "boneNames": shape["boneNames"],
                "skeletonRoot": shape["skeletonRoot"],
                "dataRef": shape["dataRef"],
                "indices": indices,
                "textures": texture_paths,
                "flags2": flags2,
                "alphaTest": threshold / 255.0 if alpha_cut and threshold else None,
                "doubleSided": bool(flags2 & 0x10),
                "role": _nif_role(path, str(shape["name"]), texture_paths),
            }
        )

    conf = FRAMES.get(frame, FRAMES["head"])
    S, CY, CZ = conf["scale"], conf["center_y"], conf["center_z"]

    positions_out: list[float] = []
    normals_out: list[float] = []
    uvs_out: list[float] = []
    indices_out: list[int] = []
    groups: list[dict[str, int]] = []
    materials: list[dict[str, object]] = []

    def texture_refs(slots: list[str]) -> dict[str, str | None]:
        """Return the two maps a static pass can use: diffuse and normal.

        Slots 2+ are cube maps, masks and glow maps whose meaning varies by
        shader and by author (this pack puts them at 2-5), so they are left
        out rather than guessed at. ponytail: add specular/gloss when the
        renderer actually shades with them.
        """
        def at(i: int) -> str | None:
            return slots[i].replace("/", "\\") if i < len(slots) and slots[i] else None

        return {"albedo": at(0), "normal": at(1)}

    # ── skeleton ─────────────────────────────────────────────────────
    # Every shape embeds its own copy of the skeleton it was skinned to. The
    # copies agree with each other and with `skeleton_female.nif` on world rest
    # pose (verified to ~1e-5 on this pack), so the first shape's tree becomes
    # the mesh's one bone list and later shapes are matched by node name.
    #
    # A RaceMenu export is assembled differently: the skinned shapes' bones are
    # siblings of the skeleton root (often parented to the BSFadeNode, or to
    # nothing at all), so the subtree under `skeletonRoot` holds no names. There
    # the union of the shapes' own `boneRefs` — which is exactly the set the
    # weights can name — becomes the bone list, with ancestors so a consumer
    # that rebuilds locals still has a parent chain.
    bones: list[dict[str, object]] = _nif_bone_tree(nif, [int(shapes[0]["skeletonRoot"])])
    bone_index = {str(b["name"]): i for i, b in enumerate(bones)}
    missing = {name for shape in shapes for name in shape["boneNames"]} - set(bone_index)
    if missing:
        # The tree under the skeleton root did not reach every bone the shapes
        # name (exports keep their bones as siblings of that root). Fall back to
        # the union of the shapes' own `boneRefs`, which is exactly the set the
        # weights can name, plus their node ancestors for the parent chain.
        roots: list[int] = []
        seen_roots: set[int] = set()
        for shape in shapes:
            for ref in shape["boneRefs"]:
                if ref in seen_roots or not (0 <= int(ref) < len(types)):
                    continue
                seen_roots.add(int(ref))
                roots.append(int(ref))
                ancestor = parents.get(int(ref), -1)
                while ancestor >= 0 and ancestor not in seen_roots:
                    if types[ancestor] != "NiNode":
                        break
                    seen_roots.add(ancestor)
                    roots.append(ancestor)
                    ancestor = parents.get(ancestor, -1)
        bones = _nif_bone_tree(nif, roots)
        bone_index = {str(b["name"]): i for i, b in enumerate(bones)}
    if not bone_index:
        raise ValueError(f"no skeleton nodes under {_nif_name(nif, int(shapes[0]['skeletonRoot']))}")

    skin_index_out: list[int] = []
    skin_weight_out: list[float] = []
    unskinned: list[int] = []

    for shape_index, item in enumerate(decoded):
        # Shape indices are local to the shape, so shift them into the
        # concatenated vertex buffer before appending.
        vertex_base = len(positions_out) // 3
        base = len(indices_out)
        n = len(item["positions"]) // 3
        for i in range(n):
            x, y, z = item["positions"][i * 3 : i * 3 + 3]
            positions_out.extend((round(x * S, 5), round((z - CZ) * S, 5), round((y - CY) * S, 5)))
            nx, ny, nz = item["normals"][i * 3 : i * 3 + 3]
            ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
            normals_out.extend((round(nx / ln, 4), round(nz / ln, 4), round(ny / ln, 4)))
            u, v = item["uvs"][i * 2 : i * 2 + 2]
            uvs_out.extend((round(u, 5), round(1.0 - v, 5)))
        indices_out.extend(i + vertex_base for i in item["indices"])
        groups.append({"start": base, "count": len(item["indices"]), "materialIndex": shape_index})

        # ── weights ────────────────────────────────────────────────
        # Partition bone indices are local to that partition's own bone list,
        # which in turn indexes the shape's `NiSkinInstance.boneRefs`. Both
        # hops are resolved here so the JSON carries global bone indices.
        shape_bones = [bone_index.get(name, -1) for name in item["boneNames"]]
        if -1 in shape_bones:
            raise ValueError(f"shape {item['name']} names a bone that is not in the shape's skeleton")
        if not item["dynamic"]:
            # Static shapes keep the sequential order this decoder has always
            # emitted; the renderer indexes weights by the appended vertex.
            for p_nv, weights, bone_bytes, bone_list, _vmap in item["partSkin"]:
                if weights is None or bone_bytes is None:
                    raise ValueError(f"shape {item['name']} has an unweighted partition")
                if len(weights) != p_nv * 4 or len(bone_bytes) != p_nv * 4:
                    raise ValueError(f"shape {item['name']} partition weights are truncated")
                for vi in range(p_nv):
                    w = weights[vi * 4 : vi * 4 + 4]
                    total = sum(w)
                    if total <= 0.0:
                        unskinned.append(1)
                        skin_index_out.extend((0, 0, 0, 0))
                        skin_weight_out.extend((1.0, 0.0, 0.0, 0.0))
                        continue
                    # Normalise: SSE streams are 8-bit-quantised and drift a little.
                    for k in range(4):
                        local = bone_bytes[vi * 4 + k]
                        gi = shape_bones[bone_list[local]] if 0 <= local < len(bone_list) else -1
                        if w[k] > 0.0 and gi < 0:
                            raise ValueError(f"shape {item['name']} names bone {local} outside its bone list")
                        skin_index_out.append(gi if gi >= 0 else 0)
                        skin_weight_out.append(round(w[k] / total, 5))
        else:
            # A dynamic shape's partitions store weights in *partition* order
            # while its geometry is in shared/shape order, so `vmap` is what
            # aligns the two. Some FaceGen wigs ship partitions with no weight
            # block at all; the instance's `NiSkinData` carries the same weights
            # already in shared vertex order, so it is the fallback.
            shape_weights: list[tuple[int, int, int, int, float, float, float, float] | None] = [None] * n
            skin_data_weights = None
            for p_nv, weights, bone_bytes, bone_list, vmap in item["partSkin"]:
                if weights is None or bone_bytes is None:
                    if skin_data_weights is None:
                        skin_data_weights = _nif_skin_data_weights(nif, int(item["dataRef"]))
                    for vi in range(p_nv):
                        target = vmap[vi] if vmap is not None else vi
                        if not (0 <= target < n):
                            raise ValueError(f"shape {item['name']} partition maps outside its vertices")
                        w = [d.get(target, 0.0) for d in skin_data_weights]
                        total = sum(w)
                        if total <= 0.0:
                            shape_weights[target] = (0, 0, 0, 0, 1.0, 0.0, 0.0, 0.0)
                            unskinned.append(1)
                            continue
                        order = sorted(range(len(w)), key=lambda k: (-w[k], k))[:4]
                        bones4 = [shape_bones[k] for k in order]
                        if -1 in bones4:
                            raise ValueError(f"shape {item['name']} names a bone that is not in the shape's skeleton")
                        # The output contract is always four influences per
                        # vertex; this block can name fewer bones than that.
                        while len(bones4) < 4:
                            bones4.append(0)
                            w.append(0.0)
                        shape_weights[target] = (*bones4, *(round(w[k] / total, 5) for k in range(4)))
                    continue
                if len(weights) != p_nv * 4 or len(bone_bytes) != p_nv * 4:
                    raise ValueError(f"shape {item['name']} partition weights are truncated")
                for vi in range(p_nv):
                    target = vmap[vi] if vmap is not None else vi
                    if not (0 <= target < n):
                        raise ValueError(f"shape {item['name']} partition maps outside its vertices")
                    w = weights[vi * 4 : vi * 4 + 4]
                    total = sum(w)
                    if total <= 0.0:
                        shape_weights[target] = (0, 0, 0, 0, 1.0, 0.0, 0.0, 0.0)
                        unskinned.append(1)
                        continue
                    bones4 = []
                    for k in range(4):
                        local = bone_bytes[vi * 4 + k]
                        gi = shape_bones[bone_list[local]] if 0 <= local < len(bone_list) else -1
                        if w[k] > 0.0 and gi < 0:
                            raise ValueError(f"shape {item['name']} names bone {local} outside its bone list")
                        bones4.append(gi if gi >= 0 else 0)
                    shape_weights[target] = (*bones4, *(round(w[k] / total, 5) for k in range(4)))
            for entry in shape_weights:
                if entry is None:
                    # FaceGen partitions cover every vertex they render; a gap
                    # means the partition set is not what this decoder thinks.
                    raise ValueError(f"shape {item['name']} has vertices with no partition weights")
                skin_index_out.extend(entry[:4])
                skin_weight_out.extend(entry[4:])

        material: dict[str, object] = {
            "name": item["name"] or f"shape{shape_index}",
            "role": item["role"],
            "textureRefs": texture_refs(item["textures"]),
            "sourceShape": item["name"],
            "sourceShapeIndex": shape_index,
            "doubleSided": item["doubleSided"],
        }
        if item["alphaTest"] is not None:
            material["alphaTest"] = round(float(item["alphaTest"]), 4)
        materials.append(material)

    if not all(math.isfinite(v) for v in positions_out):
        raise ValueError("non-finite transformed positions")
    if any(abs(v) > 10.0 for v in positions_out):
        raise ValueError("implausible mesh bounds")

    return {
        "authored": True,
        "vertexCount": len(positions_out) // 3,
        "triangleCount": len(indices_out) // 3,
        "positions": positions_out,
        "normals": normals_out,
        "uvs": uvs_out,
        "indices": indices_out,
        "groups": groups,
        "materials": materials,
        "bones": bones,
        "skinIndex": skin_index_out,
        "skinWeight": skin_weight_out,
        "unskinnedVertices": len(unskinned),
    }


def nif_geometry(path: Path, frame: str = "head", authored: bool = False) -> dict[str, object]:
    """Decode a Skyrim Special Edition (SSE 20.2.0.7) NIF mesh into Three.js attributes.

    The default path is the legacy flat decoder: every NiSkinPartition is
    concatenated with no shape grouping, transforms or materials. It stays
    exactly as it shipped because catalogue entries depend on it.

    `authored=True` selects the pack decoder: per-shape groups and materials,
    real vertex stride/attribute offsets, proxy exclusion, and a hard error on
    anything it cannot place exactly. See `_nif_authored_geometry`.
    """
    if authored:
        return _nif_authored_geometry(path, frame)
    raw = path.read_bytes()
    if not (raw.startswith(b"Gamebryo File Format") or raw.startswith(b"NetImmerse File Format")):
        raise ValueError(f"not a NIF file: {path.name}")

    pos = raw.find(b"\n") + 1
    ver, endian, user_ver, num_blocks, user_ver2 = struct.unpack("<IBIII", raw[pos : pos + 17])
    pos += 17
    # skip author, desc, export
    pos += 1 + raw[pos]
    pos += 1 + raw[pos]
    pos += 1 + raw[pos]

    num_block_types = struct.unpack("<H", raw[pos : pos + 2])[0]
    pos += 2
    block_types: list[str] = []
    for _ in range(num_block_types):
        l = struct.unpack("<I", raw[pos : pos + 4])[0]
        pos += 4
        block_types.append(raw[pos : pos + l].decode("latin1", "replace"))
        pos += l

    block_type_indices = struct.unpack(f"<{num_blocks}H", raw[pos : pos + num_blocks * 2])
    pos += num_blocks * 2
    block_sizes = struct.unpack(f"<{num_blocks}I", raw[pos : pos + num_blocks * 4])
    pos += num_blocks * 4

    num_strings = struct.unpack("<I", raw[pos : pos + 4])[0]
    pos += 4
    max_str_len = struct.unpack("<I", raw[pos : pos + 4])[0]
    pos += 4
    strings: list[str] = []
    for _ in range(num_strings):
        l = struct.unpack("<I", raw[pos : pos + 4])[0]
        pos += 4
        strings.append(raw[pos : pos + l].decode("latin1", "replace"))
        pos += l
    pos += 4

    block_offsets: list[int] = []
    curr = pos
    for s in block_sizes:
        block_offsets.append(curr)
        curr += s

    raw_verts: list[tuple[float, float, float]] = []
    raw_uvs: list[tuple[float, float]] = []
    raw_normals: list[tuple[float, float, float]] = []
    indices: list[int] = []

    for i in range(num_blocks):
        bt = block_types[block_type_indices[i]]
        if bt == "NiSkinPartition":
            b_data = raw[block_offsets[i] : block_offsets[i] + block_sizes[i]]
            num_parts, data_size, vert_size = struct.unpack("<3I", b_data[:12])
            if vert_size == 0 or data_size == 0:
                continue
            nv = data_size // vert_size

            base_idx = len(raw_verts)
            for vi in range(nv):
                v_chunk = b_data[20 + vi * vert_size : 20 + (vi + 1) * vert_size]
                x, y, z = struct.unpack("<3f", v_chunk[:12])
                x = 0.0 if not math.isfinite(x) else x
                y = 0.0 if not math.isfinite(y) else y
                z = 0.0 if not math.isfinite(z) else z
                raw_verts.append((x, y, z))
                u, v = struct.unpack("<2e", v_chunk[16:20])
                u = 0.0 if not math.isfinite(u) else float(u)
                v = 0.0 if not math.isfinite(v) else float(v)
                raw_uvs.append((u, v))
                nx = (v_chunk[20] / 127.5) - 1.0
                ny = (v_chunk[21] / 127.5) - 1.0
                nz = (v_chunk[22] / 127.5) - 1.0
                nx = 0.0 if not math.isfinite(nx) else nx
                ny = 0.0 if not math.isfinite(ny) else ny
                nz = 1.0 if not math.isfinite(nz) else nz
                raw_normals.append((nx, ny, nz))

            idx = 20 + data_size
            for pi in range(num_parts):
                p_nv, p_nt, p_nb, p_ns, p_nw = struct.unpack("<5H", b_data[idx : idx + 10])
                idx += 10 + p_nb * 2
                has_vmap = b_data[idx]
                idx += 1
                if has_vmap:
                    idx += p_nv * 2
                has_weights = b_data[idx]
                idx += 1
                if has_weights:
                    idx += p_nv * p_nw * 4
                has_faces = b_data[idx]
                idx += 1
                if has_faces:
                    raw_tris = struct.unpack(f"<{p_nt * 3}H", b_data[idx : idx + p_nt * 6])
                    idx += p_nt * 6
                    for ti in range(p_nt):
                        t0, t1, t2 = raw_tris[ti * 3], raw_tris[ti * 3 + 1], raw_tris[ti * 3 + 2]
                        indices.extend([base_idx + t0, base_idx + t2, base_idx + t1])
                has_bones = b_data[idx]
                idx += 1
                if has_bones:
                    idx += p_nv * p_nw
                idx += 1 + 1 + 8 + p_nt * 6

    if not raw_verts or not indices:
        raise ValueError(f"no decodable geometry found in NIF: {path.name}")

    zs = [v[2] for v in raw_verts]
    mean_z = sum(zs) / len(zs) if zs else 0
    if mean_z > 60:
        frame = "head"
    elif mean_z > -60:
        frame = "ground"

    conf = FRAMES.get(frame, FRAMES["head"])
    S, CY, CZ = conf["scale"], conf["center_y"], conf["center_z"]

    V = len(raw_verts)
    positions = [0.0] * (V * 3)
    normals = [0.0] * (V * 3)
    uv_out = [0.0] * (V * 2)

    for i in range(V):
        x, y, z = raw_verts[i]
        positions[i * 3] = round(x * S, 5)
        positions[i * 3 + 1] = round((z - CZ) * S, 5)
        positions[i * 3 + 2] = round((y - CY) * S, 5)

        nx, ny, nz = raw_normals[i]
        ln = (nx * nx + nz * nz + ny * ny) ** 0.5 or 1.0
        normals[i * 3] = round(nx / ln, 4)
        normals[i * 3 + 1] = round(nz / ln, 4)
        normals[i * 3 + 2] = round(ny / ln, 4)

        u, v = raw_uvs[i]
        uv_out[i * 2] = round(u, 5)
        uv_out[i * 2 + 1] = round(1.0 - v, 5)

    return {
        "vertexCount": V,
        "triangleCount": len(indices) // 3,
        "positions": positions,
        "normals": normals,
        "uvs": uv_out,
        "indices": indices,
    }


def mesh_geometry(path: Path, frame: str = "head") -> dict[str, object]:
    """Dispatch to the appropriate geometry decoder based on file extension."""
    suffix = path.suffix.lower()
    if suffix == ".tri":
        return tri_geometry(path, frame)
    if suffix == ".obj":
        return obj_geometry(path)
    if suffix == ".nif":
        return nif_geometry(path, frame)
    raise ValueError(f"not a supported mesh file: {path.name}")


def _vertex_normals(positions: list[float], indices: list[int], V: int) -> list[float]:
    """Unit face normals summed per vertex, then normalised.

    This is the weighting the shipped `ube-body.json` carries (and the one
    `tri_geometry` uses). It matches the reference exactly on every smooth
    region; the handful of hard-edge vertices differ by at most 0.07.
    """
    acc = [0.0] * (V * 3)
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        ax, ay, az = positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]
        bx, by, bz = positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]
        cx, cy, cz = positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        nx, ny, nz = nx / ln, ny / ln, nz / ln
        for ii in (ia, ib, ic):
            acc[ii * 3] += nx
            acc[ii * 3 + 1] += ny
            acc[ii * 3 + 2] += nz
    for i in range(V):
        nx, ny, nz = acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        acc[i * 3] = round(nx / ln, 4)
        acc[i * 3 + 1] = round(ny / ln, 4)
        acc[i * 3 + 2] = round(nz / ln, 4)
    return acc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", required=True)
    ap.add_argument("--mode", required=True)
    ap.add_argument("--rel", required=True, help="<mod>\\<archive-relative path>")
    ap.add_argument("--mods", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--frame", default="head", choices=sorted(FRAMES),
                    help="coordinate frame for --mode mesh (catalogue meshFrame)")
    ap.add_argument("--head", default=None,
                    help="--mode fit: the shipped head JSON to measure against")
    ap.add_argument("--authored", action="store_true",
                    help="--mode mesh: pack decoder with groups, materials and proxy exclusion")
    args = ap.parse_args()

    root = Path(args.mods).resolve()
    src = (root / args.rel.replace("\\", "/")).resolve()
    dst = Path(args.out).resolve()

    result: dict[str, object] = {"ok": False, "mode": args.mode}

    # The route already checked this; repeating it here means a bug in the
    # route cannot turn the worker into an arbitrary-file reader.
    try:
        src.relative_to(root)
    except ValueError:
        result["error"] = "path escapes the mod root"
        print(json.dumps(result))
        return 2

    if not src.is_file():
        result["error"] = f"file not found: {args.rel}"
        print(json.dumps(result))
        return 3

    try:
        if args.mode in ("mesh", "fit"):
            if args.authored:
                if src.suffix.lower() != ".nif":
                    raise ValueError("--authored applies to .nif meshes only")
                geo = nif_geometry(src, args.frame, authored=True)
            else:
                geo = mesh_geometry(src, args.frame)
            if args.mode == "fit":
                if not args.head:
                    raise ValueError("--mode fit needs --head")
                frac = visibility_against_head(geo["positions"], Path(args.head))
                result.update(ok=True, visibility=round(frac, 4))
                print(json.dumps(result))
                return 0
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(json.dumps(geo), encoding="utf-8")
            result.update(ok=True, vertexCount=geo["vertexCount"], triangleCount=geo["triangleCount"])
            print(json.dumps(result))
            return 0

        im = Image.open(src)
        im.load()

        if args.mode == "atlas":
            rgba = to_rgba(im)
            rgba = downscale(rgba, ATLAS_MAX)
            # method=6 is ~15× slower than 4 on a 2048² RGBA atlas (40 s vs
            # 2.8 s) for no visible gain, and used to blow the 30 s route
            # timeout. Quality stays 95: only the encoder effort drops.
            save_webp(rgba, dst, quality=95, method=4)
            result.update(ok=True, size=list(rgba.size), format="webp")
            print(json.dumps(result))
            return 0

        if args.mode == "normal":
            # A normal map is a vector field: no alpha compositing, no sRGB.
            out = im.convert("RGB")
            out = downscale(out, ALBEDO_MAX)
            save_png(out, dst)
            result.update(ok=True, size=list(out.size), format="png")
            print(json.dumps(result))
            return 0

        if args.mode == "alpha":
            rgba = to_rgba(im)
            mask = rgba.getchannel("A")
            if mask.getextrema() == (255, 255):
                # No alpha in the file: the tintmask is the colour itself, so
                # luminance stands in for coverage.
                mask = rgba.convert("L")
            mask = downscale(mask, ALBEDO_MAX)
            save_png(mask, dst)
            result.update(ok=True, size=list(mask.size), format="png")
            print(json.dumps(result))
            return 0

        if args.mode == "disc":
            info = measure_iris(im)
            w, h = im.size
            side = int(min(w, h) * min(0.9, info["r"] * 2.4))
            side = max(16, side)
            cx, cy = int(info["cx"] * w), int(info["cy"] * h)
            x0 = max(0, min(w - side, cx - side // 2))
            y0 = max(0, min(h - side, cy - side // 2))
            crop = im.crop((x0, y0, x0 + side, y0 + side)).convert("RGB")
            crop = crop.resize((256, 256), Image.LANCZOS)
            save_webp(crop, dst, quality=94)
            result.update(ok=True, iris=info, format="webp")
            print(json.dumps(result))
            return 0

        if args.mode == "thumb":
            rgba = to_rgba(im)
            thumb = rgba.copy()
            thumb.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
            save_webp(thumb, dst, quality=86)
            result.update(ok=True, size=list(thumb.size), format="webp")
            print(json.dumps(result))
            return 0

        # albedo
        rgba = to_rgba(im)
        rgba = downscale(rgba, ALBEDO_MAX)
        save_webp(rgba, dst, quality=92)
        result.update(ok=True, size=list(rgba.size), format="webp")
        print(json.dumps(result))
        return 0

    except Exception as exc:  # noqa: BLE001 — the route turns this into a 500
        result["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(result))
        print(f"convert failed for {args.rel} ({args.mode}): {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
