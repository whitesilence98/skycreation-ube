'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useCharacter } from '@/lib/store';
import { importPresetFromFiles } from '@/lib/head/nifImport';
import type { Mo2Manifest } from '@/lib/head/faceTexture';

export type ImportStatus = { kind: 'ok' | 'warn' | 'error'; text: string };

/**
 * Shared character preset importer supporting LYRA `.json`, RaceMenu `.jslot`,
 * and baked MO2 `.nif` head meshes (including `.jslot` + `.nif` dual selection).
 */
export function usePresetImport(
  manifest: Mo2Manifest | null,
  report?: (status: ImportStatus) => void,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [importing, setImporting] = useState(false);

  const openFilePicker = () => {
    if (busy.current) return;
    inputRef.current?.click();
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!fileList.length || busy.current) return;

    const { loadPreset, setName, showToast } = useCharacter.getState();
    const flash = (status: ImportStatus) => {
      if (report) {
        report(status);
      } else {
        showToast(status.text);
      }
    };

    busy.current = true;
    setImporting(true);
    try {
      const result = await importPresetFromFiles(fileList, manifest);
      loadPreset(result.payload, result.headOption?.id);
      if (result.characterName) {
        setName(result.characterName.toUpperCase().slice(0, 14));
      }
      flash({ kind: result.kind, text: result.summary });
    } catch (err) {
      flash({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not read that file.',
      });
    } finally {
      busy.current = false;
      setImporting(false);
    }
  };

  return { inputRef, importing, openFilePicker, onFileChange };
}
