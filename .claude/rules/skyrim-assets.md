---
paths:
  - "scripts/**"
  - "lib/mo2/**"
  - "lib/head/**"
  - "public/assets/**"
---

# Skyrim Asset & Conversion Rules

Verified against `scripts/sync_mo2_assets.py`, `lib/mo2/types.ts` and the
canonical UBE head mesh. Do not restate a convention here that the pipeline
does not actually implement — check the script first.

## Generated assets are read-only by hand

- `public/assets/mo2/` and `public/assets/preset-pack/` are **generated** and
  gitignored (2.6 GB on disk, 1 tracked file). Never hand-edit a file there.
  The change belongs in `scripts/sync_mo2_assets.py` / `scripts/sync_part.py`
  (the source) and then a re-sync.
- Regenerate with `npm run sync:assets && npm run sync:index`. A partial sync
  (`npm run sync:hair`) re-indexes only that category — use it when you did not
  touch the rest.

## Textures (DDS)

- Diffuse: BC7 (or BC1/BC3 from older sources). Normal: **BC5**.
- The tangent normal is the `*_n.dds` beside the diffuse. **Case varies by mod**
  (`femaleHead_n.dds` vs `femalehead_n.dds`) and Windows hides it — never match
  by exact-case filename. `normal_map_beside()` in `scripts/sync_mo2_assets.py`
  exists for exactly this; reuse it rather than writing a new glob.
- BC5 has **two channels** (X/Y), RGB passthrough, no alpha in the decoded RGB.
  Do not assume a third channel survived decode.
- In Skyrim the specular/gloss mask rides in the **alpha of `*_n.dds`**, not a
  separate map. `gloss_mask_from_normal()` turns it into a three.js roughness
  map. A diffuse with no alpha is a different code path — keep them distinct.

## Skeleton — XP32 / XPMSE

- Bone names must match **XP32 exactly**. Do not rename on import, do not
  "clean up" a bone name, do not drop a bone because it looks unused. The
  collision-bone pruning in `lib/exportGlb.ts` is the one sanctioned removal,
  and it is deliberate.
- Every new bone or skinning path must pass `npm run check:skeleton`.

## Head mesh / morphs (UBE)

Measured reference for the canonical head
(`public/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json`):
11,498 verts / 22,044 tris; three.js frame, **metres, Y-up, face toward +Z**;
bbox `[-0.0856, -0.1301, -0.0942] → [0.0856, 0.1385, 0.1097]`; nose tip at
`(0, -0.0024, 0.1097)`.

- When masking or weighting a shape transfer, damp the neck at `y < -0.105`
  (free by `-0.075`) and the nape at `z < -0.06`; reduce ears to ~40% for
  `|x| > 0.078, y ∈ [0, 0.07]`. This is what keeps the neck seam with the body
  intact — a transfer that ignores it produces a visible collar gap.
- Check with `npm run check:neck` after any head/morph change.

## Catalogues

- Catalogue JSON lives in `public/assets/mo2/catalogue/` (`hair.json`,
  `body.json`, `skin.json`, …). Shape is `CatalogueEntry` in `lib/mo2/types.ts`.
- Geometry kinds are the `MESH_KINDS` constant — never hardcode a kind string.
  `handsMesh`/`feetMesh` share the BODY texture kind; they are geometry slots,
  not new texture categories.
- Every catalogue change must pass `npm run check:pack` and
  `npm run check:selection`. A catalogue that parses but references a missing
  file passes no check that matters.

## Export invariants (`lib/exportGlb.ts`)

- One Armature per GLB. Do not add a second skeleton.
- `KHR_materials_ior` (ior = 1.0) is injected on purpose: without it Blender's
  Principled BSDF assumes 1.5 and the skin renders plastic. Do not remove it as
  "cleanup".
- Root elevation puts soles at Y = 0. The body-scale lift
  (`character.position.y = footDrop`) is already written by the exporter and
  must be added to, never overwritten.
