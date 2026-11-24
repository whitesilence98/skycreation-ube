'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { presetFileName } from '@/lib/presetIO';
import { downloadPresetJson } from '@/lib/presets/download';
import { useGlbExport } from '@/components/hud/useGlbExport';
import { runWardrobeBatchBuild, type BatchBuildProgress } from '@/lib/bodyslide/batchBuilder';
import { BatchBuildModal } from '@/components/hud/bodyslide/BatchBuildModal';
import { useBodySlideStore } from '@/lib/bodyslide/store';
import { cn } from '@/lib/cn';

function IconCube({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 2.5 20.5 7.5v9L12 21.5l-8.5-5v-9L12 2.5z" />
      <path d="M12 2.5v19" />
      <path d="M20.5 7.5 12 12l-8.5-4.5" />
    </svg>
  );
}

function IconPreset({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function IconHanger({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 3a3 3 0 0 0-3 3c0 1.3.8 2.4 2 2.8V10L3 15v2h18v-2l-8-5V8.8A3 3 0 0 0 12 3z" />
      <path d="M3 17v4h18v-4" />
    </svg>
  );
}

export function WuxiaExportDropdown() {
  const snapshotPreset = useCharacter((s) => s.snapshotPreset);
  const showToast = useCharacter((s) => s.showToast);
  const bodySlideSliders = useBodySlideStore((s) => s.sliders);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [batchProgress, setBatchProgress] = useState<BatchBuildProgress | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBatchBuilding, setIsBatchBuilding] = useState(false);

  const { exportGlb: onExportGlb, exportingGlb } = useGlbExport((s) => {
    if (s?.text) showToast(s.text);
  });

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const onExportJson = () => {
    const file = snapshotPreset();
    downloadPresetJson(file);
    showToast(`Exported ${presetFileName(file.name)}`);
  };

  const onStartBatchBuild = async () => {
    setOpen(false);
    setIsBatchBuilding(true);
    setIsBatchModalOpen(true);
    try {
      await runWardrobeBatchBuild({
        sliders: bodySlideSliders,
        onProgress: (p) => setBatchProgress(p),
      });
      showToast('Wardrobe conformed with zero clipping');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch build failed');
    } finally {
      setIsBatchBuilding(false);
    }
  };

  return (
    <>
      <div className="relative pointer-events-auto" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          disabled={exportingGlb}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Export character preset (.json) or 3D model (.glb)"
          className={cn(
            'group flex h-7 items-center gap-1.5 rounded-[2px] border px-2.5 text-[10px] font-mono tracking-widest uppercase transition-all duration-150',
            open
              ? 'border-[#dfba73] bg-[#dfba73]/20 text-[#f2dfbe] shadow-[0_0_10px_rgba(223,186,115,0.35)]'
              : 'border-[#dfba73]/35 bg-[#1b1916]/80 text-[#dfba73] hover:border-[#dfba73]/70 hover:bg-[#dfba73]/15 hover:text-white',
            exportingGlb && 'opacity-60 cursor-wait',
          )}
        >
          {exportingGlb ? (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-t-transparent border-[#dfba73]" />
          ) : (
            <span className="text-[11px] leading-none text-[#dfba73]">📦</span>
          )}
          <span>{exportingGlb ? 'EXPORTING...' : 'EXPORT'}</span>
          <span
            className={cn(
              'text-[8px] opacity-70 transition-transform duration-200',
              open ? 'rotate-180 text-[#dfba73]' : '',
            )}
          >
            ▼
          </span>
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Export Formats"
            className="absolute top-[calc(100%+8px)] right-0 z-50 flex w-[280px] flex-col rounded-[2px] border border-[#dfba73]/40 bg-[#161413]/98 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.92)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 select-none"
          >
            {/* Antique brass corner brackets */}
            <div className="pointer-events-none absolute -left-[1px] -top-[1px] h-1.5 w-1.5 border-l border-t border-[#dfba73]/80" />
            <div className="pointer-events-none absolute -right-[1px] -top-[1px] h-1.5 w-1.5 border-r border-t border-[#dfba73]/80" />
            <div className="pointer-events-none absolute -bottom-[1px] -left-[1px] h-1.5 w-1.5 border-b border-l border-[#dfba73]/80" />
            <div className="pointer-events-none absolute -bottom-[1px] -right-[1px] h-1.5 w-1.5 border-b border-r border-[#dfba73]/80" />

            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#dfba73]/20 px-2.5 py-1.5 text-[10px] font-mono tracking-wider text-[#a89e8f]/90 leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#dfba73] shadow-[0_0_5px_#dfba73]" />
                <span className="font-semibold text-[#f2dfbe]">EXPORT CHARACTER</span>
              </div>
              <span className="text-[10px] text-[#8c8477]">3 OPTIONS</span>
            </div>

            {/* Menu options */}
            <div className="flex flex-col gap-1 py-1">
              {/* 1. 3D Model & Rig .GLB */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExportGlb();
                }}
                disabled={exportingGlb}
                className="group relative flex w-full items-start gap-2.5 rounded-[2px] border border-transparent px-2.5 py-2 text-left transition-all duration-150 hover:border-[#dfba73]/45 hover:bg-[#dfba73]/12 disabled:opacity-40"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[#dfba73]/40 bg-black/50 text-[#dfba73] transition-all group-hover:border-[#dfba73] group-hover:text-white group-hover:shadow-[0_0_8px_rgba(223,186,115,0.4)]">
                  {exportingGlb ? (
                    <span className="h-3 w-3 animate-spin rounded-full border border-t-transparent border-[#dfba73]" />
                  ) : (
                    <IconCube className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-medium tracking-[0.08em] text-[#f2dfbe] group-hover:text-white">
                      3D MODEL &amp; RIG
                    </span>
                    <span className="rounded-xs border border-[#dfba73]/40 bg-[#dfba73]/15 px-1 py-0.5 font-mono text-[9px] tracking-wider text-[#dfba73]">
                      .GLB
                    </span>
                  </div>
                  <span className="mt-0.5 text-[10px] leading-tight text-[#9a9182] group-hover:text-[#c4bcad]">
                    Blender/WebGL mesh with baked roughness map
                  </span>
                </div>
              </button>

              <div className="mx-1 h-px bg-[#dfba73]/15" />

              {/* 2. Character Preset JSON */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExportJson();
                }}
                className="group relative flex w-full items-start gap-2.5 rounded-[2px] border border-transparent px-2.5 py-2 text-left transition-all duration-150 hover:border-[#dfba73]/45 hover:bg-[#dfba73]/12"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[#dfba73]/40 bg-black/50 text-[#dfba73] transition-all group-hover:border-[#dfba73] group-hover:text-white group-hover:shadow-[0_0_8px_rgba(223,186,115,0.4)]">
                  <IconPreset className="h-3.5 w-3.5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-medium tracking-[0.08em] text-[#f2dfbe] group-hover:text-white">
                      CHARACTER PRESET
                    </span>
                    <span className="rounded-xs border border-[#dfba73]/40 bg-[#dfba73]/15 px-1 py-0.5 font-mono text-[9px] tracking-wider text-[#dfba73]">
                      .JSON
                    </span>
                  </div>
                  <span className="mt-0.5 text-[10px] leading-tight text-[#9a9182] group-hover:text-[#c4bcad]">
                    RaceMenu &amp; UBE 2.0 morph slider parameters
                  </span>
                </div>
              </button>

              <div className="mx-1 h-px bg-[#dfba73]/15" />

              {/* 3. Wardrobe Batch Build */}
              <button
                type="button"
                role="menuitem"
                onClick={onStartBatchBuild}
                disabled={isBatchBuilding}
                className="group relative flex w-full items-start gap-2.5 rounded-[2px] border border-transparent px-2.5 py-2 text-left transition-all duration-150 hover:border-[#dfba73]/45 hover:bg-[#dfba73]/12 disabled:opacity-40"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[#dfba73]/40 bg-black/50 text-[#dfba73] transition-all group-hover:border-[#dfba73] group-hover:text-white group-hover:shadow-[0_0_8px_rgba(223,186,115,0.4)]">
                  <IconHanger className="h-3.5 w-3.5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-medium tracking-[0.08em] text-[#f2dfbe] group-hover:text-white">
                      CONFORM WARDROBE
                    </span>
                    <span className="rounded-xs border border-[#dfba73]/40 bg-[#dfba73]/15 px-1 py-0.5 font-mono text-[9px] tracking-wider text-[#dfba73]">
                      BATCH
                    </span>
                  </div>
                  <span className="mt-0.5 text-[10px] leading-tight text-[#9a9182] group-hover:text-[#c4bcad]">
                    Auto-morph 51 garments to current body shape
                  </span>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      <BatchBuildModal
        isOpen={isBatchModalOpen}
        progress={batchProgress}
        onClose={() => setIsBatchModalOpen(false)}
      />
    </>
  );
}
