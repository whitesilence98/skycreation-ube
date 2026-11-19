'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCharacter, type OverlayLayer } from '@/lib/store';
import { fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { cn } from '@/lib/cn';
import { SearchInput } from '@/components/hud/common/SearchInput';
import { OverlaySwatch } from '@/components/hud/common/OverlaySwatch';
import { IconEye } from '@/components/hud/Icons';

/** The shared overlay stack cap (`toggleOverlay` slices at 8 across kinds). */
const OVERLAY_CAP = 8;

/** Warpaint inks: dark, neutral, and two accents plus bone. */
export const TATTOO_INK_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: 'Ink Black', hex: '#1a1412' },
  { name: 'Charcoal', hex: '#2b2b2c' },
  { name: 'Rust', hex: '#5a2c1e' },
  { name: 'Indigo', hex: '#232a45' },
  { name: 'Bone', hex: '#c9bfa6' },
];

const DEFAULT_INK = TATTOO_INK_SWATCHES[0].hex;

const focus =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#eac87f]';

export function tattooLabel(entry: CatalogueEntry): string {
  return (entry.label || entry.file)
    .replace(/\.dds$/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function TattooPicker({ onDirty }: { onDirty?: () => void }) {
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);
  const overlayLayers = useCharacter((s) => s.overlayLayers);
  const toggleOverlay = useCharacter((s) => s.toggleOverlay);
  const setOverlayOpacity = useCharacter((s) => s.setOverlayOpacity);
  const clearOverlays = useCharacter((s) => s.clearOverlays);
  const activeOverlay = useCharacter((s) => s.activeOverlay);
  const setActiveOverlay = useCharacter((s) => s.setActiveOverlay);
  const showToast = useCharacter((s) => s.showToast);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(!catalogues.tattoo);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogue('tattoo')
      .then((entries) => {
        if (cancelled) return;
        if (entries.length) setCatalogue('tattoo', entries);
        else setError('Tattoo catalogue unavailable — try reloading.');
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Tattoo catalogue request failed.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setCatalogue]);

  const entries = useMemo(
    () =>
      (catalogues.tattoo ?? []).filter(
        (entry) =>
          (entry.mapRole ?? 'albedo') === 'albedo' &&
          !entry.file.toLowerCase().endsWith('_n.dds') &&
          entry.available !== false &&
          !entry.unavailable,
      ),
    [catalogues.tattoo],
  );

  const filtered = useMemo(
    () => entries.filter((entry) => matchesQuery(entry, query)),
    [entries, query],
  );

  const layers = overlayLayers.filter((layer) => layer.kind === 'tattoo');
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const selected = layers.find((layer) => `tattoo:${layer.id}` === activeOverlay) ?? layers[0];
  const selectedKey = selected ? `tattoo:${selected.id}` : null;

  /* The cap is shared with makeup, so both the counter and the refusal use the
     whole stack rather than this category's slice. */
  const total = overlayLayers.length;
  const full = total >= OVERLAY_CAP;

  const remove = (layer: OverlayLayer) => {
    toggleOverlay(layer);
    if (`tattoo:${layer.id}` === activeOverlay) setActiveOverlay(null);
    onDirty?.();
  };

  const pick = (entry: CatalogueEntry) => {
    const existing = byId.get(entry.id);
    if (existing) {
      remove(existing);
      return;
    }
    if (full) {
      showToast?.(`Overlay stack full (${OVERLAY_CAP}) — remove a layer first.`);
      return;
    }
    toggleOverlay({ kind: 'tattoo', id: entry.id, color: DEFAULT_INK, opacity: 0.85 });
    setActiveOverlay(`tattoo:${entry.id}`);
    onDirty?.();
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between border-b border-[#d4b483]/14 pb-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#efece6]">
          TATTOOS &amp; WARPAINT
        </span>
        <span className="font-mono text-[10px] text-[#a49a88]">
          {loading ? 'LOADING…' : `${entries.length} WARPAINTS`}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {/* ── 1. APPLIED LAYERS (shared cap) ─────────────────────────── */}
        <div className="flex flex-col gap-1.5 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
              APPLIED WARPAINTS ({total}/{OVERLAY_CAP})
            </span>
            {layers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearOverlays('tattoo');
                  setActiveOverlay(null);
                  onDirty?.();
                }}
                className={cn(
                  'text-[10px] font-mono tracking-[0.08em] leading-tight text-[#b9a88a] transition-colors hover:text-[#f0dfbe]',
                  focus,
                )}
              >
                [CLEAR ALL]
              </button>
            )}
          </div>
          {full && layers.length === 0 && (
            <p className="border border-[#d4b483]/20 bg-black/30 px-2 py-1 text-[10px] font-mono text-[#c5b595] leading-normal">
              Stack full with makeup — remove a layer to add a warpaint.
            </p>
          )}

          <div className="thin-scroll max-h-[85px] space-y-[3px] overflow-y-auto">
            {layers.length === 0 && (
              <p className="border border-[#d4b483]/15 bg-black/30 px-2 py-2 text-center text-[10px] font-mono leading-relaxed text-[#c4bba8]">
                No warpaints applied. Pick designs below to stack.
              </p>
            )}
            {layers.map((layer, index) => {
              const entry = entries.find((item) => item.id === layer.id);
              const label = entry ? tattooLabel(entry) : layer.id;
              const active = selectedKey === `tattoo:${layer.id}`;
              return (
                <div
                  key={layer.id}
                  className={cn(
                    'flex items-center gap-[5px] rounded-xs border px-[6px] py-[3px] transition-colors',
                    active
                      ? 'border-[#eac87f] bg-[#d4b483]/15 shadow-[0_0_8px_rgba(234,200,127,0.3)]'
                      : 'border-[#d4b483]/20 bg-black/30 hover:border-[#d4b483]/40',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveOverlay(`tattoo:${layer.id}`)}
                    title={label}
                    className={cn('flex min-w-0 flex-1 items-center gap-[6px] text-left', focus)}
                  >
                    <span
                      className="h-[8px] w-[8px] shrink-0 rounded-full border border-[#d4b483]/60 shadow-[0_0_4px_rgba(212,180,131,0.4)]"
                      style={{ backgroundColor: layer.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-[#ddceb5] leading-tight">
                      L{index + 1} · {label}
                    </span>
                    <span className="num shrink-0 text-[10px] font-mono text-[#c5b595] leading-tight">
                      {Math.round(layer.opacity * 100)}%
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${layer.opacity <= 0.05 ? 'Show' : 'Hide'} ${label}`}
                    aria-pressed={layer.opacity > 0.05}
                    onClick={() => {
                      setOverlayOpacity('tattoo', layer.id, layer.opacity > 0.05 ? 0.02 : 0.85);
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

        {/* ── 2. CATALOGUE GRID ───────────────────────────────────────── */}
        <div className="flex flex-col gap-2 border-t border-[#d4b483]/18 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
              WARPAINT DESIGNS
            </span>
            <span className="text-[10px] font-mono tracking-tight text-[#a49a88] leading-tight">
              {loading ? 'LOADING…' : `${filtered.length} DESIGNS`}
            </span>
          </div>

          <SearchInput value={query} onChange={setQuery} placeholder="Search warpaints…" />

          {error && (
            <p
              role="alert"
              className="border border-[#b56a5a]/40 bg-[#b56a5a]/10 px-2 py-1.5 text-[10px] font-mono leading-relaxed text-[#dda898]"
            >
              {error}
            </p>
          )}

          <div className="thin-scroll max-h-[160px] overflow-y-auto pr-[2px]">
            {loading ? (
              <div className="grid grid-cols-4 gap-[6px]">
                {Array.from({ length: 12 }, (_, i) => (
                  <div
                    key={i}
                    className="aspect-square animate-pulse rounded-full border border-[#d4b483]/15 bg-[#d4b483]/5 motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="border border-[#d4b483]/20 bg-black/30 px-[10px] py-[16px] text-center text-[10px] leading-relaxed text-[#c5b595]">
                {entries.length
                  ? 'No matching warpaints. Try another search.'
                  : error ? 'No warpaints could be listed.' : 'No warpaints available in pack.'}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-[6px]">
                {filtered.map((entry, index) => {
                  const layer = byId.get(entry.id);
                  const label = tattooLabel(entry);
                  const isSelected = !!layer;
                  const blocked = !isSelected && full;
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      title={`${label}\nFile: ${entry.file}${blocked ? '\nStack full — remove a layer first' : ''}`}
                      aria-label={`${layer ? 'Remove' : 'Add'} ${label}`}
                      aria-pressed={isSelected}
                      aria-disabled={blocked || undefined}
                      onClick={() => pick(entry)}
                      className={cn(
                        'group relative flex min-w-0 flex-col items-center text-left',
                        blocked && 'opacity-50',
                      )}
                    >
                      <span
                        className={cn(
                          'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-full border p-[2px] transition-all duration-200',
                          isSelected
                            ? 'border-[#eac87f] bg-[#eac87f]/16 shadow-[0_0_10px_rgba(234,200,127,0.45)]'
                            : 'border-[#d4b483]/25 bg-[#0b0a08]/80 group-hover:border-[#d4b483]/60 group-hover:bg-[#16120e]',
                        )}
                      >
                        <OverlaySwatch kind="tattoo" id={entry.id} color={layer?.color ?? DEFAULT_INK} />

                        <span className="pointer-events-none absolute bottom-[1px] right-[2px] text-[10px] font-mono tracking-tight text-[#eadcc0]/85 leading-none">
                          {String(index + 1).padStart(2, '0')}
                        </span>

                        {isSelected && (
                          <span className="pointer-events-none absolute -top-[1px] h-[3px] w-[3px] rounded-full bg-[#f2dfbe] shadow-[0_0_5px_rgba(242,223,190,0.9)]" />
                        )}
                      </span>

                      <span
                        className={cn(
                          'mt-[2px] w-full truncate text-center text-[10px] tracking-[0.04em] leading-tight transition-colors',
                          isSelected
                            ? 'font-medium text-[#f0e2ca]'
                            : 'text-[#a9a192] group-hover:text-[#d5ccbb]',
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
        </div>
      </div>
    </div>
  );
}
