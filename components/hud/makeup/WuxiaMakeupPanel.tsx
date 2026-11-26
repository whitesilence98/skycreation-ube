'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCharacter, type OverlayBlend, type OverlayLayer } from '@/lib/store';
import { ItemTile } from '@/components/hud/common/ItemTile';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { ColorStudio2D } from '@/components/hud/common/ColorStudio2D';
import { fetchCatalogue, convertUrl, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { assetOptions } from '@/lib/manifestSelect';
import { BEAUTY_SWATCHES, detectSubtype, makeupLabel, type MakeupCategory } from '@/components/hud/MakeupPicker';
import { SKIN_PALETTE_SWATCHES } from '@/components/hud/SkinProperties';
import { TATTOO_INK_SWATCHES, tattooLabel } from '@/components/hud/TattooPicker';
import { LASH_INK_SWATCHES } from '@/components/hud/LashesProperties';
import { cn } from '@/lib/cn';

export type MakeupSectionId =
  | 'skin_texture'
  | 'brows'
  | 'pupils'
  | 'lip_makeup'
  | 'eye_makeup'
  | 'blush'
  | 'accessory'
  | 'lashes';

interface SectionConfig {
  id: MakeupSectionId;
  label: string;
  badge?: string;
  categoryKind?: string;
}

const MAKEUP_SECTIONS: readonly SectionConfig[] = [
  { id: 'skin_texture', label: 'Skin & Foundation', badge: 'DIFFUSE / TONE / PBR', categoryKind: 'skin' },
  { id: 'brows', label: 'Eyebrows', badge: 'STYLES / GLOSS', categoryKind: 'brows' },
  { id: 'pupils', label: 'Pupils', badge: 'EYE IRIS', categoryKind: 'eyes' },
  { id: 'lip_makeup', label: 'Lip Makeup', badge: 'TINT & GLOSS', categoryKind: 'makeup' },
  { id: 'eye_makeup', label: 'Eye Makeup', badge: 'LINER & SHADOW', categoryKind: 'makeup' },
  { id: 'blush', label: 'Blush', badge: 'CHEEK COLOR', categoryKind: 'makeup' },
  { id: 'accessory', label: 'Facial Accessory', badge: 'WARPAINT / INK', categoryKind: 'tattoo' },
  { id: 'lashes', label: 'Eyelashes', badge: 'VOLUME & TINT', categoryKind: 'lashes' },
];

const BROW_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: 'Espresso Black', hex: '#1a120b' },
  { name: 'Dark Auburn', hex: '#2b1a0a' },
  { name: 'Warm Chestnut', hex: '#422817' },
  { name: 'Medium Brown', hex: '#5c3a21' },
  { name: 'Honey Blonde', hex: '#8c6239' },
  { name: 'Sandy Blonde', hex: '#b88e58' },
  { name: 'Platinum Blonde', hex: '#e2c799' },
  { name: 'Jet Raven', hex: '#0e0d0d' },
];

const SKIN_THUMB_MAP: Record<string, string> = {
  'skin-diamond-ube': '/assets/preset-pack/textures/skin/thumbs/diamond.webp',
  'skin-zhizhen-ube': '/assets/preset-pack/textures/skin/thumbs/zhizhen.webp',
  'skin-sayble-ube': '/assets/preset-pack/textures/skin/thumbs/sayble.webp',
  'skin-imperfect-ube': '/assets/preset-pack/textures/skin/thumbs/imperfect.webp',
  'skin-freckled-delight': '/assets/preset-pack/textures/skin/thumbs/freckled_delight.webp',
};

interface MakeupItemEntry {
  id: string;
  label?: string;
  file?: string;
  rel?: string;
  texture?: string;
  kind?: string;
  subtype?: string;
}

interface ColorSectionProps {
  label: string;
  color: string;
  onChange: (hex: string) => void;
  swatches: Array<{ name: string; hex: string }>;
  cols?: number;
  disabled?: boolean;
}

/** Shared swatch grid + expandable 2D Color Studio matching Wuxia HUD rules. */
function WuxiaColorSection({
  label,
  color,
  onChange,
  swatches,
  cols = 8,
  disabled = false,
}: ColorSectionProps) {
  const [studioOpen, setStudioOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between border-b border-white/10 pb-1">
        <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="h-3.5 w-3.5 rounded-[2px] border border-white/30 shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <span className="font-mono text-[10px] text-[#dfba73] uppercase">{color}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setStudioOpen((v) => !v)}
            aria-expanded={studioOpen}
            className={cn(
              'min-h-[24px] rounded-[2px] border px-2 font-mono text-[10px] tracking-wider transition-colors disabled:opacity-40',
              studioOpen
                ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe]'
                : 'border-white/15 bg-black/40 text-[#c4b595] hover:border-[#dfba73]/60 hover:text-white',
            )}
          >
            {studioOpen ? 'CLOSE 2D' : '2D PICKER'}
          </button>
        </div>
      </div>

      <div
        className="grid gap-1.5 p-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {swatches.map((swatch) => {
          const active = color.toLowerCase() === swatch.hex.toLowerCase();
          return (
            <button
              key={swatch.name}
              type="button"
              disabled={disabled}
              onClick={() => onChange(swatch.hex)}
              title={`${swatch.name} (${swatch.hex})`}
              aria-label={swatch.name}
              aria-pressed={active}
              className={cn(
                'min-h-[24px] h-6 w-full rounded-[2px] transition-all disabled:opacity-40',
                active
                  ? 'border-2 border-[#f0dfbe] ring-1 ring-[#eac87f]/80 shadow-[0_0_8px_rgba(234,200,127,0.45)]'
                  : 'border border-white/15 hover:border-white/45',
              )}
              style={{ backgroundColor: swatch.hex }}
            />
          );
        })}
      </div>

      {studioOpen && !disabled && (
        <div className="rounded-[2px] border border-[#d4b483]/25 bg-black/50 p-2">
          <ColorStudio2D
            color={color}
            onChange={onChange}
            swatches={swatches}
            swatchCols={Math.min(8, swatches.length || 8)}
          />
        </div>
      )}
    </div>
  );
}

interface OverlayControlsProps {
  layer: OverlayLayer | undefined;
  layerLabel: string;
  subtypeBadge?: string;
  colorLabel: string;
  opacityLabel: string;
  swatches: Array<{ name: string; hex: string }>;
  swatchCols?: number;
  defaultColor: string;
  showCoverage?: boolean;
  headerExtra?: React.ReactNode;
  onColorChange: (hex: string) => void;
  onOpacityChange: (value: number) => void;
  onBlendChange: (blend: OverlayBlend) => void;
  onCoverageChange?: (value: number) => void;
}

/** Shared Tint, Intensity, Blend Mode, and Coverage editor for an active overlay layer. */
function WuxiaOverlayLayerControls({
  layer,
  layerLabel,
  subtypeBadge,
  colorLabel,
  opacityLabel,
  swatches,
  swatchCols = 8,
  defaultColor,
  showCoverage = false,
  headerExtra,
  onColorChange,
  onOpacityChange,
  onBlendChange,
  onCoverageChange,
}: OverlayControlsProps) {
  if (!layer) {
    return (
      <div className="rounded-[2px] border border-dashed border-white/10 bg-black/30 px-3 py-4 text-center font-mono text-[10px] text-[#9f9da6]">
        Select a style above to customize tint, blend mode, and intensity.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 rounded-[2px] border border-[#d4b483]/20 bg-black/40 px-2.5 py-1.5">
        <span className="truncate font-mono text-[10px] text-[#e8d4af]" title={layerLabel}>
          {layerLabel}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {headerExtra}
          {subtypeBadge && (
            <span className="rounded-[2px] bg-[#dfba73]/15 px-1.5 py-0.5 font-mono text-[10px] text-[#dfba73]">
              {subtypeBadge}
            </span>
          )}
        </div>
      </div>

      <WuxiaColorSection
        label={colorLabel}
        color={layer.color || defaultColor}
        onChange={onColorChange}
        swatches={swatches}
        cols={swatchCols}
      />

      <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
        <BracketSlider
          label={opacityLabel}
          value={layer.opacity}
          min={0.02}
          max={1}
          step={0.01}
          display={`${Math.round(layer.opacity * 100)}%`}
          onChange={onOpacityChange}
        />

        <div className="flex items-center justify-between text-[10px] font-mono text-[#b8ab97]">
          <span>BLEND MODE</span>
          <select
            aria-label="Blending mode"
            value={layer.blend ?? 'normal'}
            onChange={(e) => onBlendChange(e.target.value as OverlayBlend)}
            className="min-h-[24px] rounded-xs border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] font-mono text-[#e8d4af] outline-none focus:border-[#eac87f]"
          >
            {(['normal', 'multiply', 'screen', 'overlay'] as const).map((b) => (
              <option key={b} value={b} className="bg-[#12100d] text-[#e8d4af]">
                {b.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {showCoverage && onCoverageChange && (
          <BracketSlider
            label="COVERAGE AREA"
            value={layer.coverage ?? 1}
            min={0.05}
            max={1}
            step={0.01}
            display={`${Math.round((layer.coverage ?? 1) * 100)}%`}
            onChange={onCoverageChange}
          />
        )}
      </div>
    </div>
  );
}

export function WuxiaMakeupPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const [activeSection, setActiveSection] = useState<MakeupSectionId | null>(null);
  const [eyeFilter, setEyeFilter] = useState<'ALL' | 'ZHIZHEN' | 'UBE'>('ALL');
  const [eyeMakeupFilter, setEyeMakeupFilter] = useState<'ALL' | 'EYELINER' | 'EYESHADOW'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const showToast = useCharacter((s) => s.showToast);

  // ── 1. Skin & Foundation State ─────────────────────────────────────
  const skinColor = useCharacter((s) => s.skinColor);
  const setSkinColor = useCharacter((s) => s.setSkinColor);
  const skinGloss = useCharacter((s) => s.skinGloss);
  const setSkinGloss = useCharacter((s) => s.setSkinGloss);
  const skinSss = useCharacter((s) => s.skinSss);
  const setSkinSss = useCharacter((s) => s.setSkinSss);
  const skinSheen = useCharacter((s) => s.skinSheen);
  const setSkinSheen = useCharacter((s) => s.setSkinSheen);
  const skinDetail = useCharacter((s) => s.skinDetail);
  const setSkinDetail = useCharacter((s) => s.setSkinDetail);
  const skinNormalStrength = useCharacter((s) => s.skinNormalStrength ?? 1.0);
  const setSkinNormalStrength = useCharacter((s) => s.setSkinNormalStrength);

  // ── 2. Brows State ─────────────────────────────────────────────────
  const browColor = useCharacter((s) => s.browColor);
  const setBrowColor = useCharacter((s) => s.setBrowColor);
  const browOpacity = useCharacter((s) => s.browOpacity);
  const setBrowOpacity = useCharacter((s) => s.setBrowOpacity);
  const browGloss = useCharacter((s) => s.browGloss);
  const setBrowGloss = useCharacter((s) => s.setBrowGloss);
  const browGlossy = useCharacter((s) => s.browGlossy);
  const setBrowGlossy = useCharacter((s) => s.setBrowGlossy);
  const linkBrowToHair = useCharacter((s) => s.linkBrowToHair);
  const setLinkBrowToHair = useCharacter((s) => s.setLinkBrowToHair);
  const hairTone = useCharacter((s) => s.hair.tone);

  // ── 3. Eyelashes State ─────────────────────────────────────────────
  const lashesColor = useCharacter((s) => s.lashesColor);
  const setLashesColor = useCharacter((s) => s.setLashesColor);
  const lashesOpacity = useCharacter((s) => s.lashesOpacity);
  const setLashesOpacity = useCharacter((s) => s.setLashesOpacity);

  // ── 4. Overlay Layer Stack State (single-select replacement per slot) ──
  const overlayLayers = useCharacter((s) => s.overlayLayers);
  const activeOverlay = useCharacter((s) => s.activeOverlay);
  const setActiveOverlay = useCharacter((s) => s.setActiveOverlay);
  const setOverlayLayers = useCharacter((s) => s.setOverlayLayers);
  const setOverlayOpacity = useCharacter((s) => s.setOverlayOpacity);
  const setOverlayColor = useCharacter((s) => s.setOverlayColor);
  const setOverlayBlend = useCharacter((s) => s.setOverlayBlend);
  const setOverlayCoverage = useCharacter((s) => s.setOverlayCoverage);

  // Load catalogues on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCatalogue('brows'),
      fetchCatalogue('eyes'),
      fetchCatalogue('eyeMesh'),
      fetchCatalogue('skin'),
      fetchCatalogue('makeup'),
      fetchCatalogue('tattoo'),
      fetchCatalogue('lashes'),
    ]).then(([brows, eyes, eyeMesh, skin, makeup, tattoo, lashes]) => {
      if (cancelled) return;
      if (brows.length) setCatalogue('brows', brows);
      if (eyes.length) setCatalogue('eyes', eyes);
      if (eyeMesh.length) setCatalogue('eyeMesh', eyeMesh);
      if (skin.length) setCatalogue('skin', skin);
      if (makeup.length) setCatalogue('makeup', makeup);
      if (tattoo.length) setCatalogue('tattoo', tattoo);
      if (lashes.length) setCatalogue('lashes', lashes);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  // Escape key returns from View 2 drill-down to View 1 Root Menu
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeSection !== null) {
        e.preventDefault();
        e.stopPropagation();
        setActiveSection(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [activeSection]);

  // Lookup maps so hash IDs resolve reliably via detectSubtype()
  const makeupEntryById = useMemo(
    () => new Map(((catalogues.makeup ?? []) as CatalogueEntry[]).map((e) => [e.id, e])),
    [catalogues.makeup],
  );
  const tattooEntryById = useMemo(
    () => new Map(((catalogues.tattoo ?? []) as CatalogueEntry[]).map((e) => [e.id, e])),
    [catalogues.tattoo],
  );

  const getLayerSubtype = (layer: OverlayLayer): Exclude<MakeupCategory, 'ALL'> => {
    const entry = makeupEntryById.get(layer.id);
    if (entry) return detectSubtype(entry);
    const low = layer.id.toLowerCase();
    if (low.includes('lip')) return 'LIPS';
    if (low.includes('blush')) return 'BLUSH';
    if (low.includes('eyeliner') || low.includes('liner')) return 'EYELINER';
    if (low.includes('eyeshadow') || low.includes('shadow')) return 'EYESHADOW';
    return 'OVERLAYS';
  };

  const getLayerDisplayName = (layer: OverlayLayer): string => {
    if (layer.kind === 'tattoo') {
      const entry = tattooEntryById.get(layer.id);
      return entry ? tattooLabel(entry) : layer.id;
    }
    const entry = makeupEntryById.get(layer.id);
    return entry ? makeupLabel(entry) : layer.id;
  };

  const currentSection = useMemo(
    () => MAKEUP_SECTIONS.find((s) => s.id === activeSection) ?? null,
    [activeSection],
  );

  const activeLipLayer = useMemo(
    () => overlayLayers.find((l) => l.kind === 'makeup' && getLayerSubtype(l) === 'LIPS'),
    [overlayLayers, makeupEntryById],
  );
  const activeBlushLayer = useMemo(
    () => overlayLayers.find((l) => l.kind === 'makeup' && getLayerSubtype(l) === 'BLUSH'),
    [overlayLayers, makeupEntryById],
  );
  const activeEyelinerLayer = useMemo(
    () => overlayLayers.find((l) => l.kind === 'makeup' && getLayerSubtype(l) === 'EYELINER'),
    [overlayLayers, makeupEntryById],
  );
  const activeEyeshadowLayer = useMemo(
    () => overlayLayers.find((l) => l.kind === 'makeup' && getLayerSubtype(l) === 'EYESHADOW'),
    [overlayLayers, makeupEntryById],
  );
  const activeEyeLayer = useMemo(() => {
    if (eyeMakeupFilter === 'EYELINER') return activeEyelinerLayer;
    if (eyeMakeupFilter === 'EYESHADOW') return activeEyeshadowLayer;
    if (activeEyelinerLayer && `makeup:${activeEyelinerLayer.id}` === activeOverlay) {
      return activeEyelinerLayer;
    }
    if (activeEyeshadowLayer && `makeup:${activeEyeshadowLayer.id}` === activeOverlay) {
      return activeEyeshadowLayer;
    }
    return activeEyelinerLayer ?? activeEyeshadowLayer;
  }, [eyeMakeupFilter, activeEyelinerLayer, activeEyeshadowLayer, activeOverlay]);

  const activeTattooLayer = useMemo(
    () => overlayLayers.find((l) => l.kind === 'tattoo'),
    [overlayLayers],
  );

  // Items for current sub-category with search + subtype filtering
  const categoryItems = useMemo<MakeupItemEntry[]>(() => {
    if (!currentSection) return [];
    const { id } = currentSection;
    const q = searchQuery.trim().toLowerCase();
    const filterBySearch = <T extends MakeupItemEntry>(list: T[]) => {
      if (!q) return list;
      return list.filter((entry) => {
        if ('rel' in entry && entry.rel !== undefined) {
          return matchesQuery(entry as unknown as CatalogueEntry, q);
        }
        return `${entry.label ?? ''} ${entry.file ?? ''} ${entry.id}`.toLowerCase().includes(q);
      });
    };

    if (id === 'skin_texture') {
      const skins = assetOptions(manifest, 'skin');
      if (skins.length > 0) {
        return filterBySearch(
          skins.map((s) => ({
            id: s.id,
            label: s.label ?? s.id,
            file: s.texture ?? '',
            texture: SKIN_THUMB_MAP[s.id] ?? s.texture,
            kind: 'skin',
          })),
        );
      }
      const raw = (catalogues.skin ?? []) as CatalogueEntry[];
      return filterBySearch(
        raw.filter((e) => !e.file.endsWith('_n.dds') && (e.mapRole ?? 'albedo') === 'albedo'),
      );
    }

    if (id === 'brows') {
      const raw = (catalogues.brows ?? []) as CatalogueEntry[];
      return filterBySearch(raw.filter((e) => !e.file.endsWith('_n.dds')));
    }

    if (id === 'pupils') {
      const raw = (catalogues.eyes ?? []) as CatalogueEntry[];
      return filterBySearch(
        raw.filter((e) => {
          const low = e.file.toLowerCase();
          if (
            e.mapRole === 'normal' ||
            e.mapRole === 'specular' ||
            low.endsWith('_n.dds') ||
            low.endsWith('_rmaos.dds') ||
            low.endsWith('_g.dds') ||
            low === 'eye_o_d.dds' ||
            low === 'wetness_d.dds' ||
            low === 'shadow_d.dds'
          ) {
            return false;
          }
          if (eyeFilter === 'ZHIZHEN') return low.includes('zhizhen');
          if (eyeFilter === 'UBE') return low.includes('ube');
          return true;
        }),
      );
    }

    if (id === 'lip_makeup') {
      const raw = (catalogues.makeup ?? []) as CatalogueEntry[];
      return filterBySearch(
        raw
          .filter((e) => !e.file.endsWith('_n.dds') && detectSubtype(e) === 'LIPS')
          .map((e) => ({ ...e, subtype: 'LIPS' })),
      );
    }

    if (id === 'eye_makeup') {
      const raw = (catalogues.makeup ?? []) as CatalogueEntry[];
      return filterBySearch(
        raw
          .filter((e) => {
            if (e.file.endsWith('_n.dds')) return false;
            const sub = detectSubtype(e);
            if (eyeMakeupFilter === 'EYELINER') return sub === 'EYELINER';
            if (eyeMakeupFilter === 'EYESHADOW') return sub === 'EYESHADOW';
            return sub === 'EYELINER' || sub === 'EYESHADOW';
          })
          .map((e) => ({ ...e, subtype: detectSubtype(e) })),
      );
    }

    if (id === 'blush') {
      const raw = (catalogues.makeup ?? []) as CatalogueEntry[];
      return filterBySearch(
        raw
          .filter((e) => !e.file.endsWith('_n.dds') && detectSubtype(e) === 'BLUSH')
          .map((e) => ({ ...e, subtype: 'BLUSH' })),
      );
    }

    if (id === 'accessory') {
      const raw = (catalogues.tattoo ?? []) as CatalogueEntry[];
      return filterBySearch(raw.filter((e) => !e.file.endsWith('_n.dds')));
    }

    if (id === 'lashes') {
      const raw = (catalogues.lashes ?? []) as CatalogueEntry[];
      return filterBySearch(raw.filter((e) => !e.file.endsWith('_n.dds')));
    }

    return [];
  }, [currentSection, catalogues, manifest, eyeFilter, eyeMakeupFilter, searchQuery]);

  const isItemActive = (item: MakeupItemEntry | null) => {
    if (!currentSection) return false;
    const { id } = currentSection;

    if (item === null) {
      if (id === 'skin_texture') return !selection.skin;
      if (id === 'brows') return !selection.brows;
      if (id === 'pupils') return !selection.eyes;
      if (id === 'lip_makeup') return !activeLipLayer;
      if (id === 'blush') return !activeBlushLayer;
      if (id === 'eye_makeup') {
        if (eyeMakeupFilter === 'EYELINER') return !activeEyelinerLayer;
        if (eyeMakeupFilter === 'EYESHADOW') return !activeEyeshadowLayer;
        return !activeEyelinerLayer && !activeEyeshadowLayer;
      }
      if (id === 'accessory') return !activeTattooLayer;
      if (id === 'lashes') return !selection.lashes;
      return false;
    }

    if (id === 'skin_texture') return selection.skin === item.id;
    if (id === 'brows') return selection.brows === item.id;
    if (id === 'pupils') return selection.eyes === item.id;
    if (id === 'lip_makeup') return activeLipLayer?.id === item.id;
    if (id === 'blush') return activeBlushLayer?.id === item.id;
    if (id === 'eye_makeup') {
      return activeEyelinerLayer?.id === item.id || activeEyeshadowLayer?.id === item.id;
    }
    if (id === 'accessory') return activeTattooLayer?.id === item.id;
    if (id === 'lashes') return selection.lashes === item.id;
    return false;
  };

  /**
   * Restores the clean single-select replacement behavior per category/subtype:
   * swapping a tile replaces that category's active style while preserving custom
   * color, opacity, blend mode and coverage (instead of stacking or resetting).
   */
  const replaceCategoryOverlay = (
    matchesSlot: (layer: OverlayLayer) => boolean,
    nextItem: { kind: 'makeup' | 'tattoo'; id: string } | null,
    prevLayer: OverlayLayer | undefined,
    defaults: { color: string; opacity: number },
    toastMsg: string,
  ) => {
    const remaining = overlayLayers.filter((l) => !matchesSlot(l));
    if (!nextItem) {
      setOverlayLayers(remaining);
      if (prevLayer && activeOverlay === `${prevLayer.kind}:${prevLayer.id}`) {
        setActiveOverlay(null);
      }
      showToast?.(toastMsg);
      return;
    }

    if (prevLayer && prevLayer.id === nextItem.id) {
      setActiveOverlay(`${nextItem.kind}:${nextItem.id}`);
      return;
    }

    const created: OverlayLayer = {
      kind: nextItem.kind,
      id: nextItem.id,
      color: prevLayer?.color ?? defaults.color,
      opacity: prevLayer?.opacity ?? defaults.opacity,
      ...(prevLayer?.blend ? { blend: prevLayer.blend } : {}),
      ...(prevLayer?.coverage !== undefined ? { coverage: prevLayer.coverage } : {}),
    };
    setOverlayLayers([...remaining, created]);
    setActiveOverlay(`${created.kind}:${created.id}`);
    showToast?.(toastMsg);
  };

  const handleSelectItem = (item: MakeupItemEntry | null) => {
    if (!currentSection) return;
    const { id } = currentSection;

    if (item === null) {
      if (id === 'skin_texture') {
        setAssets({ skin: undefined, body: undefined });
        showToast?.('Cleared skin texture');
      } else if (id === 'brows') {
        setAssets({ brows: undefined });
        showToast?.('Cleared eyebrows');
      } else if (id === 'pupils') {
        setAssets({ eyes: undefined });
        showToast?.('Cleared pupil texture');
      } else if (id === 'lip_makeup') {
        replaceCategoryOverlay(
          (l) => l.kind === 'makeup' && getLayerSubtype(l) === 'LIPS',
          null,
          activeLipLayer,
          { color: '#961c28', opacity: 0.75 },
          'Cleared lip makeup',
        );
      } else if (id === 'blush') {
        replaceCategoryOverlay(
          (l) => l.kind === 'makeup' && getLayerSubtype(l) === 'BLUSH',
          null,
          activeBlushLayer,
          { color: '#db6e5e', opacity: 0.6 },
          'Cleared blush',
        );
      } else if (id === 'eye_makeup') {
        const matchesEyeFilter = (l: OverlayLayer) => {
          if (l.kind !== 'makeup') return false;
          const sub = getLayerSubtype(l);
          if (eyeMakeupFilter === 'EYELINER') return sub === 'EYELINER';
          if (eyeMakeupFilter === 'EYESHADOW') return sub === 'EYESHADOW';
          return sub === 'EYELINER' || sub === 'EYESHADOW';
        };
        replaceCategoryOverlay(
          matchesEyeFilter,
          null,
          activeEyeLayer,
          { color: '#1c1c1f', opacity: 0.75 },
          eyeMakeupFilter === 'EYELINER'
            ? 'Cleared eyeliner'
            : eyeMakeupFilter === 'EYESHADOW'
              ? 'Cleared eyeshadow'
              : 'Cleared eye makeup',
        );
      } else if (id === 'accessory') {
        replaceCategoryOverlay(
          (l) => l.kind === 'tattoo',
          null,
          activeTattooLayer,
          { color: '#1a1412', opacity: 0.8 },
          'Cleared warpaint / accessory',
        );
      } else if (id === 'lashes') {
        setAssets({ lashes: undefined });
        showToast?.('Cleared eyelashes');
      }
      return;
    }

    const cleanName =
      id === 'accessory'
        ? tattooLabel(item as CatalogueEntry)
        : id === 'lip_makeup' || id === 'blush' || id === 'eye_makeup'
          ? makeupLabel(item as CatalogueEntry)
          : item.label || item.file || item.id;

    if (id === 'skin_texture') {
      const bodyId = item.id.replace('skin-', 'body-');
      setAssets({ skin: item.id, body: bodyId });
      showToast?.(`Selected ${cleanName}`);
    } else if (id === 'brows') {
      setAssets({ brows: item.id });
      showToast?.(`Selected ${cleanName}`);
    } else if (id === 'pupils') {
      setAssets({ eyes: item.id });
      showToast?.(`Selected ${cleanName}`);
    } else if (id === 'lip_makeup') {
      replaceCategoryOverlay(
        (l) => l.kind === 'makeup' && getLayerSubtype(l) === 'LIPS',
        { kind: 'makeup', id: item.id },
        activeLipLayer,
        { color: '#961c28', opacity: 0.75 },
        `Lip Makeup: ${cleanName}`,
      );
    } else if (id === 'blush') {
      replaceCategoryOverlay(
        (l) => l.kind === 'makeup' && getLayerSubtype(l) === 'BLUSH',
        { kind: 'makeup', id: item.id },
        activeBlushLayer,
        { color: '#db6e5e', opacity: 0.6 },
        `Blush: ${cleanName}`,
      );
    } else if (id === 'eye_makeup') {
      const targetSub: 'EYELINER' | 'EYESHADOW' =
        item.subtype === 'EYELINER' ? 'EYELINER' : 'EYESHADOW';
      const prevSubLayer = targetSub === 'EYELINER' ? activeEyelinerLayer : activeEyeshadowLayer;
      replaceCategoryOverlay(
        (l) => l.kind === 'makeup' && getLayerSubtype(l) === targetSub,
        { kind: 'makeup', id: item.id },
        prevSubLayer,
        { color: targetSub === 'EYELINER' ? '#0c0c0c' : '#541926', opacity: targetSub === 'EYELINER' ? 0.85 : 0.7 },
        `${targetSub === 'EYELINER' ? 'Eyeliner' : 'Eyeshadow'}: ${cleanName}`,
      );
    } else if (id === 'accessory') {
      replaceCategoryOverlay(
        (l) => l.kind === 'tattoo',
        { kind: 'tattoo', id: item.id },
        activeTattooLayer,
        { color: '#1a1412', opacity: 0.8 },
        `Warpaint: ${cleanName}`,
      );
    } else if (id === 'lashes') {
      setAssets({ lashes: item.id });
      showToast?.(`Eyelashes: ${cleanName}`);
    }
  };

  const activeEyeSwatches = useMemo(() => {
    const sub = activeEyeLayer ? getLayerSubtype(activeEyeLayer) : undefined;
    if (sub === 'EYELINER') return BEAUTY_SWATCHES.EYELINER;
    if (sub === 'EYESHADOW') return BEAUTY_SWATCHES.EYESHADOW;
    return [...BEAUTY_SWATCHES.EYELINER.slice(0, 3), ...BEAUTY_SWATCHES.EYESHADOW.slice(0, 5)];
  }, [activeEyeLayer, makeupEntryById]);

  const handleSectionSelect = (id: MakeupSectionId) => {
    setActiveSection(id);
    setSearchQuery('');
  };

  const eyeMeshes = catalogues.eyeMesh ?? [];
  const showItemGrid = currentSection !== null;
  const showSearchInput = showItemGrid && currentSection.id !== 'skin_texture' && categoryItems.length > 8;

  return (
    <div className="flex items-start gap-3 sm:gap-5 select-none text-white">
      <WuxiaSubCategoryRail activeTab="makeup" onSelectTab={() => setActiveSection(null)} />

      <div className="flex flex-col w-[260px] sm:w-[300px] md:w-[330px]">
        {activeSection === null ? (
          /* ── VIEW 1: MAKEUP ROOT MENU ─────────────────────────────── */
          <div className="flex flex-col">
            <h1 className="text-base font-normal tracking-wide text-white mb-3">Makeup</h1>

            <div className="flex flex-col gap-1.5" role="menu" aria-label="Makeup Categories">
              {MAKEUP_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => handleSectionSelect(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73] cursor-pointer min-h-[44px]"
                  role="menuitem"
                >
                  <div className="flex flex-col">
                    <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white">
                      {sec.label}
                    </span>
                    {sec.badge && (
                      <span className="font-mono text-[10px] text-[#75737d] group-hover:text-[#dfba73]/80">
                        {sec.badge}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white"
                    aria-hidden
                  >
                    ›
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── VIEW 2: MAKEUP DRILL-DOWN SUB-SCREEN ─────────────────── */
          <div className="flex flex-col">
            <WuxiaBreadcrumbs
              category="Makeup"
              subCategory={currentSection?.label}
              onBack={() => setActiveSection(null)}
            />

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <WuxiaRibbonPill
                label={currentSection?.label ?? ''}
                icon={
                  <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
                    <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
                  </svg>
                }
              />

              {currentSection?.id === 'skin_texture' ? (
                <button
                  type="button"
                  onClick={() => {
                    setSkinColor('#ffffff');
                    showToast?.('Skin tone restored to authored texture');
                  }}
                  title="Reset skin tone tint to authored texture"
                  className="min-h-[24px] rounded-xs border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[10px] tracking-wider text-[#a49a88] hover:border-[#dfba73] hover:text-[#f0e2ca] transition-colors"
                >
                  ↺ RESET TINT
                </button>
              ) : currentSection?.id === 'brows' ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = !linkBrowToHair;
                    setLinkBrowToHair(next);
                    showToast?.(next ? '✦ Brow color linked to hair' : '✧ Brow color unlinked (Custom)');
                  }}
                  className={cn(
                    'min-h-[24px] rounded-xs border px-2 py-0.5 font-mono text-[10px] tracking-wider transition-colors',
                    linkBrowToHair
                      ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe]'
                      : 'border-white/10 bg-black/40 text-[#a49a88] hover:border-white/30',
                  )}
                >
                  {linkBrowToHair ? '✦ LINKED TO HAIR' : 'CUSTOM COLOR'}
                </button>
              ) : null}
            </div>

            {/* Single compact Sub-Filter Strip */}
            {currentSection?.id === 'pupils' && (
              <div className="mt-2 flex flex-wrap items-center gap-1 border-b border-white/10 pb-1.5 font-mono text-[10px]">
                {(['ALL', 'ZHIZHEN', 'UBE'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setEyeFilter(tab)}
                    className={cn(
                      'min-h-[24px] px-2 py-0.5 rounded-[2px] transition-colors',
                      eyeFilter === tab
                        ? 'bg-[#dfba73]/25 text-[#f2dfbe] font-bold'
                        : 'text-[#8e8c95] hover:text-white',
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}

            {currentSection?.id === 'eye_makeup' && (
              <div className="mt-2 flex items-center gap-1 border-b border-white/10 pb-1.5 font-mono text-[10px]">
                {(['ALL', 'EYELINER', 'EYESHADOW'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setEyeMakeupFilter(tab)}
                    className={cn(
                      'min-h-[24px] px-2 py-0.5 rounded-[2px] transition-colors',
                      eyeMakeupFilter === tab
                        ? 'bg-[#dfba73]/25 text-[#f2dfbe] font-bold'
                        : 'text-[#8e8c95] hover:text-white',
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}

            {/* Compact Search Filter only on large asset grids */}
            {(showSearchInput || searchQuery.length > 0) && (
              <div className="relative mt-2 flex items-center">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${currentSection?.label.toLowerCase()}…`}
                  aria-label={`Search ${currentSection?.label}`}
                  className="min-h-[26px] w-full rounded-[2px] border border-white/10 bg-black/40 px-2.5 pr-7 font-mono text-[10px] text-[#efece6] placeholder:text-[#8e8c95] focus:border-[#dfba73] focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1 flex h-6 w-6 items-center justify-center font-mono text-[11px] text-[#8e8c95] hover:text-white"
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            {/* 4x4 ItemTile Grid (clean breathable height without overlay-chip clutter) */}
            {showItemGrid && (
              <div className="mt-2.5 grid grid-cols-4 gap-2 max-h-[195px] overflow-y-auto scrollbar-none pr-1">
                <ItemTile
                  id="none"
                  title="None"
                  isSelected={isItemActive(null)}
                  onClick={() => handleSelectItem(null)}
                  thumbnail={
                    <div className="flex h-full w-full items-center justify-center text-[#9f9da6] group-hover:text-white transition-colors">
                      <span className="text-xl font-light leading-none">⊘</span>
                    </div>
                  }
                />

                {categoryItems.map((item) => {
                  const isSelected = isItemActive(item);
                  const thumbKind =
                    currentSection?.categoryKind ??
                    (currentSection?.id === 'lashes' ? 'lashes' : 'makeup');
                  const thumbSrc =
                    (item as { thumbnailUrl?: string }).thumbnailUrl ??
                    item.texture ??
                    (item.file?.startsWith('/')
                      ? item.file
                      : convertUrl({ kind: thumbKind, id: item.id, mode: 'thumb' }));

                  const displayTitle =
                    currentSection?.id === 'accessory'
                      ? tattooLabel(item as CatalogueEntry)
                      : currentSection?.id === 'lip_makeup' ||
                          currentSection?.id === 'blush' ||
                          currentSection?.id === 'eye_makeup'
                        ? makeupLabel(item as CatalogueEntry)
                        : item.label || item.file?.replace(/\.dds$/i, '') || item.id;

                  return (
                    <ItemTile
                      key={item.id}
                      id={item.id}
                      title={displayTitle}
                      isSelected={isSelected}
                      onClick={() => handleSelectItem(item)}
                      thumbnail={
                        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] bg-[#1a1b20]">
                          {thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={displayTitle}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : null}
                          <span className="absolute bottom-0.5 inset-x-0.5 truncate text-center font-mono text-[10px] text-white/90 pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                            {displayTitle}
                          </span>
                        </div>
                      }
                    />
                  );
                })}

                {categoryItems.length === 0 && (
                  <div className="col-span-3 flex items-center justify-center rounded border border-dashed border-white/10 p-2 text-center font-mono text-[10px] text-[#8e8c95]">
                    No items in {currentSection?.label}
                  </div>
                )}
              </div>
            )}

            {/* ── DEDICATED CONTROLS & COLOR ENGINES PER SUB-CATEGORY ── */}
            <div
              className={cn(
                'mt-3 flex flex-col gap-2.5 overflow-y-auto scrollbar-none pr-1',
                showItemGrid
                  ? 'border-t border-white/10 pt-2.5 max-h-[calc(100vh-485px)]'
                  : 'max-h-[calc(100vh-240px)]',
              )}
            >
              {currentSection?.id === 'skin_texture' && (
                <div className="flex flex-col gap-2.5">
                  <WuxiaColorSection
                    label="Foundation Tone & Tint"
                    color={skinColor || '#ffffff'}
                    onChange={setSkinColor}
                    swatches={SKIN_PALETTE_SWATCHES}
                    cols={8}
                  />

                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="SKIN GLOSS"
                      value={skinGloss}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setSkinGloss}
                    />
                    <BracketSlider
                      label="SCATTERING (SSS)"
                      value={skinSss}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setSkinSss}
                    />
                    <BracketSlider
                      label="SPECULAR SHEEN"
                      value={skinSheen}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setSkinSheen}
                    />
                    <BracketSlider
                      label="MICRODETAIL PORES"
                      value={skinDetail}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setSkinDetail}
                    />
                    <BracketSlider
                      label="NORMAL MAP DEPTH"
                      value={skinNormalStrength}
                      min={0}
                      max={2.5}
                      step={0.05}
                      onChange={setSkinNormalStrength}
                    />
                    <div className="flex items-center justify-between gap-1.5 pt-1">
                      <span className="font-mono text-[10px] text-[#8e8c94] uppercase tracking-wider">
                        A/B Normal Depth
                      </span>
                      <div className="flex gap-1">
                        {[
                          { val: 0.0, label: 'FLAT (0.0)', title: 'Disable normal map deflection (flat surface)' },
                          { val: 1.0, label: '1.0x (DEFAULT)', title: 'Standard authored 1.0x normal map depth' },
                          { val: 2.0, label: '2.0x (PUNCHY)', title: 'Boosted 2.0x normal map depth (sculpted relief)' },
                        ].map((preset) => {
                          const isActive = Math.abs(skinNormalStrength - preset.val) < 0.01;
                          return (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => setSkinNormalStrength(preset.val)}
                              title={preset.title}
                              className={cn(
                                'px-2 py-0.5 text-[10px] font-mono rounded transition-all min-h-[24px]',
                                isActive
                                  ? 'bg-[#dfba73] text-black font-semibold shadow-sm'
                                  : 'bg-white/5 hover:bg-white/10 text-[#9f9da6] hover:text-white border border-white/10',
                              )}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {currentSection?.id === 'pupils' && eyeMeshes.length > 0 && (
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="shrink-0 text-[#9f9da6]">EYE MESH</span>
                  <select
                    aria-label="Eye Mesh Model"
                    value={selection.eyeMesh ?? ''}
                    onChange={(e) => {
                      const val = e.target.value || undefined;
                      setAssets({ eyeMesh: val });
                      showToast?.(val ? 'Updated eye mesh' : 'Reset to default UBE eye mesh');
                    }}
                    className="min-h-[26px] w-full rounded-[2px] border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] text-[#e8d4af] outline-none focus:border-[#eac87f]"
                  >
                    <option value="" className="bg-[#12100d] text-[#e8d4af]">
                      Default UBE (eyesfemale)
                    </option>
                    {eyeMeshes.map((m) => (
                      <option key={m.id} value={m.id} className="bg-[#12100d] text-[#e8d4af]">
                        {m.label || m.file}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {currentSection?.id === 'brows' && (
                <div className="flex flex-col gap-2.5">
                  {linkBrowToHair ? (
                    <div className="flex items-center justify-between border border-[#eac87f]/25 bg-[#d4b483]/10 px-2 py-1 text-[10px] font-mono text-[#eac87f]">
                      <span>
                        SYNCED WITH HAIR (
                        {hairTone && hairTone.toLowerCase() !== '#ffffff' ? hairTone.toUpperCase() : 'NATURAL'})
                      </span>
                      <span className="text-[#a49a88]">PICK TO CUSTOMIZE</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-mono text-[#a89f91]">
                      <span>CUSTOM BROW COLOR</span>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkBrowToHair(true);
                          showToast?.('✦ Brow color linked to hair');
                        }}
                        className="min-h-[24px] px-1 text-[10px] tracking-wider text-[#eac87f] hover:underline"
                      >
                        [RESET &amp; LINK]
                      </button>
                    </div>
                  )}

                  <WuxiaColorSection
                    label="Brow Color & Finish"
                    color={browColor || '#2b1a0a'}
                    onChange={setBrowColor}
                    swatches={BROW_SWATCHES}
                    cols={8}
                  />

                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="BROW OPACITY"
                      value={browOpacity}
                      min={0.05}
                      max={1}
                      step={0.01}
                      onChange={setBrowOpacity}
                    />
                    <BracketSlider
                      label="BROW GLOSS"
                      value={browGloss}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setBrowGloss}
                    />
                    <BracketSlider
                      label="BROW GLOSSY"
                      value={browGlossy}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setBrowGlossy}
                    />
                  </div>
                </div>
              )}

              {currentSection?.id === 'lip_makeup' && (
                <WuxiaOverlayLayerControls
                  layer={activeLipLayer}
                  layerLabel={activeLipLayer ? getLayerDisplayName(activeLipLayer) : ''}
                  subtypeBadge="LIPS"
                  colorLabel="Lip Color & Finish"
                  opacityLabel="LIP INTENSITY"
                  swatches={BEAUTY_SWATCHES.LIPS}
                  defaultColor="#961c28"
                  showCoverage
                  onColorChange={(hex) => activeLipLayer && setOverlayColor('makeup', activeLipLayer.id, hex)}
                  onOpacityChange={(v) => activeLipLayer && setOverlayOpacity('makeup', activeLipLayer.id, v)}
                  onBlendChange={(b) => activeLipLayer && setOverlayBlend('makeup', activeLipLayer.id, b)}
                  onCoverageChange={(v) => activeLipLayer && setOverlayCoverage('makeup', activeLipLayer.id, v)}
                />
              )}

              {currentSection?.id === 'eye_makeup' && (
                <WuxiaOverlayLayerControls
                  layer={activeEyeLayer}
                  layerLabel={activeEyeLayer ? getLayerDisplayName(activeEyeLayer) : ''}
                  subtypeBadge={activeEyeLayer ? getLayerSubtype(activeEyeLayer) : undefined}
                  colorLabel="Eye Shadow & Liner Tint"
                  opacityLabel="OPACITY"
                  swatches={activeEyeSwatches}
                  defaultColor="#1c1c1f"
                  headerExtra={
                    activeEyelinerLayer && activeEyeshadowLayer ? (
                      <div className="flex items-center gap-0.5 rounded-[2px] border border-white/10 bg-black/50 p-0.5 font-mono text-[10px]">
                        {[
                          { label: 'LINER', layer: activeEyelinerLayer },
                          { label: 'SHADOW', layer: activeEyeshadowLayer },
                        ].map((opt) => {
                          const editing = activeEyeLayer?.id === opt.layer.id;
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => setActiveOverlay(`makeup:${opt.layer.id}`)}
                              className={cn(
                                'min-h-[24px] px-1.5 rounded-[1px] transition-colors',
                                editing
                                  ? 'bg-[#dfba73]/30 text-[#f2dfbe] font-semibold'
                                  : 'text-[#8e8c95] hover:text-white',
                              )}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : undefined
                  }
                  onColorChange={(hex) => activeEyeLayer && setOverlayColor('makeup', activeEyeLayer.id, hex)}
                  onOpacityChange={(v) => activeEyeLayer && setOverlayOpacity('makeup', activeEyeLayer.id, v)}
                  onBlendChange={(b) => activeEyeLayer && setOverlayBlend('makeup', activeEyeLayer.id, b)}
                />
              )}

              {currentSection?.id === 'blush' && (
                <WuxiaOverlayLayerControls
                  layer={activeBlushLayer}
                  layerLabel={activeBlushLayer ? getLayerDisplayName(activeBlushLayer) : ''}
                  subtypeBadge="BLUSH"
                  colorLabel="Cheek Blush Tint"
                  opacityLabel="BLUSH INTENSITY"
                  swatches={BEAUTY_SWATCHES.BLUSH}
                  swatchCols={7}
                  defaultColor="#db6e5e"
                  showCoverage
                  onColorChange={(hex) => activeBlushLayer && setOverlayColor('makeup', activeBlushLayer.id, hex)}
                  onOpacityChange={(v) => activeBlushLayer && setOverlayOpacity('makeup', activeBlushLayer.id, v)}
                  onBlendChange={(b) => activeBlushLayer && setOverlayBlend('makeup', activeBlushLayer.id, b)}
                  onCoverageChange={(v) => activeBlushLayer && setOverlayCoverage('makeup', activeBlushLayer.id, v)}
                />
              )}

              {currentSection?.id === 'accessory' && (
                <WuxiaOverlayLayerControls
                  layer={activeTattooLayer}
                  layerLabel={activeTattooLayer ? getLayerDisplayName(activeTattooLayer) : ''}
                  subtypeBadge="TATTOO"
                  colorLabel="Warpaint & Ink Tint"
                  opacityLabel="INK OPACITY"
                  swatches={TATTOO_INK_SWATCHES}
                  swatchCols={5}
                  defaultColor="#1a1412"
                  onColorChange={(hex) => activeTattooLayer && setOverlayColor('tattoo', activeTattooLayer.id, hex)}
                  onOpacityChange={(v) => activeTattooLayer && setOverlayOpacity('tattoo', activeTattooLayer.id, v)}
                  onBlendChange={(b) => activeTattooLayer && setOverlayBlend('tattoo', activeTattooLayer.id, b)}
                />
              )}

              {currentSection?.id === 'lashes' && (
                <div className="flex flex-col gap-2.5">
                  <WuxiaColorSection
                    label="Lash Tint & Density"
                    color={lashesColor || '#1a1412'}
                    onChange={setLashesColor}
                    swatches={LASH_INK_SWATCHES}
                    cols={6}
                  />
                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="LASH OPACITY"
                      value={lashesOpacity}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setLashesOpacity}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
