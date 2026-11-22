---
paths:
  - "components/hud/**"
  - "app/**"
---

# Wuxia UI & Customization Architecture Rules

Every character customization tab in this studio (Features, Physique, Hairstyle, Makeup, Presets, Outfit) must strictly follow the **Makeup Tab Two-Level Pattern** established in `components/hud/makeup/WuxiaMakeupPanel.tsx`:

## 1. Two-Level Hierarchical Structure

### View 1: Category Root Menu
- **Header**: Category Title (`text-base md:text-lg font-normal tracking-wide text-white mb-3`).
- **Sub-Category Items List**: Vertical stack of rounded cards.
  - Geometry: `h-11`, `rounded-sm`, `px-3.5`, `border border-white/5 bg-[#1f2026]/75 hover:border-[#dfba73]/40 hover:bg-[#272830]`.
  - Layout: Flex row, text on left (`text-xs tracking-wide text-[#d4d3d9] group-hover:text-white`), right-aligned chevron `›` (`text-sm font-light text-[#75737d] group-hover:text-white`).
  - Action: Clicking transitions state to View 2 (`activeSection = id`).

### View 2: Drill-Down Sub-Screen
- **Breadcrumb Navigation**:
  - `Category › Sub-Section` (e.g. `Makeup › Eye Makeup`, `Features › Nose`, `Physique › Torso`).
  - Clicking Category or pressing `Escape` resets `activeSection = null` to return to View 1.
- **Sub-Category Ribbon Pill**:
  - Top white gradient ribbon badge: `bg-gradient-to-r from-white via-white/95 to-white/80 px-3.5 py-1 text-black font-semibold shadow-sm rounded-sm`.
  - Displays category SVG glyph + bold label.
- **Mode / Quality Segmented Control**:
  - Optional `[BASIC]` vs `[ADVANCED]` or `[CUSTOM]` vs `[QUICK]` toggle when multiple tiers or layers exist.
- **Interactive Content**:
  - Grid of `ItemTile` components ($4 \times 4$ or $3 \times 3$, `None ⊘` as Tile #1, active gold border `border-2 border-[#eac87f] shadow-[0_0_12px_rgba(234,200,127,0.45)]`).
  - Precision Sliders (`HudSlider` / `PrecisionSlider`) with live numerical readouts.
  - 2D Color Studio (`WuxiaColorPicker2D`).

## 2. Universal Standards across All Screens

- **Left Rail**: 72px `WuxiaSubCategoryRail` pinned on left across all tabs.
- **Canvas Stage**: Full bleed `absolute inset-0`. Zero container offsets causing vertical seams.
- **Zero Visible Scrollbars**: Use `scrollbar-none` on every scrollable container while preserving native touch and wheel scrolling.
- **Typography Floor**: All text elements $\ge 10\text{px}$.
- **Hit Target Floor**: All interactive targets $\ge 24\text{px}$ (cards $\ge 44\text{px}$).
- **Automated Verification**: `npm run typecheck`, `npm run check:editor`, `npm run check:hair`, `npm run check:selection` must all pass clean.
