"""
Skyrim NIF to Standalone glTF 2.0 Binary (.glb) Exporter
Converts multi-part Skyrim hair NIFs into a single, self-contained .glb
with embedded PNG textures, materials, and WebGL-ready coordinates.
"""
import io
import os
import re
import sys
import json
import math
import struct
import argparse
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from convert_worker import (
    _nif_parse,
    _nif_name,
    _nif_shape_fields,
    _nif_skin_refs,
    _nif_partition_geometry,
    _nif_shader,
    _nif_texture_paths,
    _nif_alpha,
    FRAMES,
)

def build_glb_binary(meshes, materials_map, textures_list, output_path: Path):
    """
    Constructs a spec-compliant glTF 2.0 Binary (.glb) file.
    """
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

    # 1. Add images to binary buffer
    images = []
    for tex in textures_list:
        bv_idx = add_buffer_view(tex["bytes"])
        images.append({"bufferView": bv_idx, "mimeType": tex.get("mime", "image/png"), "name": tex["name"]})

    # 2. Add samplers & textures
    samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    gltf_textures = []
    for img_idx in range(len(images)):
        gltf_textures.append({"sampler": 0, "source": img_idx})

    # 3. Add materials
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
            "doubleSided": m.get("double_sided", True)
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

    # 4. Add meshes and geometry accessors
    gltf_meshes = []
    gltf_nodes = []
    root_children = []

    for mesh_idx, m in enumerate(meshes):
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
        bv_pos = add_buffer_view(pos_data, target=34962) # ARRAY_BUFFER
        nv = len(m["positions"]) // 3
        xs = [m["positions"][i * 3] for i in range(nv)]
        ys = [m["positions"][i * 3 + 1] for i in range(nv)]
        zs = [m["positions"][i * 3 + 2] for i in range(nv)]
        acc_pos = len(accessors)
        accessors.append({
            "bufferView": bv_pos,
            "byteOffset": 0,
            "componentType": 5126, # FLOAT
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
        bv_idx = add_buffer_view(idx_data, target=34963) # ELEMENT_ARRAY_BUFFER
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
            "mesh": mesh_idx
        })
        root_children.append(node_idx)

    # Root node
    root_node_idx = len(gltf_nodes)
    gltf_nodes.append({
        "name": "HairRoot",
        "children": root_children
    })

    # Assemble JSON document
    gltf_json = {
        "asset": {
            "version": "2.0",
            "generator": "CC-Kit Skyrim NIF to GLB Exporter"
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

    # Encode JSON chunk (0x4E4F534A)
    json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")
    rem_json = len(json_bytes) % 4
    if rem_json != 0:
        json_bytes += b" " * (4 - rem_json)

    # Pad BIN chunk (0x004E4942)
    rem_bin = len(bin_buffer) % 4
    if rem_bin != 0:
        bin_buffer.extend(b"\x00" * (4 - rem_bin))

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buffer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        # 12-byte header: magic, version, length
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        # Chunk 0: JSON
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        # Chunk 1: BIN
        f.write(struct.pack("<I4s", len(bin_buffer), b"BIN\x00"))
        f.write(bin_buffer)

    return {
        "output_path": output_path,
        "size_bytes": total_len,
        "size_mb": round(total_len / (1024 * 1024), 2),
        "mesh_count": len(meshes),
        "texture_count": len(textures_list),
        "material_count": len(materials_map)
    }

def convert_nif_folder_to_glb(
    hair_mesh_dir: Path,
    mod_root_dir: Path,
    output_path: Path,
    frame: str = "head",
    compress_textures: bool = True
) -> dict:
    conf = FRAMES.get(frame, FRAMES["head"])
    S, CY, CZ = conf["scale"], conf["center_y"], conf["center_z"]

    # Collect visual NIFs
    nif_files = []
    for f in sorted(hair_mesh_dir.glob("*.nif")):
        fname = f.name.lower()
        if re.search(r"inv|45|col|vg|virtual|dummy|proxy", fname):
            continue
        nif_files.append(f)

    if not nif_files:
        raise ValueError(f"No visual NIF files found in {hair_mesh_dir}")

    meshes = []
    materials_map = {}
    textures_list = []
    tex_path_to_idx = {} # normalized_path -> texture_index

    def get_or_add_texture(rel_path: str) -> int | None:
        if not rel_path:
            return None
        norm_key = rel_path.lower().replace("/", "\\")
        if norm_key in tex_path_to_idx:
            return tex_path_to_idx[norm_key]

        disk_path = mod_root_dir / rel_path
        if not disk_path.exists():
            print(f"Warning: Texture not found on disk: {disk_path}")
            return None

        # Convert DDS to optimized PNG in-memory
        try:
            with Image.open(disk_path) as im:
                buf = io.BytesIO()
                # If RGB/RGBA, save as optimized PNG
                im.save(buf, format="PNG", optimize=True)
                png_bytes = buf.getvalue()
        except Exception as e:
            print(f"Error converting texture {disk_path.name}: {e}")
            return None

        tex_idx = len(textures_list)
        textures_list.append({
            "name": disk_path.stem,
            "bytes": png_bytes,
            "mime": "image/png"
        })
        tex_path_to_idx[norm_key] = tex_idx
        return tex_idx

    for nif_path in nif_files:
        try:
            nif = _nif_parse(nif_path)
        except Exception as e:
            print(f"Skipping {nif_path.name}: {e}")
            continue

        for block_idx, kind in enumerate(nif["types"]):
            if kind != "BSTriShape":
                continue
            shape_name = _nif_name(nif, block_idx) or nif_path.stem
            if re.search(r"col|vg|virtual|dummy|proxy|inv|45", shape_name, re.I):
                continue

            try:
                fields = _nif_shape_fields(nif, block_idx)
                _, partition = _nif_skin_refs(nif, int(fields["skin"]))
                pos, normals, uvs, part_tris, nv, part_skin = _nif_partition_geometry(nif, partition)
            except Exception as e:
                print(f"Could not extract geometry from {shape_name} in {nif_path.name}: {e}")
                continue

            # Shader & Textures
            tex_paths = []
            flags2 = 0
            alpha_test = None
            if int(fields["shader"]) >= 0:
                try:
                    tex_paths, flags2 = _nif_shader(nif, int(fields["shader"]))
                except Exception:
                    pass
            if int(fields["alpha"]) >= 0:
                try:
                    alpha_cut, thresh = _nif_alpha(nif, int(fields["alpha"]))
                    if alpha_cut and thresh:
                        alpha_test = thresh / 255.0
                except Exception:
                    pass

            diffuse_tex_idx = get_or_add_texture(tex_paths[0]) if len(tex_paths) > 0 else None
            normal_tex_idx = get_or_add_texture(tex_paths[1]) if len(tex_paths) > 1 else None

            mat_key = f"Mat_{shape_name.replace(' ', '_')}"
            materials_map[mat_key] = {
                "diffuse_tex_id": diffuse_tex_idx,
                "normal_tex_id": normal_tex_idx,
                "alpha_mode": "MASK" if alpha_test or (flags2 & 0x10) else "OPAQUE",
                "alpha_cutoff": alpha_test if alpha_test else 0.45,
                "double_sided": bool(flags2 & 0x10)
            }

            # Coordinates conversion (Head reference frame in meters)
            pos_out = []
            nrm_out = []
            uv_out = []

            for i in range(nv):
                x, y, z = pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]
                gx = round(x * S, 5)
                gy = round((z - CZ) * S, 5)
                gz = round((y - CY) * S, 5)
                pos_out.extend((gx, gy, gz))

                nx, ny, nz = normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]
                ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
                nrm_out.extend((round(nx / ln, 4), round(nz / ln, 4), round(ny / ln, 4)))

                u, v = uvs[i * 2], uvs[i * 2 + 1]
                uv_out.extend((round(u, 5), round(v, 5)))

            # Indices with Three.js / glTF winding (a, c, b)
            indices_out = []
            for tris in part_tris:
                for t in range(0, len(tris), 3):
                    a, b, c = tris[t], tris[t + 1], tris[t + 2]
                    indices_out.extend((a, c, b))

            clean_shape_name = f"{nif_path.stem}_{shape_name.replace(' ', '_')}"
            meshes.append({
                "name": clean_shape_name,
                "positions": pos_out,
                "normals": nrm_out,
                "uvs": uv_out,
                "indices": indices_out,
                "material_name": mat_key
            })

    # Build and write final GLB
    return build_glb_binary(meshes, materials_map, textures_list, output_path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert Skyrim multi-part hair NIFs to a self-contained glTF 2.0 Binary (.glb)")
    parser.add_argument("--mod", default=r"D:\Games\Skyrim\MO2_Archive\mods\[Dint999] HairPack02 SSE 1.12 (base)", help="Mod root directory")
    parser.add_argument("--hair", default=r"meshes\armor\[dint999]\02 Hair\hairS\03", help="Hairstyle directory")
    parser.add_argument("--out", default=None, help="Output .glb file path")

    args = parser.parse_args()

    mod_root = Path(args.mod)
    hair_dir = Path(args.hair) if Path(args.hair).is_absolute() else mod_root / args.hair
    
    if args.out:
        out_path = Path(args.out)
    else:
        out_path = Path(os.environ["USERPROFILE"]) / "Desktop" / "Dint999_Hair03_Blender_Ready" / f"Dint999_Hair_{hair_dir.name}.glb"

    print(f"Converting Hairstyle: {hair_dir}")
    print(f"Output GLB: {out_path}\n")

    res = convert_nif_folder_to_glb(hair_dir, mod_root, out_path)
    print("SUCCESSFULLY EXPORTED GLB!")
    print(f"  Path: {res['output_path']}")
    print(f"  Size: {res['size_mb']} MB ({res['size_bytes']:,} bytes)")
    print(f"  Meshes ({res['mesh_count']})")
    print(f"  Textures Embedded: {res['texture_count']}")
    print(f"  Materials: {res['material_count']}")
