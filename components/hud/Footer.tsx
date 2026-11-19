'use client';

import { useEffect, useRef, useState } from 'react';
import { PresetIO } from '@/components/hud/PresetIO';
import { useGlbExport } from '@/components/hud/useGlbExport';
import { EQUIP_SLOTS, type EquipSlot } from '@/lib/equipment';
import { listOutfitRecords, saveOutfitRecord } from '@/lib/outfits/library';
import { findOutfitLabelCollision, isOutfitLibraryFull, makeOutfitRecord, OUTFIT_SET_JSON_MAX_CHARS, parseOutfitSetFile, sameOutfit } from '@/lib/outfits/records';
import { exitWardrobe } from '@/lib/editorNav';
import { notifyOutfitsChanged, requestOutfitSave } from '@/lib/outfits/saveRequest';
import { useCharacter } from '@/lib/store';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

/**
 * Reference footer grammar: a left cluster of plain text actions prefixed by a
 * key glyph, a right cluster that ends in one filled gold button. The key
 * glyphs are shown as small outlined boxes, matching the reference's
 * controller/button hints.
 */
function Key({ children }: { children: React.ReactNode }) {
  return <span className="creator-key" aria-hidden>{children}</span>;
}

export function Footer({ manifest }: { manifest: Mo2Manifest | null }) {
  const isOutfit = useCharacter(s => s.primaryTab === 'EQUIPMENT');
  const isFace = useCharacter(s => s.primaryTab === 'FACE SHAPE');
  const past = useCharacter(s => s.facePast.length);
  const future = useCharacter(s => s.faceFuture.length);
  const comparing = useCharacter(s => s.faceCompareStart !== null);
  const preview = useCharacter(s => s.previewMode);
  const state = useCharacter.getState;
  if (isOutfit) return <OutfitFooter />;
  return <footer className="creator-footer">
    <div className="creator-footer-context">
      <button type="button" onClick={() => state().setWorkspace('edit')}><Key>Esc</Key><span>Return</span></button>
      {isFace && <>
        <button type="button" disabled={!past || comparing} onClick={() => state().undoFace()}><Key>Ctrl+Z</Key><span>Undo</span></button>
        <button type="button" disabled={!future || comparing} onClick={() => state().redoFace()}><Key>Ctrl+Y</Key><span>Redo</span></button>
        <button type="button" aria-pressed={comparing}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); state().beginFaceCompare(); }}
          onPointerUp={() => state().endFaceCompare()} onPointerCancel={() => state().endFaceCompare()}
          onLostPointerCapture={() => state().endFaceCompare()} onBlur={() => state().endFaceCompare()}
          onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); state().beginFaceCompare(); } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') state().endFaceCompare(); }}>
          <Key>C</Key><span>{comparing ? 'Showing last saved point' : 'Hold to compare'}</span>
        </button>
        <button type="button" disabled={comparing} onClick={() => state().resetFaceRegion()}><Key>R</Key><span>Reset region</span></button>
      </>}
    </div>
    <div className="creator-footer-actions">
      <PresetIO manifest={manifest} />
      {!preview && <button type="button" className="creator-primary-action" disabled={comparing}
        onClick={() => {
          state().applyFaceBaseline(); state().setPreviewMode(true);
          state().showToast('Preview on · compare now returns to this point');
        }}><Key>Space</Key><span>Complete</span></button>}
    </div>
  </footer>;
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
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key !== ' ' || document.querySelector('dialog[open], details[open], [role="menu"]')) return;
      const target = event.target;
      if (target instanceof Element && target.closest('button, summary, a, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]')) return;
      event.preventDefault(); state().setPreviewMode(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const importOutfit = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy.current) return;
    if (!state().hydrated) { state().showToast('Wait for your character to finish loading.'); return; }
    busy.current = true; setImporting(true);
    try {
      if (!/\.json$/i.test(file.name)) throw Error('Choose a .json outfit file. Character presets and .jslot files belong on the Presets page.');
      if (file.size > OUTFIT_SET_JSON_MAX_CHARS) throw Error('Outfit file is too large (32 KB maximum).');
      const recordFile = parseOutfitSetFile(await file.text());
      if (!recordFile) throw Error('Not a valid lyra-outfit file. Character presets must be loaded from the Presets page.');
      const listed = await listOutfitRecords();
      if (!listed.ok) throw Error(listed.message);
      const collision = findOutfitLabelCollision(listed.value, recordFile.label);
      if (collision && !window.confirm(`Replace saved outfit "${collision.label}"?`)) return;
      if (isOutfitLibraryFull(listed.value, collision?.id)) throw Error('Outfit library is full. Delete a set before importing another.');
      const before = state();
      if (!sameOutfit(before.equipment, recordFile.equipment, before.assetSelection.clothingMesh, recordFile.clothingMesh) &&
          !window.confirm(`Import and apply "${recordFile.label}"? This replaces all worn gear.`)) return;
      const record = makeOutfitRecord({ ...recordFile, id: collision?.id });
      if (collision) record.createdAt = collision.createdAt;
      const saved = await saveOutfitRecord(record);
      if (!saved.ok) throw Error(saved.reason === 'quota' ? 'Storage is full. Outfit was not imported; worn gear is unchanged.' : saved.message);
      notifyOutfitsChanged();
      const current = state();
      if (!sameOutfit(before.equipment, current.equipment, before.assetSelection.clothingMesh, current.assetSelection.clothingMesh) &&
          !window.confirm('Your worn gear changed during import. Apply the saved outfit now?')) {
        state().showToast(`SAVED ${saved.value.label}; worn gear unchanged`); return;
      }
      state().setEquip(Object.fromEntries(EQUIP_SLOTS.map(slot => [slot, saved.value.equipment[slot] ?? null])) as Record<EquipSlot, string | null>);
      state().setAssets({ clothingMesh: saved.value.clothingMesh ?? null });
      state().showToast(`IMPORTED ${saved.value.label}`);
    } catch (error) {
      state().showToast(error instanceof Error ? error.message : 'Outfit import failed. Worn gear is unchanged.');
    } finally { busy.current = false; setImporting(false); }
  };

  const clearGear = () => {
    if (!state().hydrated || !window.confirm('Clear all worn garments and accessories?')) return;
    state().setEquip(Object.fromEntries(EQUIP_SLOTS.map(slot => [slot, null])) as Record<EquipSlot, null>);
    state().setAssets({ clothingMesh: null });
    if (more.current) more.current.open = false;
  };

  return <footer className="creator-footer creator-footer-outfit">
    <div className="creator-footer-context">
      <button type="button" onClick={exitWardrobe}><Key>Esc</Key><span>Return</span></button>
      <input ref={input} type="file" accept=".json" aria-label="Import outfit JSON" hidden onChange={importOutfit} />
      <button type="button" disabled={!hydrated || importing} onClick={() => input.current?.click()}>{importing ? 'Importing outfit…' : 'Import outfit'}</button>
      <button type="button" disabled={!hydrated || importing} onClick={() => {
        if (!requestOutfitSave()) state().showToast('Open the Outfit panel to save your worn gear.');
      }}>Save outfit</button>
      <button type="button" disabled={exportingGlb} onClick={exportGlb}>{exportingGlb ? 'Exporting GLB…' : 'Export GLB'}</button>
      <details ref={more} className="creator-outfit-more" onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.open) {
          event.stopPropagation(); event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}>
        <summary>More options</summary>
        <div role="group" aria-label="Outfit options">
          <button type="button" disabled={!hydrated} onClick={clearGear}>Clear all gear</button>
          <button type="button" aria-pressed={unrestricted} onClick={() => state().toggleUnrestrictedSlots()}>Unrestricted slots</button>
          <button type="button" aria-pressed={!garmentsVisible} onClick={() => state().setGarmentVisible(!state().garmentVisible)}>Hide garments</button>
        </div>
      </details>
    </div>
    <div className="creator-footer-actions">
      <button type="button" className="creator-primary-action" onClick={() => state().setPreviewMode(true)}><Key>Space</Key><span>Preview</span></button>
    </div>
  </footer>;
}
