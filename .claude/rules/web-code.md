---
paths:
  - "app/**"
  - "components/**"
  - "lib/**"
---

# Web Code Rules (Next.js App Router · React 19 · R3F 9)

These paths are this repo's code root (`project.yaml` → `code_root: app,components,lib`).

## Layering — enforce the boundary

- **`lib/`** holds logic, types, math and store. It must not import React
  components and must not import `@react-three/fiber`. `lib/exportGlb.ts` is the
  one exception for `useThree`, and only because export runs inside the canvas.
- **`components/scene/`** is the only place that owns Three.js objects —
  meshes, materials, the canvas graph, shaders.
- **`components/hud/`** is DOM/UI only. It must never import `three` or
  `@react-three/*` [verified: 0 files in `components/hud/` do]. Read state from
  the Zustand store; request changes through store actions.
- **`app/`** routes and shell only. Scene setup lives in `components/scene/`.

## State — one owner per value

- All mutable character state lives in `lib/store.ts`. Components never hold a
  second copy of a persisted value in `useState`.
- Every new persisted field must be added to the coercion path in
  `lib/anatomy/validate.ts` or the relevant `coerce*` function, **and** to
  `coerceSession` in `lib/session.ts`. A field that bypasses coercion means an
  older saved session crashes the app on load.
- Anything written into a preset must round-trip through `lib/presetIO.ts`.
  If a new value cannot be serialized into a preset file, it is not preset
  state — keep it in `lib/viewState.ts` or `lib/session.ts` instead.

## TypeScript

- `strict: true` is on and stays on. Do not add `@ts-ignore`, and do not use
  `as any` to silence an error — model the type or narrow with a guard.
- The build is `tsc --noEmit`. It currently passes; a change that breaks it is
  not done (see `.claude/rules/workflow-discipline.md`).

## React 19 / R3F

- The canvas subtree is client-only. A file that touches `three`, a ref, an
  effect or a browser API starts with `'use client'`.
- Do not allocate Three.js objects inside a render body that runs per frame.
  Use `useMemo` for geometry/material construction and dispose in cleanup.
- `useFrame` callbacks must not call `setState` on the store every frame —
  that re-renders the whole HUD. Mirror into a ref and write on change.

## Performance budget

`project.yaml` sets the budget: 60 fps, 16.6 ms frame, 150 draw calls, 512 MB.
A change that adds a draw call per asset variant, or a texture per frame, must
justify itself against that number.
