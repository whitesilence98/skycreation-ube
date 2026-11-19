'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useCharacter } from '@/lib/store';
import { EQUIP_SLOTS, type EquipSelection, type EquipSlot } from '@/lib/equipment';
import { captureViewport } from '@/lib/presets/capture';
import { normalizeLabel } from '@/lib/presets/records';
import {
  OUTFIT_SET_LABEL_MAX, OUTFIT_SET_LIMIT, buildOutfitSetFile, findOutfitLabelCollision,
  isOutfitLibraryFull, makeOutfitRecord, normalizeOutfitRecord, sameOutfit,
  sortOutfitRecords, upsertOutfitRecord, type OutfitSetRecord,
} from '@/lib/outfits/records';
import { deleteOutfitRecord, listOutfitRecords, saveOutfitRecord, type LibraryResult } from '@/lib/outfits/library';
import {
  notifyOutfitsChanged, registerOutfitSaveHandler, requestOutfitSave,
  subscribeOutfitsChanged, unregisterOutfitSaveHandler,
} from '@/lib/outfits/saveRequest';
import { downloadOutfitSetJson } from '@/lib/outfits/download';
import { SlotIcon } from '@/components/hud/SlotIcon';

type Snapshot = { equipment: EquipSelection; clothingMesh?: string };
type Draft =
  | { kind: 'save'; snapshot: Snapshot; thumbnail?: string; label: string }
  | { kind: 'rename'; record: OutfitSetRecord; label: string }
  | { kind: 'actions'; record: OutfitSetRecord; label: string };
const buttonClass = 'rounded-xs border border-[#d4b483]/30 bg-[#d4b483]/10 px-2 py-1 text-[10px] text-[#e8dcce] hover:bg-[#d4b483]/20 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f] disabled:opacity-40';

export function OutfitSets() {
  const hydrated = useCharacter(s => s.hydrated);
  const equipment = useCharacter(s => s.equipment);
  const clothingMesh = useCharacter(s => s.assetSelection.clothingMesh);
  const [records, setRecords] = useState<OutfitSetRecord[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const refreshSeq = useRef(0);
  const titleId = useId();
  const hasGear = EQUIP_SLOTS.some(slot => !!equipment[slot]) || !!clothingMesh;

  const failure = useCallback((result: Exclude<LibraryResult<unknown>, { ok: true }>) => {
    if (result.reason === 'unavailable') setUnavailable(true);
    throw new Error(result.reason === 'quota'
      ? 'Not enough browser storage — delete a set or free up space.' : result.message);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const result = await listOutfitRecords();
      if (seq !== refreshSeq.current) return;
      if (!result.ok) { failure(result); return; }
      setUnavailable(false);
      setRecords(sortOutfitRecords(result.value));
    } catch (error) {
      if (seq === refreshSeq.current) setStatus(error instanceof Error ? error.message : 'Could not read saved outfits.');
    }
  }, [failure]);

  useEffect(() => {
    setPortalReady(true);
    void refresh();
    const onFocus = () => { void refresh(); };
    const unsubscribe = subscribeOutfitsChanged(onFocus);
    window.addEventListener('focus', onFocus);
    return () => { ++refreshSeq.current; unsubscribe(); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus('');
    try { await work(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'The outfit operation failed.'); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);

  const snapshot = (): Snapshot => {
    const state = useCharacter.getState();
    if (!state.hydrated) throw new Error('Wait for your session to finish loading.');
    if (!EQUIP_SLOTS.some(slot => !!state.equipment[slot]) && !state.assetSelection.clothingMesh) {
      throw new Error('Wear a garment before saving an outfit.');
    }
    return { equipment: { ...state.equipment }, clothingMesh: state.assetSelection.clothingMesh };
  };

  const preview = async (saved: Snapshot) => {
    const thumbnail = await captureViewport();
    const state = useCharacter.getState();
    // A changed outfit must never borrow the old/new outfit's preview.
    return sameOutfit(saved.equipment, state.equipment, saved.clothingMesh, state.assetSelection.clothingMesh)
      ? thumbnail ?? undefined : undefined;
  };

  const openDraft = useCallback((next: Draft) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStatus('');
    setDraft(next);
  }, []);

  const startSave = useCallback(() => {
    if (busyRef.current) return;
    void run(async () => {
      const saved = snapshot();
      const label = normalizeLabel(useCharacter.getState().name);
      openDraft({ kind: 'save', snapshot: saved, label });
      const thumbnail = await preview(saved);
      setDraft(current => current?.kind === 'save' ? { ...current, thumbnail } : current);
    });
  }, [openDraft, run]);

  useEffect(() => {
    registerOutfitSaveHandler(startSave);
    return () => unregisterOutfitSaveHandler(startSave);
  }, [startSave]);

  const closeDraft = useCallback(() => {
    if (!busyRef.current) setDraft(null);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (!draft && dialog.open) {
      dialog.close();
      const previous = returnFocus.current;
      if (previous?.isConnected && !previous.closest('[hidden], [inert]')) previous.focus();
      else document.querySelector<HTMLButtonElement>('.creator-editor-toggle:not([hidden]), nav[aria-label="Character categories"] button[aria-pressed="true"]')?.focus();
      returnFocus.current = null;
    }
    if (draft && !busy && (document.activeElement === dialog || !dialog.contains(document.activeElement))) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [draft, portalReady, busy]);

  useEffect(() => {
    if (!draft) return;
    // Hud listens on document too; Escape belongs to this modal, not the editor.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDraft();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [draft, closeDraft]);

  const freshRecords = async () => {
    const result = await listOutfitRecords();
    if (!result.ok) { failure(result); return []; }
    setUnavailable(false);
    ++refreshSeq.current;
    setRecords(sortOutfitRecords(result.value));
    return result.value;
  };

  const persist = async (record: OutfitSetRecord, verb: string) => {
    let result = await saveOutfitRecord(record);
    let withoutPreview = false;
    if (!result.ok && result.reason === 'quota' && record.thumbnail) {
      result = await saveOutfitRecord({ ...record, thumbnail: undefined });
      withoutPreview = result.ok;
    }
    if (!result.ok) { failure(result); return; }
    ++refreshSeq.current;
    setRecords(current => sortOutfitRecords(upsertOutfitRecord(current, result.value)));
    setDraft(null);
    setStatus(`${verb} “${result.value.label}”${withoutPreview ? ' WITHOUT PREVIEW' : ''}`);
    notifyOutfitsChanged();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || draft.kind === 'actions') return;
    const savedDraft = draft;
    void run(async () => {
      if (!useCharacter.getState().hydrated) throw new Error('Wait for your session to finish loading.');
      const current = await freshRecords();
      const label = normalizeLabel(savedDraft.label);
      if (savedDraft.kind === 'rename') {
        const record = current.find(row => row.id === savedDraft.record.id);
        if (!record) throw new Error('This outfit was deleted. Refresh the sets list.');
        if (findOutfitLabelCollision(current, label, record.id)) throw new Error('That outfit label is already in use.');
        await persist({ ...record, label, updatedAt: new Date().toISOString() }, 'RENAMED');
      } else {
        const collision = findOutfitLabelCollision(current, label);
        if (isOutfitLibraryFull(current, collision?.id)) throw new Error(`Library full (${OUTFIT_SET_LIMIT}) — use an existing label to replace a set.`);
        if (collision && !window.confirm(`Replace “${collision.label}”? This overwrites the saved outfit.`)) return;
        const record = makeOutfitRecord({ label, ...savedDraft.snapshot, thumbnail: savedDraft.thumbnail, id: collision?.id });
        await persist(collision ? { ...record, createdAt: collision.createdAt } : record, collision ? 'REPLACED' : 'SAVED');
      }
    });
  };

  const apply = (input: OutfitSetRecord) => {
    if (busyRef.current) return;
    const state = useCharacter.getState();
    if (!state.hydrated) { setStatus('Wait for your session to finish loading.'); return; }
    const record = normalizeOutfitRecord(input);
    if (!record) { setStatus('That saved outfit is invalid.'); return; }
    if (sameOutfit(state.equipment, record.equipment, state.assetSelection.clothingMesh, record.clothingMesh)) return;
    if (!window.confirm(`Apply “${record.label}”? This replaces your worn gear.`)) return;
    const patch: Partial<Record<EquipSlot, string | null>> = {};
    for (const slot of EQUIP_SLOTS) patch[slot] = record.equipment[slot] ?? null;
    state.setEquip(patch);
    state.setAssets({ clothingMesh: record.clothingMesh ?? null });
    setStatus(`APPLIED “${record.label}”`);
  };

  const update = (record: OutfitSetRecord) => {
    if (busyRef.current || !window.confirm(`Update “${record.label}” from your current worn gear? This replaces the saved outfit.`)) return;
    void run(async () => {
      const saved = snapshot();
      const current = (await freshRecords()).find(row => row.id === record.id);
      if (!current) throw new Error('This outfit was deleted. Refresh the sets list.');
      const thumbnail = await preview(saved);
      const next = makeOutfitRecord({ label: current.label, ...saved, thumbnail, id: current.id });
      await persist({ ...next, createdAt: current.createdAt }, 'UPDATED');
    });
  };

  const remove = (record: OutfitSetRecord) => {
    if (busyRef.current || !window.confirm(`Delete “${record.label}”? This cannot be undone.`)) return;
    void run(async () => {
      const result = await deleteOutfitRecord(record.id);
      if (!result.ok) { failure(result); return; }
      ++refreshSeq.current;
      setRecords(current => current.filter(row => row.id !== record.id));
      setDraft(null);
      setStatus(`DELETED “${record.label}”`);
      notifyOutfitsChanged();
    });
  };

  return <section className="creator-wardrobe-sets min-w-0 border-y border-[#d4b483]/15 py-2" aria-label="Saved outfit sets" aria-busy={busy}>
    <div className="mb-2 flex items-center justify-between text-[10px] font-mono text-[#c4b595]">
      <h3>SETS</h3>
      <div className="flex items-center gap-2"><span>{records.length}/{OUTFIT_SET_LIMIT}</span>
        <button type="button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh saved outfits" className={buttonClass}>↻</button>
      </div>
    </div>
    <div className="creator-wardrobe-set-strip flex min-w-0 max-w-full gap-2 overflow-x-auto pb-2">
      <button type="button" onClick={() => requestOutfitSave()} disabled={!hydrated || busy || unavailable || !hasGear}
        title={records.length >= OUTFIT_SET_LIMIT ? 'Library full — use an existing label to replace a set' : 'Save your current worn gear'}
        className={`${buttonClass} flex w-20 shrink-0 flex-col items-center justify-center gap-1`}><span aria-hidden="true">+</span>Save current</button>
      {records.map(record => {
        const applied = sameOutfit(equipment, record.equipment, clothingMesh, record.clothingMesh);
        const primary = EQUIP_SLOTS.find(slot => record.equipment[slot]) ?? 'outfit';
        return <div key={record.id} className="creator-wardrobe-set w-24 shrink-0">
          <button type="button" onClick={() => apply(record)} disabled={!hydrated || busy} aria-pressed={applied}
            aria-label={`Apply outfit ${record.label}`}
            title={`${record.label}${applied ? ' — worn' : ''}. Missing pack items may not render; cross-slot items require unrestricted slots.`}
            className={`${buttonClass} flex w-full flex-col items-center gap-1 ${applied ? 'border-[#eac87f] text-[#eac87f]' : ''}`}>
            {record.thumbnail ? <img src={record.thumbnail} alt="" className="h-12 w-12 rounded-xs object-cover" />
              : <SlotIcon slot={primary} className="h-12 w-12 p-2" />}
            <span className="block w-full truncate">{applied && <span aria-hidden="true">✓ </span>}{record.label}</span>
          </button>
          <button type="button" onClick={() => openDraft({ kind: 'actions', record, label: record.label })} disabled={busy}
            aria-label={`Actions for ${record.label}`} className={`${buttonClass} mt-1 w-full`}>⋯</button>
        </div>;
      })}
    </div>
    {unavailable ? <p role="status" className="text-[10px] text-[#e0a898]">Outfit sets unavailable — browser storage is blocked.</p>
      : !records.length && <p className="text-[10px] text-[#a9a192]">Save worn gear as a set. Stored in this browser only.</p>}
    {status && <p role="status" className="mt-1 break-words text-[10px] text-[#e8dcce]">{status}</p>}
    {portalReady && createPortal(<dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); closeDraft(); }}
      onClose={() => { if (!busyRef.current) setDraft(null); }}
      className="m-auto max-h-[90dvh] w-[min(92vw,340px)] overflow-y-auto rounded-xs border border-[#d4b483]/40 bg-[#161311] p-4 text-[#e6e1d8] backdrop:bg-black/70">
      {draft && <form onSubmit={submit} className="flex flex-col gap-3">
        <h3 id={titleId} className="font-mono text-xs uppercase tracking-wider">{draft.kind === 'save' ? 'Save outfit' : draft.kind === 'rename' ? 'Rename outfit' : draft.record.label}</h3>
        {draft.kind === 'actions' ? <>
          <button type="button" disabled={busy} onClick={() => { setStatus(''); setDraft({ ...draft, kind: 'rename' }); requestAnimationFrame(() => inputRef.current?.select()); }} className={buttonClass}>Rename</button>
          <button type="button" disabled={busy || !hydrated || !hasGear} onClick={() => update(draft.record)} className={buttonClass}>Update from current</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => { downloadOutfitSetJson(buildOutfitSetFile(draft.record)); setDraft(null); setStatus(`EXPORTED “${draft.record.label}”`); })} className={buttonClass}>Export JSON</button>
          <button type="button" disabled={busy} onClick={() => remove(draft.record)} className={`${buttonClass} text-[#e0a898]`}>Delete</button>
        </> : <>
          {draft.kind === 'save' && draft.thumbnail && <img src={draft.thumbnail} alt="Outfit preview" className="h-20 w-20 self-center rounded-xs object-cover" />}
          <label className="flex flex-col gap-1 text-xs">Label<input ref={inputRef} type="text" aria-label="Outfit label" value={draft.label} maxLength={OUTFIT_SET_LABEL_MAX} disabled={busy}
            onChange={event => setDraft({ ...draft, label: event.target.value })} className="min-w-0 rounded-xs border border-[#d4b483]/40 bg-black/40 px-2 py-1 text-sm focus:outline focus:outline-1 focus:outline-[#eac87f]" /></label>
          <p className="text-[10px] text-[#a9a192]">Local browser storage only. Export JSON for a portable backup.</p>
          <button type="submit" disabled={busy || !hydrated} className={buttonClass}>{draft.kind === 'rename' ? 'Save label' : 'Save outfit'}</button>
        </>}
        {status && <p role="alert" className="text-xs text-[#e0a898]">{status}</p>}
        <button type="button" onClick={closeDraft} disabled={busy} className={buttonClass}>{draft.kind === 'actions' ? 'Close' : 'Cancel'}</button>
      </form>}
    </dialog>, document.body)}
  </section>;
}
