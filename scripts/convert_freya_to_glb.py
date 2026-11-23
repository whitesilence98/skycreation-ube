#!/usr/bin/env python3
"""
scripts/convert_freya_to_glb.py

Ports Freya hair from C:\\Users\\kenko\\Desktop\\Blend (Blender export OBJ + MTL + PNGs)
into a standalone, spec-compliant glTF 2.0 Binary (.glb) for the UBE Character Creator.

Handles:
- Loading Freya.obj, Freya.mtl, and textures (Cap & Hair)
- Channel-packing RGB BaseColor + Grayscale Alpha mask into clean 4-channel RGBA PNGs
- Embedding Normal maps
- Applying vertical translation to seat onto the UBE head mesh (Y -= 1.577m)
- Exporting to public/assets/hair/freya_test.glb
"""

import os
import sys
import json
import struct
import io
from pathlib import Path
from PIL import Image

def parse_obj(obj_path: Path, delta_y: float = -1.577):
    print(f"Reading OBJ from {obj_path}...")
    raw_positions = []
    raw_uvs = []
    raw_normals = []

    # Map material_name -> { "indices": [], "vertices": [] }
    # Each unique (v_idx, vt_idx, vn_idx) maps to a combined index
    mat_mesh_data = {}
    current_mat = "Hair"

    with open(obj_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            parts = line.split()
            token = parts[0]

            if token == "v":
                # Translation: Y -= 1.577m
                x = float(parts[1])
                y = float(parts[2]) + delta_y
                z = float(parts[3])
                raw_positions.append((x, y, z))
            elif token == "vt":
                u = float(parts[1])
                v = 1.0 - float(parts[2])  # glTF flips V
                raw_uvs.append((u, v))
            elif token == "vn":
                nx = float(parts[1])
                ny = float(parts[2])
                nz = float(parts[3])
                # Normalize
                mag = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
                raw_normals.append((nx / mag, ny / mag, nz / mag))
            elif token == "usemtl":
                current_mat = parts[1]
                if current_mat not in mat_mesh_data:
                    mat_mesh_data[current_mat] = {
                        "vertex_map": {},
                        "positions": [],
                        "normals": [],
                        "uvs": [],
                        "indices": []
                    }
            elif token == "f":
                if current_mat not in mat_mesh_data:
                    mat_mesh_data[current_mat] = {
                        "vertex_map": {},
                        "positions": [],
                        "normals": [],
                        "uvs": [],
                        "indices": []
                    }
                m_data = mat_mesh_data[current_mat]

                face_verts = []
                for vert_str in parts[1:]:
                    v_p = vert_str.split("/")
                    v_i = int(v_p[0]) - 1 if v_p[0] else 0
                    vt_i = int(v_p[1]) - 1 if len(v_p) > 1 and v_p[1] else 0
                    vn_i = int(v_p[2]) - 1 if len(v_p) > 2 and v_p[2] else 0
                    key = (v_i, vt_i, vn_i)

                    if key not in m_data["vertex_map"]:
                        new_idx = len(m_data["positions"]) // 3
                        m_data["vertex_map"][key] = new_idx

                        px, py, pz = raw_positions[v_i] if v_i < len(raw_positions) else (0.0, 0.0, 0.0)
                        u, v = raw_uvs[vt_i] if vt_i < len(raw_uvs) else (0.0, 0.0)
                        nx, ny, nz = raw_normals[vn_i] if vn_i < len(raw_normals) else (0.0, 1.0, 0.0)

                        m_data["positions"].extend([round(px, 6), round(py, 6), round(pz, 6)])
                        m_data["uvs"].extend([round(u, 6), round(v, 6)])
                        m_data["normals"].extend([round(nx, 6), round(ny, 6), round(nz, 6)])

                    face_verts.append(m_data["vertex_map"][key])

                # Triangulate polygon / quad
                if len(face_verts) == 3:
                    m_data["indices"].extend(face_verts)
                elif len(face_verts) == 4:
                    # Quad -> 2 triangles (0, 1, 2) and (0, 2, 3)
                    m_data["indices"].extend([face_verts[0], face_verts[1], face_verts[2]])
                    m_data["indices"].extend([face_verts[0], face_verts[2], face_verts[3]])
                elif len(face_verts) > 4:
                    # Fan triangulation
                    for i in range(1, len(face_verts) - 1):
                        m_data["indices"].extend([face_verts[0], face_verts[i], face_verts[i + 1]])

    meshes = []
    for mat_name, m_data in mat_mesh_data.items():
        v_count = len(m_data["positions"]) // 3
        tri_count = len(m_data["indices"]) // 3
        print(f"Material {mat_name}: {v_count} verts, {tri_count} tris")
        meshes.append({
            "name": f"Freya_{mat_name}",
            "material_name": mat_name,
            "positions": m_data["positions"],
            "normals": m_data["normals"],
            "uvs": m_data["uvs"],
            "indices": m_data["indices"]
        })

    return meshes


def prepare_textures(blend_dir: Path):
    tex_dir = blend_dir / "textures"
    print(f"Packing textures from {tex_dir}...")

    textures_list = []
    materials_map = {}

    # 1. Hair material
    hair_base_path = tex_dir / "Hair_09F39A_BaseColor.png"
    hair_alpha_path = tex_dir / "Hair-Alpha.png"
    hair_nrm_path = tex_dir / "Hair_09F39A_Normal.png"

    # Merge BaseColor + Alpha
    hair_rgb = Image.open(hair_base_path).convert("RGB")
    hair_alpha = Image.open(hair_alpha_path).convert("L")
    hair_rgba = Image.merge("RGBA", (*hair_rgb.split(), hair_alpha))
    hair_buf = io.BytesIO()
    hair_rgba.save(hair_buf, format="PNG", optimize=True)
    hair_bytes = hair_buf.getvalue()

    hair_diffuse_idx = len(textures_list)
    textures_list.append({"name": "Hair_RGBA", "bytes": hair_bytes, "mime": "image/png"})

    # Hair Normal
    hair_nrm_bytes = hair_nrm_path.read_bytes()
    hair_nrm_idx = len(textures_list)
    textures_list.append({"name": "Hair_Normal", "bytes": hair_nrm_bytes, "mime": "image/png"})

    materials_map["Hair"] = {
        "diffuse_tex_id": hair_diffuse_idx,
        "normal_tex_id": hair_nrm_idx,
        "alpha_mode": "MASK",
        "alpha_cutoff": 0.45,
    }

    # 2. Cap material
    cap_base_path = tex_dir / "Cap_09F39A_BaseColor.png"
    cap_alpha_path = tex_dir / "Cap-Alpha.png"
    cap_nrm_path = tex_dir / "Cap_09F39A_Normal.png"

    cap_rgb = Image.open(cap_base_path).convert("RGB")
    cap_alpha = Image.open(cap_alpha_path).convert("L")
    cap_rgba = Image.merge("RGBA", (*cap_rgb.split(), cap_alpha))
    cap_buf = io.BytesIO()
    cap_rgba.save(cap_buf, format="PNG", optimize=True)
    cap_bytes = cap_buf.getvalue()

    cap_diffuse_idx = len(textures_list)
    textures_list.append({"name": "Cap_RGBA", "bytes": cap_bytes, "mime": "image/png"})

    cap_nrm_bytes = cap_nrm_path.read_bytes()
    cap_nrm_idx = len(textures_list)
    textures_list.append({"name": "Cap_Normal", "bytes": cap_nrm_bytes, "mime": "image/png"})

    materials_map["Cap"] = {
        "diffuse_tex_id": cap_diffuse_idx,
        "normal_tex_id": cap_nrm_idx,
        "alpha_mode": "MASK",
        "alpha_cutoff": 0.20,
    }

    return materials_map, textures_list


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
            idx_component_type = 5123  # UNSIGNED_SHORT
            idx_data = struct.pack(f"<{len(m['indices'])}H", *m["indices"])
        else:
            idx_component_type = 5125  # UNSIGNED_INT
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
            "generator": "CC-Kit Freya OBJ to GLB Converter"
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

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Successfully compiled {output_path} ({file_size_mb:.2f} MB)")


def main():
    blend_dir = Path(r"C:\Users\kenko\Desktop\Blend")
    obj_path = blend_dir / "Freya.obj"
    output_path = Path("public/assets/hair/freya_test.glb")

    if not obj_path.exists():
        print(f"Error: {obj_path} does not exist.")
        sys.exit(1)

    materials_map, textures_list = prepare_textures(blend_dir)
    meshes = parse_obj(obj_path, delta_y=-1.577)
    build_glb_binary(meshes, materials_map, textures_list, output_path)


if __name__ == "__main__":
    main()
