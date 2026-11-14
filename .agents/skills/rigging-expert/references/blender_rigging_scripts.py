"""
Blender Python (bpy) utility scripts for Skyrim/XP32 character rigging and glTF imports.
Paste and run these in Blender's Scripting workspace.
"""

import bpy

def set_clean_armature_display():
    """
    Switches active armature display from large Octahedral bones to clean Stick/Wire bones,
    making the character mesh visible without large bone spheres.
    """
    armature_obj = None
    for obj in bpy.context.selected_objects:
        if obj.type == 'ARMATURE':
            armature_obj = obj
            break
            
    if not armature_obj:
        for obj in bpy.data.objects:
            if obj.type == 'ARMATURE':
                armature_obj = obj
                break
                
    if not armature_obj:
        print("No Armature found in scene.")
        return

    armature = armature_obj.data
    armature.display_type = 'STICK'  # 'STICK' or 'WIRE'
    armature_obj.show_in_front = False
    print(f"Set {armature_obj.name} display to STICK.")


def prune_unweighted_dummy_bones():
    """
    Identifies all bones in the Armature that have ZERO vertex weights across
    all meshes in the scene and removes or hides them (e.g. SPH collision spheres,
    weapon nodes, CME handles).
    """
    armature_obj = None
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE':
            armature_obj = obj
            break

    if not armature_obj:
        print("No Armature found.")
        return

    # Find all vertex groups used by all mesh objects
    used_bone_names = set()
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            for vg in obj.vertex_groups:
                used_bone_names.add(vg.name)

    print(f"Total vertex groups used by meshes: {len(used_bone_names)}")

    # In Edit Mode, remove bones that are neither used nor parents of used bones
    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode='EDIT')
    
    edit_bones = armature_obj.data.edit_bones
    
    # Collect essential bones (used + ancestors)
    essential = set()
    for name in used_bone_names:
        if name in edit_bones:
            curr = edit_bones[name]
            while curr:
                essential.add(curr.name)
                curr = curr.parent

    # Delete non-essential dummy bones
    removed_count = 0
    for bone in list(edit_bones):
        if bone.name not in essential:
            edit_bones.remove(bone)
            removed_count += 1

    bpy.ops.object.mode_set(mode='OBJECT')
    print(f"Cleaned Armature: removed {removed_count} dummy bones. Remaining: {len(essential)} bones.")


def normalize_all_vertex_weights():
    """
    Cleans tiny stray vertex weights (< 0.001) and normalizes all weights per vertex to 1.0.
    """
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
            bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.001)
            bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
            bpy.ops.object.mode_set(mode='OBJECT')
            print(f"Cleaned and normalized weights for {obj.name}.")


if __name__ == '__main__':
    set_clean_armature_display()
