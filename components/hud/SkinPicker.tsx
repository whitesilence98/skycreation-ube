'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

interface SkinPickerProps {
  manifest: Mo2Manifest | null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Color Math & Utilities (HSV ↔ RGB ↔ HEX)
   ───────────────────────────────────────────────────────────────────────────── */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  if (Number.isNaN(num)) return { r: 184, g: 153, b: 122 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;

  if (max !== min) {
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, v };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
  } else if (h >= 120 && h < 180) {
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Authentic Palette Swatches (3 rows × 8 cols = 24 swatches)
   ───────────────────────────────────────────────────────────────────────────── */
export const SKIN_PALETTE = [
  // Row 1: Fair & Pale
  { name: 'Nordic Snow', hex: '#FFF5EB' },
  { name: 'Frost Ivory', hex: '#FDF0E6' },
  { name: 'Breton Fair', hex: '#F7E6D7' },
  { name: 'Rosy Peach', hex: '#F4D6C6' },
  { name: 'Alabaster', hex: '#EED0BA' },
  { name: 'Warm Bisque', hex: '#E8C6AA' },
  { name: 'Imperial Cream', hex: '#E6C4A4' },
  { name: 'Golden Sand', hex: '#DDBB98' },

  // Row 2: Olive & Tan (includes exact #B8997A Olive Tan from reference)
  { name: 'Warm Ochre', hex: '#D4AF88' },
  { name: 'Sunlit Sand', hex: '#C9A075' },
  { name: 'Olive Tan', hex: '#B8997A' },
  { name: 'Sun-kissed Tan', hex: '#C28C66' },
  { name: 'Copper Rose', hex: '#B57D54' },
  { name: 'Warm Cinnamon', hex: '#A87046' },
  { name: 'Redguard Bronze', hex: '#9E6642' },
  { name: 'Rich Chestnut', hex: '#8E5936' },

  // Row 3: Deep & Exotic
  { name: 'Deep Amber', hex: '#7C492A' },
  { name: 'Dark Umber', hex: '#6D3D20' },
  { name: 'Espresso', hex: '#5A3018' },
  { name: 'Dark Ebony', hex: '#4A2916' },
  { name: 'Deep Obsidian', hex: '#3B2011' },
  { name: 'Altmer Golden', hex: '#D6C48A' },
  { name: 'Bosmer Tawny', hex: '#CFAD85' },
  { name: 'Dunmer Ash', hex: '#8B939D' },
];

const VERTICAL_STRIP_PRESETS = [
  '#FFF4EA',
  '#F7E6D7',
  '#F4D6C6',
  '#B8997A',
  '#9E6642',
  '#7C492A',
  '#4A2916',
];

function findClosestColorName(hex: string): string {
  const norm = hex.toLowerCase();
  const direct = SKIN_PALETTE.find((p) => p.hex.toLowerCase() === norm);
  if (direct) return direct.name;
  const rgb = hexToRgb(hex);
  let closest = SKIN_PALETTE[0].name;
  let minD = Infinity;
  for (const p of SKIN_PALETTE) {
    const pr = hexToRgb(p.hex);
    const d = (rgb.r - pr.r) ** 2 + (rgb.g - pr.g) ** 2 + (rgb.b - pr.b) ** 2;
    if (d < minD) {
      minD = d;
      closest = p.name;
    }
  }
  return closest;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Skin Texture Presets (6 Tiles matching Image 1)
   ───────────────────────────────────────────────────────────────────────────── */
interface TexturePreset {
  id: string;
  name: string;
  title: string;
  description: string;
  thumb: string;
  manifestId: string;
}

const TEXTURE_PRESETS: TexturePreset[] = [
  {
    id: 'ube-base',
    name: 'UBE Base',
    title: 'UBE 2.0 BASE SKIN',
    description: 'Official UBE 2.0 foundation skin with neutral tones and balanced surface specularity.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/ube_base.webp',
    manifestId: 'skin-ube-base',
  },
  {
    id: 'sayble',
    name: 'Sayble',
    title: 'SAYBLE SKIN (UBE)',
    description: 'Soft, satin-smooth complexion with delicate micro-pores and luminous highlights.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/sayble.webp',
    manifestId: 'skin-sayble-ube',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    title: 'DIAMOND SKIN (UBE)',
    description: 'Iconic high-definition skin with crystalline clarity, sharp highlights, and seamless shading.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/diamond.webp',
    manifestId: 'skin-diamond-ube',
  },
  {
    id: 'imperfect',
    name: 'Imperfect',
    title: 'IMPERFECT SKIN (UBE)',
    description: 'Authentic, natural complexion with realistic skin micro-relief, subtle freckles, and pores.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/imperfect.webp',
    manifestId: 'skin-imperfect-ube',
  },
  {
    id: 'dragokini',
    name: 'Dragokini',
    title: 'DRAGOKINI SKIN (UBE)',
    description: 'Exotic dragon-touched aesthetic with radiant warm tones and fine scale textures.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/dragokini.webp',
    manifestId: 'skin-dragokini-ube',
  },
  {
    id: 'zhizhen',
    name: 'Zhizhen 8K',
    title: 'ZHIZHEN 8K SKIN (UBE)',
    description: 'Ultra-high fidelity 8K complexion featuring smooth subsurface depth and porcelain tones.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/zhizhen.webp',
    manifestId: 'skin-zhizhen-ube',
  },
  {
    id: 'dragokini-scaleless',
    name: 'Scaleless',
    title: 'DRAGOKINI SCALELESS (UBE)',
    description: 'Smooth torso variant with dragon-born facial texture and accented extremities.',
    thumb: '/assets/preset-pack/textures/skin/thumbs/dragokini_scaleless.webp',
    manifestId: 'skin-dragokini-scaleless',
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Main SkinPicker Component
   ───────────────────────────────────────────────────────────────────────────── */
export function SkinPicker({ manifest = null }: SkinPickerProps) {
  const weight = useCharacter((s) => s.weight);
  const setWeight = useCharacter((s) => s.setWeight);
  const linkFaceToWeight = useCharacter((s) => s.linkFaceToWeight);
  const setLinkFaceToWeight = useCharacter((s) => s.setLinkFaceToWeight);
  const skinColor = useCharacter((s) => s.skinColor);
  const setSkinColor = useCharacter((s) => s.setSkinColor);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const setSkinSss = useCharacter((s) => s.setSkinSss);
  const activeSkinId = useCharacter((s) => s.assetSelection.skin);
  const setAssets = useCharacter((s) => s.setAssets);

  // Active Modals: null | 'texture' | 'color'
  const [modalOpen, setModalOpen] = useState<'texture' | 'color' | null>(null);

  // Draft states for modals
  const [draftTexture, setDraftTexture] = useState<TexturePreset>(() => {
    return TEXTURE_PRESETS.find((t) => t.manifestId === activeSkinId) ?? TEXTURE_PRESETS[0];
  });

  const [draftColor, setDraftColor] = useState<string>(skinColor || '#B8997A');
  const [initialColor, setInitialColor] = useState<string>(skinColor || '#B8997A');
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(skinColor || '#B8997A')));

  // Keep draft in sync if external store changes and modal is closed
  useEffect(() => {
    if (!modalOpen) {
      setDraftColor(skinColor || '#B8997A');
      setHsv(rgbToHsv(hexToRgb(skinColor || '#B8997A')));
    }
  }, [skinColor, modalOpen]);

  // Current active texture preset
  const activeTexture = useMemo(() => {
    return TEXTURE_PRESETS.find((t) => t.manifestId === activeSkinId) ?? TEXTURE_PRESETS[0];
  }, [activeSkinId]);

  // Body Weight
  const weightPercent = Math.round(weight * 100);

  // Gloss Rating
  const glossPercent = Math.round(skinGloss * 100);
  const glossLabel =
    glossPercent < 20
      ? 'Matte'
      : glossPercent < 40
        ? 'Low'
        : glossPercent < 60
          ? 'Medium'
          : glossPercent < 80
            ? 'Glossy'
            : 'Wet';

  // SSS Rating
  const sssPercent = Math.round(skinSss * 100);
  const sssLabel =
    sssPercent === 0
      ? 'Off'
      : sssPercent <= 20
        ? 'Natural'
        : sssPercent <= 50
          ? 'Subtle'
          : sssPercent <= 80
            ? 'Lush'
            : 'Deep';

  const currentColorName = findClosestColorName(skinColor || '#B8997A');

  // Open Texture Modal
  const openTextureModal = () => {
    setDraftTexture(activeTexture);
    setModalOpen('texture');
  };

  // Open Color Modal
  const openColorModal = () => {
    const cur = skinColor || '#B8997A';
    setInitialColor(cur);
    setDraftColor(cur);
    setHsv(rgbToHsv(hexToRgb(cur)));
    setModalOpen('color');
  };

  // Apply Texture
  const applyTexture = () => {
    setAssets({ skin: draftTexture.manifestId });
    setModalOpen(null);
  };

  // Cancel Texture
  const cancelTexture = () => {
    setDraftTexture(activeTexture);
    setModalOpen(null);
  };

  // Apply Color
  const applyColor = () => {
    setSkinColor(draftColor);
    setModalOpen(null);
  };

  // Cancel Color (revert back)
  const cancelColor = () => {
    setSkinColor(initialColor);
    setDraftColor(initialColor);
    setHsv(rgbToHsv(hexToRgb(initialColor)));
    setModalOpen(null);
  };

  // Quick Pick Color from Base Panel Palette Grid
  const quickPickColor = (hex: string) => {
    setSkinColor(hex);
    setDraftColor(hex);
    setHsv(rgbToHsv(hexToRgb(hex)));
  };

  return (
    <div className="relative select-none text-[#e6e1d8]">
      {/* ── BASE PANEL: BODY & SKIN ─────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3 backdrop-blur-md">
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6] uppercase">
          BODY & SKIN
        </h2>

        {/* ── 1. BODY WEIGHT & STATURE ───────────────────────────────── */}
        <div className="flex flex-col gap-1.5 pt-0.5">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.08em]">
            <span className="text-[#c4b595] uppercase">BODY WEIGHT</span>
            <div className="flex items-center gap-1.5 text-[#8f8778]">
              <span className="text-[#d8c39c]">[{weightPercent}%]</span>
              <span>({weight.toFixed(2)})</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={weight}
            onChange={(e) => setWeight(parseFloat(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#d4b483]"
            aria-label="Body weight slider"
          />
          <div className="flex items-center justify-between text-[8.5px] font-mono text-[#8f8778]/70 px-0.5">
            <span>Slim (_0)</span>
            <span>Muscular (_1)</span>
          </div>

          {/* Link Face to Weight Toggle */}
          <button
            type="button"
            onClick={() => setLinkFaceToWeight(!linkFaceToWeight)}
            title="Link Face to Weight: FaceGen fullness and neck perimeter scale with body weight (Skyrim Creation Engine parity)"
            className={cn(
              'mt-0.5 flex w-full items-center justify-between border px-2 py-1 text-[9.5px] font-mono tracking-[0.08em] transition-colors',
              linkFaceToWeight
                ? 'border-[#d4b483]/70 bg-[#d4b483]/14 text-[#e8c691] font-medium shadow-[0_0_8px_rgba(212,180,131,0.15)]'
                : 'border-[#8c8477]/30 bg-black/20 text-[#a8a294]/70 hover:border-[#d4b483]/45 hover:text-[#d5cdbd]',
            )}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full transition-colors',
                  linkFaceToWeight ? 'bg-[#d4b483] shadow-[0_0_5px_#d4b483]' : 'bg-[#8c8477]/40',
                )}
              />
              LINK FACE TO WEIGHT
            </span>
            <span className="text-[9px] uppercase text-[#c9b184]/80">
              {linkFaceToWeight ? 'ACTIVE' : 'OFF'}
            </span>
          </button>
        </div>

        {/* ── 2. SKIN TEXTURE ────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-1.5 border-t border-[#d4b483]/18 pt-2">
          <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            SKIN TEXTURE
          </span>
          <button
            type="button"
            onClick={openTextureModal}
            className="group relative flex aspect-square w-[64px] items-center justify-center overflow-hidden rounded-xs border border-[#d4b483]/30 bg-black/50 transition-all duration-150 hover:border-[#eac87f] hover:shadow-[0_0_10px_rgba(234,200,127,0.35)]"
            title="Click to change skin texture"
          >
            <img
              src={activeTexture.thumb}
              alt={activeTexture.name}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            <span className="pointer-events-none absolute inset-0 border border-black/30" />
          </button>
          <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
            [{activeTexture.name}]
          </span>
        </div>

        {/* ── 3. SKIN COLOR & 3x8 PALETTE GRID ───────────────────────── */}
        <div className="flex flex-col items-center gap-1.5 border-t border-[#d4b483]/18 pt-2">
          <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            SKIN COLOR
          </span>

          <div className="flex w-full items-center justify-center gap-2.5">
            {/* Large Color Swatch (Click to open full color picker) */}
            <button
              type="button"
              onClick={openColorModal}
              title="Click to open skin color selector"
              className="relative aspect-square w-[52px] shrink-0 rounded-xs border border-[#d4b483]/50 shadow-[0_0_8px_rgba(0,0,0,0.6)] transition-all hover:scale-105 hover:border-[#eac87f]"
              style={{ backgroundColor: skinColor || '#B8997A' }}
            >
              <span className="pointer-events-none absolute inset-0 rounded-xs border border-white/20" />
            </button>

            {/* 3×8 Palette Grid */}
            <div className="grid grid-cols-8 gap-[2.5px]">
              {SKIN_PALETTE.map((swatch) => {
                const isSelected =
                  (skinColor || '#B8997A').toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => quickPickColor(swatch.hex)}
                    title={`${swatch.name} (${swatch.hex})`}
                    className={cn(
                      'h-[14px] w-[14px] rounded-[1px] border transition-all duration-100',
                      isSelected
                        ? 'scale-110 border-[#eac87f] ring-1 ring-[#eac87f] shadow-[0_0_6px_rgba(234,200,127,0.6)]'
                        : 'border-black/50 hover:scale-110 hover:border-white/60',
                    )}
                    style={{ backgroundColor: swatch.hex }}
                  />
                );
              })}
            </div>
          </div>

          <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
            [{currentColorName}]
          </span>
        </div>

        {/* ── 4. GLOSS SLIDER ────────────────────────────────────────── */}
        <div className="flex flex-col gap-1 border-t border-[#d4b483]/18 pt-2">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.08em]">
            <span className="text-[#c4b595] uppercase">GLOSS</span>
            <div className="flex items-center gap-1.5 text-[#8f8778]">
              <span className="text-[#d8c39c]">[{glossPercent}%]</span>
              <span>[{glossLabel}]</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={skinGloss}
            onChange={(e) => setSkinGloss(parseFloat(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#d4b483]"
          />
        </div>

        {/* ── 5. SUBSURFACE SLIDER ────────────────────────────────────── */}
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.08em]">
            <span className="text-[#c4b595] uppercase">SUBSURFACE</span>
            <div className="flex items-center gap-1.5 text-[#8f8778]">
              <span className="text-[#d8c39c]">[{sssPercent}%]</span>
              <span>[{sssLabel}]</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={skinSss}
            onChange={(e) => setSkinSss(parseFloat(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#d4b483]"
          />
        </div>

        {/* ── 6. Bottom Decorative Waist Silhouette Accent ───────────── */}
        <div className="flex justify-center pt-2 opacity-30">
          <svg viewBox="0 0 100 70" className="h-[48px] w-[70px]" fill="none" stroke="#d4b483" strokeWidth="0.9">
            <path d="M25 10 C38 25 46 35 46 45 C46 55 35 62 20 68" />
            <path d="M75 10 C62 25 54 35 54 45 C54 55 65 62 80 68" />
            <line x1="50" y1="18" x2="50" y2="58" strokeDasharray="3 3" />
          </svg>
        </div>
      </div>

      {/* ── MODAL 1: SKIN TEXTURE SELECTOR (IMAGE 1) ───────────────── */}
      {modalOpen === 'texture' && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
            onClick={cancelTexture}
          />
          <div
            className="fixed left-[16px] sm:left-[152px] top-[108px] z-50 w-[290px] select-none rounded-xs border border-[#d4b483]/30 bg-[#0a0907]/96 p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-xl lg:top-[96px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-center text-[11px] font-mono tracking-[0.16em] uppercase text-[#efece6]">
              SKIN TEXTURE SELECTOR
            </h3>

            {/* Grid of Real Skin Presets */}
            <div className="grid grid-cols-3 gap-2 max-h-[195px] overflow-y-auto thin-scroll pr-1">
              {TEXTURE_PRESETS.map((preset) => {
                const isSelected = draftTexture.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDraftTexture(preset)}
                    className="group flex flex-col items-center gap-1 text-center"
                  >
                    <div
                      className={cn(
                        'relative aspect-square w-full overflow-hidden rounded-xs border transition-all duration-150',
                        isSelected
                          ? 'border-2 border-[#eac87f] shadow-[0_0_10px_rgba(234,200,127,0.45)] ring-1 ring-[#eac87f]/60'
                          : 'border-[#d4b483]/25 bg-black/50 hover:border-[#d4b483]/60 hover:scale-105',
                      )}
                    >
                      <img
                        src={preset.thumb}
                        alt={preset.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <span
                      className={cn(
                        'text-[9px] font-mono tracking-tight transition-colors',
                        isSelected ? 'font-semibold text-[#f2dfbe]' : 'text-[#8f8778]/70 group-hover:text-[#c4b9a3]',
                      )}
                    >
                      [{preset.name}]
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Detail Preview Box */}
            <div className="my-3 flex items-center gap-3 border-y border-[#d4b483]/20 bg-black/35 p-2">
              <div className="relative aspect-square w-[52px] shrink-0 overflow-hidden rounded-xs border border-[#d4b483]/40">
                <img
                  src={draftTexture.thumb}
                  alt={draftTexture.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[10px] font-mono font-bold tracking-[0.1em] uppercase text-[#eac87f]">
                  {draftTexture.title}
                </span>
                <span className="mt-0.5 text-[9px] leading-tight text-[#b6ab98]/80">
                  {draftTexture.description}
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={applyTexture}
                className="w-[90px] rounded-xs bg-[#8c6b3e] py-1.5 text-center text-[10.5px] font-medium tracking-wider text-white shadow-[0_0_8px_rgba(140,107,62,0.4)] transition-all hover:bg-[#a8824c]"
              >
                APPLY
              </button>
              <button
                type="button"
                onClick={cancelTexture}
                className="w-[90px] rounded-xs border border-[#d4b483]/30 bg-black/30 py-1.5 text-center text-[10.5px] font-medium tracking-wider text-[#d4b483] transition-all hover:bg-white/10"
              >
                CANCEL
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── MODAL 2: SKIN SELECTOR / COLOR PICKER (IMAGE 2) ────────── */}
      {modalOpen === 'color' && (
        <ColorPickerModal
          draftColor={draftColor}
          initialColor={initialColor}
          hsv={hsv}
          onChangeHsv={(newHsv) => {
            setHsv(newHsv);
            const newRgb = hsvToRgb(newHsv);
            const newHex = rgbToHex(newRgb);
            setDraftColor(newHex);
            setSkinColor(newHex); // Real-time viewport preview
          }}
          onChangeHex={(hex) => {
            setDraftColor(hex);
            setSkinColor(hex);
            setHsv(rgbToHsv(hexToRgb(hex)));
          }}
          onApply={applyColor}
          onCancel={cancelColor}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Modal 2: ColorPickerModal Component (Matching Image 2)
   ───────────────────────────────────────────────────────────────────────────── */
interface ColorPickerModalProps {
  draftColor: string;
  initialColor: string;
  hsv: Hsv;
  onChangeHsv: (hsv: Hsv) => void;
  onChangeHex: (hex: string) => void;
  onApply: () => void;
  onCancel: () => void;
}

function ColorPickerModal({
  draftColor,
  hsv,
  onChangeHsv,
  onChangeHex,
  onApply,
  onCancel,
}: ColorPickerModalProps) {
  const satValRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Pure Hue color for gradient background
  const pureHueHex = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  const currentRgb = hsvToRgb(hsv);

  // Handle Drag on 2D Saturation / Value Gradient
  const updateSatVal = useCallback(
    (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
      if (!satValRef.current) return;
      const rect = satValRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

      const s = x / rect.width;
      const v = 1 - y / rect.height;

      onChangeHsv({ ...hsv, s, v });
    },
    [hsv, onChangeHsv],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    updateSatVal(e);

    const onMouseMove = (ev: MouseEvent) => {
      if (isDraggingRef.current) updateSatVal(ev);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Direct RGB input changes
  const handleRgbChange = (channel: 'r' | 'g' | 'b', val: number) => {
    const clamped = Math.max(0, Math.min(255, Number.isNaN(val) ? 0 : val));
    const nextRgb = { ...currentRgb, [channel]: clamped };
    const nextHex = rgbToHex(nextRgb);
    onChangeHex(nextHex);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      <div
        className="fixed left-[16px] sm:left-[152px] top-[108px] z-50 w-[290px] select-none rounded-xs border border-[#d4b483]/30 bg-[#0a0907]/96 p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.7)] backdrop-blur-xl lg:top-[96px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-center text-[11px] font-mono tracking-[0.16em] uppercase text-[#efece6]">
          SKIN SELECTOR
        </h3>

        {/* ── 2D Gradient Box + Vertical Preset Strip ────────────────── */}
        <div className="flex gap-2">
          {/* 2D Saturation / Value Gradient Box */}
          <div
            ref={satValRef}
            onMouseDown={handleMouseDown}
            onTouchStart={(e) => updateSatVal(e)}
            onTouchMove={(e) => updateSatVal(e)}
            className="relative h-[180px] flex-1 cursor-crosshair overflow-hidden rounded-xs border border-[#d4b483]/30"
            style={{ backgroundColor: pureHueHex }}
          >
            {/* White horizontal gradient */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to right, #ffffff, transparent)',
              }}
            />
            {/* Black vertical gradient */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to bottom, transparent, #000000)',
              }}
            />

            {/* Draggable Circle Picker Indicator (O) */}
            <div
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,0.8)]"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
              }}
            />
          </div>

          {/* Vertical Strip of Quick Presets (Right) */}
          <div className="flex w-[22px] flex-col gap-[3px]">
            {VERTICAL_STRIP_PRESETS.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onChangeHex(hex)}
                title={hex}
                className={cn(
                  'h-[22px] w-full rounded-[1px] border transition-transform hover:scale-105',
                  draftColor.toLowerCase() === hex.toLowerCase()
                    ? 'border-[#eac87f] ring-1 ring-[#eac87f]'
                    : 'border-black/50',
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>

        {/* ── Rainbow Hue Slider ────────────────────────────────────── */}
        <div className="relative mt-2.5">
          <input
            type="range"
            min={0}
            max={360}
            value={hsv.h}
            onChange={(e) => onChangeHsv({ ...hsv, h: parseFloat(e.target.value) })}
            className="h-2 w-full cursor-pointer appearance-none rounded-full"
            style={{
              background:
                'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
            }}
          />
        </div>

        {/* ── RGB & HEX Numerical Readout + Preview Swatch ──────────── */}
        <div className="mt-3 flex items-center justify-between border-y border-[#d4b483]/18 bg-black/40 p-2">
          {/* R, G, B Inputs */}
          <div className="flex flex-col gap-1 text-[9.5px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-3 text-[#d4b483]">R</span>
              <input
                type="number"
                min={0}
                max={255}
                value={currentRgb.r}
                onChange={(e) => handleRgbChange('r', parseInt(e.target.value, 10))}
                className="w-10 border border-[#d4b483]/30 bg-black/60 px-1 py-0.5 text-center text-[#efece6] outline-none focus:border-[#eac87f]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 text-[#d4b483]">G</span>
              <input
                type="number"
                min={0}
                max={255}
                value={currentRgb.g}
                onChange={(e) => handleRgbChange('g', parseInt(e.target.value, 10))}
                className="w-10 border border-[#d4b483]/30 bg-black/60 px-1 py-0.5 text-center text-[#efece6] outline-none focus:border-[#eac87f]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 text-[#d4b483]">B</span>
              <input
                type="number"
                min={0}
                max={255}
                value={currentRgb.b}
                onChange={(e) => handleRgbChange('b', parseInt(e.target.value, 10))}
                className="w-10 border border-[#d4b483]/30 bg-black/60 px-1 py-0.5 text-center text-[#efece6] outline-none focus:border-[#eac87f]"
              />
            </div>
          </div>

          {/* HEX Input */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] font-mono text-[#8f8778]">HEX</span>
            <input
              type="text"
              value={draftColor}
              onChange={(e) => onChangeHex(e.target.value)}
              className="w-20 border border-[#d4b483]/30 bg-black/60 px-1.5 py-1 text-center font-mono text-[10px] text-[#efece6] outline-none focus:border-[#eac87f]"
            />
          </div>

          {/* Large Color Preview Swatch */}
          <div
            className="aspect-square w-[46px] rounded-xs border-2 border-[#d4b483]/60 shadow-[0_0_8px_rgba(0,0,0,0.6)]"
            style={{ backgroundColor: draftColor }}
          />
        </div>

        {/* ── Action Buttons ────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-3 pt-3">
          <button
            type="button"
            onClick={onApply}
            className="w-[90px] rounded-xs bg-[#8c6b3e] py-1.5 text-center text-[10.5px] font-medium tracking-wider text-white shadow-[0_0_8px_rgba(140,107,62,0.4)] transition-all hover:bg-[#a8824c]"
          >
            APPLY
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-[90px] rounded-xs border border-[#d4b483]/30 bg-black/30 py-1.5 text-center text-[10.5px] font-medium tracking-wider text-[#d4b483] transition-all hover:bg-white/10"
          >
            CANCEL
          </button>
        </div>
      </div>
    </>
  );
}
