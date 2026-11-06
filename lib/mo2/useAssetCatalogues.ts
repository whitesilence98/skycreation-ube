'use client';

import { useEffect } from 'react';
import { useCharacter } from '@/lib/store';
import { fetchCatalogue } from '@/lib/mo2/client';
import type { AssetKind } from '@/lib/manifestSelect';

/** Restored presets resolve archive ids even if their picker has never been opened. */
export function useAssetCatalogues() {
  const selection = useCharacter((s) => s.assetSelection);
  const catalogues = useCharacter((s) => s.assetCatalogues);
  const register = useCharacter((s) => s.setAssetCatalogue);
  useEffect(() => {
    let cancelled = false;
    for (const kind of new Set<AssetKind>(['hairMesh', 'hair', ...Object.keys(selection) as AssetKind[]])) {
      if (catalogues[kind]) continue;
      void fetchCatalogue(kind).then((entries) => {
        if (!cancelled) register(kind, entries);
      });
    }
    return () => { cancelled = true; };
  }, [selection, catalogues, register]);
  return catalogues;
}
