/** Studio lighting data/math; deliberately independent of Three and the DOM. */
export interface LightingSettings {
  intensity: number;
  fill: number;
  rim: number;
  azimuth: number;
  elevation: number;
  keyColor: string;
}
export const LIGHTING_DEFAULTS: LightingSettings = {
  intensity: 1, fill: 1, rim: 1, azimuth: 0, elevation: 0, keyColor: '#fff6ed',
};
export const LIGHT_RIGS = [
  { id: 'studio', label: 'STUDIO', preset: { ...LIGHTING_DEFAULTS } },
  { id: 'soft', label: 'SOFT', preset: { ...LIGHTING_DEFAULTS, elevation: -10, fill: 1.6, intensity: 0.9 } },
  { id: 'dramatic', label: 'DRAMATIC', preset: { ...LIGHTING_DEFAULTS, azimuth: 35, elevation: 20, fill: 0.45, intensity: 1.15 } },
  { id: 'rim', label: 'RIM', preset: { ...LIGHTING_DEFAULTS, azimuth: 160, elevation: 5, fill: 0.6, rim: 1.4 } },
  { id: 'flat', label: 'FLAT', preset: { ...LIGHTING_DEFAULTS, fill: 2, intensity: 1.1 } },
];

export const wrapDegrees = (value: number) => ((value % 360) + 360) % 360;
export function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Also used for setter patches, so unknown fields/non-finite values never reach lights. */
export function coerceLighting(raw: unknown, fallback = LIGHTING_DEFAULTS): LightingSettings {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    intensity: bounded(o.intensity, fallback.intensity, 0.2, 2),
    fill: bounded(o.fill, fallback.fill, 0, 2),
    rim: bounded(o.rim, fallback.rim, 0, 2),
    azimuth: typeof o.azimuth === 'number' && Number.isFinite(o.azimuth) ? wrapDegrees(o.azimuth) : fallback.azimuth,
    elevation: bounded(o.elevation, fallback.elevation, -45, 45),
    keyColor: typeof o.keyColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.keyColor) ? o.keyColor : fallback.keyColor,
  };
}

export function rigDirections({ azimuth, elevation }: Pick<LightingSettings, 'azimuth' | 'elevation'>) {
  const yaw = azimuth * Math.PI / 180, tilt = elevation * Math.PI / 180;
  const rotate = ([x, y, z]: number[]): [number, number, number] => {
    // Positive elevation raises a front-facing source; yaw follows Three's Y rotation.
    const yy = y * Math.cos(tilt) + z * Math.sin(tilt);
    const zz = -y * Math.sin(tilt) + z * Math.cos(tilt);
    return [x * Math.cos(yaw) + zz * Math.sin(yaw), yy, -x * Math.sin(yaw) + zz * Math.cos(yaw)];
  };
  return { key: rotate([0.55, 0.75, 1]), fill: rotate([-0.85, 0.25, 0.70]), rim: rotate([-0.35, 0.65, -0.95]), bounce: rotate([0.1, -0.65, 0.85]) };
}
