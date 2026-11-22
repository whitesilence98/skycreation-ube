'use client';

import { useEffect, useRef, useState } from 'react';
import { PresetIO } from '@/components/hud/PresetIO';
import { useGlbExport } from '@/components/hud/useGlbExport';
import { EQUIP_SLOTS, type EquipSlot } from '@/lib/equipment';
import { listOutfitRecords, saveOutfitRecord } from '@/lib/outfits/library';
import {
  findOutfitLabelCollision,
  isOutfitLibraryFull,
  makeOutfitRecord,
  OUTFIT_SET_JSON_MAX_CHARS,
  parseOutfitSetFile,
  sameOutfit,
} from '@/lib/outfits/records';
import { exitWardrobe } from '@/lib/editorNav';
import { SmartFooter } from '@/components/hud/smart/SmartFooter';
import { notifyOutfitsChanged, requestOutfitSave } from '@/lib/outfits/saveRequest';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex h-[18px] items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 px-1 font-mono text-[10px] font-medium text-[#eae5dc]"
      aria-hidden
    >
      {children}
    </span>
  );
}

export function Footer({
  manifest,
  onToggleCustomizationDrawer,
}: {
  manifest: Mo2Manifest | null;
  onToggleCustomizationDrawer?: () => void;
}) {
  const isOutfit = useCharacter(s => s.primaryTab === 'EQUIPMENT');
  const isHair = useCharacter(s => s.primaryTab === 'HAIR');
  const isMakeup = useCharacter(s => s.primaryTab === 'FACE');
  const isFace = useCharacter(s => s.primaryTab === 'FACE SHAPE');
  const smart = useCharacter(s => s.studioPage === 'smart');
  const past = useCharacter(s => s.facePast.length);
  const future = useCharacter(s => s.faceFuture.length);
  const comparing = useCharacter(s => s.faceCompareStart !== null);
  const preview = useCharacter(s => s.previewMode);
  const state = useCharacter.getState;

  if (isOutfit) return <OutfitFooter />;
  if ((isHair || isMakeup) && smart) return <SmartFooter />;
  if (isHair) return <HairFooter onToggleImport={onToggleCustomizationDrawer} />;
  if (isMakeup) return <MakeupFooter onToggleImport={onToggleCustomizationDrawer} />;
  if (isFace) return <FeaturesFooter onToggleImport={onToggleCustomizationDrawer} />;

  return (
    <footer className="creator-footer">
      <div className="creator-footer-context">
        <button type="button" onClick={() => state().setWorkspace('edit')}>
          <Key>Esc</Key>
          <span>Return</span>
        </button>
        {isFace && (
          <>
            <button type="button" disabled={!past || comparing} onClick={() => state().undoFace()}>
              <Key>Ctrl+Z</Key>
              <span>Undo</span>
            </button>
            <button type="button" disabled={!future || comparing} onClick={() => state().redoFace()}>
              <Key>Ctrl+Y</Key>
              <span>Redo</span>
            </button>
            <button
              type="button"
              aria-pressed={comparing}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                state().beginFaceCompare();
              }}
              onPointerUp={() => state().endFaceCompare()}
              onPointerCancel={() => state().endFaceCompare()}
              onLostPointerCapture={() => state().endFaceCompare()}
              onBlur={() => state().endFaceCompare()}
              onKeyDown={e => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  state().beginFaceCompare();
                }
              }}
              onKeyUp={e => {
                if (e.key === ' ' || e.key === 'Enter') state().endFaceCompare();
              }}
            >
              <Key>C</Key>
              <span>{comparing ? 'Showing last saved point' : 'Hold to compare'}</span>
            </button>
            <button type="button" disabled={comparing} onClick={() => state().resetFaceRegion()}>
              <Key>R</Key>
              <span>Reset region</span>
            </button>
          </>
        )}
      </div>
      <div className="creator-footer-actions">
        <PresetIO manifest={manifest} />
        {!preview && (
          <button
            type="button"
            className="creator-primary-action"
            disabled={comparing}
            onClick={() => {
              state().applyFaceBaseline();
              state().setPreviewMode(true);
              state().showToast('Preview on · compare now returns to this point');
            }}
          >
            <Key>Space</Key>
            <span>Complete</span>
          </button>
        )}
      </div>
    </footer>
  );
}

function OutfitFooter() {
  const hydrated = useCharacter(s => s.hydrated);
  const unrestricted = useCharacter(s => s.unrestrictedSlots);
  const garmentsVisible = useCharacter(s => s.garmentVisible);
  const input = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLDetailsElement>(null);
  const busy = useRef(false);
  const [importing, setImporting] = useState(false);
  const { exportGlb, exportingGlb } = useGlbExport();
  const state = useCharacter.getState;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, summary, a, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]')
      )
        return;

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        input.current?.click();
      } else if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (more.current) more.current.open = !more.current.open;
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        if (!requestOutfitSave()) state().showToast('Ready to upload current outfit to gallery.');
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        const ws = state().workspace;
        state().setWorkspace(ws === 'wardrobe' ? 'edit' : 'wardrobe');
      } else if (event.key === ' ' && !document.querySelector('dialog[open], details[open], [role="menu"]')) {
        event.preventDefault();
        state().setPreviewMode(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const importOutfit = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy.current) return;
    if (!state().hydrated) {
      state().showToast('Wait for your character to finish loading.');
      return;
    }
    busy.current = true;
    setImporting(true);
    try {
      if (!/\.json$/i.test(file.name))
        throw Error('Choose a .json outfit file. Character presets and .jslot files belong on the Presets page.');
      if (file.size > OUTFIT_SET_JSON_MAX_CHARS) throw Error('Outfit file is too large (32 KB maximum).');
      const recordFile = parseOutfitSetFile(await file.text());
      if (!recordFile) throw Error('Not a valid lyra-outfit file. Character presets must be loaded from the Presets page.');
      const listed = await listOutfitRecords();
      if (!listed.ok) throw Error(listed.message);
      const collision = findOutfitLabelCollision(listed.value, recordFile.label);
      if (collision && !window.confirm(`Replace saved outfit "${collision.label}"?`)) return;
      if (isOutfitLibraryFull(listed.value, collision?.id))
        throw Error('Outfit library is full. Delete a set before importing another.');
      const before = state();
      if (
        !sameOutfit(before.equipment, recordFile.equipment, before.assetSelection.clothingMesh, recordFile.clothingMesh) &&
        !window.confirm(`Import and apply "${recordFile.label}"? This replaces all worn gear.`)
      )
        return;
      const record = makeOutfitRecord({ ...recordFile, id: collision?.id });
      if (collision) record.createdAt = collision.createdAt;
      const saved = await saveOutfitRecord(record);
      if (!saved.ok)
        throw Error(
          saved.reason === 'quota'
            ? 'Storage is full. Outfit was not imported; worn gear is unchanged.'
            : saved.message
        );
      notifyOutfitsChanged();
      const current = state();
      if (
        !sameOutfit(before.equipment, current.equipment, before.assetSelection.clothingMesh, current.assetSelection.clothingMesh) &&
        !window.confirm('Your worn gear changed during import. Apply the saved outfit now?')
      ) {
        state().showToast(`SAVED ${saved.value.label}; worn gear unchanged`);
        return;
      }
      state().setEquip(
        Object.fromEntries(EQUIP_SLOTS.map(slot => [slot, saved.value.equipment[slot] ?? null])) as Record<
          EquipSlot,
          string | null
        >
      );
      state().setAssets({ clothingMesh: saved.value.clothingMesh ?? null });
      state().showToast(`IMPORTED ${saved.value.label}`);
    } catch (error) {
      state().showToast(error instanceof Error ? error.message : 'Outfit import failed. Worn gear is unchanged.');
    } finally {
      busy.current = false;
      setImporting(false);
    }
  };

  const clearGear = () => {
    if (!state().hydrated || !window.confirm('Clear all worn garments and accessories?')) return;
    state().setEquip(Object.fromEntries(EQUIP_SLOTS.map(slot => [slot, null])) as Record<EquipSlot, null>);
    state().setAssets({ clothingMesh: null });
    if (more.current) more.current.open = false;
  };

  return (
    <footer className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex min-h-[54px] flex-wrap md:flex-nowrap items-center justify-between gap-3 px-4 sm:px-8 py-2 md:py-0 select-none bg-gradient-to-t from-black/80 to-transparent">
      {/* ─────────────────────────────────────────────────────────────────────────────
          LEFT ACTIONS (Callouts 5 & 6 + Return + Watermark)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3 sm:gap-5 text-xs text-[#cfcacf] flex-wrap">
          {/* Return button */}
          <button
            type="button"
            onClick={exitWardrobe}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 font-mono text-[10px] font-medium text-[#eae5dc]">
              ↵
            </span>
            <span>Return</span>
          </button>

          {/* CALLOUT 5: [T] Import Outfit */}
          <input
            ref={input}
            type="file"
            accept=".json"
            aria-label="Import outfit JSON"
            hidden
            onChange={importOutfit}
          />
          <button
            type="button"
            disabled={!hydrated || importing}
            onClick={() => input.current?.click()}
            className="flex items-center gap-1.5 transition-colors hover:text-white disabled:opacity-40"
          >
            <Key>T</Key>
            <span>{importing ? 'Importing outfit…' : 'Import Outfit'}</span>
          </button>

          {/* CALLOUT 6: [V] More Options */}
          <details
            ref={more}
            className="relative"
            onKeyDown={event => {
              if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.open) {
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#eac87f]">
              <Key>V</Key>
              <span>More Options</span>
            </summary>
            <div
              role="group"
              aria-label="Outfit options"
              className="absolute bottom-7 left-0 z-30 flex min-w-[170px] flex-col gap-1 rounded-[2px] border border-white/10 bg-[#1e1e23]/95 p-1.5 shadow-2xl backdrop-blur-md"
            >
              <button
                type="button"
                disabled={!hydrated}
                onClick={clearGear}
                className="rounded-[1px] px-2 py-1.5 text-left text-xs text-[#e6e1d8] hover:bg-white/10"
              >
                Clear all gear
              </button>
              <button
                type="button"
                aria-pressed={unrestricted}
                onClick={() => state().toggleUnrestrictedSlots()}
                className="rounded-[1px] px-2 py-1.5 text-left text-xs text-[#e6e1d8] hover:bg-white/10"
              >
                Unrestricted slots
              </button>
              <button
                type="button"
                aria-pressed={!garmentsVisible}
                onClick={() => state().setGarmentVisible(!state().garmentVisible)}
                className="rounded-[1px] px-2 py-1.5 text-left text-xs text-[#e6e1d8] hover:bg-white/10"
              >
                Hide garments
              </button>
              <button
                type="button"
                disabled={!hydrated}
                onClick={() => {
                  if (!requestOutfitSave()) state().showToast('Saved current outfit');
                  if (more.current) more.current.open = false;
                }}
                className="rounded-[1px] px-2 py-1.5 text-left text-xs text-[#e6e1d8] hover:bg-white/10"
              >
                Save outfit set
              </button>
              <button
                type="button"
                disabled={exportingGlb}
                onClick={() => {
                  exportGlb();
                  if (more.current) more.current.open = false;
                }}
                className="rounded-[1px] px-2 py-1.5 text-left text-xs text-[#e6e1d8] hover:bg-white/10"
              >
                {exportingGlb ? 'Exporting GLB…' : 'Export GLB'}
              </button>
            </div>
          </details>
        </div>

        {/* Early Access Watermark */}
        <span className="font-mono text-[10px] tracking-wide text-[#7a7882]/80 select-none">
          ID: 0507582430 Early Access Version
        </span>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          RIGHT ACTIONS (Callouts 10 & 11)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-6 text-xs text-[#cfcacf]">
        {/* CALLOUT 10: [R] Upload to the Gallery */}
        <button
          type="button"
          onClick={() => {
            if (!requestOutfitSave()) state().showToast('Uploading current outfit to the gallery…');
          }}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>R</Key>
          <span>Upload to the Gallery</span>
        </button>

        {/* CALLOUT 11: [F] Outfit Plan */}
        <button
          type="button"
          onClick={() => {
            const ws = state().workspace;
            state().setWorkspace(ws === 'wardrobe' ? 'edit' : 'wardrobe');
          }}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>F</Key>
          <span>Outfit Plan</span>
        </button>
      </div>
    </footer>
  );
}

function HairFooter({ onToggleImport }: { onToggleImport?: () => void }) {
  const state = useCharacter.getState;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, summary, a, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]')
      )
        return;

      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        onToggleImport?.();
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        randomize();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        state().showToast('Uploading customization data to the gallery…');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleImport]);

  const randomize = () => {
    const s = state();
    const meshes = s.assetCatalogues.hairMesh ?? [];
    if (meshes.length > 0) {
      const pick = meshes[Math.floor(Math.random() * meshes.length)];
      s.setAssets({ hairMesh: pick.id, ...(pick.pairedTextureId ? { hair: pick.pairedTextureId } : {}) });
      s.showToast(`Randomized hair: ${pick.label || pick.id}`);
    }
  };

  return (
    <footer className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex min-h-[54px] flex-wrap md:flex-nowrap items-center justify-between gap-3 px-4 sm:px-8 py-2 md:py-0 select-none bg-gradient-to-t from-black/80 to-transparent">
      {/* Left Actions */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3 sm:gap-5 text-xs text-[#cfcacf] flex-wrap">
          {/* Return */}
          <button
            type="button"
            onClick={() => state().setWorkspace('edit')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 font-mono text-[10px] font-medium text-[#eae5dc]">
              ↵
            </span>
            <span>Return</span>
          </button>

          {/* [V] Import Customization Data */}
          <button
            type="button"
            onClick={onToggleImport}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>V</Key>
            <span>Import Customization Data</span>
          </button>

          {/* [T] Random */}
          <button
            type="button"
            onClick={randomize}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>T</Key>
            <span>Random</span>
          </button>
        </div>

        {/* Early Access Watermark */}
        <span className="font-mono text-[10px] tracking-wide text-[#7a7882]/80 select-none">
          ID: 2063263297
        </span>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-6 text-xs text-[#cfcacf]">
        {/* [R] Upload to the Gallery */}
        <button
          type="button"
          onClick={() => state().showToast('Uploading customization data to the gallery…')}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>R</Key>
          <span>Upload to the Gallery</span>
        </button>
      </div>
    </footer>
  );
}

function FeaturesFooter({ onToggleImport }: { onToggleImport?: () => void }) {
  const state = useCharacter.getState;
  const setPreviewMode = useCharacter(s => s.setPreviewMode);
  const preview = useCharacter(s => s.previewMode);
  const comparing = useCharacter(s => s.faceCompareStart !== null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, summary, a, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]')
      )
        return;

      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        onToggleImport?.();
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        randomize();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        state().showToast('Uploading customization data to the gallery…');
      } else if (event.code === 'Space') {
        event.preventDefault();
        state().applyFaceBaseline();
        setPreviewMode(!preview);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleImport, preview, setPreviewMode]);

  const randomize = () => {
    state().resetFaceRegion();
    state().showToast('Reset current region');
  };

  return (
    <footer className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex min-h-[54px] flex-wrap md:flex-nowrap items-center justify-between gap-3 px-4 sm:px-8 py-2 md:py-0 select-none bg-gradient-to-t from-black/80 to-transparent">
      {/* Left Actions */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3 sm:gap-5 text-xs text-[#cfcacf] flex-wrap">
          {/* Return */}
          <button
            type="button"
            onClick={() => state().setWorkspace('edit')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 font-mono text-[10px] font-medium text-[#eae5dc]">
              ↵
            </span>
            <span>Return</span>
          </button>

          {/* [V] Import Customization Data */}
          <button
            type="button"
            onClick={onToggleImport}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>V</Key>
            <span>Import Customization Data</span>
          </button>

          {/* [T] Random */}
          <button
            type="button"
            onClick={randomize}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>T</Key>
            <span>Random</span>
          </button>

          {/* [C] Hold to Compare */}
          <button
            type="button"
            aria-pressed={comparing}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              state().beginFaceCompare();
            }}
            onPointerUp={() => state().endFaceCompare()}
            onPointerCancel={() => state().endFaceCompare()}
            className="hidden lg:flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>C</Key>
            <span>{comparing ? 'Comparing' : 'Compare'}</span>
          </button>
        </div>

        {/* Watermark matching Image 2: ID: 1127544843 */}
        <span className="font-mono text-[10px] tracking-wide text-[#7a7882]/80 select-none">
          ID: 1127544843
        </span>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4 sm:gap-6 text-xs text-[#cfcacf]">
        {/* [R] Upload to the Gallery */}
        <button
          type="button"
          onClick={() => state().showToast('Uploading customization data to the gallery…')}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>R</Key>
          <span>Upload to the Gallery</span>
        </button>

        {/* Select */}
        <span className="hidden sm:inline-flex items-center gap-1 text-[#8f8d97]">
          <span className="text-[11px] font-mono">✕</span>
          <span>Select</span>
        </span>

        {/* Gold Preview Button (Image 2 Match) */}
        <button
          type="button"
          onClick={() => {
            state().applyFaceBaseline();
            setPreviewMode(!preview);
          }}
          className="flex items-center gap-2 rounded-sm bg-[#dfba73] px-3.5 py-1.5 text-xs font-semibold text-black shadow-md transition-all hover:bg-[#eac87f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <span className="font-mono text-[10px] bg-black/20 px-1 rounded-[2px] text-black">Space</span>
          <span>Preview</span>
        </button>
      </div>
    </footer>
  );
}

function MakeupFooter({ onToggleImport }: { onToggleImport?: () => void }) {
  const state = useCharacter.getState;
  const setPreviewMode = useCharacter(s => s.setPreviewMode);
  const preview = useCharacter(s => s.previewMode);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, summary, a, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]')
      )
        return;

      if (event.key.toLowerCase() === 'v') {
        event.preventDefault();
        onToggleImport?.();
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        randomize();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        state().showToast('Uploading customization data to the gallery…');
      } else if (event.code === 'Space') {
        event.preventDefault();
        setPreviewMode(!preview);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleImport, preview, setPreviewMode]);

  const randomize = () => {
    const s = state();
    const brows = s.assetCatalogues.brows ?? [];
    if (brows.length > 0) {
      const pick = brows[Math.floor(Math.random() * brows.length)];
      s.setAssets({ brows: pick.id });
      s.showToast(`Randomized eyebrows: ${pick.label || pick.file}`);
    }
  };

  return (
    <footer className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex min-h-[54px] flex-wrap md:flex-nowrap items-center justify-between gap-3 px-4 sm:px-8 py-2 md:py-0 select-none bg-gradient-to-t from-black/80 to-transparent">
      {/* Left Actions */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-3 sm:gap-5 text-xs text-[#cfcacf] flex-wrap">
          {/* Return */}
          <button
            type="button"
            onClick={() => state().setWorkspace('edit')}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[2px] border border-white/20 bg-[#5f5a5e]/70 font-mono text-[10px] font-medium text-[#eae5dc]">
              ↵
            </span>
            <span>Return</span>
          </button>

          {/* [V] Import Customization Data */}
          <button
            type="button"
            onClick={onToggleImport}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>V</Key>
            <span>Import Customization Data</span>
          </button>

          {/* [T] Random */}
          <button
            type="button"
            onClick={randomize}
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Key>T</Key>
            <span>Random</span>
          </button>
        </div>

        {/* Watermark matching Image 2 & 3: ID: 1127544843 */}
        <span className="font-mono text-[10px] tracking-wide text-[#7a7882]/80 select-none">
          ID: 1127544843
        </span>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4 sm:gap-6 text-xs text-[#cfcacf]">
        {/* [R] Upload to the Gallery */}
        <button
          type="button"
          onClick={() => state().showToast('Uploading customization data to the gallery…')}
          className="flex items-center gap-1.5 transition-colors hover:text-white"
        >
          <Key>R</Key>
          <span>Upload to the Gallery</span>
        </button>

        {/* Select */}
        <span className="hidden sm:inline-flex items-center gap-1 text-[#8f8d97]">
          <span className="text-[11px] font-mono">✕</span>
          <span>Select</span>
        </span>

        {/* Gold Preview Button (Image 2 & 3 Match) */}
        <button
          type="button"
          onClick={() => setPreviewMode(!preview)}
          className="flex items-center gap-2 rounded-sm bg-[#dfba73] px-3.5 py-1.5 text-xs font-semibold text-black shadow-md transition-all hover:bg-[#eac87f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <span className="font-mono text-[10px] bg-black/20 px-1 rounded-[2px] text-black">Space</span>
          <span>Preview</span>
        </button>
      </div>
    </footer>
  );
}
