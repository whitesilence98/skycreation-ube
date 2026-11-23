export type HairBangs = 'none' | 'side' | 'full';
export type HairSide = 'straight' | 'tucked' | 'swept';
export type HairBack = 'cropped' | 'straight' | 'layered';
export interface HairSettings {
  style: string;
  lengthCm: number;
  bangs: HairBangs;
  side: HairSide;
  back: HairBack;
  volume: number;
  curl: number;
  wave: number;
  wispiness: number;
  asymmetry: number;
  tone: string;
  rootShift: number;
  midShift: number;
  tipShift: number;
  gradient: boolean;
  highlights: boolean;
  gloss: number;
  alpha: number;
  /** Vertical placement of the worn hairstyle, in slider units (-10..10). */
  hairOffset: number;

  /* ── material & mask tuning ─────────────────────────────────────────
     These drive `hairMaterialState` / `hairRoughness` for every loader.
     They are deliberately NOT part of `Shape`, so picking a hairstyle
     style never resets them. */

  /** Alpha cutout while the hairstyle is opaque. */
  matCutoff: number;
  /** Cutout once the user fades the hair; low values keep soft card edges. */
  matCutoffFaded: number;
  /** Opacity below which the material switches into the blended pass. */
  matBlendThreshold: number;
  /** Roughness at full gloss — the floor that stops hair reading as chrome. */
  matSheenFloor: number;
  /** Roughness at zero gloss (matte). */
  matSheenBase: number;
  /** Gloss → roughness slope. */
  matSheenSlope: number;
  /** Normal-map strength while the hair is faded. */
  matNormalFade: number;

  /* ── sway vertex shader ─────────────────────────────────────────────
     The shipped `.glb` hairstyles carry no skin and no animation, so the
     strand motion is a height-weighted vertex offset. */

  /** Head-space Y where the sway falloff starts (the crown). */
  swayCrownY: number;
  /** Slope of the falloff below `swayCrownY`. */
  swayFalloff: number;
  /** Horizontal strand frequency. */
  swayFreqX: number;
  /** Depth strand frequency. */
  swayFreqZ: number;
  /** Horizontal wave speed. */
  swaySpeedX: number;
  /** Depth wave speed. */
  swaySpeedZ: number;
  /** Horizontal amplitude, in metres. */
  swayAmpX: number;
  /** Depth amplitude, in metres. */
  swayAmpZ: number;
  /** Depth phase multiplier. */
  swayPhaseZ: number;
  /** Decay rate of the TEST SWAY kick. */
  swayImpulseDecay: number;
  /** Idle sway drive. */
  swayBase: number;
  /** How strongly FLEXIBILITY / BOUNCE drives the sway. */
  swayStiffGain: number;
  /** How strongly WIND SWAY drives the sway. */
  swayWindGain: number;
  /** How strongly TEST SWAY drives the sway. */
  swayImpulseGain: number;

  /* ── scalp filler ───────────────────────────────────────────────── */

  /** Scalp cutout; near-zero so faint texels do not open bald patches. */
  scalpCutoff: number;
  scalpRoughness: number;
  scalpMetalness: number;
  /** Polygon offset that keeps the cap from z-fighting the head. */
  scalpPolyFactor: number;
  scalpPolyUnits: number;
}
export const HAIR_TABS = ['STYLE', 'COLOR', 'GLOSS'] as const;
export type HairTab = (typeof HAIR_TABS)[number];
export const HAIR_TONES = ['#171310', '#30231c', '#493326', '#644936', '#80634a', '#9c8060', '#bda17c', '#dfc7a2'] as const;
export const DEFAULT_HAIR: HairSettings = {
  style: 'asymmetrical-bob', lengthCm: 28, bangs: 'side', side: 'straight', back: 'layered',
  volume: -3, curl: 7, wave: 0.45, wispiness: 0.15, asymmetry: 0.22,
  tone: '#ffffff', rootShift: 5, midShift: 2, tipShift: 8,
  gradient: true, highlights: false, gloss: 0.65, alpha: 1.0, hairOffset: 0,
  matCutoff: 0.35, matCutoffFaded: 0.05, matBlendThreshold: 0.999,
  matSheenFloor: 0.28, matSheenBase: 0.62, matSheenSlope: 0.4, matNormalFade: 0.6,
  swayCrownY: 0.16, swayFalloff: 0.83, swayFreqX: 11, swayFreqZ: 7,
  swaySpeedX: 1.7, swaySpeedZ: 1.31, swayAmpX: 0.022, swayAmpZ: 0.016,
  swayPhaseZ: 1.6, swayImpulseDecay: 1.6, swayBase: 0.28, swayStiffGain: 0.7,
  swayWindGain: 1.5, swayImpulseGain: 2.2,
  scalpCutoff: 0.02, scalpRoughness: 0.85, scalpMetalness: 0.05,
  scalpPolyFactor: -2, scalpPolyUnits: -4,
};
type Shape = Pick<HairSettings, 'lengthCm' | 'bangs' | 'side' | 'back' | 'volume' | 'curl' | 'wave' | 'wispiness' | 'asymmetry'>;
export interface HairStyleDef { id: string; label: string; settings: Shape }
const shape = (patch: Partial<Shape>): Shape => ({
  lengthCm: 25, bangs: 'side', side: 'straight', back: 'straight', volume: 0,
  curl: 0, wave: 0.35, wispiness: 0.15, asymmetry: 0, ...patch,
});
export const HAIR_STYLES: HairStyleDef[] = [
  { id: 'layered-bob', label: 'Layered Bob', settings: shape({ lengthCm: 26, back: 'layered', volume: 4 }) },
  { id: 'wavy-short', label: 'Wavy Short', settings: shape({ lengthCm: 22, curl: 8, wave: 0.75, volume: 3 }) },
  { id: 'asymmetrical-bob', label: 'Asymmetrical Bob', settings: shape(DEFAULT_HAIR) },
  { id: 'blunt-bob', label: 'Blunt Bob', settings: shape({ lengthCm: 24, bangs: 'full', wispiness: 0.05 }) },
  { id: 'pixie-cut', label: 'Pixie Cut', settings: shape({ lengthCm: 9, side: 'tucked', back: 'cropped', volume: 2, wispiness: 0.35 }) },
  { id: 'shoulder-length', label: 'Shoulder Length', settings: shape({ lengthCm: 40, bangs: 'none', side: 'swept', back: 'layered' }) },
  { id: 'long-waves', label: 'Long Waves', settings: shape({ lengthCm: 55, bangs: 'none', curl: 9, wave: 0.65, volume: 4, back: 'layered' }) },
];
export const HAIR_LIMITS = {
  lengthCm: [0, 55], volume: [-10, 10], curl: [-10, 10], wave: [0, 1], wispiness: [0, 1],
  asymmetry: [0, 1], rootShift: [-10, 10], midShift: [-10, 10], tipShift: [-10, 10], gloss: [0, 1],
  alpha: [0, 1], hairOffset: [-10, 10],
  matCutoff: [0.05, 0.75], matCutoffFaded: [0.005, 0.5], matBlendThreshold: [0.8, 1],
  matSheenFloor: [0.05, 0.9], matSheenBase: [0.2, 1], matSheenSlope: [0, 0.8], matNormalFade: [0, 1],
  swayCrownY: [0, 0.3], swayFalloff: [0.1, 3], swayFreqX: [0, 30], swayFreqZ: [0, 30],
  swaySpeedX: [0, 4], swaySpeedZ: [0, 4], swayAmpX: [0, 0.08], swayAmpZ: [0, 0.08],
  swayPhaseZ: [0, 4], swayImpulseDecay: [0.2, 6], swayBase: [0, 1], swayStiffGain: [0, 2],
  swayWindGain: [0, 4], swayImpulseGain: [0, 6],
  scalpCutoff: [0, 0.3], scalpRoughness: [0.2, 1], scalpMetalness: [0, 0.6],
  scalpPolyFactor: [-8, 0], scalpPolyUnits: [-8, 0],
} as const;
/** Metres per hair-height slider unit; -10..10 maps to -15..15 mm. */
export const HAIR_OFFSET_METRES = 0.0015;
/** Slider units → metres for the worn hairstyle's vertical placement. */
export function hairOffsetMetres(offset: number): number {
  return offset * HAIR_OFFSET_METRES;
}
export function coerceHair(raw: unknown): HairSettings {
  const s = { ...DEFAULT_HAIR };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(HAIR_LIMITS) as Array<keyof typeof HAIR_LIMITS>) {
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = HAIR_LIMITS[key];
      s[key] = Math.max(min, Math.min(max, v));
    }
  }
  if (o.bangs === 'none' || o.bangs === 'side' || o.bangs === 'full') s.bangs = o.bangs;
  if (o.side === 'straight' || o.side === 'tucked' || o.side === 'swept') s.side = o.side;
  if (o.back === 'cropped' || o.back === 'straight' || o.back === 'layered') s.back = o.back;
  if (typeof o.tone === 'string' && /^#[0-9a-f]{6}$/i.test(o.tone)) s.tone = o.tone;
  if (typeof o.gradient === 'boolean') s.gradient = o.gradient;
  if (typeof o.highlights === 'boolean') s.highlights = o.highlights;
  if (o.style === 'custom' || HAIR_STYLES.some((p) => p.id === o.style)) s.style = o.style as string;
  return s;
}
export function applyHairStyle(current: HairSettings, id: string): HairSettings {
  const preset = HAIR_STYLES.find((p) => p.id === id);
  if (!preset) return current;
  const { lengthCm, bangs, side, back, volume, curl, wave, wispiness, asymmetry } = preset.settings;
  return { ...current, lengthCm, bangs, side, back, volume, curl, wave, wispiness, asymmetry, style: id };
}
/** Lightness offset; no three dependency in settings or preset tooling. */
export function shiftTone(hex: string, steps: number): string {
  return '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255,
    Math.round(parseInt(hex.slice(i, i + 2), 16) + steps * 3),
  )).toString(16).padStart(2, '0')).join('');
}
