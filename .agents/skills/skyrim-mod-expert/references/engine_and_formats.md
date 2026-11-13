# Skyrim Creation Engine Technical Reference Manual

## 1. Memory Offsets & Address Library
- Skyrim 1.5.97 uses 32-bit internal FormID lookups with specific static offsets.
- Skyrim 1.6+ (Anniversary Edition) shifted engine code due to compiler toolchain updates (MSVC 2019/2022).
- When writing SKSE plugins, use `CommonLibSSE-NG` and link with `AddressLibrary` IDs (`versionlibdb.bin`) rather than raw pointers.

## 2. NIF (NetImmerse/Gamebryo) Mesh Architecture in Skyrim SE
```
BSFadeNode (Root)
 ├── NiNode (Optional bone/scene attachment)
 └── BSTriShape (Mesh Geometry Container)
      ├── BSLightingShaderProperty (Material & Shader Directives)
      │    └── BSShaderTextureSet (List of up to 9 texture slots)
      │         [0] Diffuse (_d.dds)
      │         [1] Normal / Gloss (_n.dds)
      │         [2] Glow / Subsurface / Environment (_g.dds / _sk.dds)
      │         [3] Height / Parallax (_p.dds)
      │         [4] Environment Cube Map (_m.dds)
      │         [5] Environment Mask (_m.dds)
      │         [6] Multilayer
      │         [7] Specular (_s.dds)
      └── Vertex Data Array (BSTriShape vertex descriptor)
```

## 3. Shader Flags (SLSF1 & SLSF2)
- `SLSF1_Specular`: Enables specular highlights.
- `SLSF1_Skinned`: Enables skin partition bone weighting.
- `SLSF1_Facegen`: Enables tint color blending for head meshes.
- `SLSF1_Model_Space_Normals`: Used for head meshes (pre-computed object-space normal maps).
- `SLSF2_Double_Sided`: Disables backface culling (crucial for hair and cloth).
- `SLSF2_Soft_Lighting` & `SLSF2_Subsurface_Scattering`: Used for skin shaders to simulate light penetration.

## 4. Crash Log Forensics Checklist
1. Inspect the top 5 frames of the Call Stack in `CrashLoggerSSE.log`.
2. If `SkyrimSE.exe+0xXXXXXX` crashes in `BSResource::LooseFileStream`, look for the file string in the Stack / Registers—an unreadable `.dds` or `.nif` was opened.
3. If crashing in `Pathing::NavMesh`, an actor stepped onto a deleted or unlinked NAVM record.
4. If crashing in `TESObjectREFR::GetBaseObject()`, a null FormID reference occurred (missing master plugin).
