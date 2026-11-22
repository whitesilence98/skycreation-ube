<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CC-Kit React Project Architecture

This project is a Web 3D Skyrim Character Creator & Asset Studio powered by Next.js 16, React 19, Three.js, and Claude Code Game Studios presets.

- See [CLAUDE.md](./CLAUDE.md) for full project stack and guidelines.
- See [.claude/](./.claude/) for Claude Code Game Studios agents, rules, and skills.
- See [.agents/skills/rigging-expert/](./.agents/skills/rigging-expert/) and [.claude/agents/rigging-engineer.md](./.claude/agents/rigging-engineer.md) for 3D rigging and skeletal architecture.
- See [.agents/skills/skyrim-mod-expert/](./.agents/skills/skyrim-mod-expert/) and [.claude/agents/skyrim-mod-expert.md](./.claude/agents/skyrim-mod-expert.md) for Skyrim engine internals, NIF, DDS, and MO2 pipelines.
- See [.agents/skills/bodyslide-expert/](./.agents/skills/bodyslide-expert/) and [.claude/agents/bodyslide-morph-engineer.md](./.claude/agents/bodyslide-morph-engineer.md) for BodySlide, 0NecocoSliders, and OSD binary morph pipelines.

---

# Permanent Project Operating Rules

Whenever interacting with or developing in this repository, all agents must strictly follow these mandatory rules:

### 1. The 2-Image Pairing Rule
- Whenever 2 images are provided:
  - **Image 1** is *always* the current application state.
  - **Image 2** is *always* the target reference design.
  - (If Image 3 is provided, it serves as the drill-down sub-panel / detail specification).
- The implementation standard is **100% pixel-accurate visual and layout match**.

### 2. Plan First
- Always propose, break down, and confirm the architecture/design plan with the user **before** editing or modifying any files.

### 3. Always Run Impeccable Review on 2-Image Tasks
- Whenever the 2-image rule applies, an **Impeccable finish review** (`impeccable-finish-reviewer` / quality audit) must be run on the resulting build before declaring completion.
- Quality bar:
  - Visual fidelity & element matrix match against Image 2 (and Image 3 if present)
  - Typography floor: All text elements must be $\ge 10\text{px}$ (WCAG & PRODUCT.md compliant)
  - Hit target floor: All interactive elements must be $\ge 24\text{px}$
  - Zero visible scrollbars (clean scrollbar-none, smooth wheel/touch scrolling only)
  - Viewport integrity: Verified on desktop (1440px), tablet (1024px), and mobile (390px)
  - Clean keyboard navigation and Escape key dismissal

### 4. The Wuxia Two-Level Hierarchical Standard (Makeup Tab Pattern)
- Every character customization tab (Features, Physique, Hairstyle, Makeup, Presets, Outfit) must strictly adhere to the two-level navigation hierarchy established by `WuxiaMakeupPanel.tsx`:
  - **View 1: Category Root Menu**:
    - Large category title (`text-base md:text-lg font-normal tracking-wide text-white mb-3`).
    - Vertical stack of rounded sub-category cards (`h-11`, dark translucent glass `bg-[#1f2026]/75 hover:bg-[#272830] border border-white/5 hover:border-[#dfba73]/40 px-3.5 rounded-sm flex items-center justify-between text-left transition-all`).
    - Label text on left, right-aligned chevron `›` (`text-sm font-light text-[#75737d] group-hover:text-white`).
  - **View 2: Drill-Down Sub-Screen**:
    - **Breadcrumb Navigation**: `Category › Sub-Section` (clicking Category or pressing Escape returns to View 1).
    - **Sub-Category Ribbon Pill**: Gradient white badge (`bg-gradient-to-r from-white via-white/95 to-white/80 px-3.5 py-1 text-black font-semibold shadow-sm rounded-sm`) with stylized glyph.
    - **Mode / Layer Toggle**: Optional top segmented control (e.g. `[BASIC]` vs `[ADVANCED]` or `[CUSTOM]` vs `[QUICK]`).
    - **Content Area**: Reusable `ItemTile` grid ($4 \times 4$ or $3 \times 3$ with `None ⊘` as Tile #1, active gold border `border-2 border-[#eac87f] shadow-[0_0_12px_rgba(234,200,127,0.45)]`), precision sliders with live values, or 2D Color Studio.
- Core UI elements (`ItemTile`, `WuxiaTopNavBar`, `WuxiaSubCategoryRail`, drawers, custom sliders) must be modular, generic, and reusable across all categories, never hardcoded for only one category.

### 5. Strict Scope (UI/UX Only)
- Exclusively UI/UX improvements (React 19, Tailwind CSS v4, Zustand 5, HUD shell/panels).
- **Never modify** 3D rigging, XP32 skeletons, NIF decoding, shaders, or 3D engine conversions unless explicitly required to wire UI callbacks.

### 6. Clean Stage & Zero Visible Scrollbars
- Completely remove visible scrollbars (scroll-y tracks, thumbs, native buttons) on every panel while preserving natural mouse-wheel and touch scrolling.
- Maintain full-bleed edge-to-edge 3D canvas stage (`absolute inset-0`). Never introduce stage container offsets that cause vertical split seams across HUD panels.

### 7. Wuxia 2D Color Engine & Hair Dye Architecture
- Hair and cosmetics color selection uses the canonical Wuxia 2D Color Engine (`WuxiaColorPicker2D`):
  - **Left**: $12\text{px}$ vertical rainbow Hue spectrum slider ($0^\circ \to 360^\circ$) with circular white ring thumb.
  - **Right**: $240\text{px} \times 250\text{px}$ 2D Saturation / Value canvas with circular target reticle cursor.
  - **Bottom**: `Recently Used` color swatches history + `↺ Reset` button to restore original authored texture tone.
  - **3D Engine**: Real-time non-blocking 60 FPS material tint updates in Three.js via `useCharacter.getState().setHair({ tone: hex })`.
  - Supports eyebrow color synchronization (`linkBrowToHair`).

### 8. Automated Verification Standard
- Always ensure all test suites pass with 0 errors before committing:
  - `npm run typecheck` (`tsc --noEmit`)
  - `npm run check:editor` (AST routing & picker coverage)
  - `npm run check:hair` (Hair thumbnails & framing)
  - `npm run check:selection` (Asset & pack selection)

### 9. BodySlide & 0NecocoSliders Architecture
- See [.agents/rules/bodyslide-rules.md](./.agents/rules/bodyslide-rules.md) and [.claude/rules/bodyslide-rules.md](./.claude/rules/bodyslide-rules.md).
- Staged assets in `public/assets/bodyslide/` (`0NecocoSliders.xml`, `UBE SE 2.0 - Necoco Body.osp`, `.osd`, and presets) form the canonical BodySlide foundation.
- The Body Panel must maintain a clear top toggle between `[BODYSLIDE (0NECOCO)]` high-poly vertex morphs and `[SKELETON SCALE]` RaceMenu bone transforms.
- Real-time morph vertex delta accumulation in Three.js must execute in $< 1.0\text{ms}$ (60 FPS) and non-destructively recompute vertex normals.

### 10. Navigation, Escape Key & Accessibility Floors
- Every drill-down sub-screen must support one-click return via breadcrumbs and Escape key dismissal.
- **Typography Floor**: All text elements must satisfy $\ge 10\text{px}$ (WCAG & PRODUCT.md compliant).
- **Hit Target Floor**: All interactive elements must satisfy $\ge 24\text{px}$ (menu cards and buttons $\ge 44\text{px}$).
- **Zero Visible Scrollbars**: Applied via `scrollbar-none` on every scrollable container.



