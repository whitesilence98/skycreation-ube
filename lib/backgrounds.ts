/**
 * The 3D backgrounds and stage environments the scene can mount.
 *
 * Kept free of three.js imports so that `lib/session.ts` and headless
 * check scripts can import this vocabulary in bare environments.
 */

export const BACKGROUND_MODES = [
  'room',
  'void',
  'custom-3d',
] as const;

export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

export interface BackgroundPresetSpec {
  id: BackgroundMode;
  label: string;
  sub: string;
  description: string;
  swatch: string;
}

export const BACKGROUND_PRESETS: readonly BackgroundPresetSpec[] = [
  {
    id: 'room',
    label: 'My Room',
    sub: 'DEFAULT',
    description: 'Live interactive Room Builder suite with your placed furniture and day/night lighting',
    swatch: 'linear-gradient(135deg, #5e4c36 0%, #2b2622 55%, #16171d 100%)',
  },
  {
    id: 'void',
    label: 'Studio Void',
    sub: 'OPTIONAL',
    description: 'Clean dark studio void with soft floor shadow and zero 3D stage cost',
    swatch: 'linear-gradient(135deg, #181820 0%, #07070a 100%)',
  },
  {
    id: 'custom-3d',
    label: 'Custom 3D',
    sub: 'OPTIONAL · GLB',
    description: 'Load an external 3D environment scene (.glb / .gltf) from file or URL',
    swatch: 'linear-gradient(135deg, #5b3e75 0%, #301f42 50%, #130a1c 100%)',
  },
] as const;
