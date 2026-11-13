---
name: skyrim-mod-expert
description: >-
  Expert knowledge base for Skyrim engine internals, mod development, NIF 3D meshes,
  DDS textures, Papyrus scripting, SKSE C++ plugins, MO2 asset pipelines, and converting
  Skyrim assets (UBE, RaceMenu, Tri/NIF/DDS) to 3D web environments (Three.js/R3F).
---

# Valerius — Skyrim Engine Architect & Mod Expert

This skill provides comprehensive runtime, format, and modding expertise for the Creation Engine and Skyrim assets, specifically tailored for mod authoring, debugging, and asset conversion pipelines (such as `cc-kit-react` / LYRA).

## Core Knowledge Domains

### 1. Skyrim Engine Internals
- **Executable & Binaries**: Differences between 1.5.97 (SE), 1.6.640 (AE), and 1.6.1170+ (Steam/GOG). Memory offsets, Address Library, and multi-target compilation with `CommonLibSSE-NG`.
- **FormID Allocation**:
  - `0x00`–`0xFD`: Standard master plugins (max 254 `.esm`/`.esp`).
  - `0xFE`: ESL / ESPFE lightweight plugins (`0x000`–`0xFFF` FormID range, max 4,096 loaded).
  - `0xFF`: Dynamically allocated references in savegame co-saves (`.ess`).
- **Memory & Allocator**: `SSE Engine Fixes`, scrap heap limits, Havok physics step thread, background asset streamer.

### 2. File Formats & Asset Specifications
- **Plugins (`.esp`, `.esm`, `.esl`)**: Form 43 (32-bit LE) vs Form 44 (64-bit SE). Subrecords (`CELL`, `NAVM`, `ARMO`, `ARMA`, `NPC_`, `QUST`, `WRLD`).
- **Meshes (`.nif`)**:
  - Node tree: `BSFadeNode`, `NiNode`, `BSTriShape`.
  - Shader properties: `BSLightingShaderProperty`, `BSEffectShaderProperty`.
  - Flags: `SLSF1` & `SLSF2` (Parallax, Specular, Facegen, Hair tint, Two-Pass).
  - Vertex attributes: Position (vec3), UV (vec2), Normal (vec3), Tangent (vec4), Vertex Color, Bone Weights (up to 4 bones/vertex, max 60 bones per partition).
- **Textures (`.dds`)**:
  - Diffuse: BC7 or BC1/BC3.
  - Tangent Normal (`_n.dds`): BC5 (DXN/RG two-channel with blue reconstructed) or BC3. Note: In Three.js / OpenGL, green channel ($Y$) usually requires inversion depending on coordinate conventions.
  - Specular / Gloss / Roughness / Subsurface (`_s.dds`, `_sk.dds`): Channel-packing standards for vanilla, ENB, and Community Shaders.
- **Morphs (`.tri`)**: Target vertex offsets for facial expressions, phonemes, and RaceMenu slider morphs.

### 3. Pipeline in this Project (`cc-kit-react` / LYRA)
- `scripts/convert_worker.py`: Python worker that decodes NIF meshes and DDS textures into glTF/buffer geometry and web-friendly texture formats.
- `scripts/sync_pack_assets.py` & `scripts/sync_mo2_assets.py`: Syncs assets from external Skyrim mod directories or preset packs (`D:\Games\Skyrim\...`).
- `scripts/index_mo2_assets.py`: Builds catalogues and manifests for skin, eyes, hair, makeup, and presets.
- `scripts/check_pack_contract.py` & `scripts/check_asset_selection.cjs`: Validates that geometry, textures, and material slots adhere to strict contracts without missing maps.

## Diagnostic Runbook: Common Skyrim Asset Failures

1. **Purple Textures in Engine or Viewport:**
   - Texture path inside `.nif` is invalid or points to an absolute path instead of relative (`textures\...`).
   - Unsupported DDS compression (e.g. uncompressed 32-bit RGBA or missing mipmaps causing rendering bugs).
2. **Invisible Mesh / CTD on Render:**
   - Missing Tangents/Bitangents on a mesh with normal mapping enabled in `BSLightingShaderProperty`.
   - Skin partition has more than 60 bones or un-normalized vertex weights ($\sum w \neq 1.0$).
3. **Black / Warped Facial Expressions:**
   - Corrupted `.tri` morph file or vertex count mismatch between the base head `.nif` and the `.tri` morph targets.
