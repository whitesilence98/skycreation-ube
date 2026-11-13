/**
 * The 3D backgrounds and stage environments the scene can mount.
 *
 * Kept free of three.js imports so that `lib/session.ts` and headless
 * check scripts can import this vocabulary in bare environments.
 */

export const BACKGROUND_MODES = [
  'void',
  'studio-podium',
  'nordic-tavern',
  'ancient-ruins',
  'aurora-sky',
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
    id: 'void',
    label: 'Studio Void',
    sub: 'DEFAULT',
    description: 'Clean dark studio void (#07070a) with zero performance cost',
    swatch: 'linear-gradient(135deg, #181820 0%, #07070a 100%)',
  },
  {
    id: 'studio-podium',
    label: '3D Podium',
    sub: 'SHOWROOM',
    description: 'Collector showroom pedestal with soft floor contact shadows and infinity cyclorama',
    swatch: 'linear-gradient(135deg, #3c424a 0%, #1e2229 50%, #0d1014 100%)',
  },
  {
    id: 'nordic-tavern',
    label: 'Nordic Tavern',
    sub: 'WOOD & HEARTH',
    description: 'Skyrim timber & stone chamber with wooden floor planks and warm sconces',
    swatch: 'linear-gradient(135deg, #6e4b2d 0%, #3e2617 50%, #1c110b 100%)',
  },
  {
    id: 'ancient-ruins',
    label: 'Nordic Ruins',
    sub: 'STONE SANCTUARY',
    description: 'Ancient Skyrim stone flagstones, carved monolith pillars, and cool atmospheric mist',
    swatch: 'linear-gradient(135deg, #3a4752 0%, #202b33 50%, #0f161c 100%)',
  },
  {
    id: 'aurora-sky',
    label: 'Skyrim Aurora',
    sub: 'NIGHT DOME',
    description: 'Starry night sky dome with ethereal green-purple northern lights & mountain rim',
    swatch: 'linear-gradient(135deg, #1b3831 0%, #171b38 50%, #080a14 100%)',
  },
  {
    id: 'custom-3d',
    label: 'Custom 3D',
    sub: 'GLB MODEL',
    description: 'Load an external 3D environment scene (.glb / .gltf) from file or URL',
    swatch: 'linear-gradient(135deg, #5b3e75 0%, #301f42 50%, #130a1c 100%)',
  },
] as const;
