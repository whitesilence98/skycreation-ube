'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { navigateCategory } from '@/lib/editorNav';
import { ItemTile } from '@/components/hud/common/ItemTile';
import {
  IconSubFace,
  IconSubMakeup,
  IconSubHair,
} from '@/components/hud/outfit/WuxiaSlotIcons';
import { fetchCatalogue, convertUrl } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { cn } from '@/lib/cn';

export type MakeupSectionId =
  | 'sets'
  | 'foundation'
  | 'brows'
  | 'pupils'
  | 'eye_makeup'
  | 'lip_makeup'
  | 'blush'
  | 'accessory'
  | 'facial_hair';

interface SectionConfig {
  id: MakeupSectionId;
  label: string;
  categoryKind?: string;
}

const MAKEUP_SECTIONS: SectionConfig[] = [
  { id: 'sets', label: 'Sets' },
  { id: 'foundation', label: 'Foundation', categoryKind: 'skin' },
  { id: 'brows', label: 'Eyebrows', categoryKind: 'brows' },
  { id: 'pupils', label: 'Pupils', categoryKind: 'eyes' },
  { id: 'eye_makeup', label: 'Eye Makeup', categoryKind: 'makeup' },
  { id: 'lip_makeup', label: 'Lip Makeup', categoryKind: 'mouth' },
  { id: 'blush', label: 'Blush', categoryKind: 'makeup' },
  { id: 'accessory', label: 'Facial Accessory', categoryKind: 'tattoo' },
  { id: 'facial_hair', label: 'Facial Hair' },
];

const DEFAULT_BROW_SWATCHES = [
  '#0e0d0d',
  '#1b1614',
  '#2a1f18',
  '#3a2b20',
  '#4a3729',
  '#5d4432',
  '#273029',
  '#1a2923',
];

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
}

function PrecisionSlider({ label, value, min, max, onChange }: SliderProps) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-[#9f9da6] text-[11px]">{label}</span>
        <span className="text-white text-[11px] font-medium w-8 text-right">{value}</span>
      </div>
      <div className="relative flex items-center h-6">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ '--pct': `${pct}%` } as React.CSSProperties}
          className="hud-range h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-[#eac87f] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#eac87f] focus-visible:ring-offset-1 focus-visible:ring-offset-black"
          aria-label={label}
        />
      </div>
    </div>
  );
}

export function WuxiaMakeupPanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const [activeSection, setActiveSection] = useState<MakeupSectionId | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');

  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const showToast = useCharacter((s) => s.showToast);

  // Brow-specific character state
  const browColor = useCharacter((s) => s.browColor);
  const setBrowColor = useCharacter((s) => s.setBrowColor);
  const browOpacity = useCharacter((s) => s.browOpacity);
  const setBrowOpacity = useCharacter((s) => s.setBrowOpacity);

  // Local adjustments for sliders matching Image 3 (Color Depth, Up/Down, Spacing, Length)
  const [colorDepth, setColorDepth] = useState(80);
  const [upDown, setUpDown] = useState(25);
  const [spacing, setSpacing] = useState(36);
  const [length, setLength] = useState(0);

  // Load catalogues for brows and eyes when opened
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCatalogue('brows'),
      fetchCatalogue('browsMesh'),
      fetchCatalogue('eyes'),
      fetchCatalogue('skin'),
      fetchCatalogue('makeup'),
      fetchCatalogue('tattoo'),
    ]).then(([brows, browsMesh, eyes, skin, makeup, tattoo]) => {
      if (cancelled) return;
      if (brows.length) setCatalogue('brows', brows);
      if (browsMesh.length) setCatalogue('browsMesh', browsMesh);
      if (eyes.length) setCatalogue('eyes', eyes);
      if (skin.length) setCatalogue('skin', skin);
      if (makeup.length) setCatalogue('makeup', makeup);
      if (tattoo.length) setCatalogue('tattoo', tattoo);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  // Keyboard navigation: Escape key returns from Drill-down to Root Menu
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

  // Retrieve asset items for the active category
  const categoryItems = useMemo(() => {
    if (!currentSection || !currentSection.categoryKind) return [];
    const kind = currentSection.categoryKind;
    const raw = (catalogues[kind as keyof typeof catalogues] ?? []) as CatalogueEntry[];
    return raw.filter((e) => (e.mapRole ?? 'albedo') === 'albedo' && !e.file.endsWith('_n.dds'));
  }, [currentSection, catalogues]);

  const currentSelectedId = useMemo(() => {
    if (!currentSection || !currentSection.categoryKind) return null;
    return selection[currentSection.categoryKind as keyof typeof selection] ?? null;
  }, [currentSection, selection]);

  const handleSelectItem = (item: CatalogueEntry | null) => {
    if (!currentSection?.categoryKind) return;
    const kind = currentSection.categoryKind as keyof typeof selection;
    if (item === null) {
      setAssets({ [kind]: undefined });
      showToast?.(`Cleared ${currentSection.label}`);
    } else {
      setAssets({ [kind]: item.id });
      showToast?.(`Selected ${item.label || item.file}`);
    }
  };

  return (
    <div className="flex items-start gap-5 select-none text-white">
      {/* ─────────────────────────────────────────────────────────────────────────────
          LEFT SUB-CATEGORY RAIL (Customization/Face, Makeup [Active], Hairstyle)
          ───────────────────────────────────────────────────────────────────────────── */}
      <nav
        className="flex w-[72px] shrink-0 flex-col items-center gap-5 pt-1"
        aria-label="Character Customization Sub-categories"
      >
        {/* Customization (Face Sculpt) */}
        <button
          type="button"
          onClick={() => navigateCategory('face')}
          className="group flex flex-col items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          aria-label="Features — Face Sculpting"
          title="Face Features"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#9f9da6] backdrop-blur-md transition-all group-hover:border-white/30 group-hover:text-white">
            <IconSubFace className="h-6 w-6" />
          </span>
          <span className="text-[10px] tracking-tight whitespace-nowrap text-[#9f9da6] transition-colors group-hover:text-white">
            Features
          </span>
        </button>

        {/* Makeup (Active) */}
        <button
          type="button"
          onClick={() => setActiveSection(null)}
          className="group flex flex-col items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          aria-current="page"
          aria-label="Makeup menu"
          title="Makeup menu"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-[2px] bg-white text-black shadow-lg transition-transform group-hover:scale-105">
            <IconSubMakeup className="h-6 w-6" />
          </div>
          <span className="text-[10px] font-medium tracking-tight whitespace-nowrap text-white">
            Makeup
          </span>
        </button>

        {/* Hairstyle */}
        <button
          type="button"
          onClick={() => navigateCategory('hair')}
          className="group flex flex-col items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
          aria-label="Hairstyles"
          title="Hairstyles"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-white/10 bg-[#202126]/80 text-[#9f9da6] backdrop-blur-md transition-all group-hover:border-white/30 group-hover:text-white">
            <IconSubHair className="h-6 w-6" />
          </span>
          <span className="text-[10px] tracking-tight whitespace-nowrap text-[#9f9da6] transition-colors group-hover:text-white">
            Hairstyle
          </span>
        </button>
      </nav>

      {/* ─────────────────────────────────────────────────────────────────────────────
          MAIN CONTENT AREA: Root Menu (Image 2) OR Drill-Down (Image 3)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[300px] md:w-[330px]">
        {activeSection === null ? (
          /* ─────────────────────────────────────────────────────────────────────────────
             VIEW 1: MAKEUP ROOT MENU (Image 2 Match)
             ───────────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            <h1 className="text-base font-normal tracking-wide text-white mb-3">Makeup</h1>

            <div className="flex flex-col gap-1.5" role="menu" aria-label="Makeup Categories">
              {MAKEUP_SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className="group flex h-11 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
                  role="menuitem"
                >
                  <span className="text-xs tracking-wide text-[#d4d3d9] transition-colors group-hover:text-white">
                    {sec.label}
                  </span>
                  <span className="text-sm font-light text-[#75737d] transition-colors group-hover:text-white">
                    ›
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ─────────────────────────────────────────────────────────────────────────────
             VIEW 2: DRILL-DOWN SUB-SCREEN (Image 3 Match)
             ───────────────────────────────────────────────────────────────────────────── */
          <div className="flex flex-col">
            {/* Breadcrumb Header */}
            <nav className="flex items-center gap-1.5 text-xs font-mono" aria-label="Breadcrumb">
              <button
                type="button"
                onClick={() => setActiveSection(null)}
                className="py-1 px-1.5 -ml-1.5 rounded text-[#9f9da6] transition-colors hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#dfba73]"
              >
                Makeup
              </button>
              <span className="text-[#65636d]" aria-hidden>
                ›
              </span>
              <span className="text-white font-medium">{currentSection?.label}</span>
            </nav>

            {/* Sub-Category Brush Ribbon Pill */}
            <div className="mt-2.5 flex items-center">
              <div className="relative inline-flex items-center gap-2 rounded-sm bg-gradient-to-r from-white via-white/95 to-white/80 px-3.5 py-1 text-black shadow-sm">
                <svg viewBox="0 0 24 10" className="h-2.5 w-6 fill-current text-neutral-800" aria-hidden>
                  <path d="M1 8 C6 2 16 1 23 4 C18 5 9 6 1 8 Z" />
                </svg>
                <span className="text-[11px] font-semibold tracking-wide text-neutral-900">
                  {currentSection?.label}
                </span>
              </div>
            </div>

            {/* 4x4 Grid of ItemTiles */}
            <div className="mt-3 grid grid-cols-4 gap-2 max-h-[290px] overflow-y-auto scrollbar-none pr-1">
              {/* Tile #1: None (⊘) */}
              <ItemTile
                id="none"
                title="None"
                isSelected={!currentSelectedId}
                onClick={() => handleSelectItem(null)}
                thumbnail={
                  <div className="flex h-full w-full items-center justify-center text-[#9f9da6] group-hover:text-white transition-colors">
                    <span className="text-xl font-light leading-none">⊘</span>
                  </div>
                }
              />

              {/* Category Asset Tiles */}
              {categoryItems.map((item) => {
                const isSelected = currentSelectedId === item.id;
                const kind = currentSection?.categoryKind ?? 'brows';
                return (
                  <ItemTile
                    key={item.id}
                    id={item.id}
                    title={item.label || item.file}
                    isSelected={isSelected}
                    onClick={() => handleSelectItem(item)}
                    thumbnail={
                      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[2px] bg-[#1a1b20]">
                        {item.id ? (
                          <img
                            src={convertUrl({ kind, id: item.id, mode: 'thumb' })}
                            alt={item.label || item.file}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : null}
                        <span className="absolute bottom-1 px-1 font-mono text-[10px] text-white/70 line-clamp-1 pointer-events-none">
                          {item.label || item.file.replace(/\.dds$/i, '').slice(0, 10)}
                        </span>
                      </div>
                    }
                  />
                );
              })}

              {/* Empty state notice if category has no assets */}
              {categoryItems.length === 0 && (
                <div className="col-span-3 flex items-center justify-center rounded border border-dashed border-white/10 p-2 text-center font-mono text-[10px] text-[#8e8c95]">
                  No items in {currentSection?.label}
                </div>
              )}
            </div>

            {/* Basic / Advanced Tab Switcher */}
            <div className="mt-4 flex items-center justify-center gap-8 border-b border-white/10 pb-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('basic')}
                className={cn(
                  'relative flex items-center gap-1.5 pb-2 font-mono transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#dfba73]',
                  activeTab === 'basic'
                    ? 'text-[#eac87f] font-semibold'
                    : 'text-[#8f8d97] hover:text-white'
                )}
              >
                <span className="text-[10px] text-[#6b6973] font-mono">[L2]</span>
                <span>Basic</span>
                {activeTab === 'basic' && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#eac87f] shadow-[0_0_8px_rgba(234,200,127,0.6)]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('advanced')}
                className={cn(
                  'relative flex items-center gap-1.5 pb-2 font-mono transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#dfba73]',
                  activeTab === 'advanced'
                    ? 'text-[#eac87f] font-semibold'
                    : 'text-[#8f8d97] hover:text-white'
                )}
              >
                <span>Advanced</span>
                <span className="text-[10px] text-[#6b6973] font-mono">[R2]</span>
                {activeTab === 'advanced' && (
                  <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#eac87f] shadow-[0_0_8px_rgba(234,200,127,0.6)]" />
                )}
              </button>
            </div>

            {/* Tab 1: Basic Controls */}
            {activeTab === 'basic' && (
              <div className="flex flex-col gap-3 pt-3">
                {/* 2-Row Color Swatches */}
                <div className="flex flex-col gap-1.5">
                  {/* Row 1: 8 Color Swatches */}
                  <div className="grid grid-cols-8 gap-1">
                    {DEFAULT_BROW_SWATCHES.map((hex) => {
                      const isSelected = browColor.toLowerCase() === hex.toLowerCase();
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => {
                            setBrowColor(hex);
                            showToast?.(`Color: ${hex}`);
                          }}
                          className={cn(
                            'h-6 w-full rounded-[2px] transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]',
                            isSelected
                              ? 'ring-2 ring-white ring-offset-1 ring-offset-black scale-105'
                              : 'border border-white/20 hover:scale-105'
                          )}
                          style={{ backgroundColor: hex }}
                          aria-label={`Color swatch ${hex}`}
                        />
                      );
                    })}
                  </div>

                  {/* Row 2: Selected indicator & Rainbow Custom Picker */}
                  <div className="flex items-center gap-2 pt-0.5">
                    {/* Active Selected Swatch */}
                    <div
                      className="h-6 w-6 rounded-[2px] border-2 border-white shadow-sm flex items-center justify-center"
                      style={{ backgroundColor: browColor }}
                      title={`Active Color: ${browColor}`}
                    />

                    {/* Rainbow Custom Color Swatch with Checkmark */}
                    <button
                      type="button"
                      onClick={() => showToast?.('Custom color palette selected')}
                      className="group relative flex h-6 w-6 items-center justify-center rounded-[2px] bg-gradient-to-tr from-rose-500 via-amber-400 to-sky-500 ring-1 ring-white/40 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]"
                      aria-label="Custom rainbow color palette"
                    >
                      <span className="text-[10px] text-white font-bold drop-shadow">✓</span>
                    </button>
                  </div>
                </div>

                {/* 4 Precision Sliders (Image 3 Match) */}
                <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
                  <PrecisionSlider
                    label="Color Depth"
                    value={colorDepth}
                    min={0}
                    max={100}
                    onChange={(v) => {
                      setColorDepth(v);
                      setBrowOpacity(v / 100);
                    }}
                  />
                  <PrecisionSlider
                    label="Up/Down"
                    value={upDown}
                    min={-50}
                    max={50}
                    onChange={setUpDown}
                  />
                  <PrecisionSlider
                    label="Spacing"
                    value={spacing}
                    min={-50}
                    max={50}
                    onChange={setSpacing}
                  />
                  <PrecisionSlider
                    label="Length"
                    value={length}
                    min={-50}
                    max={50}
                    onChange={setLength}
                  />
                </div>
              </div>
            )}

            {/* Tab 2: Advanced Controls */}
            {activeTab === 'advanced' && (
              <div className="flex flex-col gap-3 pt-3">
                <PrecisionSlider
                  label="Inner Angle"
                  value={0}
                  min={-30}
                  max={30}
                  onChange={() => {}}
                />
                <PrecisionSlider
                  label="Outer Angle"
                  value={0}
                  min={-30}
                  max={30}
                  onChange={() => {}}
                />
                <PrecisionSlider
                  label="Arch Height"
                  value={15}
                  min={-30}
                  max={30}
                  onChange={() => {}}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
