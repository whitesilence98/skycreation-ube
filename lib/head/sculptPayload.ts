// Generated Smart sculpts only; general RaceMenu imports retain their own contract.
export const CANONICAL_HEAD_URL = '/assets/preset-pack/meshes/headMesh-96612a53f30f4e56.json';
export const CANONICAL_HEAD_VERTICES = 11498;
export const CANONICAL_HEAD_TOPOLOGY = '6cc05326819d20076753d565d74d910436eb439c4d261b6fd0d963c8ef59329e';
export const CANONICAL_SCULPT_HOST = '!UBE\\Head\\femaleHeadCharGen.tri';
export const MAX_OBJ_BYTES = 64 * 1024 * 1024;

export interface SculptPayload {
  name: string;
  morphs: {
    custom: [];
    sculptDivisor: number;
    sculpt: [{ host: string; vertices: number; data: Array<[number, number, number, number]> }];
  };
}

export interface SmartFitMetrics {
  approximate: true;
  alignment_rms_m: number;
  fit_strength: number;
  face_surface_rms_m: number;
  face_coverage_15mm: number;
  max_displacement_m: number;
  quality: {
    collar_max_displacement_m: number;
    protected_max_displacement_m: number;
    likeness_approved: false;
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSculptPayload(raw: unknown):
  { ok: true; payload: SculptPayload } | { ok: false; reason: string } {
  const invalid = (reason: string) => ({ ok: false as const, reason });
  if (!record(raw) || typeof raw.name !== 'string' || raw.name.length > 256 || !record(raw.morphs)) {
    return invalid('Invalid generated sculpt envelope');
  }
  const morphs = raw.morphs;
  if (!Array.isArray(morphs.custom) || morphs.custom.length !== 0 || morphs.sculptDivisor !== 10000 ||
      !Array.isArray(morphs.sculpt) || morphs.sculpt.length !== 1) {
    return invalid('Expected one canonical sculpt with divisor 10000 and no slider morphs');
  }
  const block: unknown = morphs.sculpt[0];
  if (!record(block) || typeof block.host !== 'string' ||
      block.host.toLowerCase() !== CANONICAL_SCULPT_HOST.toLowerCase() ||
      block.vertices !== CANONICAL_HEAD_VERTICES || !Array.isArray(block.data) ||
      block.data.length > CANONICAL_HEAD_VERTICES) {
    return invalid('Sculpt does not target the canonical UBE head');
  }
  const seen = new Set<number>();
  const data: Array<[number, number, number, number]> = [];
  for (const entry of block.data) {
    if (!Array.isArray(entry) || entry.length !== 4 ||
        !entry.every(value => typeof value === 'number' && Number.isSafeInteger(value))) {
      return invalid('Sculpt entries must contain an index and three finite quantized offsets');
    }
    const [index, x, z, y] = entry as [number, number, number, number];
    if (index < 0 || index >= CANONICAL_HEAD_VERTICES || seen.has(index)) {
      return invalid('Sculpt has duplicate or out-of-range vertex indices');
    }
    if (Math.hypot(x, y, z) * (0.01288 / 10000) > 0.05) {
      return invalid('Sculpt displacement exceeds the 50 mm safety limit');
    }
    seen.add(index);
    data.push([index, x, z, y]);
  }
  return { ok: true, payload: {
    name: raw.name,
    morphs: { custom: [], sculptDivisor: 10000,
      sculpt: [{ host: CANONICAL_SCULPT_HOST, vertices: CANONICAL_HEAD_VERTICES, data }] },
  } };
}

export function validateFitMetrics(raw: unknown): SmartFitMetrics {
  if (!record(raw) || raw.approximate !== true || !record(raw.quality) ||
      raw.quality.likeness_approved !== false) throw new Error('Invalid fitting metrics');
  const finite = (value: unknown, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error('Invalid or rejected fitting metrics');
    }
    return value;
  };
  return {
    approximate: true,
    alignment_rms_m: finite(raw.alignment_rms_m, 0, 0.015),
    fit_strength: finite(raw.fit_strength, 0, 1),
    face_surface_rms_m: finite(raw.face_surface_rms_m, 0, 0.01),
    face_coverage_15mm: finite(raw.face_coverage_15mm, 0.8, 1),
    max_displacement_m: finite(raw.max_displacement_m, 0, 0.05),
    quality: {
      collar_max_displacement_m: finite(raw.quality.collar_max_displacement_m, 0, 0),
      protected_max_displacement_m: finite(raw.quality.protected_max_displacement_m, 0, 0),
      likeness_approved: false,
    },
  };
}
