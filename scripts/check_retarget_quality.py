"""Phase-1 synthetic quality evidence, not a real-person likeness certification.

Run through npm run check:retarget. Optional --report-dir creates a NEW directory
containing reproducible skin-off comparisons and machine-readable measurements.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile

import numpy as np

# Explicit trusted module path: also works with python -I from any directory.
spec = importlib.util.spec_from_file_location("retarget", Path(__file__).with_name("retarget_head.py"))
retarget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retarget)


def replay(base, sculpt):
    result = base.copy()
    for index, x, z, y in sculpt["morphs"]["sculpt"][0]["data"]:
        result[index] += np.array([x, y, z]) * retarget.SCALE
    return result


def run(report_dir=None):
    data = json.loads(retarget.BASE.read_text(encoding="utf-8"))
    base = np.asarray(data["positions"], dtype=float).reshape(-1, 3)
    faces = np.asarray(data["indices"], dtype=int).reshape(-1, 3)
    regions = retarget.quality_regions(base, faces)
    assert all(mask.any() for mask in regions.values()), "Every diagnostic region needs coverage"
    # Computed once: the mask walks the whole mesh in Python.
    protected = retarget.facial_mask(base, faces) == 0

    # The evaluator itself must detect known local errors, including pinned
    # areas. These are pure distance summaries, so they need no surface search.
    for name, mask in regions.items():
        assert retarget.summarise_errors(np.zeros(int(mask.sum())))["max_m"] < 1e-10, name
        measured = retarget.summarise_errors(np.full(int(mask.sum()), .006))
        assert measured["max_m"] > .001, f"Evaluator missed {name} error"
    silhouette_probe = base.copy()
    silhouette_probe[:, 0] *= 1.2
    silhouette_metrics = retarget.projected_envelopes(silhouette_probe, base, base)
    assert silhouette_metrics["front"]["rms_m"] > .003

    reports = []
    for name in ("neutral", "known-deformation", "different-topology"):
        source = base.copy()
        source_faces = faces.copy()
        if name != "neutral":
            # Known smooth displacements in all four diagnostic bands, including
            # eyes/lips which are intentionally constrained by open boundaries.
            x, y, z = base.T
            front = z > 0.04
            for cy, cx, amount in ((0.0, 0.0, .004), (.035, .035, .003), (-.035, 0.0, .003)):
                source[:, 2] += amount * np.exp(-((np.abs(x)-cx)/.018)**2 - ((y-cy)/.014)**2) * front
            source[:, 0] += .003 * np.sign(x) * np.exp(-((y+.06)/.018)**2) * (z > 0)
        target = source.copy()  # Known correspondence before deliberate topology destruction.
        if name == "different-topology":
            _, representative, mapping = np.unique(np.floor(source/.003).astype(int), axis=0,
                                                    return_index=True, return_inverse=True)
            source = source[representative]
            source_faces = mapping[faces]
            source_faces = source_faces[(source_faces[:, 0] != source_faces[:, 1]) &
                                        (source_faces[:, 0] != source_faces[:, 2]) &
                                        (source_faces[:, 1] != source_faces[:, 2])]
            assert len(source) != len(base)

        # Already aligned fixtures isolate fitting from alignment. Existing CJS
        # regression separately exercises yaw, scale, translation and reordered IDs.
        fitted, fit_metrics = retarget.fit(base, faces, source, source_faces)
        sculpt = retarget.encode(base, fitted, name)
        decoded = replay(base, sculpt)
        assert np.max(np.abs(decoded-fitted)) <= retarget.SCALE/2 + 1e-12
        retarget.validate_fitted_geometry(base, faces, decoded)
        metrics = retarget.quality_metrics(base, faces, decoded, source, source_faces, protected)
        assert metrics["collar_max_displacement_m"] == 0
        assert metrics["protected_max_displacement_m"] == 0
        # Synthetic regression ceilings, NOT calibrated production likeness limits.
        for region in metrics["regions"].values():
            assert region["rms_m"] < .003, (name, region)
            assert region["p95_m"] < .006, (name, region)
        for view in metrics["projected_envelopes"].values():
            assert view["samples"] >= 60, (name, view)
            assert view["rms_m"] < .002, (name, view)
        if name == "neutral":
            assert np.max(np.abs(decoded-base)) < retarget.SCALE
        else:
            assert np.linalg.norm(decoded-base, axis=1).max() > .0005, "Returned unchanged base"
        correspondence = {}
        for region, mask in regions.items():
            errors = np.linalg.norm(decoded[mask]-target[mask], axis=1)
            correspondence[region] = {"rms_m": float(np.sqrt(np.mean(errors**2))),
                                      "max_m": float(errors.max())}
            assert correspondence[region]["rms_m"] < .0025, (name, region, correspondence[region])
            assert correspondence[region]["max_m"] < .0045, (name, region, correspondence[region])
        report = {"fixture": name, "synthetic": True, "real_head_likeness_approved": False,
                  "alignment": "identity: fixture already in canonical frame",
                  "fit": fit_metrics, "quality": metrics,
                  "known_correspondence": correspondence,
                  "encoding_max_error_m": float(np.max(np.abs(decoded-fitted)))}
        reports.append(report)
        if report_dir:
            retarget.write_quality_report(report_dir / name, base, faces, decoded,
                                          source, source_faces, report)
        print(json.dumps(report, allow_nan=False))

    # Explicit proof that pinned eye/lip boundaries cannot reproduce arbitrary
    # targets. Direct geometric error: no source surface search needed.
    for name in ("eyes", "lips"):
        boundary = protected & regions[name]
        assert boundary.any(), f"Fixture must exercise protected {name} boundaries"
        error = np.zeros(len(base))
        error[boundary] = .004
        # Index the region first, then summarise that region's errors. Passing the
        # whole mesh was the bug this assertion exists to catch.
        assert retarget.summarise_errors(error[regions[name]])["max_m"] > .001, \
            f"Pinned {name} limitation hidden"

    with tempfile.TemporaryDirectory(prefix="retarget-invalid-") as directory:
        path = Path(directory) / "invalid.obj"
        for content in ("", "v inf 0 0\nf 1 1 1", "v 0 0 0\nf 0 1 1",
                        "v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3"):
            path.write_text(content, encoding="utf-8")
            try:
                retarget.load_obj(path)
            except ValueError:
                pass
            else:
                raise AssertionError("Malformed/degenerate OBJ accepted")
    inverted = base.copy()
    a, b, _ = faces[0]
    inverted[[a, b]] = inverted[[b, a]]
    try:
        retarget.validate_fitted_geometry(base, faces, inverted)
    except ValueError:
        pass
    else:
        raise AssertionError("Folded encoded geometry accepted")
    if report_dir:
        (report_dir / "summary.json").write_text(json.dumps({
            "real_head_likeness_approved": False,
            "limitations": ["Synthetic evidence only; provide a representative isolated real-head OBJ.",
                            "Diagnostic coordinate bands are not anatomical landmarks.",
                            "Projected envelopes are silhouette proxies, not visibility-aware contours.",
                            "Eye/lip boundaries and companions are not fitted freely.",
                            "Regional production thresholds require reference review."],
            "fixtures": reports,
        }, indent=2, allow_nan=False), encoding="utf-8")
    print("Phase-1 synthetic regional, silhouette-proxy, replay and rejection checks passed; real-head gate PENDING")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path)
    args = parser.parse_args()
    if args.report_dir:
        args.report_dir.mkdir(parents=True, exist_ok=False)
    run(args.report_dir)
