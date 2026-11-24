import bpy
import os
import sys
import traceback

log_file = r"C:/Users/kenko/Desktop/priject/cc-kit-react/scripts/convert_log.txt"

with open(log_file, "w", encoding="utf-8") as log:
    def write_log(msg):
        log.write(msg + "\n")
        log.flush()

    try:
        blend_file = r"C:/Users/kenko/Desktop/Blend/[pomiya]node_hair_floral02__daisy.blend"
        texture_file = r"D:/exports/hair_texture.png"
        out_glb = r"C:/Users/kenko/Desktop/priject/cc-kit-react/public/assets/hair/daisy_hair.glb"

        write_log(f"Opening blend file: {blend_file}")
        bpy.ops.wm.open_mainfile(filepath=blend_file)

        # 1. Load texture
        img = bpy.data.images.load(filepath=texture_file, check_existing=True)
        write_log(f"Loaded texture: {img.name}")

        # 2. Setup PBR hair material
        mat = bpy.data.materials.new(name="Pomiya_Hair_PBR")
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links

        nodes.clear()
        output_node = nodes.new('ShaderNodeOutputMaterial')
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = 0.52
        bsdf.inputs['Metallic'].default_value = 0.0

        tex_node = nodes.new('ShaderNodeTexImage')
        tex_node.image = img

        links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(bsdf.outputs['BSDF'], output_node.inputs['Surface'])
        write_log("Created standard PBR material")

        # 3. Create CurveToRibbon Geometry Node Tree
        ng = bpy.data.node_groups.new(name="CurveToRibbonFast", type='GeometryNodeTree')
        ng.interface.new_socket(name="Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
        ng.interface.new_socket(name="Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')

        in_node = ng.nodes.new('NodeGroupInput')
        out_node = ng.nodes.new('NodeGroupOutput')
        
        # Resample curves to 8 points per strand for smooth curvature with low poly count
        resample = ng.nodes.new('GeometryNodeResampleCurve')
        resample.inputs['Count'].default_value = 8
        
        c2m = ng.nodes.new('GeometryNodeCurveToMesh')
        line = ng.nodes.new('GeometryNodeCurvePrimitiveLine')
        line.inputs['Start'].default_value = (-0.0013, 0, 0)
        line.inputs['End'].default_value = (0.0013, 0, 0)

        ng.links.new(in_node.outputs['Geometry'], resample.inputs['Curve'])
        ng.links.new(resample.outputs['Curve'], c2m.inputs['Curve'])
        ng.links.new(line.outputs['Curve'], c2m.inputs['Profile Curve'])
        ng.links.new(c2m.outputs['Mesh'], out_node.inputs['Geometry'])

        created_meshes = []

        for obj_name in ['top', 'under']:
            obj = bpy.data.objects.get(obj_name)
            if not obj:
                write_log(f"Object '{obj_name}' not found")
                continue
            
            write_log(f"Processing '{obj_name}'...")
            mod = obj.modifiers.new(name="ConvertToRibbon", type='NODES')
            mod.node_group = ng
            
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.convert(target='MESH')
            
            # Apply Decimate modifier (~28% ratio to balance visual fullness and 60 FPS performance)
            dec = obj.modifiers.new(name="DecimateHair", type='DECIMATE')
            dec.ratio = 0.28
            bpy.ops.object.modifier_apply(modifier="DecimateHair")
            
            # Smart project UVs for hair texture mapping
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.001)
            bpy.ops.object.mode_set(mode='OBJECT')
            
            # Assign PBR material
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            created_meshes.append(obj)
            write_log(f"  '{obj_name}' processed: {len(obj.data.vertices)} verts, {len(obj.data.polygons)} polys")

        # Retain Scalp Skullcap
        scalp = bpy.data.objects.get('[pomiya]node_hair_Flower Collection_daisy')
        if scalp:
            scalp.name = 'scalp'
            scalp.data.materials.clear()
            scalp.data.materials.append(mat)
            created_meshes.append(scalp)
            write_log(f"  'scalp' preserved: {len(scalp.data.vertices)} verts, {len(scalp.data.polygons)} polys")

        # Delete FemaleHead reference object
        fhead = bpy.data.objects.get('FemaleHead')
        if fhead:
            bpy.data.objects.remove(fhead, do_unlink=True)
            write_log("Removed reference FemaleHead object")

        # Select all hair parts for export
        bpy.ops.object.select_all(action='DESELECT')
        for m in created_meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = created_meshes[0]

        write_log(f"Exporting to {out_glb}...")
        os.makedirs(os.path.dirname(out_glb), exist_ok=True)
        bpy.ops.export_scene.gltf(
            filepath=out_glb,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_texcoords=True,
            export_normals=True,
            export_materials='EXPORT',
            export_image_format='AUTO',
        )
        write_log(f"Export completed successfully to {out_glb}!")
    except Exception as e:
        write_log(f"EXCEPTION: {e}")
        traceback.print_exc(file=log)
