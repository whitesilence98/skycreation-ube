/**
 * The 3D backgrounds and stage environments the scene can mount.
 *
 * Kept free of three.js imports so that `lib/session.ts` and headless
 * check scripts can import this vocabulary in bare environments.
 */

export const BACKGROUND_MODES = [
  'void',
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
    description: 'Clean studio void with soft floor contact shadow and zero stage geometry cost',
    swatch: 'linear-gradient(135deg, #181820 0%, #07070a 100%)',
  },
] as const;
