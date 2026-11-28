'use client';

import React, { useEffect, useState } from 'react';
import { useCharacter, BODY_WEIGHT_ENABLED } from '@/lib/store';
import { WuxiaBreadcrumbs } from '@/components/hud/common/WuxiaBreadcrumbs';
import { WuxiaRibbonPill } from '@/components/hud/common/WuxiaRibbonPill';
import { MouthPicker } from '@/components/hud/MouthPicker';
import { HairProperties } from '@/components/hud/HairProperties';
import { BracketSlider } from '@/components/hud/common/BracketSlider';
import { fetchCatalogue, matchesQuery } from '@/lib/mo2/client';
import type { Mo2Manifest } from '@/lib/head/faceTexture';
import type { CatalogueEntry } from '@/lib/mo2/types';
import { SearchInput } from '@/components/hud/common/SearchInput';
import { cn } from '@/lib/cn';

type HeadBaseSection = 'identity' | 'head_mesh' | 'mouth' | 'hair_fit';

const HEAD_BASE_SECTIONS: ReadonlyArray<{ id: HeadBaseSection; label: string; badge: string }> = [
  { id: 'identity', label: 'Character Identity & Weight', badge: 'NAME / BASE' },
  { id: 'head_mesh', label: 'Base Head & Sculpt Mesh', badge: 'HEAD PART' },
  { id: 'mouth', label: 'Mouth & Teeth', badge: 'TEETH / TONGUE' },
  { id: 'hair_fit', label: 'Hair Fit, Offset & Finish', badge: 'PHYSICS / GLOSS' },
];

export function WuxiaHeadBasePanel({ manifest }: { manifest: Mo2Manifest | null }) {
  const [section, setSection] = useState<HeadBaseSection | null>(null);
  const [query, setQuery] = useState('');
  const name = useCharacter((s) => s.name);
  const setName = useCharacter((s) => s.setName);
  const weight = useCharacter((s) => s.weight);
  const setWeight = useCharacter((s) => s.setWeight);
  const selection = useCharacter((s) => s.assetSelection);
  const setAssets = useCharacter((s) => s.setAssets);
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const setCatalogue = useCharacter((s) => s.setAssetCatalogue);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && section !== null) {
        e.preventDefault();
        setSection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [section]);

  useEffect(() => {
    if (section === 'head_mesh' && !catalogues.headMesh?.length) {
      void fetchCatalogue('headMesh').then((rows) => {
        if (rows.length) setCatalogue('headMesh', rows);
      });
    }
  }, [section, catalogues.headMesh, setCatalogue]);

  const headEntries = ((catalogues.headMesh ?? manifest?.assets?.headMesh ?? []) as CatalogueEntry[]).filter((e) =>
    !query.trim() ? true : matchesQuery(e, query),
  );

  const meta = section ? HEAD_BASE_SECTIONS.find((s) => s.id === section) ?? null : null;

  return (
    <div className="flex flex-col w-[calc(100vw-108px)] sm:w-[310px] md:w-[330px] max-w-[330px] shrink-0 select-none text-white pointer-events-auto">
      {section === null ? (
        <div className="flex flex-col">
          <h1 className="text-base md:text-lg font-normal tracking-wide text-white mb-3">
            Head &amp; Base
          </h1>
          <div
            className="flex flex-col gap-1.5 max-h-[calc(100vh-195px)] overflow-y-auto scrollbar-none pr-0.5"
            role="menu"
            aria-label="Head and Base Categories"
          >
            {HEAD_BASE_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                role="menuitem"
                onClick={() => setSection(sec.id)}
                className="group flex h-11 min-h-[44px] shrink-0 w-full items-center justify-between rounded-sm border border-white/5 bg-[#1f2026]/75 px-3.5 text-left transition-all hover:border-[#dfba73]/40 hover:bg-[#272830] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dfba73]"
              >
                <span className="text-xs tracking-wide text-[#d4d3d9] group-hover:text-white">
                  {sec.label}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] tracking-wider text-[#8c8891] uppercase">
                    {sec.badge}
                  </span>
                  <span className="text-sm font-light text-[#75737d] group-hover:text-white" aria-hidden>
                    ›
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <WuxiaBreadcrumbs
            category="Head & Base"
            subCategory={meta?.label}
            onBack={() => setSection(null)}
          />
          <div className="mt-2.5">
            <WuxiaRibbonPill label={meta?.label ?? ''} />
          </div>

          <div className="mt-3 max-h-[calc(100vh-225px)] overflow-y-auto scrollbar-none pr-1 pb-2">
            {section === 'identity' && (
              <div className="rounded-sm border border-white/8 bg-[#181920]/75 p-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-[10px] font-mono tracking-wider text-[#c9b796] uppercase">
                  <span>Character Name</span>
                  <input
                    type="text"
                    maxLength={24}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Character name"
                    className="h-9 rounded-sm border border-white/15 bg-black/40 px-2.5 text-xs font-sans text-white focus:border-[#eac87f] focus:outline-none"
                  />
                </label>

                <div className="flex flex-col gap-1.5 border-t border-white/8 pt-2.5">
                  <BracketSlider
                    label="Skyrim Actor Weight"
                    value={Math.round(weight * 100)}
                    min={0}
                    max={100}
                    step={1}
                    display={`${Math.round(weight * 100)}%`}
                    onChange={(v) => setWeight(v / 100)}
                  />
                  {!BODY_WEIGHT_ENABLED && (
                    <p className="text-[10px] text-[#9b968e]">
                      Body mesh weight blending is currently locked to _0 slim mesh (`BODY_WEIGHT_ENABLED = false`); neck &amp; actor export weight still update cleanly.
                    </p>
                  )}
                </div>
              </div>
            )}

            {section === 'head_mesh' && (
              <div className="flex flex-col gap-2.5">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search head mesh…"
                />
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setAssets({ headMesh: undefined })}
                    className={cn(
                      'flex min-h-[36px] items-center justify-between rounded-sm border px-3 text-left text-[11px] transition-colors',
                      !selection.headMesh
                        ? 'border-[#eac87f] bg-[#dfba73]/20 text-white'
                        : 'border-white/8 bg-[#181920]/70 text-[#b6ad9c] hover:border-[#dfba73]/40 hover:text-white',
                    )}
                  >
                    <span>Default Pack Head</span>
                    <span className="font-mono text-[10px]">AUTO</span>
                  </button>
                  {headEntries.map((entry) => {
                    const active = selection.headMesh === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setAssets({ headMesh: entry.id })}
                        className={cn(
                          'flex min-h-[36px] items-center justify-between rounded-sm border px-3 text-left text-[11px] transition-colors',
                          active
                            ? 'border-[#eac87f] bg-[#dfba73]/20 text-white'
                            : 'border-white/8 bg-[#181920]/70 text-[#c9c5ba] hover:border-[#dfba73]/40 hover:text-white',
                        )}
                      >
                        <span className="truncate">{entry.label || entry.file}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[#8c8891]">{entry.mod}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {section === 'mouth' && (
              <div className="rounded-sm border border-white/8 bg-[#181920]/75 p-2">
                <MouthPicker />
              </div>
            )}

            {section === 'hair_fit' && (
              <div className="rounded-sm border border-white/8 bg-[#181920]/75 p-2">
                <HairProperties />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
