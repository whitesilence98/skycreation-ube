/**
 * lib/head/bodyPaintTypes.ts
 *
 * Pure data structures & validators for RaceMenu BodyPaint / HandPaint / FootPaint.
 * Kept free of Three.js/DOM imports so headless `vm` check scripts and session
 * persistence can import it safely.
 */

export type BodyPaintSlot = 'body' | 'hands' | 'feet';

export interface BodyPaintLayer {
  textureId: string | null;
  textureUrl: string | null;
  color: string;
  opacity: number;
}

export type BodyPaintMap = Record<BodyPaintSlot, BodyPaintLayer>;

export function createDefaultBodyPaintMap(): BodyPaintMap {
  return {
    body: { textureId: null, textureUrl: null, color: '#d4b483', opacity: 0.78 },
    hands: { textureId: null, textureUrl: null, color: '#d4b483', opacity: 0.78 },
    feet: { textureId: null, textureUrl: null, color: '#d4b483', opacity: 0.78 },
  };
}

export function coerceBodyPaintMap(raw: unknown): BodyPaintMap {
  const def = createDefaultBodyPaintMap();
  if (!raw || typeof raw !== 'object') return def;
  const o = raw as Record<string, unknown>;
  const out = { ...def };

  for (const slot of ['body', 'hands', 'feet'] as const) {
    const entry = o[slot];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const textureId = typeof e.textureId === 'string' && e.textureId ? e.textureId : null;
    const textureUrl = typeof e.textureUrl === 'string' && e.textureUrl ? e.textureUrl : null;
    const color =
      typeof e.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(e.color)
        ? e.color
        : def[slot].color;
    const opacity =
      typeof e.opacity === 'number' && Number.isFinite(e.opacity)
        ? Math.min(1, Math.max(0, e.opacity))
        : def[slot].opacity;
    out[slot] = { textureId, textureUrl, color, opacity };
  }

  return out;
}

export function hasActiveBodyPaint(layer: BodyPaintLayer | undefined): boolean {
  return Boolean(layer && layer.textureUrl && layer.opacity > 0.01);
}
