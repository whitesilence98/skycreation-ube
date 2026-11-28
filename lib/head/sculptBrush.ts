/**
 * lib/head/sculptBrush.ts
 *
 * Interactive RaceMenu-style 3D vertex sculpt brush accumulator for the head mesh.
 * Keeps displacement deltas outside React state for smooth 60 FPS pointer dragging.
 */

export type SculptBrushMode = 'inflate' | 'deflate' | 'smooth' | 'move';

export interface SculptStrokeParams {
  mode: SculptBrushMode;
  radius: number;
  strength: number;
  symmetry: boolean;
  hitPoint: readonly [number, number, number];
  hitNormal: readonly [number, number, number];
  moveDelta?: readonly [number, number, number];
}

let brushDeltas: Float32Array | null = null;
let brushVertCount = 0;

export function getSculptBrushDeltas(vertCount: number): Float32Array | null {
  if (!brushDeltas || brushVertCount !== vertCount) return null;
  return brushDeltas;
}

export function clearSculptBrushDeltas(): void {
  brushDeltas = null;
  brushVertCount = 0;
}

export function hasSculptBrushDeltas(): boolean {
  if (!brushDeltas) return false;
  for (let i = 0; i < brushDeltas.length; i++) {
    if (Math.abs(brushDeltas[i]) > 1e-6) return true;
  }
  return false;
}

export function exportSculptBrushArray(): number[] | undefined {
  if (!hasSculptBrushDeltas() || !brushDeltas) return undefined;
  return Array.from(brushDeltas, (v) => Math.round(v * 1e5) / 1e5);
}

export function importSculptBrushArray(arr: unknown): void {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length % 3 !== 0) {
    clearSculptBrushDeltas();
    return;
  }
  const f = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    f[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  brushDeltas = f;
  brushVertCount = f.length / 3;
}

function ensureBuffer(vertCount: number): Float32Array {
  if (!brushDeltas || brushVertCount !== vertCount) {
    brushDeltas = new Float32Array(vertCount * 3);
    brushVertCount = vertCount;
  }
  return brushDeltas;
}

function applySingleBrushCenter(
  positions: Float32Array,
  deltas: Float32Array,
  vertCount: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number,
  mdx: number,
  mdy: number,
  mdz: number,
  mode: SculptBrushMode,
  radius: number,
  strength: number,
): boolean {
  const r2 = radius * radius;
  const maxStep = 0.0022 * Math.max(0.05, strength);
  let modified = false;

  if (mode === 'smooth') {
    let avgX = 0;
    let avgY = 0;
    let avgZ = 0;
    let wSum = 0;
    const hitIndices: number[] = [];
    const hitWeights: number[] = [];

    for (let i = 0; i < vertCount; i++) {
      const i3 = i * 3;
      const dx = positions[i3] - cx;
      const dy = positions[i3 + 1] - cy;
      const dz = positions[i3 + 2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * Math.sqrt(d2)) / radius));
      avgX += deltas[i3] * w;
      avgY += deltas[i3 + 1] * w;
      avgZ += deltas[i3 + 2] * w;
      wSum += w;
      hitIndices.push(i3);
      hitWeights.push(w);
    }

    if (wSum > 1e-6) {
      avgX /= wSum;
      avgY /= wSum;
      avgZ /= wSum;
      const alpha = Math.min(0.65, strength * 0.45);
      for (let j = 0; j < hitIndices.length; j++) {
        const i3 = hitIndices[j];
        const blend = alpha * hitWeights[j];
        deltas[i3] += (avgX - deltas[i3]) * blend;
        deltas[i3 + 1] += (avgY - deltas[i3 + 1]) * blend;
        deltas[i3 + 2] += (avgZ - deltas[i3 + 2]) * blend;
      }
      modified = true;
    }
    return modified;
  }

  for (let i = 0; i < vertCount; i++) {
    const i3 = i * 3;
    const vx = positions[i3];
    const vy = positions[i3 + 1];
    const vz = positions[i3 + 2];
    const dx = vx - cx;
    const dy = vy - cy;
    const dz = vz - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;

    const falloff = 0.5 * (1 + Math.cos((Math.PI * Math.sqrt(d2)) / radius));
    if (falloff <= 1e-5) continue;

    if (mode === 'inflate' || mode === 'deflate') {
      const sign = mode === 'inflate' ? 1 : -1;
      const disp = sign * maxStep * falloff;
      deltas[i3] += nx * disp;
      deltas[i3 + 1] += ny * disp;
      deltas[i3 + 2] += nz * disp;
    } else if (mode === 'move') {
      const moveWeight = Math.min(1.5, Math.max(0.1, strength * 1.4)) * falloff;
      deltas[i3] += mdx * moveWeight;
      deltas[i3 + 1] += mdy * moveWeight;
      deltas[i3 + 2] += mdz * moveWeight;
    }

    // Clamp max displacement to +-3.5cm per axis so mesh stays sane
    deltas[i3] = Math.max(-0.035, Math.min(0.035, deltas[i3]));
    deltas[i3 + 1] = Math.max(-0.035, Math.min(0.035, deltas[i3 + 1]));
    deltas[i3 + 2] = Math.max(-0.035, Math.min(0.035, deltas[i3 + 2]));
    modified = true;
  }

  return modified;
}

/**
 * Applies a sculpt brush dab onto `positions` (current morphed vertex buffer)
 * and accumulates into `brushDeltas`. Returns `true` if any vertex moved.
 */
export function applySculptBrushStroke(
  positions: Float32Array,
  params: SculptStrokeParams,
): boolean {
  const vertCount = Math.floor(positions.length / 3);
  if (vertCount === 0) return false;
  const deltas = ensureBuffer(vertCount);

  const [cx, cy, cz] = params.hitPoint;
  const [nx, ny, nz] = params.hitNormal;
  const [mdx, mdy, mdz] = params.moveDelta ?? [0, 0, 0];

  let changed = applySingleBrushCenter(
    positions,
    deltas,
    vertCount,
    cx,
    cy,
    cz,
    nx,
    ny,
    nz,
    mdx,
    mdy,
    mdz,
    params.mode,
    params.radius,
    params.strength,
  );

  // Apply mirrored X stroke when symmetry is active and hit is away from midline
  if (params.symmetry && Math.abs(cx) > 0.004) {
    const mirrorChanged = applySingleBrushCenter(
      positions,
      deltas,
      vertCount,
      -cx,
      cy,
      cz,
      -nx,
      ny,
      nz,
      -mdx,
      mdy,
      mdz,
      params.mode,
      params.radius,
      params.strength,
    );
    changed = changed || mirrorChanged;
  }

  return changed;
}
