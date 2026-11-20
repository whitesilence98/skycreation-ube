---
trigger: always_on
description: Core UI/UX design rules, 2-image comparison standard, and Impeccable review requirement.
---

# UI/UX & Wuxia HUD Design Rules

1. **The 2-Image Pairing Rule**:
   - Whenever 2 images are provided: **Image 1** is *always* current app state; **Image 2** is *always* target reference. (Image 3 if present is the drill-down specification).
   - Standard: **100% pixel-accurate visual and layout match**.

2. **Plan First**:
   - Always propose, break down, and confirm the architecture/design plan with the user **before** touching or modifying any files.

3. **Always Run Impeccable Review**:
   - Whenever the 2-image rule applies, an **Impeccable finish review** must be run to audit layout fidelity, typography ($\ge 10\text{px}$), hit targets ($\ge 24\text{px}$), and zero visible scrollbars across 1440px desktop, 1024px tablet, and 390px mobile viewports.

4. **Component Reusability**:
   - Core components (`ItemTile`, `WuxiaTopNavBar`, sub-rails, drawers) must be modular and reusable across all categories (Presets, Makeup, Face Features, Outfits, Tattoos).

5. **Strict Scope**:
   - Exclusively UI/UX improvements (React 19, Tailwind CSS v4, Zustand 5, HUD shell/panels).
   - **Never modify** 3D rigging, XP32 skeletons, NIF decoding, shaders, or engine conversions unless required to wire UI callbacks.

6. **Clean Canvas & No Scrollbars**:
   - Full-bleed edge-to-edge 3D canvas stage (`absolute inset-0`).
   - Zero visible scrollbars (no scroll tracks, thumbs, native buttons) on any panel while preserving natural mouse-wheel and touch scrolling.

7. **Hair Properties Deferred**:
   - Hair properties (color, fit, finish) remain hidden until explicitly scheduled.

8. **Automated Verification**:
   - `npm run typecheck`, `npm run check:editor`, `npm run check:hair`, `npm run check:selection` must all pass clean.
