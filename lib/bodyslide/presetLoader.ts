/**
 * lib/bodyslide/presetLoader.ts
 *
 * Loader and catalogue definitions for BodySlide XML Presets (*.xml).
 * Re-exports parser utilities from `presetParser.ts`.
 */

import {
  parseBodySlidePresetXml,
  loadPresetFromXmlUrl,
  type BodySlidePreset,
} from './presetParser';

export * from './presetParser';

export interface PresetMeta {
  id: string;
  name: string;
  set: string;
  filePath: string;
  description?: string;
  isDefault?: boolean;
}

export const DEFAULT_PRESET_ID = 'necoco-converting-outfits';

/** Pre-bundled Necoco Body presets in public/assets/bodyslide/presets/ */
export const BUILTIN_PRESETS: readonly PresetMeta[] = [
  {
    id: 'necoco-converting-outfits',
    name: 'UBE Necoco for Converting Outfits',
    set: 'UBE SE 2.0 - Necoco Body',
    filePath: '/assets/bodyslide/presets/UBE Necoco for Converting Outfits.xml',
    description: 'Master 211 morph slider preset for seamless Clothes Pack 6 outfit fitting',
    isDefault: true,
  },
  {
    id: 'necoco-v1',
    name: 'UBE Necoco V1',
    set: 'UBE SE 2.0 - Necoco Body',
    filePath: '/assets/bodyslide/presets/UBE Necoco V1.xml',
    description: 'Original nude Necoco Body v1 base curves',
  },
] as const;

/**
 * Loads and parses a preset XML file from a given URL or path.
 */
export async function loadPresetFromUrl(url: string): Promise<BodySlidePreset | null> {
  return loadPresetFromXmlUrl(url);
}
