'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCharacter, type OverlayBlend, type OverlayLayer } from '@/lib/store';
import { ItemTile } from '@/components/hud/common/ItemTile';
import { WuxiaSubCategoryRail } from '@/components/hud/common/WuxiaSubCategoryRail';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { fetchCatalogue, convertUrl } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { assetOptions } from '@/lib/manifestSelect';
import { BEAUTY_SWATCHES, detectSubtype } from '@/components/hud/MakeupPicker';
import { SKIN_PALETTE_SWATCHES } from '@/components/hud/SkinProperties';
import { TATTOO_INK_SWATCHES } from '@/components/hud/TattooPicker';
import { LASH_INK_SWATCHES } from '@/components/hud/LashesProperties';
import { cn } from '@/lib/cn';

export type MakeupSectionId =
  | 'skin_texture'
  | 'foundation'
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
  { id: 'skin_texture', label: 'Skin Texture', badge: 'DIFFUSE / PBR', categoryKind: 'skin' },
  { id: 'foundation', label: 'Foundation & Tone', badge: 'COLOR TINT', categoryKind: 'skin' },
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

interface MakeupItemEntry {
  id: string;
  label?: string;
  file?: string;
  texture?: string;
  kind?: string;
  subtype?: string;
}

export function WuxiaMakeupPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const [activeSection, setActiveSection] = useState<MakeupSectionId | null>(null);
  const [eyeFilter, setEyeFilter] = useState<'ALL' | 'ZHIZHEN' | 'UBE'>('ALL');

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
  const linkBrowToHair = useCharacter((s) => s.linkBrowToHair);
  const setLinkBrowToHair = useCharacter((s) => s.setLinkBrowToHair);

  // ── 3. Eyelashes State ─────────────────────────────────────────────
  const lashesColor = useCharacter((s) => s.lashesColor);
  const setLashesColor = useCharacter((s) => s.setLashesColor);
  const lashesOpacity = useCharacter((s) => s.lashesOpacity);
  const setLashesOpacity = useCharacter((s) => s.setLashesOpacity);

  // ── 4. Multi-Layer Makeup & Tattoo Stack ───────────────────────────
  const overlayLayers = useCharacter((s) => s.overlayLayers);
  const toggleOverlay = useCharacter((s) => s.toggleOverlay);
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
      fetchCatalogue('skin'),
      fetchCatalogue('makeup'),
      fetchCatalogue('tattoo'),
      fetchCatalogue('lashes'),
    ]).then(([brows, eyes, skin, makeup, tattoo, lashes]) => {
      if (cancelled) return;
      if (brows.length) setCatalogue('brows', brows);
      if (eyes.length) setCatalogue('eyes', eyes);
      if (skin.length) setCatalogue('skin', skin);
      if (makeup.length) setCatalogue('makeup', makeup);
      if (tattoo.length) setCatalogue('tattoo', tattoo);
      if (lashes.length) setCatalogue('lashes', lashes);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  // Escape key to return to Root Menu
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

  const currentSection = useMemo(() => {
    return MAKEUP_SECTIONS.find((s) => s.id === activeSection) ?? null;
  }, [activeSection]);

  // Find active layers in the stack for each category
  const activeLipLayer = useMemo(() => {
    return overlayLayers.find((l) => l.kind === 'makeup' && l.id.toLowerCase().includes('lip'));
  }, [overlayLayers]);

  const activeBlushLayer = useMemo(() => {
    return overlayLayers.find((l) => l.kind === 'makeup' && l.id.toLowerCase().includes('blush'));
  }, [overlayLayers]);

  const activeEyeLayer = useMemo(() => {
    return overlayLayers.find(
      (l) =>
        l.kind === 'makeup' &&
        (l.id.toLowerCase().includes('eyeliner') || l.id.toLowerCase().includes('eyeshadow')),
    );
  }, [overlayLayers]);

  const activeTattooLayer = useMemo(() => {
    return overlayLayers.find((l) => l.kind === 'tattoo');
  }, [overlayLayers]);

  // Filter items for current sub-category
  const categoryItems = useMemo<MakeupItemEntry[]>(() => {
    if (!currentSection) return [];
    const { id } = currentSection;

    if (id === 'skin_texture' || id === 'foundation') {
      const skins = assetOptions(manifest, 'skin');
      if (skins.length > 0) {
        return skins.map((s) => ({
          id: s.id,
          label: s.label ?? s.id,
          file: s.texture ?? '',
          texture: s.texture,
          kind: 'skin',
        }));
      }
      const raw = (catalogues.skin ?? []) as CatalogueEntry[];
      return raw.filter((e) => !e.file.endsWith('_n.dds') && (e.mapRole ?? 'albedo') === 'albedo');
    }

    if (id === 'brows') {
      const raw = (catalogues.brows ?? []) as CatalogueEntry[];
      return raw.filter((e) => !e.file.endsWith('_n.dds'));
    }

    if (id === 'pupils') {
      const raw = (catalogues.eyes ?? []) as CatalogueEntry[];
      return raw.filter((e) => {
        if (e.file.endsWith('_n.dds') || e.mapRole === 'normal') return false;
        if (eyeFilter === 'ZHIZHEN') return e.file.toLowerCase().includes('zhizhen');
        if (eyeFilter === 'UBE') return e.file.toLowerCase().includes('ube');
        return true;
      });
    }

    if (id === 'lip_makeup') {
      const raw = (catalogues.makeup ?? []) as CatalogueEntry[];
      return raw
        .filter((e) => detectSubtype(e) === 'LIPS')
        .map((e) => ({ ...e, subtype: 'LIPS' }));
    }

    if (id === 'eye_makeup') {
      const raw = (catalogues.makeup ?? []) as CatalogueEntry[];
      return raw
        .filter((e) => {
          const sub = detectSubtype(e);
          return sub === 'EYELINER' || sub === 'EYESHADOW';
        })
        .map((e) => ({ ...e, subtype: detectSubtype(e) }));
    }

    if (id === 'blush') {
      const raw = (catalogues.makeup ?? []) as CatalogueEntry[];
      return raw
        .filter((e) => detectSubtype(e) === 'BLUSH')
        .map((e) => ({ ...e, subtype: 'BLUSH' }));
    }

    if (id === 'accessory') {
      const raw = (catalogues.tattoo ?? []) as CatalogueEntry[];
      return raw.filter((e) => !e.file.endsWith('_n.dds'));
    }

    if (id === 'lashes') {
      const raw = (catalogues.lashes ?? []) as CatalogueEntry[];
      return raw.filter((e) => !e.file.endsWith('_n.dds'));
    }

    return [];
  }, [currentSection, catalogues, manifest, eyeFilter]);

  // Determine which tile is currently selected in View 2
  const isItemActive = (item: MakeupItemEntry | null) => {
    if (!currentSection) return false;
    const { id } = currentSection;

    if (item === null) {
      if (id === 'skin_texture' || id === 'foundation') return !selection.skin;
      if (id === 'brows') return !selection.brows;
      if (id === 'pupils') return !selection.eyes;
      if (id === 'lip_makeup') return !activeLipLayer;
      if (id === 'blush') return !activeBlushLayer;
      if (id === 'eye_makeup') return !activeEyeLayer;
      if (id === 'accessory') return !activeTattooLayer;
      if (id === 'lashes') return !selection.lashes;
      return false;
    }

    if (id === 'skin_texture' || id === 'foundation') return selection.skin === item.id;
    if (id === 'brows') return selection.brows === item.id;
    if (id === 'pupils') return selection.eyes === item.id;
    if (id === 'lip_makeup') return activeLipLayer?.id === item.id;
    if (id === 'blush') return activeBlushLayer?.id === item.id;
    if (id === 'eye_makeup') return activeEyeLayer?.id === item.id;
    if (id === 'accessory') return activeTattooLayer?.id === item.id;
    if (id === 'lashes') return selection.lashes === item.id;
    return false;
  };

  const handleSelectItem = (item: MakeupItemEntry | null) => {
    if (!currentSection) return;
    const { id } = currentSection;

    // ── None (⊘) Clicked ─────────────────────────────────────────────
    if (item === null) {
      if (id === 'skin_texture' || id === 'foundation') {
        setAssets({ skin: undefined, body: undefined });
        showToast?.('Cleared skin texture');
      } else if (id === 'brows') {
        setAssets({ brows: undefined });
        showToast?.('Cleared eyebrows');
      } else if (id === 'pupils') {
        setAssets({ eyes: undefined });
        showToast?.('Cleared pupil texture');
      } else if (id === 'lip_makeup' && activeLipLayer) {
        toggleOverlay(activeLipLayer);
        showToast?.('Cleared lip makeup');
      } else if (id === 'blush' && activeBlushLayer) {
        toggleOverlay(activeBlushLayer);
        showToast?.('Cleared blush');
      } else if (id === 'eye_makeup' && activeEyeLayer) {
        toggleOverlay(activeEyeLayer);
        showToast?.('Cleared eye makeup');
      } else if (id === 'accessory' && activeTattooLayer) {
        toggleOverlay(activeTattooLayer);
        showToast?.('Cleared warpaint / accessory');
      } else if (id === 'lashes') {
        setAssets({ lashes: undefined });
        showToast?.('Cleared eyelashes');
      }
      return;
    }

    // ── Asset / Overlay Selection ────────────────────────────────────
    if (id === 'skin_texture' || id === 'foundation') {
      const bodyId = item.id.replace('skin-', 'body-');
      setAssets({ skin: item.id, body: bodyId });
      showToast?.(`Selected ${item.label || item.id}`);
    } else if (id === 'brows') {
      setAssets({ brows: item.id });
      showToast?.(`Selected ${item.label || item.file}`);
    } else if (id === 'pupils') {
      setAssets({ eyes: item.id });
      showToast?.(`Selected ${item.label || item.file}`);
    } else if (id === 'lip_makeup') {
      if (activeLipLayer) toggleOverlay(activeLipLayer);
      toggleOverlay({
        kind: 'makeup',
        id: item.id,
        color: activeLipLayer?.color ?? '#961c28',
        opacity: activeLipLayer?.opacity ?? 0.75,
      });
      showToast?.(`Lip Makeup: ${item.label || item.file}`);
    } else if (id === 'blush') {
      if (activeBlushLayer) toggleOverlay(activeBlushLayer);
      toggleOverlay({
        kind: 'makeup',
        id: item.id,
        color: activeBlushLayer?.color ?? '#db6e5e',
        opacity: activeBlushLayer?.opacity ?? 0.6,
      });
      showToast?.(`Blush: ${item.label || item.file}`);
    } else if (id === 'eye_makeup') {
      if (activeEyeLayer) toggleOverlay(activeEyeLayer);
      const isLiner = item.subtype === 'EYELINER';
      toggleOverlay({
        kind: 'makeup',
        id: item.id,
        color: activeEyeLayer?.color ?? (isLiner ? '#0c0c0c' : '#541926'),
        opacity: activeEyeLayer?.opacity ?? (isLiner ? 0.85 : 0.7),
      });
      showToast?.(`Eye Makeup: ${item.label || item.file}`);
    } else if (id === 'accessory') {
      if (activeTattooLayer) toggleOverlay(activeTattooLayer);
      toggleOverlay({
        kind: 'tattoo',
        id: item.id,
        color: activeTattooLayer?.color ?? '#1a1412',
        opacity: activeTattooLayer?.opacity ?? 0.8,
      });
      showToast?.(`Warpaint: ${item.label || item.file}`);
    } else if (id === 'lashes') {
      setAssets({ lashes: item.id });
      showToast?.(`Eyelashes: ${item.label || item.file}`);
    }
  };

  return (
    <div className="flex items-start gap-5 select-none text-white">
      {/* Reusable Left Sub-Category Rail */}
      <WuxiaSubCategoryRail activeTab="makeup" onSelectTab={() => setActiveSection(null)} />

      {/* Main Content Area */}
      <div className="flex flex-col w-[300px] md:w-[330px]">
        {activeSection === null ? (
          /* ─────────────────────────────────────────────────────────────────────────
             VIEW 1: MAKEUP ROOT MENU
             ───────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            <h1 className="text-base font-normal tracking-wide text-white mb-3">Makeup</h1>

            <div className="flex flex-col gap-1.5" role="menu" aria-label="Makeup Categories">
              {MAKEUP_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73] cursor-pointer"
                  role="menuitem"
                >
                  <div className="flex flex-col">
                    <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white">
                      {sec.label}
                    </span>
                    {sec.badge && (
                      <span className="font-mono text-[9px] text-[#75737d] group-hover:text-[#dfba73]/80">
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
          /* ─────────────────────────────────────────────────────────────────────────
             VIEW 2: MAKEUP DRILL-DOWN SUB-SCREEN
             ───────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            {/* Breadcrumb Header */}
            <WuxiaBreadcrumbs
              category="Makeup"
              subCategory={currentSection?.label}
              onBack={() => setActiveSection(null)}
            />

            {/* Sub-Category Brush Ribbon Pill */}
            <div className="mt-2.5 flex items-center justify-between">
              <WuxiaRibbonPill
                label={currentSection?.label ?? ''}
                icon={
                  <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
                    <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
                  </svg>
                }
              />

              {/* Quick Reset Button for Current Category */}
              {currentSection?.id === 'skin_texture' || currentSection?.id === 'foundation' ? (
                <button
                  type="button"
                  onClick={() => {
                    setSkinColor('#ffffff');
                    showToast?.('Skin tone restored to authored texture');
                  }}
                  title="Reset skin tone tint to authored texture"
                  className="rounded-xs border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[9px] tracking-wider text-[#a49a88] hover:border-[#dfba73] hover:text-[#f0e2ca] transition-colors"
                >
                  ↺ RESET TINT
                </button>
              ) : currentSection?.id === 'brows' ? (
                <button
                  type="button"
                  onClick={() => {
                    setLinkBrowToHair(!linkBrowToHair);
                    showToast?.(linkBrowToHair ? 'Brows unlinked' : 'Brows linked to hair color');
                  }}
                  className={cn(
                    'rounded-xs border px-2 py-0.5 font-mono text-[9px] tracking-wider transition-colors',
                    linkBrowToHair
                      ? 'border-[#eac87f] bg-[#d4b483]/20 text-[#f2dfbe]'
                      : 'border-white/10 bg-black/40 text-[#a49a88] hover:border-white/30',
                  )}
                >
                  {linkBrowToHair ? '✦ LINKED TO HAIR' : 'LINK TO HAIR'}
                </button>
              ) : null}
            </div>

            {/* Sub-Filters (e.g. Eye Pupils Pack Filter) */}
            {currentSection?.id === 'pupils' && (
              <div className="mt-2 flex items-center gap-1 border-b border-white/10 pb-1.5 font-mono text-[10px]">
                {(['ALL', 'ZHIZHEN', 'UBE'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setEyeFilter(tab)}
                    className={cn(
                      'px-2 py-0.5 rounded-[2px] transition-colors',
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

            {/* 4x4 ItemTile Grid */}
            <div className="mt-2.5 grid grid-cols-4 gap-2 max-h-[195px] overflow-y-auto scrollbar-none pr-1">
              {/* Tile #1: None (⊘) */}
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

              {/* Category Asset Tiles */}
              {categoryItems.map((item) => {
                const isSelected = isItemActive(item);
                const thumbKind =
                  currentSection?.categoryKind ??
                  (currentSection?.id === 'lashes' ? 'lashes' : 'makeup');
                const thumbSrc =
                  item.texture ??
                  (item.file?.startsWith('/')
                    ? item.file
                    : convertUrl({ kind: thumbKind, id: item.id, mode: 'thumb' }));

                return (
                  <ItemTile
                    key={item.id}
                    id={item.id}
                    title={item.label || item.file || item.id}
                    isSelected={isSelected}
                    onClick={() => handleSelectItem(item)}
                    thumbnail={
                      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] bg-[#1a1b20]">
                        {thumbSrc ? (
                          <img
                            src={thumbSrc}
                            alt={item.label || item.file || item.id}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : null}
                        <span className="absolute bottom-0.5 px-0.5 font-mono text-[9px] text-white/80 line-clamp-1 pointer-events-none drop-shadow">
                          {item.label || item.file?.replace(/\.dds$/i, '').slice(0, 10) || item.id}
                        </span>
                      </div>
                    }
                  />
                );
              })}

              {/* Empty Notice if category has no assets */}
              {categoryItems.length === 0 && (
                <div className="col-span-3 flex items-center justify-center rounded border border-dashed border-white/10 p-2 text-center font-mono text-[10px] text-[#8e8c95]">
                  No items in {currentSection?.label}
                </div>
              )}
            </div>

            {/* ─────────────────────────────────────────────────────────────
                DEDICATED CONTROLS & COLOR ENGINES PER SUB-CATEGORY
                ───────────────────────────────────────────────────────────── */}
            <div className="mt-3 flex flex-col gap-2.5 border-t border-white/10 pt-2.5 max-h-[calc(100vh-420px)] overflow-y-auto scrollbar-none pr-1">
              {/* ── 1. Skin Texture & Foundation Controls ────────────── */}
              {(currentSection?.id === 'skin_texture' || currentSection?.id === 'foundation') && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Skin Tone &amp; PBR Shading
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={skinColor || '#ffffff'}
                        onChange={(e) => setSkinColor(e.target.value)}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0"
                        title="Pick custom skin color tint"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {skinColor || '#FFFFFF'}
                      </span>
                    </div>
                  </div>

                  {/* 24 Race Skin Swatches */}
                  <div className="grid grid-cols-8 gap-1">
                    {SKIN_PALETTE_SWATCHES.map((swatch) => {
                      const active = (skinColor || '#ffffff').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => setSkinColor(swatch.hex)}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Physical PBR Shader Sliders */}
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
                      <span className="font-mono text-[10px] text-[#8e8c94] uppercase tracking-wider">A/B Normal Depth</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setSkinNormalStrength(0.0)}
                          title="Disable normal map deflection (flat surface)"
                          className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all min-h-[24px] ${
                            skinNormalStrength === 0
                              ? 'bg-[#dfba73] text-black font-semibold shadow-sm'
                              : 'bg-white/5 hover:bg-white/10 text-[#9f9da6] hover:text-white border border-white/10'
                          }`}
                        >
                          FLAT (0.0)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkinNormalStrength(1.0)}
                          title="Standard authored 1.0x normal map depth"
                          className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all min-h-[24px] ${
                            Math.abs(skinNormalStrength - 1.0) < 0.01
                              ? 'bg-[#dfba73] text-black font-semibold shadow-sm'
                              : 'bg-white/5 hover:bg-white/10 text-[#9f9da6] hover:text-white border border-white/10'
                          }`}
                        >
                          1.0x (DEFAULT)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkinNormalStrength(2.0)}
                          title="Boosted 2.0x normal map depth (sculpted relief)"
                          className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all min-h-[24px] ${
                            Math.abs(skinNormalStrength - 2.0) < 0.01
                              ? 'bg-[#dfba73] text-black font-semibold shadow-sm'
                              : 'bg-white/5 hover:bg-white/10 text-[#9f9da6] hover:text-white border border-white/10'
                          }`}
                        >
                          2.0x (PUNCHY)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 2. Eyebrows Controls ─────────────────────────────── */}
              {currentSection?.id === 'brows' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Brow Color &amp; Finish
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={browColor || '#2b1a0a'}
                        onChange={(e) => setBrowColor(e.target.value)}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {browColor || '#2B1A0A'}
                      </span>
                    </div>
                  </div>

                  {/* Brow Swatches */}
                  <div className="grid grid-cols-8 gap-1">
                    {BROW_SWATCHES.map((swatch) => {
                      const active = (browColor || '#2b1a0a').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => setBrowColor(swatch.hex)}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Brow Sliders */}
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
                  </div>
                </div>
              )}

              {/* ── 3. Lip Makeup Controls ───────────────────────────── */}
              {currentSection?.id === 'lip_makeup' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Lip Color &amp; Finish
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={activeLipLayer?.color ?? '#961c28'}
                        disabled={!activeLipLayer}
                        onChange={(e) => {
                          if (activeLipLayer) setOverlayColor('makeup', activeLipLayer.id, e.target.value);
                        }}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0 disabled:opacity-40"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {activeLipLayer?.color ?? '#961C28'}
                      </span>
                    </div>
                  </div>

                  {/* 8 Curated Lip Swatches */}
                  <div className="grid grid-cols-8 gap-1">
                    {BEAUTY_SWATCHES.LIPS.map((swatch) => {
                      const active = (activeLipLayer?.color ?? '#961c28').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => {
                            if (activeLipLayer) setOverlayColor('makeup', activeLipLayer.id, swatch.hex);
                          }}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Lip Sliders & Blending Mode */}
                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="LIP INTENSITY"
                      value={activeLipLayer?.opacity ?? 0.75}
                      min={0.02}
                      max={1}
                      step={0.01}
                      disabled={!activeLipLayer}
                      onChange={(v) => {
                        if (activeLipLayer) setOverlayOpacity('makeup', activeLipLayer.id, v);
                      }}
                    />

                    <div className="flex items-center justify-between text-[10px] font-mono text-[#b8ab97]">
                      <span>BLEND MODE</span>
                      <select
                        value={activeLipLayer?.blend ?? 'normal'}
                        disabled={!activeLipLayer}
                        onChange={(e) => {
                          if (activeLipLayer) setOverlayBlend('makeup', activeLipLayer.id, e.target.value as OverlayBlend);
                        }}
                        className="rounded-xs border border-white/20 bg-black/60 px-1.5 py-0.5 text-[9.5px] font-mono text-[#e8d4af] outline-none"
                      >
                        {['normal', 'multiply', 'screen', 'overlay'].map((b) => (
                          <option key={b} value={b} className="bg-[#12100d] text-[#e8d4af]">
                            {b.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>

                    <BracketSlider
                      label="LIP COVERAGE"
                      value={activeLipLayer?.coverage ?? 1}
                      min={0.05}
                      max={1}
                      step={0.01}
                      disabled={!activeLipLayer}
                      onChange={(v) => {
                        if (activeLipLayer) setOverlayCoverage('makeup', activeLipLayer.id, v);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* ── 4. Eye Makeup Controls (Liner & Shadow) ──────────── */}
              {currentSection?.id === 'eye_makeup' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Eye Shadow &amp; Liner Tint
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={activeEyeLayer?.color ?? '#1c1c1f'}
                        disabled={!activeEyeLayer}
                        onChange={(e) => {
                          if (activeEyeLayer) setOverlayColor('makeup', activeEyeLayer.id, e.target.value);
                        }}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0 disabled:opacity-40"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {activeEyeLayer?.color ?? '#1C1C1F'}
                      </span>
                    </div>
                  </div>

                  {/* Eye Swatches */}
                  <div className="grid grid-cols-8 gap-1">
                    {[...BEAUTY_SWATCHES.EYELINER.slice(0, 3), ...BEAUTY_SWATCHES.EYESHADOW.slice(0, 5)].map((swatch) => {
                      const active = (activeEyeLayer?.color ?? '#1c1c1f').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => {
                            if (activeEyeLayer) setOverlayColor('makeup', activeEyeLayer.id, swatch.hex);
                          }}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Eye Makeup Sliders */}
                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="OPACITY"
                      value={activeEyeLayer?.opacity ?? 0.75}
                      min={0.02}
                      max={1}
                      step={0.01}
                      disabled={!activeEyeLayer}
                      onChange={(v) => {
                        if (activeEyeLayer) setOverlayOpacity('makeup', activeEyeLayer.id, v);
                      }}
                    />

                    <div className="flex items-center justify-between text-[10px] font-mono text-[#b8ab97]">
                      <span>BLEND MODE</span>
                      <select
                        value={activeEyeLayer?.blend ?? 'normal'}
                        disabled={!activeEyeLayer}
                        onChange={(e) => {
                          if (activeEyeLayer) setOverlayBlend('makeup', activeEyeLayer.id, e.target.value as OverlayBlend);
                        }}
                        className="rounded-xs border border-white/20 bg-black/60 px-1.5 py-0.5 text-[9.5px] font-mono text-[#e8d4af] outline-none"
                      >
                        {['normal', 'multiply', 'screen', 'overlay'].map((b) => (
                          <option key={b} value={b} className="bg-[#12100d] text-[#e8d4af]">
                            {b.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 5. Blush Controls ────────────────────────────────── */}
              {currentSection?.id === 'blush' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Cheek Blush Tint
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={activeBlushLayer?.color ?? '#db6e5e'}
                        disabled={!activeBlushLayer}
                        onChange={(e) => {
                          if (activeBlushLayer) setOverlayColor('makeup', activeBlushLayer.id, e.target.value);
                        }}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0 disabled:opacity-40"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {activeBlushLayer?.color ?? '#DB6E5E'}
                      </span>
                    </div>
                  </div>

                  {/* Blush Swatches */}
                  <div className="grid grid-cols-7 gap-1">
                    {BEAUTY_SWATCHES.BLUSH.map((swatch) => {
                      const active = (activeBlushLayer?.color ?? '#db6e5e').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => {
                            if (activeBlushLayer) setOverlayColor('makeup', activeBlushLayer.id, swatch.hex);
                          }}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Blush Sliders */}
                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="BLUSH INTENSITY"
                      value={activeBlushLayer?.opacity ?? 0.6}
                      min={0.02}
                      max={1}
                      step={0.01}
                      disabled={!activeBlushLayer}
                      onChange={(v) => {
                        if (activeBlushLayer) setOverlayOpacity('makeup', activeBlushLayer.id, v);
                      }}
                    />
                    <BracketSlider
                      label="SPREAD / COVERAGE"
                      value={activeBlushLayer?.coverage ?? 1}
                      min={0.05}
                      max={1}
                      step={0.01}
                      disabled={!activeBlushLayer}
                      onChange={(v) => {
                        if (activeBlushLayer) setOverlayCoverage('makeup', activeBlushLayer.id, v);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* ── 6. Facial Accessory / Warpaint Controls ──────────── */}
              {currentSection?.id === 'accessory' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Warpaint &amp; Ink Tint
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={activeTattooLayer?.color ?? '#1a1412'}
                        disabled={!activeTattooLayer}
                        onChange={(e) => {
                          if (activeTattooLayer) setOverlayColor('tattoo', activeTattooLayer.id, e.target.value);
                        }}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0 disabled:opacity-40"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {activeTattooLayer?.color ?? '#1A1412'}
                      </span>
                    </div>
                  </div>

                  {/* Warpaint Swatches */}
                  <div className="grid grid-cols-5 gap-1">
                    {TATTOO_INK_SWATCHES.map((swatch) => {
                      const active = (activeTattooLayer?.color ?? '#1a1412').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => {
                            if (activeTattooLayer) setOverlayColor('tattoo', activeTattooLayer.id, swatch.hex);
                          }}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Warpaint Sliders */}
                  <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                    <BracketSlider
                      label="INK OPACITY"
                      value={activeTattooLayer?.opacity ?? 0.8}
                      min={0.02}
                      max={1}
                      step={0.01}
                      disabled={!activeTattooLayer}
                      onChange={(v) => {
                        if (activeTattooLayer) setOverlayOpacity('tattoo', activeTattooLayer.id, v);
                      }}
                    />

                    <div className="flex items-center justify-between text-[10px] font-mono text-[#b8ab97]">
                      <span>BLEND MODE</span>
                      <select
                        value={activeTattooLayer?.blend ?? 'normal'}
                        disabled={!activeTattooLayer}
                        onChange={(e) => {
                          if (activeTattooLayer) setOverlayBlend('tattoo', activeTattooLayer.id, e.target.value as OverlayBlend);
                        }}
                        className="rounded-xs border border-white/20 bg-black/60 px-1.5 py-0.5 text-[9.5px] font-mono text-[#e8d4af] outline-none"
                      >
                        {['normal', 'multiply', 'screen', 'overlay'].map((b) => (
                          <option key={b} value={b} className="bg-[#12100d] text-[#e8d4af]">
                            {b.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 7. Eyelashes Controls ────────────────────────────── */}
              {currentSection?.id === 'lashes' && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1">
                    <span className="font-mono text-[10px] text-[#9f9da6] uppercase tracking-wider">
                      Lash Tint &amp; Density
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={lashesColor || '#1a1412'}
                        onChange={(e) => setLashesColor(e.target.value)}
                        className="h-4 w-6 cursor-pointer rounded-xs border border-white/30 bg-transparent p-0"
                      />
                      <span className="font-mono text-[9.5px] text-[#dfba73] uppercase">
                        {lashesColor || '#1A1412'}
                      </span>
                    </div>
                  </div>

                  {/* Lash Swatches */}
                  <div className="grid grid-cols-6 gap-1">
                    {LASH_INK_SWATCHES.map((swatch) => {
                      const active = (lashesColor || '#1a1412').toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.name}
                          type="button"
                          onClick={() => setLashesColor(swatch.hex)}
                          title={`${swatch.name} (${swatch.hex})`}
                          className={cn(
                            'h-5 w-full rounded-[1px] border transition-transform hover:scale-105',
                            active
                              ? 'border-[#f0dfbe] ring-1 ring-[#eac87f] scale-105'
                              : 'border-white/15',
                          )}
                          style={{ backgroundColor: swatch.hex }}
                        />
                      );
                    })}
                  </div>

                  {/* Lash Sliders */}
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
