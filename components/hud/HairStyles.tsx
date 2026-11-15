'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { assetOptions, isRenderableMeshRow } from '@/lib/manifestSelect';
import { convertUrl, fetchCatalogue } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import { cn } from '@/lib/cn';
import { buildHairGroups, findHairGroupForPartId, type HairBrand, type HairGroup } from '@/lib/hair';

/** Below this, the shipped head hides the mesh — see `visibility`. */
const VISIBLE_MIN = 0.55;

type HairCategoryFilter = 'ALL' | 'HAIR' | 'HL';
type HairBrandFilter = 'ALL' | 'BDOR' | 'KSHAIR' | 'OTHER';

const HAIR_PALETTE = [
  { name: 'Raven Black', hex: '#110e0c' },
  { name: 'Espresso', hex: '#1c1512' },
  { name: 'Dark Chestnut', hex: '#2b1d16' },
  { name: 'Mocha Brown', hex: '#3d281e' },
  { name: 'Warm Chocolate', hex: '#523829' },
  { name: 'Auburn Bronze', hex: '#633722' },
  { name: 'Deep Copper', hex: '#7b3d22' },
  { name: 'Spiced Rust', hex: '#8c482c' },
  { name: 'Caramel Amber', hex: '#9e673a' },
  { name: 'Honey Blonde', hex: '#b5834f' },
  { name: 'Golden Wheat', hex: '#cca368' },
  { name: 'Ash Blonde', hex: '#a6977e' },
  { name: 'Platinum Ice', hex: '#d9d0c1' },
  { name: 'Silver Frost', hex: '#9ea2a6' },
  { name: 'Charcoal Grey', hex: '#403d3c' },
  { name: 'Natural White', hex: '#eae7e1' },
];

export function HairStyles({ manifest }: { manifest: Mo2Manifest | null }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const hair = useCharacter((s) => s.hair);
  const setHair = useCharacter((s) => s.setHair);

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<HairCategoryFilter>('ALL');
  const [brandFilter, setBrandFilter] = useState<HairBrandFilter>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCatalogue('hairMesh'), fetchCatalogue('hair')]).then(([meshes, textures]) => {
      if (cancelled) return;
      setCatalogue('hairMesh', meshes);
      setCatalogue('hair', textures);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  const curated = assetOptions(manifest, 'hairMesh');
  const archive = catalogues.hairMesh ?? [];

  const visible = (e: { visibility?: number }) =>
    e.visibility === undefined || e.visibility >= VISIBLE_MIN;

  const rawOptions = useMemo(() => {
    return [
      ...curated.map((m) => ({
        ...m,
        pairedTextureId:
          m.pairedTextureId ?? archive.find((e) => e.rel === m.rel)?.pairedTextureId,
      })),
      ...archive.filter(
        (m) => isRenderableMeshRow(m) && visible(m) && !curated.some((c) => c.rel === m.rel),
      ),
    ];
  }, [curated, archive]);

  // Group raw fragmented NIF files into consolidated multi-part hairstyles
  const hairGroups = useMemo(() => {
    return buildHairGroups(rawOptions);
  }, [rawOptions]);

  const totalCount = hairGroups.length;
  const hairCount = useMemo(() => hairGroups.filter((g) => !g.isHL).length, [hairGroups]);
  const hlCount = useMemo(() => hairGroups.filter((g) => g.isHL).length, [hairGroups]);

  const bdorCount = useMemo(() => hairGroups.filter((g) => g.brand === 'BDOR').length, [hairGroups]);
  const ksCount = useMemo(() => hairGroups.filter((g) => g.brand === 'KSHAIR').length, [hairGroups]);
  const otherCount = useMemo(() => hairGroups.filter((g) => g.brand === 'OTHER').length, [hairGroups]);

  const filtered = useMemo(() => {
    return hairGroups.filter((g) => {
      if (categoryFilter === 'HAIR' && g.isHL) return false;
      if (categoryFilter === 'HL' && !g.isHL) return false;

      if (brandFilter === 'BDOR' && g.brand !== 'BDOR') return false;
      if (brandFilter === 'KSHAIR' && g.brand !== 'KSHAIR') return false;
      if (brandFilter === 'OTHER' && g.brand !== 'OTHER') return false;

      if (!query.trim()) return true;
      const q = query.toLowerCase().trim();
      return (
        g.label.toLowerCase().includes(q) ||
        g.groupKey.toLowerCase().includes(q) ||
        (g.mod && g.mod.toLowerCase().includes(q)) ||
        g.parts.some((p) => p.label.toLowerCase().includes(q))
      );
    });
  }, [hairGroups, categoryFilter, brandFilter, query]);

  const activeGroup = useMemo(() => {
    return findHairGroupForPartId(hairGroups, selection.hairMesh) ?? hairGroups[0];
  }, [hairGroups, selection.hairMesh]);

  const selectedGroupId = activeGroup?.id;
  const activeLabel = activeGroup ? activeGroup.label : 'Default Hair';

  const activeColor = HAIR_PALETTE.find((c) => c.hex.toLowerCase() === hair.tone.toLowerCase());
  const currentColorName = hair.tone === '#ffffff' ? 'Original Atlas' : activeColor?.name || hair.tone.toUpperCase();

  const [hexInput, setHexInput] = useState(hair.tone);
  useEffect(() => {
    setHexInput(hair.tone);
  }, [hair.tone]);

  const glossPercent = Math.round(hair.gloss * 100);
  const glossLabel = glossPercent < 25 ? 'Matte' : glossPercent < 55 ? 'Natural' : glossPercent < 80 ? 'Glossy' : 'High Shine';

  const hairAlpha = hair.alpha !== undefined ? hair.alpha : 1.0;
  const alphaPercent = Math.round(hairAlpha * 100);
  const alphaLabel =
    alphaPercent >= 98
      ? 'Opaque'
      : alphaPercent >= 70
        ? 'Subtle Strand'
        : alphaPercent >= 35
          ? 'Translucent'
          : 'Phantom';

  return (
    <div className="relative flex w-full flex-col select-none">
      <div className="flex flex-col gap-3 rounded-xs border border-[#d4b483]/22 bg-black/45 p-3.5 backdrop-blur-md">
        {/* Top Header: HAIR & STYLE */}
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-[#efece6] uppercase">
          HAIR &amp; STYLE
        </h2>

        {/* ── 1. HAIRSTYLES SELECTOR ─────────────────────────────────── */}
        <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
              HAIRSTYLE
            </span>
            <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
              {loading ? 'LOADING…' : `${hairGroups.length} STYLES (${filtered.length} SHOWN)`}
            </span>
          </div>

          {/* Row 1: Category Filter (ALL / HAIR / HAIRLINE) */}
          <div className="flex items-stretch border border-[#d4b483]/22 bg-black/40 text-[9.5px] tracking-[0.08em]">
            <button
              type="button"
              onClick={() => setCategoryFilter('ALL')}
              className={cn(
                'flex-1 py-[3px] text-center transition-colors',
                categoryFilter === 'ALL'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              ALL ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('HAIR')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                categoryFilter === 'HAIR'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              HAIR ({hairCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('HL')}
              className={cn(
                'flex-1 border-l border-[#d4b483]/22 py-[3px] text-center transition-colors',
                categoryFilter === 'HL'
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
              )}
            >
              HAIRLINE ({hlCount})
            </button>
          </div>

          {/* Row 2: Sub-brand Segmented Filters */}
          <div className="flex items-stretch border border-[#d4b483]/16 bg-black/30 text-[9px] tracking-[0.06em]">
            <button
              type="button"
              onClick={() => setBrandFilter('ALL')}
              className={cn(
                'flex-1 py-[2px] text-center transition-colors',
                brandFilter === 'ALL'
                  ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
              )}
            >
              ALL
            </button>
            {bdorCount > 0 && (
              <button
                type="button"
                onClick={() => setBrandFilter('BDOR')}
                className={cn(
                  'flex-1 border-l border-[#d4b483]/16 py-[2px] text-center transition-colors',
                  brandFilter === 'BDOR'
                    ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                    : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
                )}
              >
                BDOR ({bdorCount})
              </button>
            )}
            {ksCount > 0 && (
              <button
                type="button"
                onClick={() => setBrandFilter('KSHAIR')}
                className={cn(
                  'flex-1 border-l border-[#d4b483]/16 py-[2px] text-center transition-colors',
                  brandFilter === 'KSHAIR'
                    ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                    : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
                )}
              >
                KS HAIR ({ksCount})
              </button>
            )}
            {otherCount > 0 && (
              <button
                type="button"
                onClick={() => setBrandFilter('OTHER')}
                className={cn(
                  'flex-1 border-l border-[#d4b483]/16 py-[2px] text-center transition-colors',
                  brandFilter === 'OTHER'
                    ? 'bg-[#d4b483]/16 font-medium text-[#f0dfbe]'
                    : 'text-[#8f8778]/60 hover:text-[#c4b9a3]',
                )}
              >
                UBE ({otherCount})
              </button>
            )}
          </div>

          {/* Search Input with Clear Button */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hairstyles…"
              aria-label="Search hairstyles"
              className="w-full border border-[#d4b483]/26 bg-black/48 px-[7px] py-[3px] text-[10px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[10px] text-[#8f8778] hover:text-[#e2d8c6]"
              >
                ×
              </button>
            )}
          </div>

          {/* Hairstyle Grid */}
          <div className="thin-scroll grid max-h-[190px] grid-cols-4 gap-[6px] overflow-y-auto pr-[2px]">
            {filtered.map((g, i) => {
              const isSelected = selectedGroupId === g.id;
              const rep = g.representative;
              const isUnt = rep.untextured === true;

              return (
                <button
                  key={g.id}
                  type="button"
                  aria-label={`${g.label} — ${g.mod || g.brand}${g.partCount > 1 ? ` (${g.partCount} Parts)` : ''}`}
                  aria-pressed={isSelected}
                  title={`${g.label}\nBrand: ${g.brand}\nParts: ${g.partCount} (${g.parts.map((p) => p.label).join(', ')})\nMod: ${g.mod || 'preset-pack'}${isUnt ? '\nNo atlas — drawn flat grey' : ''}`}
                  onClick={() =>
                    setAssets({
                      hairMesh: g.id,
                      ...(g.pairedTextureId ? { hair: g.pairedTextureId } : {}),
                    })
                  }
                  className="group relative flex min-w-0 flex-col items-center text-left"
                >
                  <span
                    className={cn(
                      'relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden border p-[2px] transition-all duration-200',
                      isSelected
                        ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_10px_rgba(234,200,127,0.45)]'
                        : 'border-[#d4b483]/25 bg-[#0b0a08]/80 group-hover:border-[#d4b483]/60 group-hover:bg-[#16120e]',
                    )}
                  >
                    {/* Multi-part count badge */}
                    {g.partCount > 1 && (
                      <span className="pointer-events-none absolute top-[2px] right-[2px] z-10 rounded-[1px] border border-[#eac87f]/50 bg-black/80 px-[3px] py-[0.5px] font-mono text-[7px] font-medium tracking-tight text-[#f2dfbe] shadow-xs">
                        {g.partCount}P
                      </span>
                    )}

                    {/* Hairline variant badge */}
                    {g.isHL && (
                      <span className="pointer-events-none absolute top-[2px] left-[2px] z-10 rounded-[1px] border border-[#7fb0ea]/50 bg-black/80 px-[3px] py-[0.5px] font-mono text-[7px] font-medium tracking-tight text-[#bfdbfe] shadow-xs">
                        HL
                      </span>
                    )}

                    {g.pairedTextureId ? (
                      <img
                        src={convertUrl({ kind: 'hair', id: g.pairedTextureId, mode: 'thumb' })}
                        alt=""
                        loading="lazy"
                        className={cn(
                          'h-full w-full object-cover transition-transform duration-200 group-hover:scale-105',
                          isSelected ? 'opacity-100' : 'opacity-85 group-hover:opacity-100',
                        )}
                      />
                    ) : (
                      <span
                        className={cn(
                          'text-[8px] tracking-[0.06em] text-center px-0.5 font-mono uppercase',
                          isUnt ? 'text-[#c9b184]/80' : 'text-[#b6ad9c]/60',
                        )}
                      >
                        {isUnt ? 'NO ATLAS' : 'MESH'}
                      </span>
                    )}

                    <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[8px] font-mono tracking-tight text-[#eadcc0]/75">
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    {isSelected && (
                      <span className="pointer-events-none absolute -top-[1px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_rgba(242,223,190,0.9)]" />
                    )}
                  </span>

                  <span
                    className={cn(
                      'mt-[2px] w-full truncate text-center text-[9px] tracking-[0.04em] transition-colors',
                      isSelected
                        ? 'font-medium text-[#f0e2ca]'
                        : 'text-[#a9a192]/70 group-hover:text-[#d5ccbb]',
                    )}
                  >
                    {g.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active selection footer */}
          <div className="flex items-center justify-between px-1 text-[9px] font-mono tracking-tight text-[#8f8778]">
            <span className="truncate max-w-[200px] text-[#e2d8c6]">
              [{activeLabel}]
            </span>
            <span className="shrink-0 text-[#c4b595]">
              {activeGroup ? `${activeGroup.partCount} ${activeGroup.partCount === 1 ? 'Part' : 'Parts'}` : ''}
              {activeGroup?.isHL ? ' • HL' : ''}
            </span>
          </div>
        </div>

        {/* ── 2. HAIR COLOR & PALETTE ─────────────────────────────────── */}
        <div className="flex flex-col items-center gap-1.5 border-t border-[#d4b483]/18 pt-2">
          <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
            HAIR COLOR
          </span>

          <div className="flex w-full items-center justify-center gap-2.5">
            {/* Color Swatch Preview & Native Color Picker Trigger */}
            <label
              className="group/picker relative aspect-square w-[46px] shrink-0 cursor-pointer overflow-hidden rounded-xs border border-[#d4b483]/50 shadow-[0_0_8px_rgba(0,0,0,0.6)] transition-all hover:border-[#eac87f]"
              title="Click to open custom color picker"
              style={{ backgroundColor: hair.tone || '#171310' }}
            >
              <input
                type="color"
                value={hair.tone && /^#[0-9a-f]{6}$/i.test(hair.tone) ? hair.tone : '#171310'}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase();
                  setHair({ tone: val });
                  setHexInput(val);
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Custom hair color picker"
              />
              <span className="pointer-events-none absolute inset-0 rounded-xs border border-white/20" />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/picker:opacity-100">
                <svg className="h-3.5 w-3.5 text-[#f0e6d4]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                </svg>
              </span>
            </label>

            {/* 2×8 Palette Grid */}
            <div className="grid grid-cols-8 gap-[2.5px]">
              {HAIR_PALETTE.map((swatch) => {
                const isSelected = hair.tone.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => {
                      setHair({ tone: swatch.hex });
                      setHexInput(swatch.hex);
                    }}
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

          <div className="flex items-center justify-between w-full px-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] font-mono tracking-tight text-[#8f8778]">
                [{currentColorName}]
              </span>
              <div className="flex items-center border border-[#d4b483]/28 bg-black/55 px-1 py-[1px]">
                <span className="text-[8.5px] font-mono text-[#8f8778] mr-0.5">#</span>
                <input
                  type="text"
                  value={hexInput.replace(/^#/, '')}
                  onChange={(e) => {
                    const raw = e.target.value.trim().replace(/^#/, '');
                    const val = `#${raw}`;
                    setHexInput(val);
                    if (/^#[0-9a-f]{6}$/i.test(val)) {
                      setHair({ tone: val.toLowerCase() });
                    }
                  }}
                  onBlur={() => {
                    if (!/^#[0-9a-f]{6}$/i.test(hexInput)) {
                      setHexInput(hair.tone);
                    }
                  }}
                  maxLength={6}
                  placeholder="RRGGBB"
                  aria-label="Hex color code"
                  className="w-[48px] bg-transparent text-[9px] font-mono uppercase text-[#e2d8c6] placeholder-[#8f8778]/50 outline-none"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setHair({ tone: '#ffffff' });
                setHexInput('#ffffff');
              }}
              className={cn(
                'border px-1.5 py-0.5 text-[9px] font-mono tracking-wider transition-colors',
                hair.tone === '#ffffff'
                  ? 'border-[#d4b483] bg-[#d4b483]/15 text-[#f0e6d4]'
                  : 'border-[#d4b483]/30 text-[#8f8778] hover:border-[#d4b483]/60 hover:text-[#d8c9ad]',
              )}
            >
              [ORIGINAL]
            </button>
          </div>
        </div>

        {/* ── 3. HAIR TRANSPARENCY / ALPHA SLIDER ───────────────────── */}
        <div className="flex flex-col gap-1 border-t border-[#d4b483]/18 pt-2">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.08em]">
            <span className="text-[#c4b595] uppercase">HAIR OPACITY / ALPHA</span>
            <div className="flex items-center gap-1.5 text-[#8f8778]">
              <span className="text-[#d8c39c]">[{alphaPercent}%]</span>
              <span>[{alphaLabel}]</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={hairAlpha}
            onChange={(e) => setHair({ alpha: parseFloat(e.target.value) })}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#d4b483]"
            aria-label="Hair transparency / opacity slider"
          />
        </div>

        {/* ── 4. HAIR GLOSS SLIDER ───────────────────────────────────── */}
        <div className="flex flex-col gap-1 border-t border-[#d4b483]/18 pt-2">
          <div className="flex items-center justify-between text-[10px] font-mono tracking-[0.08em]">
            <span className="text-[#c4b595] uppercase">HAIR GLOSS</span>
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
            value={hair.gloss}
            onChange={(e) => setHair({ gloss: parseFloat(e.target.value) })}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#201d18] accent-[#d4b483]"
            aria-label="Hair gloss slider"
          />
        </div>

        {/* Decorative curve arc at the bottom */}
        <div className="flex justify-center pt-1">
          <svg className="h-5 w-14 text-[#d4b483]/30" viewBox="0 0 100 40" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M 10 38 Q 50 5 90 38" />
            <path d="M 50 5 L 50 0" />
          </svg>
        </div>
      </div>
    </div>
  );
}
