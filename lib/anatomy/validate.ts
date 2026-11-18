import {
  ANATOMY_PARAMS, ANATOMY_COLOR_DEFS, type AnatomyValues, type AnatomyAsymmetry,
  type AnatomyColors, type AnatomyGroupId,
} from '@/lib/anatomy/params';

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const bounded = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function coerceAnatomy(raw?: unknown): AnatomyValues {
  const values = record(raw);
  return Object.fromEntries(ANATOMY_PARAMS.map(p => [p.id,
    bounded(values[p.id], p.default, p.min, p.max),
  ])) as AnatomyValues;
}
export function coerceAsymmetry(raw?: unknown): AnatomyAsymmetry {
  const values = record(raw);
  return Object.fromEntries(ANATOMY_PARAMS.filter(p => p.bilateral).map(p => [p.id,
    bounded(values[p.id], 0, -100, 100),
  ])) as AnatomyAsymmetry;
}
export function coerceAnatomyColors(raw?: unknown): AnatomyColors {
  const values = record(raw);
  return Object.fromEntries(ANATOMY_COLOR_DEFS.map(p => {
    const value = values[p.id];
    return [p.id, typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : p.default];
  })) as AnatomyColors;
}
export function applyPresetValues(current: AnatomyValues, group: AnatomyGroupId, raw: unknown): AnatomyValues {
  const values = record(raw);
  const patch = Object.fromEntries(ANATOMY_PARAMS.filter(p => p.group === group && Object.hasOwn(values, p.id))
    .map(p => [p.id, bounded(values[p.id], current[p.id], p.min, p.max)]));
  return { ...current, ...patch };
}
