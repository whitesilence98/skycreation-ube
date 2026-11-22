---
name: bodyslide-expert
description: >-
  Expert knowledge base for BodySlide, Outfit Studio, UBE SE 2.0 / Necoco body meshes,
  0NecocoSliders categories, binary .osd Outfit Studio morph deltas, .osp SliderSets,
  XML preset serialization, and real-time Three.js / WebGL GPU morph deformation.
---

# Morpha — BodySlide & 3D Mesh Morph Engineer

This skill provides comprehensive architectural and technical knowledge for Bethesda BodySlide, Outfit Studio, UBE (Ultimate Body Enhancer) 2.0 / Necoco body topologies, and real-time WebGL deformation in Three.js / Next.js.

---

## 1. File Formats & Binary Specifications

### A. Binary Morph Deltas (`.osd` / Outfit Studio Data)
- **Signature & Header**:
  - `Magic` (4 bytes): `\0DSO` (`0x00, 0x44, 0x53, 0x4F`).
  - `Version` (4 bytes, uint32 little-endian): `1`.
  - `Block Count` (4 bytes, uint32 little-endian): Number of shape morphs (e.g. `236` in `UBE SE 2.0 - Necoco Body.osd`).
- **Data Block Structure**:
  - `name_len` (1 byte, uint8): Length of block name.
  - `name` (`name_len` bytes, ASCII): Target identifier (e.g. `BaseShapeBreastsBigger`, `BaseShapeNecoco_Boob_Base`).
  - `diff_count` (2 bytes, uint16 little-endian): Total vertices morphed by this slider.
  - `diff_records` (`diff_count * 14` bytes):
    - `vert_idx` (2 bytes, uint16 little-endian): Index into base mesh geometry ($0 \dots 32,511$).
    - `dx` (4 bytes, float32 little-endian): X-axis displacement.
    - `dy` (4 bytes, float32 little-endian): Y-axis displacement.
    - `dz` (4 bytes, float32 little-endian): Z-axis displacement.

### B. Outfit Slider Projects (`.osp`)
XML format mapping UI slider identifiers to target meshes and binary morph block names:
```xml
<SliderSet name="UBE SE 2.0 - Necoco Body">
    <DataFolder>UBE SE 2.0 - Necoco Body</DataFolder>
    <SourceFile>UBE SE 2.0 - Necoco Body.nif</SourceFile>
    <OutputPath>Meshes\!UBE\Body</OutputPath>
    <OutputFile GenWeights="true">femalebody_tangent</OutputFile>
    <Shape target="BaseShape">BaseShape</Shape>
    <Slider name="Necoco_Boob_Base" invert="false" small="0" big="0">
        <Data name="BaseShapeNecoco_Boob_Base" target="BaseShape" local="true">
            UBE SE 2.0 - Necoco Body.osd\BaseShapeNecoco_Boob_Base
        </Data>
    </Slider>
</SliderSet>
```

### C. Slider Categories (`0NecocoSliders.xml`)
Defines the visual taxonomy and logical groupings of morph sliders:
1. `1 - Necoco Boob`: Primary breast volume, MafaVam, and Bom39 addons.
2. `2 - Necoco Sliders Overall`: Global breast and nipple scales.
3. `3 - Necoco Body (Use this for Customizing)`: Body with/without breasts base.
4. `4 - Necoco Body Addons`: Lewd Zone, Leg, Butt, Belly, Upper Body Smooth.
5. `5 - Necoco Sliders Other`: Detailed creases, abs, thighs, calves, and fine sculpting.
6. `Burger Sliders`: Nipple enhancements, vindictus curves, anime shaping.
7. `Xtrem Sliders`: Extreme anatomical adjustments.

### D. Preset Files (`.xml`)
Bethesda Creation Engine / BodySlide preset schema:
```xml
<SliderPresets>
    <Preset name="UBE Necoco V1" set="UBE SE 2.0 - Necoco Body">
        <Group name="UBE"/>
        <Group name="UBE Female"/>
        <SetSlider name="Necoco_Boob_Base" size="big" value="100"/>
        <SetSlider name="Necoco_Body_Addon_Butt" size="big" value="100"/>
    </Preset>
</SliderPresets>
```

---

## 2. Coordinate Transformation Pipeline

Skyrim's Creation Engine uses a **centimeter-scale Z-up** coordinate system, whereas Three.js uses a **meter-scale Y-up** coordinate system. When transforming vertex offsets:

$$\begin{aligned}
X_{\text{Three.js}} &= X_{\text{NIF}} \times 0.01288 \\
Y_{\text{Three.js}} &= Z_{\text{NIF}} \times 0.01288 \quad (\text{Z-up} \to \text{Y-up}) \\
Z_{\text{Three.js}} &= Y_{\text{NIF}} \times 0.01288 \quad (\text{Y-forward} \to \text{Z-forward})
\end{aligned}$$

---

## 3. High-Performance Three.js Deformation Engine

```
[Base Positions Buffer (bodyBasePositionsRef)]
                 │
                 ▼
[Sparse Delta Accumulation (lib/bodyslide/morphLoader.ts)]
   P_active[i] = P_base[i] + ∑ (weight_s / 100) * Δv_s[i]
                 │
                 ▼
[Target BufferGeometry Position Attribute]
   posAttr.needsUpdate = true
   geometry.computeVertexNormals()
                 │
                 ▼
[GPU Render: 60 FPS Smooth Deformation]
```

### Key Principles:
1. **Zero Heap Allocation in Hot Loop**: Never instantiate new objects or allocate arrays during slider dragging; accumulate directly into pre-allocated `Float32Array`.
2. **Sparse Processing**: Only touch vertices that have non-zero deltas ($\approx 2,000$ to $5,000$ vertices per slider out of $32,512$).
3. **Non-Destructive Layering**: Always compute from cached `basePositions` to allow infinite adjustments without accumulation drift.

---

## 4. UI/UX & Wuxia HUD Design Standards

- **Sub-Tab Navigation**: `[BODYSLIDE (0NECOCO)]` and `[SKELETON SCALE]` toggles in `BodyPanel.tsx`.
- **Category Accordions**: Expandable/collapsible sections adhering to Wuxia Glass UI (`border-[#d4b483]/20`, gold highlights `#eac87f`).
- **Typography & Hit Target Floors**: All labels $\ge 10\text{px}$, buttons $\ge 24\text{px}$.
- **Zero Visible Scrollbars**: Clean `scrollbar-none` styling with native wheel and touch support.
- **Double-Click Reset**: Double-clicking any slider or numerical badge restores the authored base value.

---

## 5. Diagnostic Runbook

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **Exploding / Spiky Vertices** | Vertex index out-of-bounds or scale factor incorrect. | Ensure `vert_idx < vertCount` and scale multiplier is exactly `0.01288`. |
| **Dark Seams / Black Surface** | Missing normal recalculation after position deformation. | Call `geometry.computeVertexNormals()` on every update. |
| **Slider Has No Visual Effect** | Mismatch between slider name in XML and target block name in OSP/OSD. | Verify `mapping.dataTarget` in `SliderOspMapping`. |
| **Lag / Dropped Frames** | Reallocating arrays or triggering React re-renders on slider move. | Use direct BufferAttribute array manipulation and debounce store subscriptions. |
