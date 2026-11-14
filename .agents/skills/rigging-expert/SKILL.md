---
name: rigging-expert
description: >-
  Expert knowledge base for 3D character rigging, Skyrim XP32/XPMSE skeletons,
  Blender Armature modifiers, vertex groups, skin weight painting, glTF 2.0 / GLB skinning,
  and Three.js SkinnedMesh deformation.
---

# Rigging Expert — 3D Character Rigging & Technical Art

This skill equips the agent with in-depth knowledge of character rigging, skeletal hierarchies, skin weighting, and integration between Skyrim assets, Blender, and web 3D engines (Three.js / glTF).

## Core Knowledge Domains

### 1. Skyrim & XPMSE Skeletal Architecture
- **Root**: `Scene Root` $\rightarrow$ `NPC` $\rightarrow$ `NPC Root [Root]` $\rightarrow$ `NPC COM [COM ]` $\rightarrow$ `NPC Pelvis [Pelv]`.
- **Spine Chain**: `NPC Pelvis [Pelv]` $\rightarrow$ `NPC Spine [Spn0]` $\rightarrow$ `NPC Spine1 [Spn1]` $\rightarrow$ `NPC Spine2 [Spn2]` $\rightarrow$ `NPC Neck [Neck]` $\rightarrow$ `NPC Head [Head]`.
- **Limbs**:
  - Arms: `NPC [L/R] Clavicle [LClv/RClv]` $\rightarrow$ `NPC [L/R] UpperArm [LUar/RUar]` $\rightarrow$ `Twist1` $\rightarrow$ `Forearm` $\rightarrow$ `Hand` $\rightarrow$ Fingers (`Finger00`..`Finger42`).
  - Legs: `NPC Pelvis [Pelv]` $\rightarrow$ `NPC [L/R] Thigh [LThg/RThg]` $\rightarrow$ `NPC [L/R] Calf [LClf/RClf]` $\rightarrow$ `Foot [Lft /Rft ]` $\rightarrow$ `Toe0 [LToe/RToe]`.
- **Deforming vs. Non-Deforming Bones**:
  - Out of 554 nodes in XPMSE, only ~75–95 bones actually deform the mesh.
  - Non-deforming dummy nodes include `SPH ...` (Havok collision spheres), `CME ...` / `MOV ...` (scale/position sliders), `HDT ...` (physics hulls), and `Weapon...` (sheath anchors). In Blender, these dummy nodes should either be hidden or pruned so they do not clutter viewport editing.

### 2. Blender Rigging & Skinning Workflows
- **Armature Display**: For dense skeletons like XP32, set `Object Data Properties` $\rightarrow$ `Viewport Display` $\rightarrow$ **Stick** or **Wire** to prevent overlapping octahedral bone shapes from blocking the character mesh.
- **Vertex Groups**:
  - Vertex group names on each mesh must match bone names in the Armature **byte-for-byte** (including case and bracket spacing: e.g. `NPC Head [Head]`, `NPC Spine [Spn0]`).
  - Up to 4 bone influences per vertex for Skyrim/glTF compatibility; weights per vertex must normalize to $\le 1.0$.
- **Weight Transfer**:
  - In Blender: Select source body $\rightarrow$ Shift-select target garment $\rightarrow$ Enter **Weight Paint Mode** $\rightarrow$ `Weights` menu $\rightarrow$ **Transfer Weights** (`Source Layers: By Name`).
- **Pose Mode & Rest Pose**:
  - **Edit Mode**: Defines the Armature's Rest Position (bind pose).
  - **Pose Mode**: Defines active deformations. Use `Alt + R` (Clear Rotation) and `Alt + G` (Clear Location) to return to rest.
  - To freeze a custom pose as the new permanent rest pose: `Pose` $\rightarrow$ `Apply` $\rightarrow$ `Apply Pose as Rest Pose`.

### 3. Three.js / glTF 2.0 Skinning Pipeline
- **Joints & Skins**: In glTF, joints are standard scene graph nodes indexed by `skin.joints`.
- **Inverse Bind Matrices (`inverseBindMatrices`)**: 4x4 matrix per bone defining the inverse world matrix at bind time. `jointMatrix = boneWorldMatrix * inverseBindMatrix`.
- **Multi-Mesh Single Armature**: Ensure all meshes (`Head`, `Body`, `Hands`, `Feet`, `Clothing`, `Hair`, `Eyes`, `Mouth`) reference bones under a single common root node (`NPC Root [Root]`) so glTF exporters and Blender produce **one unified Armature** instead of multiple disconnected skeletons.
- **Pose Action Export**: 2-keyframe `AnimationClip` (`time = [0, 1/30]`) named `"Pose"` targeting `bone.uuid + '.quaternion'` / `'.position'` to load the active pose immediately in Blender's Pose Mode.

## Handy Blender Python Scripts (`bpy`)

See [references/blender_rigging_scripts.py](./references/blender_rigging_scripts.py) for automations:
- `clean_non_deforming_bones()`: Removes or hides dummy collision bones with zero vertex weights.
- `set_clean_armature_display()`: Sets armature display to Wire/Stick and enables In Front.
- `normalize_all_vertex_groups()`: Normalizes all vertex weights to 1.0 and cleans tiny weights (< 0.001).
