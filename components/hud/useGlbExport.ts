'use client';

import { useRef, useState } from 'react';
import { useCharacter } from '@/lib/store';
import { exportCharacterGlb } from '@/lib/exportGlb';

export type ExportStatus = { kind: 'ok' | 'error'; text: string };
export interface GlbExportOptions {
  includeLighting?: boolean;
  animated?: boolean;
}

export function useGlbExport(report?: (status: ExportStatus) => void) {
  const [exportingGlb, setExportingGlb] = useState(false);
  const busy = useRef(false);
  const exportGlb = async (options?: GlbExportOptions) => {
    if (busy.current) return;
    const includeLighting = options?.includeLighting !== false;
    const animated = options?.animated ?? true;
    busy.current = true; setExportingGlb(true);
    const flash = (status: ExportStatus) => report ? report(status) : useCharacter.getState().showToast(status.text);
    const characterName = useCharacter.getState().name;
    flash({
      kind: 'ok',
      text: includeLighting ? 'EXPORTING MODEL & RIG (.GLB)...' : 'EXPORTING MODEL (NO LIGHTING .GLB)...',
    });
    try {
      await exportCharacterGlb(characterName, { animated, includeLighting });
      const safeName = (characterName || 'Character').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'Character';
      const fileName = includeLighting ? `${safeName}.glb` : `${safeName}_nolight.glb`;
      flash({ kind: 'ok', text: `EXPORTED ${fileName}` });
    } catch (err) {
      flash({ kind: 'error', text: err instanceof Error ? err.message : 'GLB export failed' });
    } finally {
      busy.current = false; setExportingGlb(false);
    }
  };
  return { exportGlb, exportingGlb };
}
