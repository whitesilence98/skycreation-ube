"""Offline, approximate head OBJ -> UBE RaceMenu sculpt. Requires numpy.

Input: isolated head, Y-up, neutral expression; UVs/materials/rig are ignored.
Run --help for alignment overrides. A surface fit is not anatomical correspondence.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json"
SCALE = 0.01288 / 10000


def load_obj(path):
    if path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("OBJ exceeds 64 MiB; decimate the isolated head first")
    vertices, faces = [], []
    with path.open(encoding="utf-8-sig") as stream:
        for line_number, line in enumerate(stream, 1):
            fields = line.partition("#")[0].split()
            if not fields:
                continue
            try:
                if fields[0] == "v":
                    if len(fields) not in (4, 5, 7, 8):
                        raise ValueError("expected XYZ, optional W / vertex color")
                    point = [float(x) for x in fields[1:4]]
                    if len(fields) in (5, 8):
                        w = float(fields[4])
                        if not np.isfinite(w) or w == 0:
                            raise ValueError("invalid homogeneous vertex weight")
                        point = [x / w for x in point]
                    vertices.append(point)
                elif fields[0] == "f":
                    if len(fields) < 4:
                        raise ValueError("face needs at least three vertices")
                    ids = []
                    for token in fields[1:]:
                        index = int(token.split("/")[0])
                        index = index - 1 if index > 0 else len(vertices) + index
                        if not 0 <= index < len(vertices) or token.split("/")[0] == "0":
                            raise ValueError("face index out of range")
                        ids.append(index)
                    # ponytail: convex polygons only; triangulate concave faces in Blender.
                    faces.extend([ids[0], ids[i], ids[i + 1]] for i in range(1, len(ids) - 1))
            except ValueError as exc:
                raise ValueError(f"OBJ line {line_number}: {exc}") from exc
            if len(vertices) > 350_000 or len(faces) > 700_000:
                raise ValueError("OBJ too dense; limit 350,000 vertices / 700,000 triangles")
    if not vertices or not faces:
        raise ValueError("OBJ needs vertices and polygon faces")
    p = np.asarray(vertices, dtype=float)
    f = np.asarray(faces, dtype=int)
    if not np.isfinite(p).all():
        raise ValueError("OBJ contains non-finite coordinates")
    area = np.linalg.norm(np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]]), axis=1)
    f = f[area > 1e-15]
    if not len(f):
        raise ValueError("OBJ contains only degenerate triangles")
    used, inverse = np.unique(f, return_inverse=True)
    return p[used], inverse.reshape(-1, 3)


def nearest(p, q, count=1):
    """Bounded-memory, vectorized exact point lookup; no scipy dependency."""
    result = []
    count = min(count, len(q))
    for start in range(0, len(p), 64):
        block = p[start:start + 64]
        distances = np.maximum((block * block).sum(1)[:, None] + (q * q).sum(1)[None, :] - 2 * block @ q.T, 0)
        ids = np.argpartition(distances, count - 1, axis=1)[:, :count]
        result.append(ids)
    return np.concatenate(result)


def rotate_y(p, degrees):
    angle = np.deg2rad(degrees)
    c, s = np.cos(angle), np.sin(angle)
    return p @ np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])


def align(source, base, yaw):
    extent = np.ptp(source, axis=0)
    if extent.min() < 1e-10 or extent[1] / extent[0] > 2.5:
        raise ValueError("Expected an isolated, upright 3D head; remove torso / shoulders first")
    factor = np.ptp(base[:, 1]) / extent[1]
    source = (source - (source.min(0) + source.max(0)) / 2) * factor
    center = (base.min(0) + base.max(0)) / 2
    target = base[np.linspace(0, len(base) - 1, min(900, len(base)), dtype=int)]
    sample = source[np.linspace(0, len(source) - 1, min(900, len(source)), dtype=int)]
    best = None
    # ponytail: upright heads only; explicit --yaw/--mirror correct ambiguous alignment.
    for angle in ([yaw] if yaw is not None else range(0, 360, 45)):
        moving = rotate_y(sample, angle) + center
        full = rotate_y(source, angle) + center
        for _ in range(15):
            paired = target[nearest(moving, target)[:, 0]]
            distance = np.linalg.norm(paired - moving, axis=1)
            keep = distance <= np.quantile(distance, 0.8)
            a, b = moving[keep], paired[keep]
            ca, cb = a.mean(0), b.mean(0)
            u, _, vt = np.linalg.svd((a - ca).T @ (b - cb))
            correction = np.eye(3)
            correction[-1, -1] = np.linalg.det(u @ vt)
            rotation = u @ correction @ vt
            translation = cb - ca @ rotation
            moving = moving @ rotation + translation
            full = full @ rotation + translation
        distances = np.linalg.norm(moving - target[nearest(moving, target)[:, 0]], axis=1)
        score = float(np.sqrt(np.mean(np.sort(distances)[:int(len(distances) * 0.8)] ** 2)))
        if best is None or score < best[0]:
            best = score, full, angle
    return best[1], {"alignment_rms_m": best[0], "yaw_seed_deg": best[2], "scale": float(factor)}


def closest_on_triangles(points, triangles):
    """Closest point per point/triangle pair, including triangle edges."""
    a, b, c = triangles[..., 0, :], triangles[..., 1, :], triangles[..., 2, :]
    ab, ac, ap = b - a, c - a, points - a
    d00, d01, d11 = (ab * ab).sum(-1), (ab * ac).sum(-1), (ac * ac).sum(-1)
    d20, d21 = (ap * ab).sum(-1), (ap * ac).sum(-1)
    det = d00 * d11 - d01 * d01
    denominator = np.maximum(det, 1e-30)
    v, w = (d11 * d20 - d01 * d21) / denominator, (d00 * d21 - d01 * d20) / denominator
    projected = a + v[..., None] * ab + w[..., None] * ac
    valid = (det > 1e-30) & (v >= 0) & (w >= 0) & (v + w <= 1)
    candidates = [projected]
    distances = [np.where(valid, ((projected - points) ** 2).sum(-1), np.inf)]
    for start, end in ((a, b), (b, c), (c, a)):
        edge = end - start
        t = np.clip(((points - start) * edge).sum(-1) / np.maximum((edge * edge).sum(-1), 1e-30), 0, 1)
        candidate = start + t[..., None] * edge
        candidates.append(candidate)
        distances.append(((candidate - points) ** 2).sum(-1))
    chosen = np.argmin(np.stack(distances, axis=-1), axis=-1)
    return np.take_along_axis(np.stack(candidates, axis=-2), chosen[..., None, None], axis=-2)[..., 0, :]


def surface_matches(p, source, faces):
    # ponytail: local surface search, not a global BVH; reject distant matches rather than force a fit.
    incident = [[] for _ in source]
    for i, tri in enumerate(faces):
        for v in tri:
            incident[v].append(i)
    degree = max(map(len, incident))
    if degree > 128:
        raise ValueError("Pathological OBJ topology: vertex touches more than 128 triangles")
    table = np.full((len(source), degree), -1, dtype=int)
    for i, ids in enumerate(incident):
        table[i, :len(ids)] = ids
    nearest_ids = nearest(p, source, 4)
    out = np.empty_like(p)
    for start in range(0, len(p), 128):
        block = p[start:start + 128]
        ids = table[nearest_ids[start:start + 128]].reshape(len(block), -1)
        triangles = source[faces[np.maximum(ids, 0)]]
        candidates = closest_on_triangles(block[:, None, :], triangles)
        distances = ((candidates - block[:, None, :]) ** 2).sum(-1)
        distances[ids < 0] = np.inf
        out[start:start + len(block)] = candidates[np.arange(len(block)), distances.argmin(1)]
    return out


def smoothstep(a, b, values):
    t = np.clip((values - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def collar_indices():
    text = (ROOT / "lib/head/neckDeltas.ts").read_text(encoding="utf-8")
    match = re.search(r"NECK_SEAM_HEAD_INDICES = new Uint16Array\(\[([\d,\s]+)\]\)", text)
    if not match:
        raise ValueError("Cannot read canonical UBE neck seam indices")
    return np.array([int(x) for x in match[1].split(",")], dtype=int)


def facial_mask(base, faces):
    """Only fit the largest connected shell; accessory shells remain canonical."""
    neighbors = [[] for _ in base]
    for a, b, c in faces:
        neighbors[a].extend((b, c))
        neighbors[b].extend((a, c))
        neighbors[c].extend((a, b))
    seen, largest = set(), []
    for start in range(len(base)):
        if start in seen:
            continue
        component, stack = [], [start]
        seen.add(start)
        while stack:
            vertex = stack.pop()
            component.append(vertex)
            for other in neighbors[vertex]:
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        if len(component) > len(largest):
            largest = component
    mask = np.zeros(len(base))
    mask[largest] = 1
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    unique, counts = np.unique(edges, axis=0, return_counts=True)
    # Pin open shell boundaries (eyelids, mouth, neck joins), feather into the face.
    boundary = np.unique(unique[counts == 1])
    mask[boundary] = 0
    for _ in range(3):
        grown = mask.copy()
        for a, b in unique:
            grown[a] = min(grown[a], min(1, mask[b] + 0.25))
            grown[b] = min(grown[b], min(1, mask[a] + 0.25))
        mask = grown
    return mask


def fit(base, faces, source, source_faces):
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges = np.unique(np.concatenate([edges, edges[:, ::-1]]), axis=0)
    degree = np.bincount(edges[:, 0], minlength=len(base))[:, None]
    mask = facial_mask(base, faces)
    mask *= smoothstep(-0.105, -0.075, base[:, 1]) * smoothstep(-0.06, -0.03, base[:, 2])
    mask *= 1 - 0.6 * smoothstep(0.07, 0.085, np.abs(base[:, 0]))
    mask[collar_indices()] = 0
    delta = np.zeros_like(base)
    for cutoff in (0.04, 0.03, 0.02):
        current = base + delta
        matched = surface_matches(current, source, source_faces)
        distance = np.linalg.norm(matched - current, axis=1)
        proposal = np.where((distance < cutoff)[:, None], matched - base, delta)
        for _ in range(3):
            average = np.zeros_like(delta)
            np.add.at(average, edges[:, 0], proposal[edges[:, 1]])
            proposal = 0.7 * proposal + 0.3 * average / np.maximum(degree, 1)
        delta = proposal * mask[:, None]
    rest_normals = np.cross(base[faces[:, 1]] - base[faces[:, 0]], base[faces[:, 2]] - base[faces[:, 0]])
    strength = 1.0
    for _ in range(9):
        final = base + delta * strength
        fitted_normals = np.cross(final[faces[:, 1]] - final[faces[:, 0]], final[faces[:, 2]] - final[faces[:, 0]])
        inverted = ((rest_normals * fitted_normals).sum(1) <= 0) & (np.linalg.norm(rest_normals, axis=1) > 1e-12)
        if not inverted.any():
            break
        strength *= 0.5
    else:
        raise ValueError("Fit rejected: folded / collapsed triangles; shape needs landmark-guided retargeting")
    delta *= strength
    matched = surface_matches(final, source, source_faces)
    distances = np.linalg.norm(matched - final, axis=1)
    active = mask > 0.95
    if not active.any():
        raise ValueError("No face vertices available for fitting")
    metrics = {
        "fit_strength": strength,
        "face_surface_rms_m": float(np.sqrt(np.mean(distances[active] ** 2))),
        "face_coverage_15mm": float(np.mean(distances[active] < 0.015)),
        "max_displacement_m": float(np.linalg.norm(delta, axis=1).max()),
    }
    return final, metrics


def encode(base, fitted, name):
    delta = np.rint((fitted - base) / SCALE).astype(np.int64)
    data = [[i, int(d[0]), int(d[2]), int(d[1])] for i, d in enumerate(delta) if d.any()]
    return {"name": name, "morphs": {"custom": [], "sculptDivisor": 10000, "sculpt": [
        {"host": "!UBE\\Head\\femaleHeadCharGen.tri", "vertices": len(base), "data": data}
    ]}}


def quality_regions(base, faces):
    """ponytail: canonical coordinate bands, not landmarks; replace after reference calibration."""
    x, y, z = base.T
    shell = facial_mask(base, faces) > 0
    # Recover pinned opening vertices adjacent to the main shell, not the
    # boundaries of disconnected accessory shells.
    shell[np.unique(faces[np.any(shell[faces], axis=1)])] = True
    front = shell & (z > .035)
    return {
        "nose": front & (np.abs(x) < .025) & (y > -.022) & (y < .025),
        "eyes": front & (np.abs(x) > .015) & (np.abs(x) < .065) & (y > .018) & (y < .055),
        "lips": front & (np.abs(x) < .035) & (y > -.055) & (y < -.022),
        "jaw": shell & (z > 0) & (y > -.09) & (y < -.055),
    }


def validate_fitted_geometry(base, faces, fitted):
    """Check the final decoded sculpt, not only its pre-quantization proposal."""
    if fitted.shape != base.shape or not np.isfinite(fitted).all():
        raise ValueError("Fit rejected: invalid decoded geometry")
    rest = np.cross(base[faces[:, 1]]-base[faces[:, 0]], base[faces[:, 2]]-base[faces[:, 0]])
    current = np.cross(fitted[faces[:, 1]]-fitted[faces[:, 0]], fitted[faces[:, 2]]-fitted[faces[:, 0]])
    if np.any(((rest*current).sum(1) <= 0) & (np.linalg.norm(rest, axis=1) > 1e-12)):
        raise ValueError("Fit rejected: encoded sculpt folded / collapsed triangles")
    if np.any(fitted[collar_indices()] != base[collar_indices()]):
        raise ValueError("Fit rejected: encoded sculpt moved the protected collar")


def summarise_errors(errors):
    """RMS/p95/max for one region. Pure, so the evaluator can be tested without a fit."""
    if not len(errors):
        raise ValueError("No diagnostic vertices in region")
    return {"vertices": int(len(errors)),
            "rms_m": float(np.sqrt(np.mean(errors**2))),
            "p95_m": float(np.quantile(errors, .95)), "max_m": float(errors.max())}


def projected_envelopes(fitted, source, base):
    """ponytail: horizontal-band extents are silhouette proxies; upgrade to
    visibility-aware raster contours before treating this as silhouette truth."""
    envelopes = {}
    for name, angle in (("front", 0), ("profile", 90), ("three-quarter", 45)):
        a, b = rotate_y(fitted, angle), rotate_y(source, angle)
        bounds = np.linspace(base[:, 1].min(), base[:, 1].max(), 41)
        differences = []
        for lo, hi in zip(bounds[:-1], bounds[1:]):
            aa = a[(a[:, 1] >= lo) & (a[:, 1] < hi), 0]
            bb = b[(b[:, 1] >= lo) & (b[:, 1] < hi), 0]
            if len(aa) and len(bb):
                differences.extend((aa.min()-bb.min(), aa.max()-bb.max()))
        errors = np.abs(differences)
        envelopes[name] = {"samples": len(errors),
                           "rms_m": float(np.sqrt(np.mean(errors**2))) if len(errors) else None,
                           "max_m": float(errors.max()) if len(errors) else None}
    return envelopes


def quality_metrics(base, faces, fitted, source, source_faces, protected=None):
    """Distances include constrained regions. Scores do not certify identity.

    `protected` may be passed when the caller already computed the facial mask;
    the mask walks the whole mesh in Python, so recomputing it per fixture is
    the single most expensive avoidable step in the quality suite.
    """
    matched = surface_matches(fitted, source, source_faces)
    distances = np.linalg.norm(matched-fitted, axis=1)
    regions = {name: summarise_errors(distances[mask])
               for name, mask in quality_regions(base, faces).items()}
    displacement = np.linalg.norm(fitted-base, axis=1)
    if protected is None:
        protected = facial_mask(base, faces) == 0
    return {"regions": regions, "projected_envelopes": projected_envelopes(fitted, source, base),
            "collar_max_displacement_m": float(displacement[collar_indices()].max()),
            "protected_max_displacement_m": float(displacement[protected].max()),
            "likeness_approved": False,
            "limitations": ["Coordinate bands are not anatomical landmarks",
                            "Surface distances are one-directional local-search estimates",
                            "Eye/lip boundaries remain constrained; companions not fitted"]}


def write_quality_report(directory, base, faces, fitted, source, source_faces, report):
    """Optional Pillow diagnostic: fixed orthographic cameras, no textures or materials."""
    from PIL import Image, ImageDraw

    directory.mkdir(parents=True, exist_ok=False)
    (directory / "metrics.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    # Separate panels avoid color-only source/result identity and occlusion from
    # overlaying two surfaces. Same world scale and framing in every panel.
    width, height = 420, 480
    image = Image.new("RGB", (width*3, height*2+90), "#ffffff")
    draw = ImageDraw.Draw(image)
    draw.text((16, 10), "Skin-off geometry comparison / SOURCE top / FITTED UBE bottom", fill="#111111")
    draw.text((16, 30), "Fixed orthographic scale. Synthetic fixtures do not certify real-head likeness.", fill="#333333")
    low, high = base.min(0), base.max(0)
    scale = 350 / max(high-low)
    center_y = (low[1]+high[1])/2
    for column, (name, angle) in enumerate((("Front", 0), ("Profile", 90), ("Three-quarter", 45))):
        for row, (points, triangles, label) in enumerate(((source, source_faces, "SOURCE"), (fitted, faces, "FITTED UBE"))):
            rotated = rotate_y(points, angle)
            normals = np.cross(rotated[triangles[:, 1]]-rotated[triangles[:, 0]],
                               rotated[triangles[:, 2]]-rotated[triangles[:, 0]])
            light = np.array([.3, .5, 1.0]); light /= np.linalg.norm(light)
            lengths = np.linalg.norm(normals, axis=1)
            shades = np.clip(np.abs(normals @ light)/np.maximum(lengths, 1e-15), 0, 1)
            xy = np.column_stack((column*width+width/2+rotated[:, 0]*scale,
                                  70+row*height+height/2-(rotated[:, 1]-center_y)*scale))
            # Orthographic painter's algorithm; diagnostic only, not a GPU render.
            for index in np.argsort(rotated[triangles, 2].mean(1)):
                shade = int(65+170*shades[index])
                draw.polygon([tuple(p) for p in xy[triangles[index]]], fill=(shade, shade, shade))
            draw.text((column*width+16, 70+row*height+8), f"{name} / {label}", fill="#111111")
    image.save(directory / "comparison.png")
    # These are generated reference outputs; never change the shipped base mesh.
    for name, points, triangles in (("source.obj", source, source_faces), ("fitted.obj", fitted, faces)):
        with (directory / name).open("x", encoding="utf-8") as stream:
            for x, y, z in points:
                stream.write(f"v {x} {y} {z}\n")
            for a, b, c in triangles:
                stream.write(f"f {a+1} {b+1} {c+1}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mesh", type=Path, required=True)
    parser.add_argument("--base", type=Path, default=BASE)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--yaw", type=float, help="Yaw seed in degrees; otherwise search eight upright orientations")
    parser.add_argument("--mirror", action="store_true", help="Explicitly mirror X; never guessed automatically")
    parser.add_argument("--report-dir", type=Path, help="NEW directory for regional metrics and fixed-camera skin-off PNGs (requires Pillow)")
    args = parser.parse_args()
    if args.report_dir and args.report_dir.exists():
        raise ValueError("Report directory already exists; choose a new --report-dir")
    if args.out.exists():
        raise ValueError("Output already exists; choose another --out path")
    if args.yaw is not None and not np.isfinite(args.yaw):
        raise ValueError("Yaw must be finite")
    data = json.loads(args.base.read_text(encoding="utf-8"))
    base = np.asarray(data["positions"], dtype=float).reshape(-1, 3)
    faces = np.asarray(data["indices"], dtype=int).reshape(-1, 3)
    if base.shape != (11498, 3) or faces.shape != (22044, 3) or not np.isfinite(base).all() or faces.min() < 0 or faces.max() >= len(base):
        raise ValueError("Base must be the canonical 11,498-vertex / 22,044-triangle UBE mesh")
    fingerprint = hashlib.sha256(faces.astype("<u4").tobytes()).hexdigest()
    if fingerprint != "6cc05326819d20076753d565d74d910436eb439c4d261b6fd0d963c8ef59329e":
        raise ValueError("Base vertex order / triangle topology does not match canonical UBE")
    source, source_faces = load_obj(args.mesh)
    if args.mirror:
        source[:, 0] *= -1
        source_faces = source_faces[:, ::-1]
    source, metrics = align(source, base, args.yaw)
    fitted, quality = fit(base, faces, source, source_faces)
    metrics.update(quality)
    if metrics["alignment_rms_m"] > 0.015 or metrics["face_coverage_15mm"] < 0.8 or metrics["face_surface_rms_m"] > 0.01:
        raise ValueError(f"Fit rejected: {json.dumps(metrics)}; prepare an isolated upright head / adjust --yaw")
    sculpt = encode(base, fitted, args.mesh.stem)
    decoded = base.copy()
    for index, x, z, y in sculpt["morphs"]["sculpt"][0]["data"]:
        decoded[index] += np.array([x, y, z]) * SCALE
    validate_fitted_geometry(base, faces, decoded)
    regional = quality_metrics(base, faces, decoded, source, source_faces)
    if args.report_dir:
        write_quality_report(args.report_dir, base, faces, decoded, source, source_faces,
                             {"approximate": True, "alignment_and_fit": metrics, "quality": regional})
    # Exclusive creation avoids overwriting a previous sculpt, including concurrent runs.
    with args.out.open("x", encoding="utf-8") as stream:
        json.dump(sculpt, stream, allow_nan=False)
    print(json.dumps({"output": str(args.out), "approximate": True, **metrics, "quality": regional}, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as exc:
        print(f"retarget: {exc}", file=sys.stderr)
        sys.exit(1)
