# CC-Kit React — Character Creator Studio Architecture

Web-based 3D Skyrim Character Creator & Asset Studio managed with Claude Code Game Studios subagents.

## Technology Stack

- **Engine**: Web (Next.js 16.4.6 App Router + React 19 + `@react-three/fiber` 9 + `@react-three/drei` 10 + Three.js 0.187)
- **Language**: TypeScript (Strict mode)
- **Styling**: Tailwind CSS v4 + PostCSS
- **State**: Zustand 5
- **3D Pipeline**: Skyrim XP32 (XPMSE) SkinnedMesh, UBE bodies, DDS BC7/BC5 textures, RaceMenu morphs, glTF 2.0 / GLB exporter (`lib/exportGlb.ts`)
- **Version Control**: Git with trunk-based development

## Project Structure

- `app/`: Next.js App Router root layout and main character creator page.
- `components/`: UI components:
  - `components/canvas/`: Three.js R3F canvas, scene lighting, model loaders (`HeadModel.tsx`, `BodyModel.tsx`).
  - `components/hud/`: Slider controls, categories, morph adjustments, preset import/export (`PresetIO.tsx`).
- `lib/`: Core 3D and math libraries:
  - `lib/exportGlb.ts`: Unified single Armature GLB export with pruned collision bones and baked pose animation.
  - `lib/head/neckDeltas.ts`: Neck seam snapping and dual-weight interpolation.
  - `lib/store.ts`: Global Zustand store for character presets, morphs, and camera state.
- `public/assets/`: 3D meshes, textures, catalogues, manifests:
  - `public/assets/mo2/catalogue/`: JSON asset catalogues (hair, body, eyes, skin, makeup, etc.).
- `scripts/`: Asset sync, python converters, contract verification.
- `.claude/`: Claude Code Game Studios framework (agents, rules, skills, engines).

## Key Specialist Agents

- `rigging-engineer`: XP32/XPMSE skeletal hierarchies, Blender weight painting, vertex groups, and glTF skinning.
- `skyrim-mod-expert`: NIF meshes, DDS textures, RaceMenu/Tri morphs, MO2 asset catalogues.
- `technical-artist`: Shaders, material pipelines, 3D performance budgets, glTF export.
- `art-director`: Visual aesthetics, lighting balance, character silhouette.
- `ui-programmer` / `ux-designer`: Sliders, responsive layout, preset panels.

## Verification & Commands

- **Dev Server**: `npm run dev`
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`)
- **Asset Contract**: `python scripts/check_pack_contract.py`
- **Asset Selection**: `npm run check:selection`
- **Skeleton Hierarchy**: `npm run check:skeleton`

## Collaboration Protocol

- **User-driven collaboration**: Discuss architectural decisions, propose solutions, and confirm major file modifications.
- Multi-file changes should be explained with clear rationale.
- Always verify changes with `npm run typecheck` before concluding.
