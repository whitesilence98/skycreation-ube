'use client';

import { useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { parsePreset, payloadFromMorphs, presetFileName } from '@/lib/presetIO';
import { sculptHeadFor } from '@/lib/manifestSelect';
import { cn } from '@/lib/cn';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

type Status = { kind: 'ok' | 'warn' | 'error'; text: string } | null;

interface PresetIOProps {
  manifest: Mo2Manifest | null;
}

/**
 * Import / export for character presets.
 *
 * Export downloads a JSON file (this app's own format, with the same values
 * also listed in RaceMenu's morph vocabulary). Import accepts that file back,
 * or a RaceMenu `.jslot` straight from the mod archive — those are JSON too,
 * and `parsePreset` maps their `morphs.custom` names onto the slider banks.
 *
 * A `.jslot`'s shape lives mostly in `morphs.sculpt`, which cannot be replayed
 * onto a live mesh: the file only stores sparse per-vertex deltas against the
 * exact `.tri` it was authored on (Frau: 26,262 points against 37 named
 * morphs). `scripts/sync_mo2_assets.py` bakes each one into a `headMesh`, so
 * import selects that baked head — otherwise the import is invisible.
 */
export function PresetIO({ manifest }: PresetIOProps) {
  const loadPreset = useCharacter((s) => s.loadPreset);
  const snapshotPreset = useCharacter((s) => s.snapshotPreset);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const flash = (s: Status) => {
    setStatus(s);
    window.setTimeout(() => setStatus(null), 3200);
  };

  const onExport = () => {
    const file = snapshotPreset();
    // Blob rather than a data: URL — preset files carry every region's bank
    // and can exceed what some browsers accept in a URL.
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = presetFileName(file.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    flash({ kind: 'ok', text: `EXPORTED ${presetFileName(file.name)}` });
  };

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const payload = parsePreset(await file.text(), file.name);
      // Select only a head explicitly linked to this preset's filename.
      const head = sculptHeadFor(manifest, payload.sourceFile);
      // Exports already contain FaceGen morphs; do not deform them a second time.
      loadPreset(payload.source === 'racemenu' && head?.origin === 'racemenu-export'
        ? { ...payload, regions: payloadFromMorphs([], { baked: true }).regions }
        : payload, head?.id);
      if (payload.source === 'racemenu') {
        const notes: string[] = [];
        if (payload.unmapped) notes.push(`${payload.unmapped} MORPHS UNMAPPED`);
        if (head) notes.push(`HEAD ${head.label.toUpperCase()}`);
        else notes.push('NO BAKED HEAD');
        flash({
          kind: payload.unmapped || !head ? 'warn' : 'ok',
          text: `IMPORTED ${file.name} · ${notes.join(' · ')}`,
        });
      } else {
        flash({ kind: 'ok', text: `IMPORTED ${file.name}` });
      }
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'Could not read that file.' });
    } finally {
      setBusy(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset first: picking the same file twice must still fire a change.
    e.target.value = '';
    if (file) void readFile(file);
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
        accept=".json,.jslot,application/json"
        onChange={onPick}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group flex items-center gap-[4px] text-[8px] tracking-[0.13em] text-[#b6ad9d]/80 transition-colors hover:text-[#eee2ca] disabled:opacity-40"
      >
        <IconImport className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:-translate-y-[1px]" />
        <span>IMPORT</span>
      </button>
      <span className="h-[9px] w-px bg-[#d4b483]/20" />
      <button
        type="button"
        onClick={onExport}
        className="group flex items-center gap-[4px] text-[8px] tracking-[0.13em] text-[#b6ad9d]/80 transition-colors hover:text-[#eee2ca]"
      >
        <IconExport className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:translate-y-[1px]" />
        <span>EXPORT</span>
      </button>

      {status && (
        <span
          role="status"
          className={cn(
            'max-w-[230px] truncate text-[7px] tracking-[0.11em] uppercase',
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
