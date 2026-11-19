'use client';

import { useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { exportCharacterGlb } from '@/lib/exportGlb';

export type ExportStatus = { kind: 'ok' | 'error'; text: string };

export function useGlbExport(report?: (status: ExportStatus) => void) {
  const [exportingGlb, setExportingGlb] = useState(false);
  const busy = useRef(false);
  const exportGlb = async () => {
    if (busy.current) return;
    busy.current = true; setExportingGlb(true);
    const flash = (status: ExportStatus) => report ? report(status) : useCharacter.getState().showToast(status.text);
    const characterName = useCharacter.getState().name;
    flash({ kind: 'ok', text: 'EXPORTING MODEL & RIG (.GLB)...' });
    try {
      await exportCharacterGlb(characterName, { animated: true });
      const safeName = (characterName || 'Character').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
      flash({ kind: 'ok', text: `EXPORTED ${safeName}.glb` });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'GLB export failed' });
    } finally {
      busy.current = false; setExportingGlb(false);
    }
  };
  return { exportGlb, exportingGlb };
}
