# MetaHuman & AAA Real-Time Hair Pipeline Guide

This guide documents the architecture, sourcing, and conversion pipeline for importing **AAA-quality MetaHuman hairstyles** into the **Skyrim UBE WebGL Character Creator**.

---

## 1. Why MetaHuman Hair?

Epic Games' **MetaHuman Creator** is the AAA industry standard for digital human characters. For real-time hair rendering:
- **LOD 0**: Uses strand-based Alembic (`.abc`) grooming (heavy, cinematic only).
- **LOD 1 & LOD 2**: Uses **production-grade Hair Cards** with embedded scalp underlays, flyaways, and 4K PBR textures (Alpha, Depth, Root, Anisotropic Flow, Albedo, Normal).
- **Full Scalp Coverage**: Every MetaHuman hairstyle includes an engineered inner scalp cap that prevents bald spots and hollow cavities.

---

## 2. How to Export from MetaHuman / Unreal Engine 5

1. **In Unreal Engine 5** or the [MetaHuman Creator web app](https://metahuman.unrealengine.com/):
   - Open your character and navigate to the hair component.
   - Set the LOD to **LOD 1** or **LOD 2** (the hair card mesh).
   - Right-click the mesh asset in the Content Browser $\rightarrow$ **Asset Actions $\rightarrow$ Export...**
   - Save as `.fbx` (or `.gltf` / `.glb` using the Unreal glTF Exporter plugin).
2. **Export the Textures**:
   - MetaHuman hair exports with standard PBR textures:
     - `_BaseColor.png` (Albedo / Diffuse)
     - `_Alpha.png` or opacity in the alpha channel
     - `_Normal.png`
     - `_AnisotropicFlow.png` (hair highlight direction)
     - `_RootDepth.png`

---

## 3. Importing into SkyCreation (Automated Script)

Use the built-in repository script:
```bash
node scripts/import_external_hair_glb.cjs "C:\path\to\metahuman_hair.glb" --name "MetaHumanHairstyleName"
```

**What the script does automatically:**
1. **Vertical Offset ($\Delta Y$)**: Re-centers vertex coordinates so the crown seats naturally at $Y = +0.150\text{m}$ atop the canonical Skyrim UBE head.
2. **Armature Decoupling**: Strips foreign Unreal/Blender bone rigs, converting the hair into a high-performance static mesh that binds to `SkyrimHeadRoot`.
3. **PBR Preservation**: Retains all embedded 4K textures, UV coordinates, normals, and material properties.
4. **Outputs**: Saves the clean asset directly to `public/assets/hair/<name>.glb`.

---

## 4. Registering the Hair in the Character Creator

Add an entry to `lib/hairGlbRegistry.ts`:
```ts
export const CURATED_GLB_HAIRS: CuratedGlbHair[] = [
  // ...
  {
    id: 'metahuman_ponytail',
    label: 'MetaHuman Ponytail',
    file: 'metahuman_ponytail.glb',
    meshUrl: '/assets/hair/metahuman_ponytail.glb',
    badge: 'AAA',
    author: 'Epic Games',
    mod: 'MetaHuman',
    description: 'AAA multi-layer hair card system with full scalp underlay and flyaway strands.',
    partCount: 1,
  },
];
```

The new hairstyle will immediately appear in the **Hairstyle** tab with live 60 FPS dye tinting, roughness tuning, and salon framing.

---

## 5. Summary of AAA Hair Architecture

| Layer | Purpose |
| :--- | :--- |
| **Tier 1: Scalp Base (Skull Cap)** | Prevents see-through gaps, bald spots, and skin shining through. |
| **Tier 2: Volume Cards** | Dense, wide hair card strips providing the silhouette, body, and occlusion. |
| **Tier 3: Flyaways & Strands** | Fine, semi-transparent strands that break the digital silhouette. |
| **Transferred Normals** | Vertex normals transferred from a smooth sphere for soft, continuous light reflection. |
| **Anisotropic Flow** | Controls directional specular highlights (the natural hair halo). |
