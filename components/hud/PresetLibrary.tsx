'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import { useCharacter } from '@/lib/store';
import { parsePreset, presetFileName, type PresetFile } from '@/lib/presetIO';
import { cn } from '@/lib/cn';
import { captureViewport } from '@/lib/presets/capture';
import {
  PRESET_LABEL_MAX,
  PRESET_LIBRARY_LIMIT,
  findLabelCollision,
  formatRelativeDate,
  makeRecord,
  normalizeLabel,
  sortRecords,
  type PresetLibraryRecord,
} from '@/lib/presets/records';
import {
  deletePresetRecord,
  listPresetRecords,
  savePresetRecord,
} from '@/lib/presets/library';
import { downloadPresetJson } from '@/lib/presets/download';

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

type Draft = {
  preset: PresetFile;
  thumbnail: string | null;
  label: string;
};

type FailureReason = 'unavailable' | 'quota' | 'error';

function failureText(reason: FailureReason, message?: string): string {
  if (reason === 'unavailable') return 'PRESET LIBRARY UNAVAILABLE — BROWSER STORAGE IS BLOCKED';
  if (reason === 'quota') return 'NOT ENOUGH BROWSER STORAGE — DELETE A PRESET OR FREE UP SPACE';
  return message ?? 'THE PRESET LIBRARY REQUEST FAILED';
}

/**
 * Named preset library backed by IndexedDB (the storage layer lives in
 * `lib/presets`). Built-in cards stay untouched; this section only ever
 * writes its own database, never the session autosave or dynamic meshes.
 */
export function PresetLibrary() {
  const hydrated = useCharacter((s) => s.hydrated);
  const characterName = useCharacter((s) => s.name);
  const snapshotPreset = useCharacter((s) => s.snapshotPreset);
  const loadPreset = useCharacter((s) => s.loadPreset);

  const [records, setRecords] = useState<PresetLibraryRecord[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshSeq = useRef(0);
  const toastTimer = useRef<number | null>(null);

  const flash = useCallback((next: Status) => {
    setStatus(next);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (next) toastTimer.current = window.setTimeout(() => setStatus(null), 3500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const result = await listPresetRecords();
    if (seq !== refreshSeq.current) return;
    if (!result.ok) {
      if (result.reason === 'unavailable') setUnavailable(true);
      else flash({ kind: 'error', text: failureText(result.reason, result.message) });
      return;
    }
    setUnavailable(false);
    setRecords(sortRecords(result.value));
  }, [flash]);

  useEffect(() => {
    void refresh();
    /* Another tab may have changed the library while this one was hidden. */
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Drive the native dialog so focus trapping and Escape come from the browser.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (draft && !el.open) {
      el.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (!draft && el.open) {
      el.close();
    }
  }, [draft]);

  /* ── Save ────────────────────────────────────────────────────────────── */

  const startSave = async () => {
    if (!hydrated || busyRef.current || unavailable) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // The snapshot is taken before the viewport read so the saved look is
      // exactly what was on screen when the button was pressed.
      const preset = snapshotPreset();
      const thumbnail = await captureViewport();
      setDraftError(null);
      setDraft({ preset, thumbnail, label: normalizeLabel(characterName, 'Untitled') });
    } catch {
      flash({ kind: 'error', text: 'COULD NOT READ THE CURRENT CHARACTER' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const closeDraft = () => {
    if (busyRef.current) return;
    setDraftError(null);
    setDraft(null);
  };

  const submitDraft = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || busyRef.current) return;
    const label = normalizeLabel(draft.label, 'Untitled');
    busyRef.current = true;
    setBusy(true);
    try {
      // Re-read just before deciding: the count and label ownership must come
      // from the same fresh snapshot the write is judged against.
      const fresh = await listPresetRecords();
      if (!fresh.ok) {
        if (fresh.reason === 'unavailable') setUnavailable(true);
        setDraftError(failureText(fresh.reason, fresh.message));
        return;
      }
      const existing = fresh.value;
      setUnavailable(false);
      setRecords(sortRecords(existing));

      const collision = findLabelCollision(existing, label);
      if (!collision && existing.length >= PRESET_LIBRARY_LIMIT) {
        setDraftError(`Library full (${PRESET_LIBRARY_LIMIT}) — delete a preset first.`);
        return;
      }
      if (collision && !window.confirm(`Replace “${collision.label}”?`)) return;

      let record = makeRecord({
        label,
        preset: draft.preset,
        thumbnail: draft.thumbnail ?? undefined,
      });
      if (collision) record = { ...record, id: collision.id, createdAt: collision.createdAt };

      let result = await savePresetRecord(record);
      let withoutPreview = false;
      if (!result.ok && result.reason === 'quota' && record.thumbnail) {
        result = await savePresetRecord({ ...record, thumbnail: undefined });
        withoutPreview = result.ok;
      }
      if (!result.ok) {
        // The previous record was never removed, so a failed overwrite keeps it.
        setDraftError(failureText(result.reason, result.message));
        return;
      }

      const saved = result.value;
      setRecords((prev) => sortRecords([...prev.filter((r) => r.id !== saved.id), saved]));
      setDraft(null);
      flash(
        withoutPreview
          ? { kind: 'warn', text: `SAVED “${label}” WITHOUT PREVIEW` }
          : { kind: 'ok', text: collision ? `REPLACED “${label}”` : `SAVED “${label}”` },
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /* ── Row actions ─────────────────────────────────────────────────────── */

  const loadRecord = (record: PresetLibraryRecord) => {
    if (busyRef.current) return;
    if (!window.confirm(`Load “${record.label}”? This replaces the current face and clears undo history.`)) {
      return;
    }
    try {
      const payload = parsePreset(JSON.stringify(record.preset));
      loadPreset(payload);
      flash({ kind: 'ok', text: `LOADED “${record.label}”` });
    } catch {
      flash({ kind: 'error', text: 'THAT SAVED PRESET COULD NOT BE READ' });
    }
  };

  const submitRename = async (e: FormEvent, record: PresetLibraryRecord) => {
    e.preventDefault();
    if (busyRef.current) return;
    const label = normalizeLabel(renameValue, record.label);
    busyRef.current = true;
    setBusy(true);
    try {
      const fresh = await listPresetRecords();
      if (!fresh.ok) {
        flash({ kind: 'error', text: failureText(fresh.reason, fresh.message) });
        return;
      }
      const collision = findLabelCollision(fresh.value, label, record.id);
      if (collision) {
        flash({ kind: 'error', text: `“${collision.label}” IS ALREADY IN USE` });
        return;
      }
      const result = await savePresetRecord({
        ...record,
        label,
        updatedAt: new Date().toISOString(),
      });
      if (!result.ok) {
        flash({ kind: 'error', text: failureText(result.reason, result.message) });
        return;
      }
      const saved = result.value;
      setRecords((prev) => sortRecords(prev.map((r) => (r.id === record.id ? saved : r))));
      setRenameId(null);
      flash({ kind: 'ok', text: `RENAMED TO “${saved.label}”` });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const updateRecord = async (record: PresetLibraryRecord) => {
    if (busyRef.current) return;
    if (!window.confirm(`Update “${record.label}” from the current character?`)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const preset = snapshotPreset();
      const thumbnail = await captureViewport();
      const next: PresetLibraryRecord = {
        ...makeRecord({
          label: record.label,
          preset,
          thumbnail: thumbnail ?? undefined,
          id: record.id,
        }),
        createdAt: record.createdAt,
      };

      let result = await savePresetRecord(next);
      let withoutPreview = false;
      if (!result.ok && result.reason === 'quota' && next.thumbnail) {
        result = await savePresetRecord({ ...next, thumbnail: undefined });
        withoutPreview = result.ok;
      }
      if (!result.ok) {
        flash({ kind: 'error', text: failureText(result.reason, result.message) });
        return;
      }
      const saved = result.value;
      setRecords((prev) => sortRecords(prev.map((r) => (r.id === record.id ? saved : r))));
      flash(
        withoutPreview
          ? { kind: 'warn', text: `UPDATED “${record.label}” WITHOUT PREVIEW` }
          : { kind: 'ok', text: `UPDATED “${record.label}”` },
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const exportRecord = (record: PresetLibraryRecord) => {
    downloadPresetJson(record.preset);
    flash({ kind: 'ok', text: `EXPORTED ${presetFileName(record.preset.name)}` });
  };

  const deleteRecord = async (record: PresetLibraryRecord) => {
    if (busyRef.current) return;
    if (!window.confirm(`Delete “${record.label}”? This cannot be undone.`)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await deletePresetRecord(record.id);
      if (!result.ok) {
        flash({ kind: 'error', text: failureText(result.reason, result.message) });
        return;
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      flash({ kind: 'ok', text: `DELETED “${record.label}”` });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const fromMenu = (e: MouseEvent, action: () => void) => {
    const details = e.currentTarget.closest('details');
    if (details instanceof HTMLDetailsElement) details.open = false;
    action();
  };

  const saveTitle = unavailable
    ? 'Preset library unavailable — browser storage is blocked'
    : !hydrated
      ? 'Loading your session…'
      : records.length >= PRESET_LIBRARY_LIMIT
        ? 'Library full — save with an existing label to overwrite'
        : 'Save the current character as a named preset';

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-2 border-t border-[#d4b483]/14 pt-2.5 select-none text-[#e6e1d8]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]">
          YOUR PRESETS
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono tracking-wider text-[#8f8778]">
            {records.length}/{PRESET_LIBRARY_LIMIT}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            aria-label="Refresh saved presets"
            title="Refresh saved presets"
            className="flex min-h-[24px] min-w-[24px] items-center justify-center rounded-xs px-1 text-[11px] leading-none text-[#c4b595] transition-colors hover:text-[#f2dfbe] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f] disabled:opacity-40"
          >
            ↻
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void startSave()}
        disabled={!hydrated || busy || unavailable}
        title={saveTitle}
        className={cn(
          'min-h-[28px] w-full rounded-xs border px-2.5 py-1.5 text-[10px] font-mono tracking-[0.12em] uppercase transition-colors',
          'border-[#d4b483]/35 bg-[#d4b483]/10 text-[#e8dcce]',
          'hover:border-[#d4b483]/70 hover:bg-[#d4b483]/20 hover:text-[#fff0d4]',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#d4b483]/35 disabled:hover:bg-[#d4b483]/10',
        )}
      >
        Save current character
      </button>

      {unavailable ? (
        <p className="text-[10px] leading-relaxed text-[#b8b0a0]">
          Preset library unavailable — browser storage is blocked. Built-in presets and JSON
          import/export still work.
        </p>
      ) : records.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-[#8f8778]">
          No saved presets yet. Save the current character to build your library.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" onKeyDown={e => {
          if (e.key !== 'Escape') return;
          e.currentTarget.querySelectorAll('details[open]').forEach(details => details.removeAttribute('open'));
        }}>
          {records.map((record) => (
            <li key={record.id} className="flex flex-col gap-1">
              <div className="flex items-stretch gap-1">
                <button
                  type="button"
                  onClick={() => loadRecord(record)}
                  disabled={busy}
                  aria-label={`Load preset ${record.label}`}
                  title={`Load “${record.label}”`}
                  className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-xs border border-[#d4b483]/20 bg-black/35 p-1.5 text-left transition-colors hover:border-[#d4b483]/55 disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#eac87f]"
                >
                  {record.thumbnail ? (
                    <img
                      src={record.thumbnail}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-xs border border-[#d4b483]/20 object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs border border-[#d4b483]/20 text-[10px] text-[#8f8778]">
                      —
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] text-[#e8dcce]">{record.label}</span>
                    <span className="block font-mono text-[10px] text-[#8f8778]">
                      {formatRelativeDate(record.updatedAt)}
                    </span>
                  </span>
                </button>

                <details className="relative shrink-0">
                  <summary
                    aria-label={`Actions for ${record.label}`}
                    title="Preset actions"
                    className="flex min-h-[24px] min-w-[24px] cursor-pointer list-none items-center justify-center rounded-xs border border-[#d4b483]/20 px-1.5 text-[#c4b595] transition-colors hover:border-[#d4b483]/55 hover:text-[#f2dfbe] [&::-webkit-details-marker]:hidden"
                  >
                    ⋯
                  </summary>
                  <div className="absolute right-0 top-[calc(100%+4px)] z-20 flex w-[150px] flex-col gap-1 rounded-xs border border-[#463a2e] bg-[#161311]/96 p-1.5 backdrop-blur-md">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) =>
                        fromMenu(e, () => {
                          setRenameId(record.id);
                          setRenameValue(record.label);
                        })
                      }
                      className="min-h-[24px] rounded-xs px-1.5 py-1 text-left text-[10px] text-[#d8c39c] hover:bg-[#d4b483]/15 hover:text-[#fff0d4] disabled:opacity-40"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => fromMenu(e, () => void updateRecord(record))}
                      className="min-h-[24px] rounded-xs px-1.5 py-1 text-left text-[10px] text-[#d8c39c] hover:bg-[#d4b483]/15 hover:text-[#fff0d4] disabled:opacity-40"
                    >
                      Update from current
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => fromMenu(e, () => exportRecord(record))}
                      className="min-h-[24px] rounded-xs px-1.5 py-1 text-left text-[10px] text-[#d8c39c] hover:bg-[#d4b483]/15 hover:text-[#fff0d4] disabled:opacity-40"
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => fromMenu(e, () => void deleteRecord(record))}
                      className="min-h-[24px] rounded-xs px-1.5 py-1 text-left text-[10px] text-[#e0967c] hover:bg-[#e0967c]/15 hover:text-[#f2b8a2] disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </details>
              </div>

              {renameId === record.id && (
                <form
                  onSubmit={(e) => void submitRename(e, record)}
                  className="flex items-center gap-1"
                >
                  <input
                    type="text"
                    aria-label="New preset label"
                    value={renameValue}
                    maxLength={PRESET_LABEL_MAX}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="min-w-0 flex-1 rounded-xs border border-[#d4b483]/30 bg-black/45 px-1.5 py-1 text-[10px] text-[#e8dcce] focus:outline focus:outline-1 focus:outline-[#eac87f]"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[24px] rounded-xs border border-[#d4b483]/35 bg-[#d4b483]/10 px-1.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#e8dcce] hover:bg-[#d4b483]/20 disabled:opacity-40"
                  >
                    Save label
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRenameId(null)}
                    className="min-h-[24px] rounded-xs px-1.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#8f8778] hover:text-[#c4b9a3] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] font-mono leading-relaxed tracking-wide text-[#8b8375]/80">
        Stored in this browser only — export JSON for a portable backup.
      </p>

      {status && (
        <div
          role="status"
          className={cn(
            'text-center font-mono text-[10px] tracking-wide uppercase',
            status.kind === 'error'
              ? 'text-[#e0967c]'
              : status.kind === 'warn'
                ? 'text-[#e0c48d]'
                : 'text-[#a9c9b6]',
          )}
        >
          {status.text}
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="preset-save-title"
        onCancel={(e) => {
          if (busyRef.current) e.preventDefault();
        }}
        onClose={() => {
          if (!busyRef.current) {
            setDraft(null);
            setDraftError(null);
          }
        }}
        className="m-auto w-[min(92vw,320px)] max-h-[90vh] overflow-y-auto scrollbar-none rounded-xs border border-[#d4b483]/30 bg-[#161311] p-3 text-[#e6e1d8] shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop:bg-black/70"
      >
        {draft && (
          <form onSubmit={(e) => void submitDraft(e)} className="flex flex-col gap-2.5">
            <h3
              id="preset-save-title"
              className="text-[10px] font-mono tracking-[0.14em] uppercase text-[#c4b595]"
            >
              Save preset
            </h3>

            <div className="flex items-center gap-2.5">
              {draft.thumbnail ? (
                <img
                  src={draft.thumbnail}
                  alt="Preset preview"
                  className="h-16 w-16 shrink-0 rounded-xs border border-[#d4b483]/25 object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xs border border-[#d4b483]/20 bg-black/45 text-[10px] text-[#8f8778]">
                  No preview
                </span>
              )}
              <div className="min-w-0">
                <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-[#c4b595]">
                  Label
                  <input
                    ref={inputRef}
                    type="text"
                    aria-label="Preset label input"
                    value={draft.label}
                    maxLength={PRESET_LABEL_MAX}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    className="w-full rounded-xs border border-[#d4b483]/30 bg-black/45 px-1.5 py-1 text-[11px] text-[#e8dcce] focus:outline focus:outline-1 focus:outline-[#eac87f]"
                  />
                </label>
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-[#8f8778]">
              Saved in this browser only — no cross-device backup.
            </p>

            {draftError && (
              <p role="alert" className="text-[10px] leading-relaxed text-[#e0967c]">
                {draftError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDraft}
                disabled={busy}
                className="min-h-[24px] rounded-xs px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[#8f8778] transition-colors hover:text-[#c4b9a3] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[24px] rounded-xs border border-[#d4b483]/40 bg-[#d4b483]/15 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[#f2dfbe] transition-colors hover:bg-[#d4b483]/25 disabled:opacity-40"
              >
                Save preset
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
