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

### 4. Component Reusability Rule
- Core UI elements (e.g. `ItemTile` selection grid squares, `WuxiaTopNavBar`, sub-rails, drawers, custom sliders) must be modular, generic, and reusable across all categories (Presets, Makeup, Face Features, Outfits, Tattoos), never hardcoded for only one category.

### 5. Strict Scope (UI/UX Only)
- Exclusively UI/UX improvements (React 19, Tailwind CSS v4, Zustand 5, HUD shell/panels).
- **Never modify** 3D rigging, XP32 skeletons, NIF decoding, shaders, or 3D engine conversions unless explicitly required to wire UI callbacks.

### 6. Clean Stage & Zero Visible Scrollbars
- Completely remove visible scrollbars (scroll-y tracks, thumbs, native buttons) on every panel while preserving natural mouse-wheel and touch scrolling.
- Maintain full-bleed edge-to-edge 3D canvas stage (`absolute inset-0`). Never introduce stage container offsets that cause vertical split seams across HUD panels.

### 7. Hair Properties Deferred
- Hair properties (color, fit, and finish sliders) remain hidden for now per user instruction, to be discussed and designed in a future dedicated task.

### 8. Automated Verification Standard
- Always ensure all test suites pass with 0 errors before committing:
  - `npm run typecheck` (`tsc --noEmit`)
  - `npm run check:editor` (AST routing & picker coverage)
  - `npm run check:hair` (Hair thumbnails & framing)
  - `npm run check:selection` (Asset & pack selection)


