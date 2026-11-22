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

4. **The Wuxia Two-Level Hierarchical Standard (Makeup Tab Pattern)**:
   - Every character customization tab (Features, Physique, Hairstyle, Makeup, Presets, Outfit) must strictly adhere to the two-level navigation hierarchy established by `WuxiaMakeupPanel.tsx`:
     - **View 1: Category Root Menu**: Large category title, vertical stack of rounded sub-category cards (`h-11`, dark translucent glass `bg-[#1f2026]/75 hover:bg-[#272830] border border-white/5 hover:border-[#dfba73]/40 px-3.5 rounded-sm flex items-center justify-between text-left transition-all`), right-aligned chevron `›`.
     - **View 2: Drill-Down Sub-Screen**:
       - **Breadcrumb Navigation**: `Category › Sub-Section` (clicking Category or pressing Escape returns to View 1).
       - **Sub-Category Ribbon Pill**: Gradient white badge (`bg-gradient-to-r from-white via-white/95 to-white/80 px-3.5 py-1 text-black font-semibold shadow-sm rounded-sm`) with stylized glyph.
       - **Mode / Layer Toggle**: Optional top segmented control (e.g. `[BASIC]` vs `[ADVANCED]` or `[CUSTOM]` vs `[QUICK]`).
       - **Content Area**: Reusable `ItemTile` grid ($4 \times 4$ or $3 \times 3$ with `None ⊘` as Tile #1, active gold border `border-2 border-[#eac87f] shadow-[0_0_12px_rgba(234,200,127,0.45)]`), precision sliders with live numerical readouts, or 2D Color Studio.
   - Core UI elements (`ItemTile`, `WuxiaTopNavBar`, `WuxiaSubCategoryRail`, drawers, custom sliders) must be modular, generic, and reusable across all categories.

5. **Strict Scope**:
   - Exclusively UI/UX improvements (React 19, Tailwind CSS v4, Zustand 5, HUD shell/panels).
   - **Never modify** 3D rigging, XP32 skeletons, NIF decoding, shaders, or engine conversions unless required to wire UI callbacks.

6. **Clean Canvas & No Scrollbars**:
   - Full-bleed edge-to-edge 3D canvas stage (`absolute inset-0`).
   - Zero visible scrollbars (no scroll tracks, thumbs, native buttons) on any panel while preserving natural mouse-wheel and touch scrolling (`scrollbar-none`).

7. **Wuxia 2D Color Engine & Hair Dye Architecture**:
   - Hair and cosmetics color selection uses the canonical Wuxia 2D Color Engine (`WuxiaColorPicker2D`):
     - **Left**: $12\text{px}$ vertical rainbow Hue spectrum slider ($0^\circ \to 360^\circ$) with circular white ring thumb.
     - **Right**: $240\text{px} \times 250\text{px}$ 2D Saturation / Value canvas with circular target reticle cursor.
     - **Bottom**: `Recently Used` color swatches history + `↺ Reset` button to restore original authored texture tone.
     - **3D Engine**: Real-time non-blocking 60 FPS material tint updates in Three.js via `useCharacter.getState().setHair({ tone: hex })`.
     - Supports eyebrow color synchronization (`linkBrowToHair`).

8. **Automated Verification**:
   - `npm run typecheck`, `npm run check:editor`, `npm run check:hair`, `npm run check:selection` must all pass clean.

9. **Navigation, Escape Key & Accessibility Floors**:
   - Every drill-down sub-screen must support one-click return via breadcrumbs and Escape key dismissal.
   - **Typography Floor**: All text elements $\ge 10\text{px}$ (WCAG & PRODUCT.md compliant).
   - **Hit Target Floor**: All interactive elements $\ge 24\text{px}$ (menu cards $\ge 44\text{px}$).
   - Zero visible scrollbars (`scrollbar-none`) on all containers.
