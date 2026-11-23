#!/usr/bin/env python3
"""
scripts/convert_dint_obj_to_glb.py

Converts Wavefront OBJ + MTL + PNG hairstyles from Dint999 (Blender export)
into standalone, spec-compliant glTF 2.0 Binary (.glb) files optimized for the
Skyrim UBE Character Creator.

Applies the exact canonical coordinate transform:
  X_glb = X_skyrim * 0.01288
  Y_glb = (Z_skyrim - 120.73) * 0.01288
  Z_glb = (Y_skyrim - 1.0) * 0.01288
  V_glb = 1.0 - V_obj
  Normals: (NX, NZ, NY) normalized
  Indices: (a, c, b) winding
"""

import os
import sys
import json
import struct
import argparse
from pathlib import Path

def parse_mtl(mtl_path: Path) -> dict[str, dict]:
    materials = {}
    current_mat = None

    if not mtl_path.exists():
        return materials

    with open(mtl_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            parts = line.split(maxsplit=1)
            token = parts[0]
            val = parts[1] if len(parts) > 1 else ""

            if token == "newmtl":
                current_mat = val.strip()
                materials[current_mat] = {
                    "name": current_mat,
                    "diffuse_map": None,
                    "normal_map": None,
                    "alpha_map": None,
                }
            elif current_mat:
                if token in ("map_Kd", "map_kd"):
                    materials[current_mat]["diffuse_map"] = val.strip()
                elif token in ("map_Bump", "map_bump", "bump"):
                    # Might have flags like -bm 1.0 textures/xyz.png
                    tex_file = val.split()[-1]
                    materials[current_mat]["normal_map"] = tex_file
                elif token in ("map_d", "map_D"):
                    materials[current_mat]["alpha_map"] = val.strip()

    return materials


def build_glb_binary(meshes, materials_map, textures_list, output_path: Path):
    bin_buffer = bytearray()
    buffer_views = []
    accessors = []

    def add_buffer_view(data: bytes, target=None):
        offset = len(bin_buffer)
        rem = offset % 4
        if rem != 0:
            bin_buffer.extend(b"\x00" * (4 - rem))
            offset = len(bin_buffer)

        bin_buffer.extend(data)
        length = len(data)

        bv = {"buffer": 0, "byteOffset": offset, "byteLength": length}
        if target:
            bv["target"] = target
        bv_idx = len(buffer_views)
        buffer_views.append(bv)
        return bv_idx

    # 1. Add images
    images = []
    for tex in textures_list:
        bv_idx = add_buffer_view(tex["bytes"])
        images.append({"bufferView": bv_idx, "mimeType": tex.get("mime", "image/png"), "name": tex["name"]})

    # 2. Samplers & textures
    samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    gltf_textures = []
    for img_idx in range(len(images)):
        gltf_textures.append({"sampler": 0, "source": img_idx})

    # 3. Materials
    mat_keys = list(materials_map.keys())
    gltf_materials = []
    for mat_name in mat_keys:
        m = materials_map[mat_name]
        gltf_mat = {
            "name": mat_name,
            "pbrMetallicRoughness": {
                "metallicFactor": 0.05,
                "roughnessFactor": 0.8
            },
            "doubleSided": True
        }
        if m.get("diffuse_tex_id") is not None:
            gltf_mat["pbrMetallicRoughness"]["baseColorTexture"] = {"index": m["diffuse_tex_id"]}
        if m.get("normal_tex_id") is not None:
            gltf_mat["normalTexture"] = {"index": m["normal_tex_id"]}

        alpha_mode = m.get("alpha_mode", "MASK")
        gltf_mat["alphaMode"] = alpha_mode
        if alpha_mode == "MASK":
            gltf_mat["alphaCutoff"] = m.get("alpha_cutoff", 0.45)

        gltf_materials.append(gltf_mat)

    # 4. Meshes & Accessors
    gltf_meshes = []
    gltf_nodes = []
    root_children = []

    for mesh_idx, m in enumerate(meshes):
        if not m["positions"] or not m["indices"]:
            continue

        pos_data = struct.pack(f"<{len(m['positions'])}f", *m["positions"])
        nrm_data = struct.pack(f"<{len(m['normals'])}f", *m["normals"])
        uv_data = struct.pack(f"<{len(m['uvs'])}f", *m["uvs"])

        max_idx = max(m["indices"]) if m["indices"] else 0
        if max_idx < 65535:
            idx_component_type = 5123 # UNSIGNED_SHORT
            idx_data = struct.pack(f"<{len(m['indices'])}H", *m["indices"])
        else:
            idx_component_type = 5125 # UNSIGNED_INT
            idx_data = struct.pack(f"<{len(m['indices'])}I", *m["indices"])

        # Positions
        bv_pos = add_buffer_view(pos_data, target=34962)
        nv = len(m["positions"]) // 3
        xs = [m["positions"][i * 3] for i in range(nv)]
        ys = [m["positions"][i * 3 + 1] for i in range(nv)]
        zs = [m["positions"][i * 3 + 2] for i in range(nv)]
        acc_pos = len(accessors)
        accessors.append({
            "bufferView": bv_pos,
            "byteOffset": 0,
            "componentType": 5126,
            "count": nv,
            "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)]
        })

        # Normals
        bv_nrm = add_buffer_view(nrm_data, target=34962)
        acc_nrm = len(accessors)
        accessors.append({
            "bufferView": bv_nrm,
            "byteOffset": 0,
            "componentType": 5126,
            "count": nv,
            "type": "VEC3"
        })

        # UVs
        bv_uv = add_buffer_view(uv_data, target=34962)
        acc_uv = len(accessors)
        accessors.append({
            "bufferView": bv_uv,
            "byteOffset": 0,
            "componentType": 5126,
            "count": nv,
            "type": "VEC2"
        })

        # Indices
        bv_idx = add_buffer_view(idx_data, target=34963)
        acc_idx = len(accessors)
        accessors.append({
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": idx_component_type,
            "count": len(m["indices"]),
            "type": "SCALAR"
        })

        mat_idx = mat_keys.index(m["material_name"]) if m["material_name"] in mat_keys else 0

        gltf_meshes.append({
            "name": m["name"],
            "primitives": [{
                "attributes": {
                    "POSITION": acc_pos,
                    "NORMAL": acc_nrm,
                    "TEXCOORD_0": acc_uv
                },
                "indices": acc_idx,
                "material": mat_idx
            }]
        })

        node_idx = len(gltf_nodes)
        gltf_nodes.append({
            "name": m["name"],
            "mesh": len(gltf_meshes) - 1
        })
        root_children.append(node_idx)

    root_node_idx = len(gltf_nodes)
    gltf_nodes.append({
        "name": "HairRoot",
        "children": root_children
    })

    gltf_json = {
        "asset": {
            "version": "2.0",
            "generator": "CC-Kit Dint999 OBJ to GLB Converter"
        },
        "scene": 0,
        "scenes": [{
            "name": "DefaultScene",
            "nodes": [root_node_idx]
        }],
        "nodes": gltf_nodes,
        "meshes": gltf_meshes,
        "materials": gltf_materials,
        "textures": gltf_textures,
        "images": images,
        "samplers": samplers,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{
            "byteLength": len(bin_buffer)
        }]
    }

    json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")
    rem_json = len(json_bytes) % 4
    if rem_json != 0:
        json_bytes += b" " * (4 - rem_json)

    rem_bin = len(bin_buffer) % 4
    if rem_bin != 0:
        bin_buffer.extend(b"\x00" * (4 - rem_bin))

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buffer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_buffer), b"BIN\x00"))
        f.write(bin_buffer)

    return total_len, len(gltf_meshes)


def convert_hair_folder(folder_path: Path, output_glb_path: Path):
    objs = list(folder_path.glob("*.obj"))
    if not objs:
        raise FileNotFoundError(f"No .obj found in {folder_path}")
    obj_path = objs[0]

    mtls = list(folder_path.glob("*.mtl"))
    mtl_path = mtls[0] if mtls else None
    mtl_dict = parse_mtl(mtl_path) if mtl_path else {}

    raw_v = []
    raw_vt = []
    raw_vn = []

    groups = []
    current_group = {
        "name": "DefaultHairPart",
        "material_name": "DefaultMaterial",
        "faces": []
    }

    with open(obj_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            parts = line.split()
            token = parts[0]

            if token == "v":
                raw_v.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif token == "vt":
                raw_vt.append((float(parts[1]), float(parts[2])))
            elif token == "vn":
                raw_vn.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif token in ("o", "g"):
                g_name = parts[1] if len(parts) > 1 else f"part_{len(groups)}"
                if current_group["faces"]:
                    groups.append(current_group)
                current_group = {
                    "name": g_name,
                    "material_name": current_group["material_name"],
                    "faces": []
                }
            elif token == "usemtl":
                m_name = parts[1] if len(parts) > 1 else "DefaultMaterial"
                if current_group["faces"]:
                    groups.append(current_group)
                    current_group = {
                        "name": f"{current_group['name']}_{len(groups)}",
                        "material_name": m_name,
                        "faces": []
                    }
                else:
                    current_group["material_name"] = m_name
            elif token == "f":
                face_verts = []
                for p in parts[1:]:
                    vals = p.split("/")
                    vi = int(vals[0]) - 1 if vals[0] else -1
                    vti = int(vals[1]) - 1 if len(vals) > 1 and vals[1] else -1
                    vni = int(vals[2]) - 1 if len(vals) > 2 and vals[2] else -1
                    face_verts.append((vi, vti, vni))

                # Triangulate polygon fans
                for i in range(1, len(face_verts) - 1):
                    current_group["faces"].append((face_verts[0], face_verts[i], face_verts[i + 1]))

    if current_group["faces"]:
        groups.append(current_group)

    # Coordinate transform constants
    S = 0.01288
    CZ = 120.73
    CY = 1.0

    # Build meshes
    meshes = []
    tex_cache = {}
    textures_list = []
    materials_map = {}

    def get_tex_id(tex_rel_name: str | None) -> int | None:
        if not tex_rel_name:
            return None
        tex_norm = Path(tex_rel_name).name.lower()
        if tex_norm in tex_cache:
            return tex_cache[tex_norm]

        # Search for texture file in folder and folder/textures
        candidates = [
            folder_path / tex_rel_name,
            folder_path / "textures" / Path(tex_rel_name).name,
            folder_path / Path(tex_rel_name).name,
        ]
        found = None
        for c in candidates:
            if c.exists():
                found = c
                break

        if not found:
            # Case-insensitive search in textures/
            tex_dir = folder_path / "textures"
            if tex_dir.exists():
                for f in tex_dir.iterdir():
                    if f.name.lower() == tex_norm:
                        found = f
                        break

        if not found:
            return None

        tex_bytes = found.read_bytes()
        tex_id = len(textures_list)
        textures_list.append({
            "name": found.stem,
            "bytes": tex_bytes,
            "mime": "image/png" if found.suffix.lower() == ".png" else "image/jpeg"
        })
        tex_cache[tex_norm] = tex_id
        return tex_id

    for g in groups:
        mat_name = g["material_name"]
        if mat_name not in materials_map:
            mtl_info = mtl_dict.get(mat_name, {})
            diffuse_id = get_tex_id(mtl_info.get("diffuse_map"))
            normal_id = get_tex_id(mtl_info.get("normal_map"))

            materials_map[mat_name] = {
                "name": mat_name,
                "diffuse_tex_id": diffuse_id,
                "normal_tex_id": normal_id,
                "alpha_mode": "MASK",
                "alpha_cutoff": 0.45,
                "double_sided": True
            }

        vert_map = {}
        pos_out = []
        nrm_out = []
        uv_out = []
        indices_out = []

        for tri in g["faces"]:
            # Skyrim to Three.js winding: (a, c, b)
            tri_ordered = (tri[0], tri[2], tri[1])
            tri_indices = []

            for key in tri_ordered:
                if key not in vert_map:
                    idx = len(pos_out) // 3
                    vert_map[key] = idx

                    vi, vti, vni = key
                    x, y, z = raw_v[vi]
                    # Transform coordinates
                    px = round(x * S, 5)
                    py = round((z - CZ) * S, 5)
                    pz = round((y - CY) * S, 5)
                    pos_out.extend((px, py, pz))

                    if vni >= 0 and vni < len(raw_vn):
                        nx, ny, nz = raw_vn[vni]
                        ln = (nx * nx + nz * nz + ny * ny) ** 0.5 or 1.0
                        nrm_out.extend((round(nx / ln, 4), round(nz / ln, 4), round(ny / ln, 4)))
                    else:
                        nrm_out.extend((0.0, 1.0, 0.0))

                    if vti >= 0 and vti < len(raw_vt):
                        u, v = raw_vt[vti]
                        uv_out.extend((round(u, 5), round(1.0 - v, 5)))
                    else:
                        uv_out.extend((0.0, 0.0))

                tri_indices.append(vert_map[key])

            indices_out.extend(tri_indices)

        meshes.append({
            "name": g["name"],
            "material_name": mat_name,
            "positions": pos_out,
            "normals": nrm_out,
            "uvs": uv_out,
            "indices": indices_out
        })

    total_len, mesh_count = build_glb_binary(meshes, materials_map, textures_list, output_glb_path)
    return total_len, mesh_count


def main():
    parser = argparse.ArgumentParser(description="Convert Dint999 OBJ hairs to GLB")
    parser.add_argument("--source", default=r"C:\Users\kenko\Desktop\Dint999_All_Hairs_Blender", help="Source folder")
    parser.add_argument("--out", default=r"public\assets\hair", help="Output directory")
    args = parser.parse_args()

    src_root = Path(args.source)
    out_dir = Path(args.out)

    if not src_root.exists():
        print(f"Error: {src_root} does not exist")
        sys.exit(1)

    folders = sorted([d for d in src_root.iterdir() if d.is_dir()])
    print(f"Found {len(folders)} hairstyle folders in {src_root}")

    registry_entries = []

    for idx, folder in enumerate(folders):
        folder_name = folder.name
        # Generate clean ID and filename
        # e.g. Dint999_Hair_03Long -> dint_hair_03_long
        # Dint999_Hair_07 -> dint_hair_07
        clean_name = folder_name.replace("Dint999_Hair_", "").replace("Hair_", "").lower()
        glb_id = f"dint_hair_{clean_name}"
        glb_filename = f"{glb_id}.glb"
        out_glb = out_dir / glb_filename

        # Clean display label
        label_suffix = clean_name.replace("_", " ").title()
        display_label = f"Dint Hair {label_suffix}"

        print(f"[{idx+1}/{len(folders)}] Converting {folder_name} -> {glb_filename}...")
        try:
            total_bytes, mesh_count = convert_hair_folder(folder, out_glb)
            mb = round(total_bytes / (1024 * 1024), 2)
            print(f"    ✓ OK: {mesh_count} parts, {mb} MB")

            registry_entries.append({
                "id": glb_id,
                "label": display_label,
                "file": glb_filename,
                "meshUrl": f"/assets/hair/{glb_filename}",
                "badge": "GLB",
                "author": "Dint999",
                "mod": "[Dint999] HairPack",
                "description": f"High-poly hair with {mesh_count} sub-parts and PBR textures.",
                "partCount": mesh_count,
            })
        except Exception as e:
            print(f"    ✗ FAILED: {e}")

    # Output registry snippet
    reg_path = out_dir / "dint_hair_registry.json"
    with open(reg_path, "w", encoding="utf-8") as f:
        json.dump(registry_entries, f, indent=2)

    print(f"\nAll conversions complete! {len(registry_entries)}/{len(folders)} succeeded.")
    print(f"Registry data written to: {reg_path}")


if __name__ == "__main__":
    main()
