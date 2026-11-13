'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacter, type OverlayLayer } from '@/lib/store';
import { convertUrl, fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { cn } from '@/lib/cn';
import { IconCheck, IconEye, IconSparkle } from '@/components/hud/Icons';

const CATEGORIES = ['ALL', 'LIPS', 'BLUSH', 'EYELINER', 'EYESHADOW', 'OVERLAYS'] as const;
export type MakeupCategory = (typeof CATEGORIES)[number];

export const BEAUTY_SWATCHES: Record<Exclude<MakeupCategory, 'ALL'>, Array<{ name: string; hex: string }>> = {
  LIPS: [
    { name: 'Classic Red', hex: '#961c28' }, { name: 'Wine Berry', hex: '#5c1626' },
    { name: 'Soft Rose', hex: '#bd4f6c' }, { name: 'Nude Blush', hex: '#ab6b60' },
    { name: 'Coral', hex: '#cc584b' }, { name: 'Peach Nude', hex: '#d18475' },
    { name: 'Deep Plum', hex: '#421927' }, { name: 'Ruby Glow', hex: '#781422' },
  ],
  BLUSH: [
    { name: 'Soft Pink', hex: '#e0798a' }, { name: 'Rosy Peach', hex: '#db6e5e' },
    { name: 'Sweet Petal', hex: '#e69199' }, { name: 'Sun-kissed', hex: '#b85f4b' },
    { name: 'Warm Coral', hex: '#cf6353' }, { name: 'Deep Rose', hex: '#9c3b4d' },
    { name: 'Plum Blush', hex: '#8a424e' },
  ],
  EYELINER: [
    { name: 'Jet Black', hex: '#0c0c0c' }, { name: 'Charcoal', hex: '#242426' },
    { name: 'Espresso', hex: '#2b1d18' }, { name: 'Deep Plum', hex: '#301625' },
    { name: 'Smudge Brown', hex: '#3d2b24' }, { name: 'Midnight', hex: '#161d28' },
  ],
  EYESHADOW: [
    { name: 'Smoky Night', hex: '#1c1c1f' }, { name: 'Dark Taupe', hex: '#4a3f3a' },
    { name: 'Warm Bronze', hex: '#85523a' }, { name: 'Rose Gold', hex: '#b37478' },
    { name: 'Golden Glow', hex: '#b88a44' }, { name: 'Burgundy', hex: '#541926' },
    { name: 'Mauve Shimmer', hex: '#6b4c5e' }, { name: 'Soft Champagne', hex: '#c9b7ad' },
  ],
  OVERLAYS: [
    { name: 'Rose Glow', hex: '#b34d65' }, { name: 'Warm Sunset', hex: '#b85f4b' },
    { name: 'Smoky Glam', hex: '#262426' }, { name: 'Bronze', hex: '#6e4c3b' },
    { name: 'Berry Wine', hex: '#5e1e2d' }, { name: 'Soft Natural', hex: '#ab6f67' },
  ],
};

export function detectSubtype(entry: CatalogueEntry): Exclude<MakeupCategory, 'ALL'> {
  const rel = (entry.rel || entry.file || '').toLowerCase();
  if (rel.includes('lip')) return 'LIPS';
  if (rel.includes('blush')) return 'BLUSH';
  if (rel.includes('eyeliner')) return 'EYELINER';
  if (rel.includes('eyeshadow')) return 'EYESHADOW';
  return 'OVERLAYS';
}

export function makeupLabel(entry: CatalogueEntry): string {
  return (entry.label || entry.file).replace(/\.dds$/i, '').replace(/^SDZ21\s*/i, '')
    .replace(/\bUBE(?:\s*[- ]?\s*4K)?\b/gi, '').replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

function defaultColor(subtype: MakeupCategory): string {
  return subtype === 'BLUSH' ? '#db6e5e' : subtype === 'EYELINER' ? '#111111'
    : subtype === 'EYESHADOW' ? '#33221c' : '#961c28';
}

const focus = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]';

function MakeupSwatch({ entry, color }: { entry: CatalogueEntry; color: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const src = convertUrl({ kind: 'makeup', id: entry.id, mode: 'alpha' });
  return (
    <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border border-[#d4b483]/20 bg-[radial-gradient(ellipse_at_center,#4a3f32_0%,#221d17_62%,#0f0d0b_100%)] p-[3px] transition-transform duration-200 group-hover:scale-105">
      {/* Lazy image gates the CSS mask; otherwise CSS fetches all masks at once. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full opacity-0"
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
      {status === 'ready' ? (
        <span
          className="absolute inset-[3px] rounded-full transition-transform duration-200 group-hover:scale-105"
          style={{
            backgroundColor: color,
            maskImage: `url("${src}")`,
            maskSize: 'contain',
            maskPosition: 'center',
            maskRepeat: 'no-repeat',
            WebkitMaskImage: `url("${src}")`,
            WebkitMaskSize: 'contain',
            WebkitMaskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
          }}
        />
      ) : (
        <span className="text-[9px] tracking-[0.06em] text-[#dacbad]/50">
          {status === 'error' ? 'NO MASK' : '…'}
        </span>
      )}
    </span>
  );
}

export function MakeupPicker({ onDirty }: { onDirty?: () => void }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const overlayLayers = useCharacter((s) => s.overlayLayers);
  const toggleOverlay = useCharacter((s) => s.toggleOverlay);
  const setOverlayOpacity = useCharacter((s) => s.setOverlayOpacity);
  const clearOverlays = useCharacter((s) => s.clearOverlays);
  const activeOverlay = useCharacter((s) => s.activeOverlay);
  const setActiveOverlay = useCharacter((s) => s.setActiveOverlay);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MakeupCategory>('ALL');
  const [loading, setLoading] = useState(!catalogues.makeup);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogue('makeup')
      .then((entries) => {
        if (!cancelled) {
          setCatalogue('makeup', entries);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  const entries = useMemo(
    () => (catalogues.makeup ?? []).filter((entry) => !entry.mapRole || entry.mapRole === 'albedo'),
    [catalogues.makeup],
  );
  const classified = useMemo(
    () => entries.map((entry) => ({ entry, subtype: detectSubtype(entry) })),
    [entries],
  );
  const filtered = classified.filter(
    ({ entry, subtype }) =>
      (category === 'ALL' || subtype === category) && matchesQuery(entry, query),
  );
  const layers = overlayLayers.filter((layer) => layer.kind === 'makeup');
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const selected = layers.find((layer) => `makeup:${layer.id}` === activeOverlay) ?? layers[0];
  const selectedKey = selected ? `makeup:${selected.id}` : null;

  const remove = (layer: OverlayLayer) => {
    toggleOverlay(layer);
    if (`makeup:${layer.id}` === activeOverlay) setActiveOverlay(null);
    onDirty?.();
  };

  const pick = (entry: CatalogueEntry, subtype: MakeupCategory) => {
    const existing = byId.get(entry.id);
    if (existing) {
      remove(existing);
      return;
    }
    toggleOverlay({
      kind: 'makeup',
      id: entry.id,
      color: defaultColor(subtype),
      opacity: subtype === 'LIPS' ? 0.75 : subtype === 'BLUSH' ? 0.6 : 0.85,
    });
    setActiveOverlay(`makeup:${entry.id}`);
    onDirty?.();
  };

  return (
    <section
      aria-label="Makeup workspace"
      className="flex max-h-[calc(var(--hud-h,572px)-151px)] flex-col gap-[8px] text-[#e6e1d8] select-none"
    >
      {/* ── Active Layers Stack ────────────────────────────────────── */}
      <div className="shrink-0 rounded-xs border border-[#d4b483]/30 bg-[#15130f]/85 shadow-[0_8px_24px_#08070566] backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-[#d4b483]/20 bg-[linear-gradient(100deg,#6d573338,transparent)] px-[9px] py-[6px]">
          <h2 className="text-[11px] font-normal tracking-[0.02em] text-[#e8d4af]">
            APPLIED LAYERS <span className="num">({layers.length}/8)</span>
          </h2>
          {layers.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearOverlays('makeup');
                setActiveOverlay(null);
                onDirty?.();
              }}
              className={cn(
                'text-[10px] tracking-[0.08em] text-[#b9a88a] transition-colors hover:text-[#f0dfbe]',
                focus,
              )}
            >
              CLEAR ALL
            </button>
          )}
        </div>
        <div className="p-[6px]">
          <div className="thin-scroll max-h-[96px] space-y-[4px] overflow-y-auto">
            {layers.length === 0 && (
              <p className="px-[3px] py-[6px] text-[10px] leading-relaxed text-[#b5ab99]/70">
                No makeup applied. Select presets below to stack layers.
              </p>
            )}
            {layers.map((layer, index) => {
              const entry = entries.find((e) => e.id === layer.id);
              const label = entry ? makeupLabel(entry) : layer.id;
              const active = selectedKey === `makeup:${layer.id}`;
              return (
                <div
                  key={layer.id}
                  className={cn(
                    'flex items-center gap-[5px] rounded-xs border px-[6px] py-[4px] transition-colors',
                    active
                      ? 'border-[#d8b273]/75 bg-[#d4b483]/15 shadow-[inset_0_0_9px_#d4b4830c]'
                      : 'border-[#d4b483]/20 bg-black/25',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveOverlay(`makeup:${layer.id}`)}
                    title={label}
                    className={cn('flex min-w-0 flex-1 items-center gap-[6px] text-left', focus)}
                  >
                    <span
                      className="h-[7px] w-[7px] shrink-0 rounded-full border border-[#d4b483]/50 shadow-[0_0_4px_rgba(212,180,131,0.3)]"
                      style={{ backgroundColor: layer.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[10px] text-[#ddceb5]">
                      L{index + 1} · {label}
                    </span>
                    <span className="num shrink-0 text-[10px] text-[#c5b595]">
                      {Math.round(layer.opacity * 100)}%
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${layer.opacity <= 0.05 ? 'Show' : 'Hide'} ${label}`}
                    aria-pressed={layer.opacity > 0.05}
                    onClick={() => {
                      setOverlayOpacity('makeup', layer.id, layer.opacity > 0.05 ? 0.02 : 0.75);
                      onDirty?.();
                    }}
                    className={cn(
                      'p-[2px] text-[#dac5a0] transition-opacity hover:opacity-100',
                      layer.opacity <= 0.05 ? 'opacity-30' : 'opacity-75',
                      focus,
                    )}
                  >
                    <IconEye className="h-[10px] w-[10px]" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => remove(layer)}
                    className={cn(
                      'px-[2px] text-[11px] leading-none text-[#b2a38d] hover:text-[#f0dfbe]',
                      focus,
                    )}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Sub-category Segmented Filters ─────────────────────────── */}
      <div className="flex shrink-0 items-stretch border border-[#d4b483]/22 bg-black/40 text-[9.5px] tracking-[0.06em]">
        {CATEGORIES.map((cat, idx) => {
          const count = cat === 'ALL' ? classified.length : classified.filter((e) => e.subtype === cat).length;
          const isActive = category === cat;
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={isActive}
              onClick={() => setCategory(cat)}
              className={cn(
                'flex-1 py-[4px] text-center transition-colors',
                idx > 0 && 'border-l border-[#d4b483]/22',
                isActive
                  ? 'bg-[#d4b483]/20 font-medium text-[#f0dfbe]'
                  : 'text-[#8f8778]/70 hover:text-[#c4b9a3]',
                focus,
              )}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* ── Search Input with Clear Button ──────────────────────────── */}
      <div className="relative shrink-0">
        <input
          ref={search}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search makeup styles…"
          aria-label="Search makeup styles"
          className="w-full border border-[#d4b483]/26 bg-black/48 px-[7px] py-[4px] text-[10px] tracking-[0.06em] text-[#e2d8c6] placeholder-[#8f8778]/55 outline-none transition-colors focus:border-[#d4b483]/60"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              search.current?.focus();
            }}
            className={cn(
              'absolute right-[6px] top-1/2 -translate-y-1/2 text-[10px] text-[#8f8778] hover:text-[#e2d8c6]',
              focus,
            )}
          >
            ×
          </button>
        )}
      </div>

      {/* ── Grid of Available Styles ─────────────────────────────────── */}
      <div
        className="thin-scroll min-h-0 flex-1 overflow-y-auto pr-[2px]"
        aria-label="Makeup styles"
        aria-busy={loading}
      >
        {loading ? (
          <div className="grid grid-cols-4 gap-[6px]">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-full border border-[#d4b483]/15 bg-[#d4b483]/5 motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="border border-[#d4b483]/20 bg-black/30 px-[10px] py-[16px] text-center text-[10px] leading-relaxed text-[#c5b595]">
            {entries.length
              ? 'No matching styles. Try another search or category.'
              : 'No makeup styles available in pack.'}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-[7px]">
            {filtered.map(({ entry, subtype }, i) => {
              const layer = byId.get(entry.id);
              const label = makeupLabel(entry);
              const isSelected = !!layer;

              return (
                <button
                  type="button"
                  key={entry.id}
                  title={`${label}\nType: ${subtype}\nFile: ${entry.file}`}
                  aria-label={`${layer ? 'Remove' : 'Add'} ${label}`}
                  aria-pressed={isSelected}
                  onClick={() => pick(entry, subtype)}
                  className="group relative flex min-w-0 flex-col items-center text-left"
                >
                  {/* Circular Preview Disc */}
                  <span
                    className={cn(
                      'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border p-[2px] transition-all duration-200',
                      isSelected
                        ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_12px_rgba(234,200,127,0.45)]'
                        : 'border-[#d4b483]/25 bg-[#0b0a08]/80 group-hover:border-[#d4b483]/60 group-hover:bg-[#16120e]',
                    )}
                  >
                    <MakeupSwatch entry={entry} color={layer?.color ?? defaultColor(subtype)} />

                    {/* Monospace Number Badge */}
                    <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[9.5px] font-mono tracking-tight text-[#eadcc0]/75">
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    {/* Selected Active Glow Pip */}
                    {isSelected && (
                      <span className="pointer-events-none absolute -top-[1px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_rgba(242,223,190,0.9)]" />
                    )}
                  </span>

                  {/* Clean Label */}
                  <span
                    className={cn(
                      'mt-[3px] w-full truncate text-center text-[10px] tracking-[0.05em] transition-colors',
                      isSelected
                        ? 'font-medium text-[#f0e2ca]'
                        : 'text-[#a9a192]/70 group-hover:text-[#d5ccbb]',
                    )}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Status Footer ─────────────────────────────────────────── */}
      <div className="mt-[4px] flex shrink-0 items-center justify-between text-[10px] tracking-[0.11em] text-[#8b8375]/50">
        <div className="flex items-center gap-[4px]">
          <IconSparkle className="h-[6px] w-[6px] text-[#c9b184]/50" />
          <span>SDZ21 · UBE 4K ATLAS MASKS</span>
        </div>
        <span>{filtered.length} SHOWN</span>
      </div>
    </section>
  );
}
