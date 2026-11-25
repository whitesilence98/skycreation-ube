/**
 * lib/morphs/facialExpressionMorphs.ts
 *
 * Builds standard ARKit / Unreal MetaHuman / Oculus Viseme-compatible GPU
 * morph targets onto UBE Head (`11,498` verts) and Mouth (`9,043` verts):
 *
 * - Smiles (`mouthSmileLeft`, `mouthSmileRight`, `smallSmile`, `smile`,
 *   `closedSmile`, `moodHappy`) use calibrated smooth anatomical Duchenne
 *   fields measured directly from the active sculpt's lip corners, cheeks,
 *   and lower eyelids — avoiding rigid Skyrim RaceMenu teeth over-exposure.
 * - Speech visemes (`jawOpen`, `viseme_*`) use paired UBE head + mouth deltas.
 * - Pre-authored MetaHuman / glTF shape keys are always preserved untouched.
 */

import * as THREE from 'three';
import {
  expandSparseMorph,
  hasNamedMorphTarget,
  mergeNamedMorphTargets,
  setNamedMorphWeight,
  type MorphTargetEntry,
  type SparseMorphDelta,
} from '@/lib/morphs/gpuMorphUtils';

export const EXPRESSION_ALIASES = {
  mouthSmileLeft: ['mouthSmileLeft', 'MouthSmileLeft', 'CTRL_expressions_mouthSmileL', 'Smile_L'],
  mouthSmileRight: ['mouthSmileRight', 'MouthSmileRight', 'CTRL_expressions_mouthSmileR', 'Smile_R'],
  smile: ['smile', 'Smile'],
  smallSmile: ['smallSmile', 'Small_smile'],
  closedSmile: ['closedSmile', 'ClosedSmile_topless'],
  moodHappy: ['moodHappy', 'MoodHappy'],
  jawOpen: ['jawOpen', 'JawOpen', 'CTRL_expressions_jawOpen', 'BigAah'],
  viseme_aa: ['viseme_aa', 'Aah'],
  viseme_E: ['viseme_E', 'Eh'],
  viseme_O: ['viseme_O', 'Oh'],
  viseme_U: ['viseme_U', 'OohQ'],
  viseme_I: ['viseme_I', 'Eee'],
  viseme_PP: ['viseme_PP', 'BMP'],
  viseme_FF: ['viseme_FF', 'FV'],
} as const;

export type FacialExpressionId = keyof typeof EXPRESSION_ALIASES;

const UBE_EXPR_URL = '/assets/morphs/head/ube-facial-expressions.json';
const UBE_EXPR_FLAG = '__ubeFacialExpressions';
const UBE_HEAD_VERT_COUNT = 11498;
const UBE_MOUTH_VERT_COUNT = 9043;

const SMILE_TARGET_NAMES = new Set<string>([
  'mouthSmileLeft',
  'mouthSmileRight',
  'smile',
  'smallSmile',
  'closedSmile',
  'moodHappy',
]);

const NATIVE_CHECK_NAMES = [
  ...EXPRESSION_ALIASES.mouthSmileLeft,
  ...EXPRESSION_ALIASES.mouthSmileRight,
  ...EXPRESSION_ALIASES.jawOpen,
  ...EXPRESSION_ALIASES.viseme_aa,
];

const MANAGED_EXPRESSION_NAMES: ReadonlySet<string> = new Set(Object.keys(EXPRESSION_ALIASES));

export interface UbeExpressionBundle {
  version: number;
  names: string[];
  head: {
    vertexCount: number;
    morphs: Record<string, SparseMorphDelta>;
  };
  mouth: {
    vertexCount: number;
    morphs: Record<string, SparseMorphDelta>;
  };
}

let bundlePromise: Promise<UbeExpressionBundle | null> | null = null;
let bundleCache: UbeExpressionBundle | null = null;
let bundleAttempted = false;

/** Fetches and caches UBE's paired head + mouth facial expression deltas. */
export async function loadUbeExpressionData(): Promise<UbeExpressionBundle | null> {
  if (bundleCache) return bundleCache;
  if (bundlePromise) return bundlePromise;

  bundlePromise = (async () => {
    try {
      const res = await fetch(UBE_EXPR_URL);
      if (!res.ok) return null;
      const parsed = (await res.json()) as UbeExpressionBundle;
      if (!parsed?.head?.morphs || !parsed?.mouth?.morphs) return null;
      bundleCache = parsed;
      return parsed;
    } catch {
      return null;
    } finally {
      bundleAttempted = true;
    }
  })();

  return bundlePromise;
}

if (typeof window !== 'undefined') {
  void loadUbeExpressionData();
}

export function getCachedUbeExpressionData(): UbeExpressionBundle | null {
  return bundleCache;
}

export function hasUbeExpressionSettled(): boolean {
  return bundleAttempted;
}

export interface AttachExpressionOptions {
  force?: boolean;
  ubeData?: UbeExpressionBundle | null;
}

interface MouthLandmarks {
  cornerX: number;
  cornerY: number;
  cornerZ: number;
  centerLipZ: number;
}

interface SmileConfig {
  side: 'left' | 'right' | 'both';
  /** Upward corner curl (meters). */
  liftY: number;
  /** Lateral corner pull (meters). */
  pullX: number;
  /** Backward facial-arch wrap (meters, positive pulls back into -Z). */
  wrapZ: number;
  /** Soft cheek apple lift + puff strength (0..1.5). */
  cheekLift: number;
  /** Subtle Duchenne lower-eyelid crinkle lift (meters). */
  eyeSquintY: number;
}

/** Measures the active head sculpt's actual lip corner & central mouth coordinates. */
function measureMouthLandmarks(pos: THREE.BufferAttribute): MouthLandmarks {
  let centerY = 0;
  let centerCount = 0;
  let centerLipZ = -Infinity;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(x) < 0.008 && y > -0.055 && y < -0.018 && z > 0.078) {
      centerY += y;
      centerCount++;
      if (z > centerLipZ) centerLipZ = z;
    }
  }

  const avgLipY = centerCount > 0 ? centerY / centerCount : -0.033;
  if (!Number.isFinite(centerLipZ)) centerLipZ = 0.092;

  let cornerX = 0.025;
  let cornerY = avgLipY;
  let cornerZ = 0.076;
  let bestScore = -Infinity;

  for (let i = 0; i < pos.count; i++) {
    const x = Math.abs(pos.getX(i));
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (x < 0.018 || x > 0.036 || z < 0.072) continue;
    if (Math.abs(y - avgLipY) > 0.009) continue;
    const score = x - Math.abs(y - avgLipY) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      cornerX = x;
      cornerY = y;
      cornerZ = z;
    }
  }

  return { cornerX, cornerY, cornerZ, centerLipZ };
}

/**
 * Generates a smooth, non-uncanny anatomical Duchenne smile directly on the
 * active face mesh: gentle mouth-corner curve wrapping along the facial arch,
 * soft nasolabial cheek lift, and optional lower-eyelid warmth — keeping lips closed.
 */
function buildAnatomicalSmileDeltas(
  pos: THREE.BufferAttribute,
  lm: MouthLandmarks,
  cfg: SmileConfig,
): Float32Array {
  const count = pos.count;
  const deltas = new Float32Array(count * 3);

  const cornerRx = 0.0175;
  const cornerRy = 0.0145;
  const cornerRz = 0.019;

  const cheekCenterY = lm.cornerY + 0.031;
  const cheekCenterX = lm.cornerX + 0.010;
  const cheekRx = 0.024;
  const cheekRy = 0.020;

  const eyeCenterX = 0.031;
  const eyeLowerY = 0.021;
  const eyeRx = 0.015;
  const eyeRy = 0.0085;

  const sides: readonly (1 | -1)[] =
    cfg.side === 'left' ? [1] : cfg.side === 'right' ? [-1] : [1, -1];

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    if (z < 0.048) continue;

    let dx = 0;
    let dy = 0;
    let dz = 0;

    for (const sign of sides) {
      // Smooth bilateral center crossover blend so midline doesn't pinch
      const sideBlend =
        cfg.side === 'both'
          ? sign === 1
            ? x >= 0
              ? 1
              : Math.max(0, 1 + x / 0.008)
            : x <= 0
              ? 1
              : Math.max(0, 1 - x / 0.008)
          : sign === 1
            ? Math.min(1, Math.max(0, (x + 0.004) / 0.010))
            : Math.min(1, Math.max(0, (-x + 0.004) / 0.010));
      if (sideBlend <= 0.001) continue;

      const cx = lm.cornerX * sign;
      const dxC = (x - cx) / cornerRx;
      const dyC = (y - lm.cornerY) / cornerRy;
      const dzC = (z - lm.cornerZ) / cornerRz;
      const r2Corner = dxC * dxC + dyC * dyC + dzC * dzC;

      if (r2Corner < 4.5) {
        const w = Math.exp(-1.55 * r2Corner) * sideBlend;
        // Emphasize outer corner & taper softly toward philtrum so Cupid's bow stays intact
        const centerFade = Math.min(1, Math.abs(x) / 0.014);
        const cornerW = w * (0.28 + 0.72 * centerFade);

        dx += sign * cfg.pullX * cornerW;
        dy += cfg.liftY * cornerW;
        dz -= cfg.wrapZ * cornerW;
      }

      // Duchenne zygomatic cheek apple lift + subtle soft puff
      if (cfg.cheekLift > 0.01) {
        const dxK = (x - cheekCenterX * sign) / cheekRx;
        const dyK = (y - cheekCenterY) / cheekRy;
        const dzK = (z - 0.068) / 0.025;
        const r2Cheek = dxK * dxK + dyK * dyK + dzK * dzK;
        if (r2Cheek < 4.0) {
          const wK = Math.exp(-1.5 * r2Cheek) * cfg.cheekLift * sideBlend;
          dx += sign * 0.0008 * wK;
          dy += 0.0020 * wK;
          dz += 0.0011 * wK;
        }
      }

      // Subtle lower-eyelid smile crinkle (orbicularis oculi)
      if (cfg.eyeSquintY > 0.00005) {
        const dxE = (x - eyeCenterX * sign) / eyeRx;
        const dyE = (y - eyeLowerY) / eyeRy;
        const dzE = (z - 0.075) / 0.018;
        const r2Eye = dxE * dxE + dyE * dyE + dzE * dzE;
        if (r2Eye < 3.6 && y < 0.030) {
          const wE = Math.exp(-1.7 * r2Eye) * sideBlend;
          dy += cfg.eyeSquintY * wE;
          dz += cfg.eyeSquintY * 0.25 * wE;
        }
      }
    }

    if (dx !== 0 || dy !== 0 || dz !== 0) {
      const o = i * 3;
      deltas[o] = dx;
      deltas[o + 1] = dy;
      deltas[o + 2] = dz;
    }
  }

  return deltas;
}

const CUSTOM_SMILE_CONFIGS: Readonly<Record<string, SmileConfig>> = {
  mouthSmileLeft: {
    side: 'left',
    liftY: 0.0038,
    pullX: 0.0030,
    wrapZ: 0.0024,
    cheekLift: 0.75,
    eyeSquintY: 0.0008,
  },
  mouthSmileRight: {
    side: 'right',
    liftY: 0.0038,
    pullX: 0.0030,
    wrapZ: 0.0024,
    cheekLift: 0.75,
    eyeSquintY: 0.0008,
  },
  smallSmile: {
    side: 'both',
    liftY: 0.0026,
    pullX: 0.0020,
    wrapZ: 0.0016,
    cheekLift: 0.45,
    eyeSquintY: 0.0004,
  },
  smile: {
    side: 'both',
    liftY: 0.0040,
    pullX: 0.0032,
    wrapZ: 0.0026,
    cheekLift: 0.85,
    eyeSquintY: 0.0009,
  },
  closedSmile: {
    side: 'both',
    liftY: 0.0032,
    pullX: 0.0023,
    wrapZ: 0.0019,
    cheekLift: 0.50,
    eyeSquintY: 0.0005,
  },
  moodHappy: {
    side: 'both',
    liftY: 0.0046,
    pullX: 0.0036,
    wrapZ: 0.0029,
    cheekLift: 1.15,
    eyeSquintY: 0.0012,
  },
};

function attachHeadExpressions(
  headGeo: THREE.BufferGeometry | null,
  ubeData: UbeExpressionBundle | null,
  force: boolean,
): boolean {
  if (!headGeo) return false;
  const pos = headGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return false;

  const hasNative = hasNamedMorphTarget(headGeo, NATIVE_CHECK_NAMES);
  if (hasNative && (!force || !headGeo.userData[UBE_EXPR_FLAG])) {
    return false;
  }

  // Wait for UBE speech viseme deltas on UBE head count before locking initial GPU morph count.
  if (!ubeData && !bundleAttempted && pos.count === UBE_HEAD_VERT_COUNT) {
    return false;
  }

  const landmarks = measureMouthLandmarks(pos);
  const entries: MorphTargetEntry[] = [];

  for (const name of Object.keys(EXPRESSION_ALIASES)) {
    const smileCfg = CUSTOM_SMILE_CONFIGS[name];
    if (smileCfg) {
      entries.push({
        name,
        deltas: buildAnatomicalSmileDeltas(pos, landmarks, smileCfg),
      });
      continue;
    }

    if (ubeData && pos.count === (ubeData.head.vertexCount ?? UBE_HEAD_VERT_COUNT)) {
      const sparse = ubeData.head.morphs[name];
      if (sparse) {
        entries.push({
          name,
          deltas: expandSparseMorph(pos.count, sparse, 1.0),
        });
      }
    }
  }

  return mergeNamedMorphTargets(headGeo, entries, MANAGED_EXPRESSION_NAMES, UBE_EXPR_FLAG);
}

function attachMouthExpressions(
  mouthGeo: THREE.BufferGeometry | null,
  ubeData: UbeExpressionBundle | null,
  force: boolean,
): boolean {
  if (!mouthGeo || !ubeData) return false;
  const pos = mouthGeo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const expectedVerts = ubeData.mouth.vertexCount ?? UBE_MOUTH_VERT_COUNT;
  if (!pos || pos.count !== expectedVerts) return false;

  const hasNative = hasNamedMorphTarget(mouthGeo, NATIVE_CHECK_NAMES);
  if (hasNative && (!force || !mouthGeo.userData[UBE_EXPR_FLAG])) {
    return false;
  }

  const entries: MorphTargetEntry[] = [];
  for (const name of Object.keys(EXPRESSION_ALIASES)) {
    if (SMILE_TARGET_NAMES.has(name)) {
      // Custom anatomical smiles keep lips softly closed; keep internal teeth/tongue still.
      entries.push({ name, deltas: new Float32Array(pos.count * 3) });
      continue;
    }
    const sparse = ubeData.mouth.morphs[name];
    if (!sparse) continue;
    entries.push({
      name,
      deltas: expandSparseMorph(pos.count, sparse, 1.0),
    });
  }

  return mergeNamedMorphTargets(mouthGeo, entries, MANAGED_EXPRESSION_NAMES, UBE_EXPR_FLAG);
}

/**
 * Ensures `headGeo` and `mouthGeo` carry calibrated anatomical smile morphs +
 * UBE speech visemes + smooth morph normals. Leaves pre-authored MetaHuman / glTF
 * expression targets untouched.
 */
export function attachExpressionMorphTargets(
  headGeo: THREE.BufferGeometry | null,
  mouthGeo: THREE.BufferGeometry | null,
  options?: AttachExpressionOptions,
): boolean {
  const ubeData = options?.ubeData ?? bundleCache;
  const force = Boolean(options?.force);

  let updated = false;
  updated = attachHeadExpressions(headGeo, ubeData, force) || updated;
  updated = attachMouthExpressions(mouthGeo, ubeData, force) || updated;
  return updated;
}

/**
 * Updates smile and viseme morph weights across all morph-capable meshes under `root`.
 */
export function applyFacialExpressionWeights(
  root: THREE.Object3D | null | undefined,
  weights: Readonly<Record<string, number>>,
): void {
  if (!root) return;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!obj.morphTargetDictionary || !obj.morphTargetInfluences) return;
    for (const [id, aliases] of Object.entries(EXPRESSION_ALIASES)) {
      const w = weights[id] ?? 0;
      setNamedMorphWeight(obj, aliases, w);
    }
  });
}
