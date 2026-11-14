# Technical Preferences

<!-- project.yaml at the repo root is the machine-readable source of truth for
     engine, specialists, naming, performance, platform, and testing.framework.
     This file is the human-readable LEGACY FALLBACK: agents and skills resolve
     each key from project.yaml first and fall back here only when the
     project.yaml key is absent. -->

## Engine & Language

- **Engine**: Web
- **Framework**: Next.js 16 (App Router) + React 19
- **3D Renderer**: Three.js (`@react-three/fiber`, `@react-three/drei`)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **State Management**: Zustand
- **Asset Pipeline**: Skyrim NIF/DDS -> Python extractor (`scripts/convert_worker.py`) -> Three.js SkinnedMesh & glTF 2.0 / GLB exporter

## Input & Platform

- **Target Platforms**: Web (Desktop Chrome / Firefox / Edge)
- **Input Methods**: Keyboard / Mouse (OrbitControls, Slider HUD)
- **Primary Input**: Mouse & Touch Pointer

## Naming Conventions

- **Components**: PascalCase (e.g., `HeadModel.tsx`, `PresetIO.tsx`)
- **Libraries/Helpers**: camelCase (e.g., `exportGlb.ts`, `neckDeltas.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `NECK_SPINE2_WEIGHTS`)
- **Hooks**: `use` prefix camelCase (e.g., `useCCStore`)

## Performance Budgets

- **Target Framerate**: 60 FPS
- **Frame Budget**: 16.6 ms
- **Max Bone Influence**: 4 weights per vertex (glTF standard)
- **Texture Resolutions**: Diffuse / Normal 2K/4K BC7/DDS with mipmaps

## Testing & Integrity

- **Typecheck**: `npm run typecheck` (`tsc --noEmit`)
- **Asset Verification**: `npm run check:selection`, `npm run check:pack`, `npm run check:skeleton`
- **Smoke Check**: `node scripts/check_pack_server.cjs`
