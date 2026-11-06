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
}
export const HAIR_TABS = ['STYLE', 'COLOR', 'GLOSS'] as const;
export type HairTab = (typeof HAIR_TABS)[number];
export const HAIR_TONES = ['#171310', '#30231c', '#493326', '#644936', '#80634a', '#9c8060', '#bda17c', '#dfc7a2'] as const;
export const DEFAULT_HAIR: HairSettings = {
  style: 'asymmetrical-bob', lengthCm: 28, bangs: 'side', side: 'straight', back: 'layered',
  volume: -3, curl: 7, wave: 0.45, wispiness: 0.15, asymmetry: 0.22,
  tone: '#ffffff', rootShift: 5, midShift: 2, tipShift: 8,
  gradient: true, highlights: false, gloss: 0.65,
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
} as const;
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
