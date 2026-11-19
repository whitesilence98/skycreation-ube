'use client';

import { useEffect, useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { presetFileName } from '@/lib/presetIO';
import { downloadPresetJson } from '@/lib/presets/download';
import { exportCharacterGlb } from '@/lib/exportGlb';
import { exportCharacterPackage } from '@/lib/exportPackage';
import { importPresetFromFiles } from '@/lib/head/nifImport';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

interface PresetIOProps {
  manifest: Mo2Manifest | null;
}

/**
 * Import / export for character presets.
 *
 * Export dropdown allows exporting:
 * 1. Character Preset (.json) - RaceMenu & LYRA morph sliders
 * 2. 3D Model & Skeletal Rig (.glb) - Skinned mesh for Blender / WebGL
 * 3. Complete Game Asset Package (.zip) - GLB, OBJ/MTL, extracted textures & README
 *
 * Import accepts LYRA JSON, RaceMenu .jslot, or NIF meshes straight from MO2.
 */
export function PresetIO({ manifest }: PresetIOProps) {
  const loadPreset = useCharacter((s) => s.loadPreset);
  const snapshotPreset = useCharacter((s) => s.snapshotPreset);
  const setName = useCharacter((s) => s.setName);
  const showToast = useCharacter((s) => s.showToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const characterName = useCharacter((s) => s.name);
  const [exportingGlb, setExportingGlb] = useState(false);
  const [exportingPackage, setExportingPackage] = useState(false);

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

  const flash = (s: Status) => {
    setStatus(s);
    if (s?.text) {
      showToast?.(s.text);
    }
    window.setTimeout(() => setStatus(null), 3500);
  };

  const onExportGlb = async () => {
    setExportingGlb(true);
    flash({ kind: 'ok', text: 'EXPORTING MODEL & RIG (.GLB)...' });
    try {
      await exportCharacterGlb(characterName, { animated: true });
      const safeName = (characterName || 'Character').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
      flash({ kind: 'ok', text: `EXPORTED ${safeName}.glb` });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'GLB export failed' });
    } finally {
      setExportingGlb(false);
    }
  };

  const onExportPackage = async () => {
    setExportingPackage(true);
    flash({ kind: 'ok', text: 'PACKAGING MODEL & TEXTURES (.ZIP)...' });
    try {
      await exportCharacterPackage(characterName, { animated: true });
      const safeName = (characterName || 'Character').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
      flash({ kind: 'ok', text: `EXPORTED ${safeName}_Package.zip` });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'Asset package export failed' });
    } finally {
      setExportingPackage(false);
    }
  };

  const onExport = () => {
    const file = snapshotPreset();
    downloadPresetJson(file);
    flash({ kind: 'ok', text: `EXPORTED ${presetFileName(file.name)}` });
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!fileList.length) return;

    setBusy(true);
    try {
      const result = await importPresetFromFiles(fileList, manifest);
      loadPreset(result.payload, result.headOption?.id);
      if (result.characterName) {
        setName(result.characterName.toUpperCase().slice(0, 14));
      }
      flash({ kind: result.kind, text: result.summary });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'Could not read that file.' });
    } finally {
      setBusy(false);
    }
  };

  const tone =
    status?.kind === 'error'
      ? 'text-[#e0967c]'
      : status?.kind === 'warn'
        ? 'text-[#e0c48d]'
        : 'text-[#a9c9b6]';

  return (
    <div className="flex items-center gap-[10px]">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".json,.jslot,.nif"
        onChange={onPick}
        className="hidden"
      />

      {/* ── IMPORT ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group flex items-center gap-[4px] text-[10px] tracking-[0.13em] text-[#b6ad9d]/80 transition-colors hover:text-[#eee2ca] disabled:opacity-40"
      >
        <IconImport className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:-translate-y-[1px]" />
        <span>IMPORT</span>
      </button>

      <span className="h-[9px] w-px bg-[#d4b483]/20" />

      {/* ── EXPORT Dropdown ─────────────────────────────────────── */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          disabled={exportingGlb || exportingPackage}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Export character preset (.json), 3D model (.glb), or complete package (.zip)"
          className={cn(
            'group flex items-center gap-[4px] text-[10px] tracking-[0.13em] transition-all duration-150',
            open
              ? 'text-[#eac87f] drop-shadow-[0_0_6px_rgba(234,200,127,0.45)]'
              : 'text-[#b6ad9d]/80 hover:text-[#eee2ca]',
            (exportingGlb || exportingPackage) && 'opacity-60',
          )}
        >
          {exportingGlb || exportingPackage ? (
            <span className="h-[9px] w-[9px] animate-spin rounded-full border border-t-transparent border-[#eac87f]" />
          ) : (
            <IconExport className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:translate-y-[1px]" />
          )}
          <span>
            {exportingGlb
              ? 'EXPORTING...'
              : exportingPackage
                ? 'PACKAGING...'
                : 'EXPORT'}
          </span>
          <IconChevronUp
            className={cn(
              'h-[8px] w-[8px] opacity-70 transition-transform duration-200',
              open ? 'rotate-180 text-[#eac87f]' : 'group-hover:-translate-y-[1px]',
            )}
          />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Export Formats"
            className="absolute bottom-[calc(100%+10px)] right-0 z-50 flex w-[270px] flex-col rounded-[2px] border border-[#463a2e] bg-[#161311]/96 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Antique Nordic brass corner brackets matching StudioCard */}
            <div className="pointer-events-none absolute -left-[1px] -top-[1px] h-1.5 w-1.5 border-l border-t border-[#d4b483]/60" />
            <div className="pointer-events-none absolute -right-[1px] -top-[1px] h-1.5 w-1.5 border-r border-t border-[#d4b483]/60" />
            <div className="pointer-events-none absolute -bottom-[1px] -left-[1px] h-1.5 w-1.5 border-b border-l border-[#d4b483]/60" />
            <div className="pointer-events-none absolute -bottom-[1px] -right-[1px] h-1.5 w-1.5 border-b border-r border-[#d4b483]/60" />

            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#463a2e]/60 px-2 py-1.5 text-[9px] font-mono tracking-wider text-[#a89e8f]/80">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#eac87f] shadow-[0_0_5px_#eac87f]" />
                <span className="font-semibold text-[#e8c691]">EXPORT ASSET</span>
              </div>
              <span className="text-[8px] text-[#8c8477]">3 FORMATS</span>
            </div>

            {/* Menu options */}
            <div className="flex flex-col gap-1 py-1">
              {/* 1. Preset JSON */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExport();
                }}
                className="group relative flex w-full items-start gap-2.5 rounded-[2px] border border-transparent px-2 py-1.5 text-left transition-all duration-150 hover:border-[#d4b483]/45 hover:bg-[#d4b483]/12"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[#d4b483]/30 bg-black/45 text-[#d4b483] transition-all group-hover:border-[#eac87f] group-hover:text-[#f2dfbe] group-hover:shadow-[0_0_8px_rgba(234,200,127,0.3)]">
                  <IconExport className="h-3.5 w-3.5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-medium tracking-[0.1em] text-[#e8dcce] group-hover:text-[#fff]">
                      CHARACTER PRESET
                    </span>
                    <span className="rounded-xs border border-[#d4b483]/35 bg-[#d4b483]/15 px-1 py-0.5 font-mono text-[8px] tracking-wider text-[#eac87f]">
                      .JSON
                    </span>
                  </div>
                  <span className="mt-0.5 text-[8.5px] leading-tight text-[#9a9182] group-hover:text-[#c4bcad]">
                    RaceMenu &amp; LYRA morph sliders
                  </span>
                </div>
              </button>

              <div className="mx-1 h-px bg-[#463a2e]/40" />

              {/* 2. 3D Model & Rig .GLB */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExportGlb();
                }}
                disabled={exportingGlb || exportingPackage}
                className="group relative flex w-full items-start gap-2.5 rounded-[2px] border border-transparent px-2 py-1.5 text-left transition-all duration-150 hover:border-[#d4b483]/45 hover:bg-[#d4b483]/12 disabled:opacity-40"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[#d4b483]/30 bg-black/45 text-[#d4b483] transition-all group-hover:border-[#eac87f] group-hover:text-[#f2dfbe] group-hover:shadow-[0_0_8px_rgba(234,200,127,0.3)]">
                  {exportingGlb ? (
                    <span className="h-3 w-3 animate-spin rounded-full border border-t-transparent border-[#eac87f]" />
                  ) : (
                    <IconCube className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-medium tracking-[0.1em] text-[#e8dcce] group-hover:text-[#fff]">
                      {exportingGlb ? 'EXPORTING 3D MESH...' : '3D MODEL & RIG'}
                    </span>
                    <span className="rounded-xs border border-[#d4b483]/35 bg-[#d4b483]/15 px-1 py-0.5 font-mono text-[8px] tracking-wider text-[#eac87f]">
                      .GLB
                    </span>
                  </div>
                  <span className="mt-0.5 text-[8.5px] leading-tight text-[#9a9182] group-hover:text-[#c4bcad]">
                    Skinned mesh + skeleton for Blender / 3D
                  </span>
                </div>
              </button>

              <div className="mx-1 h-px bg-[#463a2e]/40" />

              {/* 3. Game Asset Package .ZIP */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExportPackage();
                }}
                disabled={exportingPackage || exportingGlb}
                className="group relative flex w-full items-start gap-2.5 rounded-[2px] border border-transparent px-2 py-1.5 text-left transition-all duration-150 hover:border-[#d4b483]/45 hover:bg-[#d4b483]/12 disabled:opacity-40"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-[#d4b483]/30 bg-black/45 text-[#d4b483] transition-all group-hover:border-[#eac87f] group-hover:text-[#f2dfbe] group-hover:shadow-[0_0_8px_rgba(234,200,127,0.3)]">
                  {exportingPackage ? (
                    <span className="h-3 w-3 animate-spin rounded-full border border-t-transparent border-[#eac87f]" />
                  ) : (
                    <IconPackage className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[10px] font-medium tracking-[0.1em] text-[#e8dcce] group-hover:text-[#fff]">
                      {exportingPackage ? 'COMPILING PACKAGE...' : 'GAME ASSET PACKAGE'}
                    </span>
                    <span className="rounded-xs border border-[#d4b483]/35 bg-[#d4b483]/15 px-1 py-0.5 font-mono text-[8px] tracking-wider text-[#eac87f]">
                      .ZIP
                    </span>
                  </div>
                  <span className="mt-0.5 text-[8.5px] leading-tight text-[#9a9182] group-hover:text-[#c4bcad]">
                    GLB + OBJ/MTL + extracted textures + preset
                  </span>
                </div>
              </button>
            </div>

            {/* Footer */}
            <div className="border-t border-[#463a2e]/50 px-2 py-1 text-right font-mono text-[8px] text-[#8c8477]">
              CHARACTER: <span className="text-[#d4b483]">{characterName || 'LYRA'}</span>
            </div>
          </div>
        )}
      </div>

      {status && (
        <span
          role="status"
          className={cn(
            'max-w-[230px] truncate text-[10px] tracking-[0.11em] uppercase',
            tone,
          )}
          title={status.text}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}

function IconImport({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M6 1v6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M3.6 4.4 6 6.8l2.4-2.4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 8.6v1.2a.8.8 0 0 0 .8.8h6.4a.8.8 0 0 0 .8-.8V8.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

function IconExport({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M6 7.4V1.4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M3.6 4 6 1.6 8.4 4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 8.6v1.2a.8.8 0 0 0 .8.8h6.4a.8.8 0 0 0 .8-.8V8.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronUp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path
        d="M2.5 7.5L6 4L9.5 7.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCube({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6L6 1.2Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M6 6v4.8M6 6 1.8 3.6M6 6l4.2-2.4" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
    </svg>
  );
}

function IconPackage({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M2 3.5 6 1.5l4 2v5l-4 2-4-2v-5Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M2 3.5 6 5.5l4-2M6 5.5v5M3.5 2.25l5 2.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
