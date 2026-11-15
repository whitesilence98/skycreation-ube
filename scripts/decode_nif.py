"""
Standalone CLI to decode Skyrim Special Edition RaceMenu exported .nif files
into web-ready Three.js geometry buffers.
"""
import sys
import json
import re
from pathlib import Path

# Add current scripts directory to import convert_worker
sys.path.insert(0, str(Path(__file__).parent))
from convert_worker import nif_geometry

def decode_nif_parts(nif_path: Path) -> dict:
    geo = nif_geometry(nif_path, frame="head", authored=True)
    groups = geo.get("groups", [])
    materials = geo.get("materials", [])
    
    parts = {}
    for g in groups:
        mat = materials[g["materialIndex"]]
        name = str(mat.get("sourceShape") or mat.get("name") or "")
        start = g["start"]
        count = g["count"]
        indices = geo["indices"][start:start + count]
        used = sorted(set(indices))
        remap = {v: i for i, v in enumerate(used)}
        
        part_geo = {
            "positions": [round(float(geo["positions"][v * 3 + axis]), 5) for v in used for axis in range(3)],
            "normals": [round(float(geo["normals"][v * 3 + axis]), 4) for v in used for axis in range(3)],
            "uvs": [round(float(geo["uvs"][v * 2 + axis]), 5) for v in used for axis in range(2)],
            "indices": [remap[v] for v in indices],
            "vertexCount": len(used),
            "triangleCount": len(indices) // 3
        }
        
        # Categorize
        if re.search(r"femalehead|malehead|\bhead\b|humanhead|facemesh|^head", name, re.I) and not re.search(r"brow|mouth|lash|eye|hair|earring|ground|line|dummy", name, re.I):
            if "head" not in parts or re.search(r"femalehead", name, re.I) or part_geo["vertexCount"] > parts["head"]["vertexCount"]:
                parts["head"] = part_geo
        elif re.search(r"mouth", name, re.I):
            parts["mouth"] = part_geo
        elif re.search(r"lash", name, re.I):
            parts["lashes"] = part_geo
        elif re.search(r"brow(?!n)", name, re.I):
            parts["brows"] = part_geo
        elif re.search(r"eye", name, re.I) and not re.search(r"shadow|outer|lens|dummy|brow(?!n)", name, re.I):
            parts["eyes"] = part_geo

    # Robust fallback: if head shape was not explicitly matched by name,
    # find the largest non-accessory geometry (excluding hair/mouth/eyes/etc.)
    if "head" not in parts:
        best_candidate = None
        for g in groups:
            mat = materials[g["materialIndex"]]
            name = str(mat.get("sourceShape") or mat.get("name") or "")
            if re.search(r"brow|mouth|lash|eye|hair|earring|ground|line|dummy|shadow|lens", name, re.I):
                continue
            start = g["start"]
            count = g["count"]
            indices = geo["indices"][start:start + count]
            used = sorted(set(indices))
            if best_candidate is None or len(used) > best_candidate[0]:
                remap = {v: i for i, v in enumerate(used)}
                candidate_geo = {
                    "positions": [round(float(geo["positions"][v * 3 + axis]), 5) for v in used for axis in range(3)],
                    "normals": [round(float(geo["normals"][v * 3 + axis]), 4) for v in used for axis in range(3)],
                    "uvs": [round(float(geo["uvs"][v * 2 + axis]), 5) for v in used for axis in range(2)],
                    "indices": [remap[v] for v in indices],
                    "vertexCount": len(used),
                    "triangleCount": len(indices) // 3
                }
                best_candidate = (len(used), candidate_geo)
        if best_candidate and best_candidate[0] > 100:
            parts["head"] = best_candidate[1]

    if "head" not in parts:
        raise ValueError(f"no valid head shape found in {nif_path.name}")
        
    return parts

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "file path required"}))
        sys.exit(1)
    try:
        res = decode_nif_parts(Path(sys.argv[1]))
        # Check if output path is provided
        if len(sys.argv) >= 3:
            out_path = Path(sys.argv[2])
            out_path.write_text(json.dumps({"ok": True, **res}), encoding="utf-8")
            print(json.dumps({"ok": True, "output": str(out_path)}))
        else:
            print(json.dumps({"ok": True, **res}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
