'use client';

import { useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { presetFileName } from '@/lib/presetIO';
import { exportCharacterGlb } from '@/lib/exportGlb';
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
  const characterName = useCharacter((s) => s.name);
  const [exportingGlb, setExportingGlb] = useState(false);

  const onExportGlb = async () => {
    setExportingGlb(true);
    flash({ kind: 'ok', text: 'EXPORTING MODEL & RIG (.GLB)...' });
    try {
      await exportCharacterGlb(characterName);
      const safeName = (characterName || 'Character').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
      flash({ kind: 'ok', text: `EXPORTED ${safeName}.glb` });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'GLB export failed' });
    } finally {
      setExportingGlb(false);
    }
  };

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

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || !files.length) return;

    setBusy(true);
    try {
      const result = await importPresetFromFiles(files, manifest);
      loadPreset(result.payload, result.headOption?.id);
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
        accept=".json,.jslot,.nif,application/json"
        onChange={onPick}
        className="hidden"
      />
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
      <button
        type="button"
        onClick={onExport}
        className="group flex items-center gap-[4px] text-[10px] tracking-[0.13em] text-[#b6ad9d]/80 transition-colors hover:text-[#eee2ca]"
      >
        <IconExport className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:translate-y-[1px]" />
        <span>EXPORT</span>
      </button>
      <span className="h-[9px] w-px bg-[#d4b483]/20" />
      <button
        type="button"
        onClick={onExportGlb}
        disabled={exportingGlb}
        title="Export complete 3D model with skeletal rig (.glb) for Blender"
        className="group flex items-center gap-[4px] text-[10px] tracking-[0.13em] text-[#b6ad9d]/80 transition-colors hover:text-[#eee2ca] disabled:opacity-40"
      >
        <IconCube className="h-[9px] w-[9px] opacity-70 transition-transform group-hover:scale-110" />
        <span>{exportingGlb ? 'EXPORTING...' : 'EXPORT .GLB'}</span>
      </button>

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

function IconCube({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden>
      <path d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6L6 1.2Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M6 6v4.8M6 6 1.8 3.6M6 6l4.2-2.4" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
    </svg>
  );
}
