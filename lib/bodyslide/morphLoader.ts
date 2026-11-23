/**
 * lib/bodyslide/morphLoader.ts
 *
 * High-performance BodySlide morph loader and deformation engine for UBE 3D meshes in Three.js.
 * Caches binary OSD morph targets and applies sparse vertex delta accumulation in Three.js render frame at 60 FPS.
 */

import * as THREE from 'three';
import {
  parseOsd,
  parseOspXml,
  loadOsd,
  DEFAULT_NIF_TO_RENDER_SCALE,
  type OsdData,
  type SliderOspMapping,
} from './osdParser';
import {
  UBE_BODY_CATEGORIES,
  NECOCO_CATEGORIES,
  type BodySlideCategory,
} from './categories';

export { UBE_BODY_CATEGORIES, NECOCO_CATEGORIES, type BodySlideCategory };

/**
 * Synchronous getter for active BodySlide categories (UBE_BODY_CATEGORIES).
 */
export function getActiveBodyCategories(): BodySlideCategory[] {
  return UBE_BODY_CATEGORIES ?? NECOCO_CATEGORIES;
}

export interface BodySlideDataBundle {
  categories: BodySlideCategory[];
  mappings: Record<string, SliderOspMapping>;
  osdData: OsdData;
}

// In-memory singleton caches
let cachedBundle: BodySlideDataBundle | null = null;
let activeBundlePromise: Promise<BodySlideDataBundle> | null = null;

const CANONICAL_OSP_URLS = [
  '/assets/bodyslide/SliderSets/UBE SE 2.0 - Necoco Body.osp',
  '/assets/bodyslide/UBE SE 2.0 - Necoco Body.osp',
];
const CANONICAL_OSD_URLS = [
  '/assets/bodyslide/ShapeData/UBE SE 2.0 - Necoco Body/UBE SE 2.0 - Necoco Body.osd',
  '/assets/bodyslide/UBE SE 2.0 - Necoco Body.osd',
];

const DEFAULT_OSP_URL = CANONICAL_OSP_URLS[0];
const DEFAULT_OSD_URL = CANONICAL_OSD_URLS[0];

/**
 * Helper to fetch a file from a list of fallback URLs.
 */
async function fetchWithFallback<T>(
  urls: string[],
  loader: (url: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return await loader(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Failed to load from URLs: ${urls.join(', ')}`);
}

/**
 * Loads and caches all BodySlide definitions, mappings, and binary morph deltas.
 */
export async function loadAllBodySlideData(
  ospUrl?: string,
  osdUrl?: string,
): Promise<BodySlideDataBundle> {
  if (cachedBundle) {
    return cachedBundle;
  }

  if (activeBundlePromise) {
    return activeBundlePromise;
  }

  activeBundlePromise = (async () => {
    try {
      const ospUrls = ospUrl ? [ospUrl] : CANONICAL_OSP_URLS;
      const osdUrls = osdUrl ? [osdUrl] : CANONICAL_OSD_URLS;

      const [ospRes, osdData] = await Promise.all([
        fetchWithFallback(ospUrls, async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        }),
        fetchWithFallback(osdUrls, (url) => loadOsd(url)),
      ]);

      const mappings = parseOspXml(ospRes);
      cachedBundle = {
        categories: getActiveBodyCategories(),
        mappings,
        osdData,
      };

      return cachedBundle;
    } finally {
      activeBundlePromise = null;
    }
  })();

  return activeBundlePromise;
}

/**
 * Synchronous getter for already loaded morph data.
 */
export function getLoadedBodySlideData(): BodySlideDataBundle | null {
  return cachedBundle;
}

export interface MeshShapeOffset {
  offset: number;
  count: number;
}

/**
 * Computes vertex starting offset and vertex count for each named sub-shape in a multi-shape mesh.
 */
export function computeMeshShapeOffsets(mesh: unknown): Record<string, MeshShapeOffset> {
  const offsets: Record<string, MeshShapeOffset> = {};
  if (!mesh || typeof mesh !== 'object') return offsets;

  const m = mesh as {
    geometry?: { index?: { array?: ArrayLike<number> } };
    materials?: Array<{ name?: string; sourceShape?: string }>;
    groups?: Array<{ start: number; count: number; materialIndex: number }>;
  };

  const indices = m.geometry?.index?.array;
  if (!indices || !m.materials || !m.groups?.length) return offsets;

  for (const group of m.groups) {
    const mat: { name?: string; sourceShape?: string } | undefined = m.materials[group.materialIndex];
    if (!mat) continue;
    const shapeName = mat.sourceShape || mat.name;
    if (!shapeName) continue;

    let minIdx = Infinity;
    let maxIdx = -Infinity;
    const end = group.start + group.count;
    for (let i = group.start; i < end; i++) {
      const idx = indices[i];
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    }

    if (minIdx !== Infinity) {
      const info = {
        offset: minIdx,
        count: maxIdx - minIdx + 1,
      };
      offsets[shapeName] = info;
      offsets[shapeName.toLowerCase()] = info;
    }
  }

  return offsets;
}

/**
 * Applies active slider morphs on a vertex position buffer in Three.js render space.
 *
 * Highly optimized CPU accumulation:
 * Reads sparse delta records, transforms Skyrim NIF coordinates to Three.js coordinates
 * (Z-up -> Y-up, Y-forward -> Z-forward, scaled by 0.01288), and accumulates directly.
 * Supports multi-shape meshes (e.g. clothing + embedded skin) via optional shapeOffsets.
 *
 * @param targetPositions Array to receive the modified positions
 * @param basePositions Original un-morphed geometry positions
 * @param sliders Map of slider names to weights (0 to 100)
 * @param mappings OSP slider to target mapping dictionary
 * @param osdData Parsed OSD morph data container
 * @param scale Coordinate scale factor (default 0.01288)
 * @param shapeOffsets Optional sub-shape vertex starting offsets (for multi-shape garment meshes)
 * @returns true if any morph was applied, false if neutral
 */
export function applyBodySlideMorphs(
  targetPositions: Float32Array,
  basePositions: Float32Array,
  sliders: Record<string, number>,
  mappings: Record<string, SliderOspMapping>,
  osdData: OsdData,
  scale: number = DEFAULT_NIF_TO_RENDER_SCALE,
  shapeOffsets?: Record<string, MeshShapeOffset>,
): boolean {
  targetPositions.set(basePositions);

  let appliedCount = 0;
  const vertCount = basePositions.length / 3;

  for (const [sliderName, weight] of Object.entries(sliders)) {
    if (!weight || Math.abs(weight) < 0.0001 || !Number.isFinite(weight)) continue;

    // BodySlide percentage weight (100% = 1.0 multiplier)
    const factor = (weight / 100.0) * scale;

    // Resolve OSP mapping with full aliasing support:
    // 1. Direct name (e.g. "BreastsBigger")
    // 2. Clean name without BaseShape (e.g. "BaseShapeBreastsBigger" -> "BreastsBigger")
    // 3. Raw name with BaseShape (e.g. "BreastsBigger" -> "BaseShapeBreastsBigger")
    // 4. XML escaped/unescaped variants (e.g. NeckSize__HEAD> <-> NeckSize__HEAD&gt;)
    let mapping: SliderOspMapping | undefined = undefined;
    if (mappings) {
      mapping =
        mappings[sliderName] ??
        mappings[sliderName.replace(/^BaseShape/i, '')] ??
        mappings[`BaseShape${sliderName}`] ??
        mappings[sliderName.replace(/&gt;/g, '>').replace(/&lt;/g, '<')] ??
        mappings[sliderName.replace(/>/g, '&gt;').replace(/</g, '&lt;')];
    }

    // Fallback: If no OSP mapping exists, resolve directly against osdData!
    const targets =
      mapping && mapping.targets && mapping.targets.length > 0
        ? mapping.targets
        : [{ dataTarget: mapping?.dataTarget || sliderName, shapeTarget: '' }];

    let appliedForSlider = false;

    for (const target of targets) {
      const block =
        osdData.getBlock(target.dataTarget) ||
        osdData.getBlock(sliderName) ||
        osdData.getBlock(target.dataTarget.replace(/&gt;/g, '>').replace(/&lt;/g, '<')) ||
        osdData.getBlock(sliderName.replace(/&gt;/g, '>').replace(/&lt;/g, '<'));

      if (!block || block.diffCount === 0) continue;

      let shapeOffset = 0;
      if (shapeOffsets && target.shapeTarget) {
        const offsetInfo =
          shapeOffsets[target.shapeTarget] || shapeOffsets[target.shapeTarget.toLowerCase()];
        if (offsetInfo) {
          shapeOffset = offsetInfo.offset;
        }
      }

      const { diffCount, indices, deltas } = block;

      // Coordinate transformation from Skyrim NIF to Three.js:
      // render_X = nif_dx * scale
      // render_Y = nif_dz * scale (Skyrim Z-up -> Three.js Y-up)
      // render_Z = nif_dy * scale (Skyrim Y-forward -> Three.js Z-forward)
      if (shapeOffset === 0) {
        let inBase = 0;
        for (let d = 0; d < diffCount; d++) {
          const vIdx = indices[d];
          if (vIdx < vertCount) {
            const pIdx = vIdx * 3;
            targetPositions[pIdx] += deltas[inBase] * factor;
            targetPositions[pIdx + 1] += deltas[inBase + 2] * factor;
            targetPositions[pIdx + 2] += deltas[inBase + 1] * factor;
          }
          inBase += 3;
        }
      } else {
        let inBase = 0;
        for (let d = 0; d < diffCount; d++) {
          const vIdx = indices[d] + shapeOffset;
          if (vIdx < vertCount) {
            const pIdx = vIdx * 3;
            targetPositions[pIdx] += deltas[inBase] * factor;
            targetPositions[pIdx + 1] += deltas[inBase + 2] * factor;
            targetPositions[pIdx + 2] += deltas[inBase + 1] * factor;
          }
          inBase += 3;
        }
      }

      appliedForSlider = true;
    }

    if (appliedForSlider) {
      appliedCount++;
    }
  }

  return appliedCount > 0;
}

/**
 * Updates a Three.js BufferGeometry directly with active BodySlide morphs.
 */
export function updateGeometryWithBodySlide(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  sliders: Record<string, number>,
  mappings: Record<string, SliderOspMapping>,
  osdData: OsdData,
  shapeOffsets?: Record<string, MeshShapeOffset>,
): void {
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positionAttr) return;

  const positions = positionAttr.array as Float32Array;
  if (positions.length !== basePositions.length) return;

  applyBodySlideMorphs(positions, basePositions, sliders, mappings, osdData, DEFAULT_NIF_TO_RENDER_SCALE, shapeOffsets);

  positionAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

// In-memory cache for loaded garment / clothing OSD data
const garmentOsdCache = new Map<string, OsdData>();

export const CLOTHES_PACK_6_MAPPINGS: Readonly<Record<string, string>> = Object.freeze({
  'cp6_doneb14n shirt v2v3_fpv': 'Clothes Pack 6 Shirt V2V3 FPV UBE.osd',
  'cp6_doneb14n bodysuit v1': 'Clothes Pack 6 Bodysuit V1 UBE.osd',
  'cp6_doneb14n bodysuit v2': 'Clothes Pack 6 Bodysuit V2 UBE.osd',
  'cp6_doneb14n bodysuit v3': 'Clothes Pack 6 Bodysuit V3 UBE.osd',
  'cp6_doneb14n bodysuit v4': 'Clothes Pack 6 Bodysuit V4 UBE.osd',
  'cp6_doneb14n bodysuit v5': 'Clothes Pack 6 Bodysuit V5 UBE.osd',
  'cp6_doneb14n jacket v1': 'Clothes Pack 6 Jacket V1 UBE.osd',
  'cp6_doneb14n leggings v1': 'Clothes Pack 6 Leggings V1 UBE.osd',
  'cp6_doneb14n leggings v2': 'Clothes Pack 6 Leggings V2 UBE.osd',
  'cp6_doneb14n leggings v3': 'Clothes Pack 6 Leggings V3 UBE.osd',
  'cp6_doneb14n onepiece v1': 'Clothes Pack 6 Onepiece V1 UBE.osd',
  'cp6_doneb14n leggings v4': 'Clothes Pack 6 Leggings V4 UBE.osd',
  'cp6_doneb14n onepiece v2': 'Clothes Pack 6 Onepiece V2 UBE.osd',
  'cp6_doneb14n onepiece v3': 'Clothes Pack 6 Onepiece V3 UBE.osd',
  'cp6_doneb14n onepiece v4': 'Clothes Pack 6 Onepiece V4 UBE.osd',
  'cp6_doneb14n onepiece v5': 'Clothes Pack 6 Onepiece V5 UBE.osd',
  'cp6_doneb14n panties v1': 'Clothes Pack 6 Panties V1 UBE.osd',
  'cp6_doneb14n panties v2': 'Clothes Pack 6 Panties V2 UBE.osd',
  'cp6_doneb14n panties v3': 'Clothes Pack 6 Panties V3 UBE.osd',
  'cp6_doneb14n pants v1': 'Clothes Pack 6 Pants V1 UBE.osd',
  'cp6_doneb14n shirt v1': 'Clothes Pack 6 Shirt V1 UBE.osd',
  'cp6_doneb14n shirt v2': 'Clothes Pack 6 Shirt V2 UBE.osd',
  'cp6_doneb14n shirt v3': 'Clothes Pack 6 Shirt V3 UBE.osd',
  'cp6_doneb14n shirt v4': 'Clothes Pack 6 Shirt V4 UBE.osd',
  'cp6_doneb14n shoes': 'Clothes Pack 6 Shoes V1 UBE.osd',
  'cp6_doneb14n shorts v1': 'Clothes Pack 6 Shorts V1 UBE.osd',
  'cp6_doneb14n shorts v2': 'Clothes Pack 6 Shorts V2 UBE.osd',
  'cp6_doneb14n sweater v1': 'Clothes Pack 6 Sweater V1 UBE.osd',
  'cp6_doneb14n sweater v10': 'Clothes Pack 6 Sweater V10 UBE.osd',
  'cp6_doneb14n sweater v2': 'Clothes Pack 6 Sweater V2 UBE.osd',
  'cp6_doneb14n sweater v3': 'Clothes Pack 6 Sweater V3 UBE.osd',
  'cp6_doneb14n sweater v4': 'Clothes Pack 6 Sweater V4 UBE.osd',
  'cp6_doneb14n sweater v5': 'Clothes Pack 6 Sweater V5 UBE.osd',
  'cp6_doneb14n sweater v6': 'Clothes Pack 6 Sweater V6 UBE.osd',
  'cp6_doneb14n sweater v7': 'Clothes Pack 6 Sweater V7 UBE.osd',
  'cp6_doneb14n sweater v8': 'Clothes Pack 6 Sweater V8 UBE.osd',
  'cp6_doneb14n sweater v9': 'Clothes Pack 6 Sweater V9 UBE.osd',
  'cp6_doneb14n top v1': 'Clothes Pack 6 Top V1 UBE.osd',
  'cp6_doneb14n top v2': 'Clothes Pack 6 Top V2 UBE.osd',
  'cp6_doneb14n top v3': 'Clothes Pack 6 Top V3 UBE.osd',
  'cp6_doneb14n top v4': 'Clothes Pack 6 Top V4 UBE.osd',
  'cp6_doneb14n top v5': 'Clothes Pack 6 Top V5 UBE.osd',
  'cp6_doneb14n top v6': 'Clothes Pack 6 Top V6 UBE.osd',
  'cp6_doneb14n top v7': 'Clothes Pack 6 Top V7 UBE.osd',
  'cp6_doneb14n top v8': 'Clothes Pack 6 Top V8 UBE.osd',
  'cp6_doneb14n top v9': 'Clothes Pack 6 Top V9 UBE.osd',
  'cp6_doneb14n t-shirt v1': 'Clothes Pack 6 T-Shirt V1 UBE.osd',
  'cp6_doneb14n t-shirt v2': 'Clothes Pack 6 T-Shirt V2 UBE.osd',
  'cp6_doneb14n t-shirt v3': 'Clothes Pack 6 T-Shirt V3 UBE.osd',
  'cp6_doneb14n t-shirt v4': 'Clothes Pack 6 T-Shirt V4 UBE.osd',
  'cp6_doneb14n t-shirt v5': 'Clothes Pack 6 T-Shirt V5 UBE.osd',
});

/**
 * Reverse mapping from catalogue clothingMesh ids (and their weight variant ids)
 * directly to their Clothes Pack 6 stem.
 */
export const CLOTHES_PACK_6_ID_MAP: Readonly<Record<string, string>> = Object.freeze({
  'clothingMesh-e1239a2427486ece': 'cp6_doneb14n bodysuit v1',
  'clothingMesh-71be442105a8a88a': 'cp6_doneb14n bodysuit v1',
  'clothingMesh-8d7fab0f0f613f17': 'cp6_doneb14n bodysuit v2',
  'clothingMesh-7fc2591d90082bd2': 'cp6_doneb14n bodysuit v2',
  'clothingMesh-26724fb2e0a730f2': 'cp6_doneb14n bodysuit v3',
  'clothingMesh-807201d5431f8ab1': 'cp6_doneb14n bodysuit v3',
  'clothingMesh-ae21b5fcfbab5426': 'cp6_doneb14n bodysuit v4',
  'clothingMesh-579283937bb11007': 'cp6_doneb14n bodysuit v4',
  'clothingMesh-b4c98186ac1d9408': 'cp6_doneb14n bodysuit v5',
  'clothingMesh-3cd3d2c8437508a1': 'cp6_doneb14n bodysuit v5',
  'clothingMesh-2f656e7d8da989ea': 'cp6_doneb14n jacket v1',
  'clothingMesh-0f776b6abe46a4b0': 'cp6_doneb14n leggings v1',
  'clothingMesh-42da8f390b52dcce': 'cp6_doneb14n leggings v1',
  'clothingMesh-f82728ed29ea2316': 'cp6_doneb14n leggings v2',
  'clothingMesh-765e3ed328585615': 'cp6_doneb14n leggings v2',
  'clothingMesh-129ec05e6dd3c4e2': 'cp6_doneb14n leggings v3',
  'clothingMesh-5e099d4af4100f76': 'cp6_doneb14n leggings v3',
  'clothingMesh-3b1ab6f6d88a1126': 'cp6_doneb14n leggings v4',
  'clothingMesh-54e6b7f69a1badbd': 'cp6_doneb14n leggings v4',
  'clothingMesh-06610fe1b741d582': 'cp6_doneb14n onepiece v1',
  'clothingMesh-bbab7458926a504a': 'cp6_doneb14n onepiece v1',
  'clothingMesh-2ac683b1060fe5da': 'cp6_doneb14n onepiece v2',
  'clothingMesh-96d35d290da45938': 'cp6_doneb14n onepiece v2',
  'clothingMesh-14121c7aeb9567da': 'cp6_doneb14n onepiece v3',
  'clothingMesh-f1ba5ee67d875097': 'cp6_doneb14n onepiece v3',
  'clothingMesh-84c56af1ac4598cd': 'cp6_doneb14n onepiece v4',
  'clothingMesh-590cc88f3dbaaf12': 'cp6_doneb14n onepiece v4',
  'clothingMesh-e3a56c7ddf7ef3d7': 'cp6_doneb14n onepiece v5',
  'clothingMesh-e05927bd17547e25': 'cp6_doneb14n onepiece v5',
  'clothingMesh-e397c2b327b07dc3': 'cp6_doneb14n panties v1',
  'clothingMesh-db791d2916956914': 'cp6_doneb14n panties v1',
  'clothingMesh-4287fb924e417ed8': 'cp6_doneb14n panties v2',
  'clothingMesh-6ccf3bb0c3753dc9': 'cp6_doneb14n panties v2',
  'clothingMesh-8dc4767ea9900a92': 'cp6_doneb14n panties v3',
  'clothingMesh-2b5b3fbcf4f8f410': 'cp6_doneb14n panties v3',
  'clothingMesh-ad5d0570fdc0aaf1': 'cp6_doneb14n pants v1',
  'clothingMesh-78f24d6c76c200f6': 'cp6_doneb14n pants v1',
  'clothingMesh-0b3c16569742e58d': 'cp6_doneb14n shirt v1',
  'clothingMesh-fa3e264a03a0e2cd': 'cp6_doneb14n shirt v1',
  'clothingMesh-255e80d2b5303c02': 'cp6_doneb14n shirt v2',
  'clothingMesh-d6483f6c5d0f0d81': 'cp6_doneb14n shirt v2',
  'clothingMesh-0d8e15e82925c17e': 'cp6_doneb14n shirt v2v3_fpv',
  'clothingMesh-fdb75222721bc46d': 'cp6_doneb14n shirt v2v3_fpv',
  'clothingMesh-bb01aa1ad6a66d49': 'cp6_doneb14n shirt v3',
  'clothingMesh-9a0d6b6b09843070': 'cp6_doneb14n shirt v3',
  'clothingMesh-2803d1a77b846f86': 'cp6_doneb14n shirt v4',
  'clothingMesh-3bee6ba9063e574a': 'cp6_doneb14n shirt v4',
  'clothingMesh-2e5147e4ddcf4183': 'cp6_doneb14n shoes',
  'clothingMesh-ce47f830b8acf6f4': 'cp6_doneb14n shoes',
  'clothingMesh-9a89c3094f0be702': 'cp6_doneb14n shorts v1',
  'clothingMesh-dd15dcce3582b394': 'cp6_doneb14n shorts v1',
  'clothingMesh-281e8e630bb97b60': 'cp6_doneb14n shorts v2',
  'clothingMesh-67a1533b9b27b2af': 'cp6_doneb14n shorts v2',
  'clothingMesh-e40e5300c5160b24': 'cp6_doneb14n sweater v10',
  'clothingMesh-030e762b9828a717': 'cp6_doneb14n sweater v10',
  'clothingMesh-e59635732683c431': 'cp6_doneb14n sweater v1',
  'clothingMesh-cec9cbd2106cd04a': 'cp6_doneb14n sweater v1',
  'clothingMesh-79c47a60a9172b9b': 'cp6_doneb14n sweater v2',
  'clothingMesh-aa7c78dfa2348868': 'cp6_doneb14n sweater v2',
  'clothingMesh-0b062d322ffba20a': 'cp6_doneb14n sweater v3',
  'clothingMesh-01555d650c4fbe94': 'cp6_doneb14n sweater v3',
  'clothingMesh-f1ba0544ae009fc6': 'cp6_doneb14n sweater v4',
  'clothingMesh-e8ce6c738892d601': 'cp6_doneb14n sweater v4',
  'clothingMesh-635be445798694c8': 'cp6_doneb14n sweater v5',
  'clothingMesh-bf0f62d5cd92b39d': 'cp6_doneb14n sweater v5',
  'clothingMesh-bbf3ddbc39f66f59': 'cp6_doneb14n sweater v6',
  'clothingMesh-4b9aafd63e337f5d': 'cp6_doneb14n sweater v6',
  'clothingMesh-925893d15e9a6de5': 'cp6_doneb14n sweater v7',
  'clothingMesh-18ad40c660835d55': 'cp6_doneb14n sweater v7',
  'clothingMesh-90670ad5b1a1b612': 'cp6_doneb14n sweater v8',
  'clothingMesh-97a120a0e2edac3f': 'cp6_doneb14n sweater v8',
  'clothingMesh-422aa96310ca82f3': 'cp6_doneb14n sweater v9',
  'clothingMesh-8bf52b80718e70ec': 'cp6_doneb14n sweater v9',
  'clothingMesh-5a3497efb79ba6ae': 'cp6_doneb14n t-shirt v1',
  'clothingMesh-0ed7f067f7fd8839': 'cp6_doneb14n t-shirt v1',
  'clothingMesh-dc2ea353a9a15d15': 'cp6_doneb14n t-shirt v2',
  'clothingMesh-0a46aebcb040f23d': 'cp6_doneb14n t-shirt v2',
  'clothingMesh-aa14a93d2bade6e6': 'cp6_doneb14n t-shirt v3',
  'clothingMesh-6f83b6e121b39413': 'cp6_doneb14n t-shirt v3',
  'clothingMesh-f2854b48f00b90f1': 'cp6_doneb14n t-shirt v4',
  'clothingMesh-65161fa2db487004': 'cp6_doneb14n t-shirt v4',
  'clothingMesh-aa31f10a1a602f58': 'cp6_doneb14n t-shirt v5',
  'clothingMesh-7a14fecafa60d4c7': 'cp6_doneb14n t-shirt v5',
  'clothingMesh-45cccbb97ddf0d00': 'cp6_doneb14n top v1',
  'clothingMesh-b808ae1b4b951902': 'cp6_doneb14n top v1',
  'clothingMesh-6e27cbbf85d6a151': 'cp6_doneb14n top v2',
  'clothingMesh-04626e1906bc4ff1': 'cp6_doneb14n top v2',
  'clothingMesh-e1048aae11d4dd7a': 'cp6_doneb14n top v3',
  'clothingMesh-7af54f95f3f74e90': 'cp6_doneb14n top v3',
  'clothingMesh-9435f4372facb06c': 'cp6_doneb14n top v4',
  'clothingMesh-0b08472f86c152e2': 'cp6_doneb14n top v4',
  'clothingMesh-3ab70712ecaf02a9': 'cp6_doneb14n top v5',
  'clothingMesh-7c5ff9b040ffe909': 'cp6_doneb14n top v5',
  'clothingMesh-d36fded92c9a965f': 'cp6_doneb14n top v6',
  'clothingMesh-46508da2d17959d5': 'cp6_doneb14n top v6',
  'clothingMesh-246e209c786d8557': 'cp6_doneb14n top v7',
  'clothingMesh-ba6ceaff2ab4638e': 'cp6_doneb14n top v7',
  'clothingMesh-07b9e58abe01921d': 'cp6_doneb14n top v8',
  'clothingMesh-7bb41324bebd2471': 'cp6_doneb14n top v8',
  'clothingMesh-e459536a08e624a1': 'cp6_doneb14n top v9',
  'clothingMesh-fca09527d46cb4e1': 'cp6_doneb14n top v9',
});

export type GarmentIdentifier =
  | string
  | { id?: string; weightKey?: string; file?: string; label?: string; rel?: string; meshUrl?: string }
  | null
  | undefined;

/**
 * Resolves any garment mesh URL, path, label, or garment object to its corresponding SliderSet name in Clothes Pack 6.
 */
export function resolveGarmentSliderSetName(garmentOrKey: GarmentIdentifier): string | null {
  if (!garmentOrKey) return null;

  let query: string = '';
  if (typeof garmentOrKey === 'object') {
    query =
      garmentOrKey.weightKey ||
      garmentOrKey.file ||
      garmentOrKey.label ||
      garmentOrKey.rel ||
      garmentOrKey.id ||
      garmentOrKey.meshUrl ||
      '';
  } else {
    query = garmentOrKey;
  }
  if (!query) return null;

  // 1. Direct id lookup (supports bare id, query param, or pack json path)
  const idMatch = query.match(/clothingMesh-[a-f0-9]+/i);
  if (idMatch && CLOTHES_PACK_6_ID_MAP[idMatch[0]]) {
    const key = CLOTHES_PACK_6_ID_MAP[idMatch[0]].toLowerCase();
    const osd =
      CLOTHES_PACK_6_MAPPINGS[key] ??
      Object.entries(CLOTHES_PACK_6_MAPPINGS).find(([k]) => key.includes(k) || k.includes(key))?.[1];
    if (osd) return osd.replace(/\.osd$/i, '');
  }

  // 2. Decode filename or path stem
  const decoded = decodeURIComponent(query).toLowerCase().replace(/\\/g, '/');
  const filename = decoded.split('/').pop() ?? '';
  const stem = filename.replace(/(_[01])?\.nif$/, '').replace(/(_[01])?\.json$/, '').trim();

  // 3. Match against CLOTHES_PACK_6_MAPPINGS keys or values
  const osdFile =
    CLOTHES_PACK_6_MAPPINGS[stem] ??
    CLOTHES_PACK_6_MAPPINGS[decoded] ??
    Object.entries(CLOTHES_PACK_6_MAPPINGS).find(
      ([key, val]) =>
        stem === key ||
        decoded === key ||
        stem.includes(key) ||
        key.includes(stem) ||
        val.toLowerCase().includes(stem) ||
        stem.includes(val.toLowerCase().replace(/\.osd$/i, '')),
    )?.[1];

  return osdFile ? osdFile.replace(/\.osd$/i, '') : null;
}

/**
 * Resolves any garment mesh URL, path, or label to its corresponding OSD URL.
 */
export function resolveGarmentOsdUrl(garmentOrKey: GarmentIdentifier): string | null {
  const setName = resolveGarmentSliderSetName(garmentOrKey);
  if (!setName) return null;
  return `/assets/bodyslide/ShapeData/Clothes Pack 6 UBE/${setName}.osd`;
}

// In-memory cache for parsed Clothes Pack 6 SliderSets
let cp6SliderSetsCache: Record<string, Record<string, SliderOspMapping>> | null = null;
let cp6SliderSetsPromise: Promise<Record<string, Record<string, SliderOspMapping>>> | null = null;

/**
 * Loads and parses all 51 SliderSets from Clothes Pack 6 UBE.osp with in-memory caching.
 */
export async function loadClothesPack6SliderSets(): Promise<Record<string, Record<string, SliderOspMapping>>> {
  if (cp6SliderSetsCache) return cp6SliderSetsCache;
  if (cp6SliderSetsPromise) return cp6SliderSetsPromise;

  cp6SliderSetsPromise = (async () => {
    try {
      const res = await fetch('/assets/bodyslide/SliderSets/Clothes Pack 6 UBE.osp');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xmlString = await res.text();

      const sets: Record<string, Record<string, SliderOspMapping>> = {};
      const setRegex = /<SliderSet\s+name="([^"]+)">([\s\S]*?)<\/SliderSet>/gi;
      let sm: RegExpExecArray | null;
      while ((sm = setRegex.exec(xmlString)) !== null) {
        const setName = sm[1];
        const setBody = sm[2];
        sets[setName] = parseOspXml(setBody);
      }

      cp6SliderSetsCache = sets;
      return sets;
    } finally {
      cp6SliderSetsPromise = null;
    }
  })();

  return cp6SliderSetsPromise;
}

/**
 * Loads the exact SliderSet mappings for an equipped garment mesh.
 * Falls back to canonical body mappings if the garment has no specific SliderSet.
 */
export async function loadGarmentMappings(garmentOrKey: GarmentIdentifier): Promise<Record<string, SliderOspMapping>> {
  const setName = resolveGarmentSliderSetName(garmentOrKey);
  if (setName) {
    try {
      const sets = await loadClothesPack6SliderSets();
      if (sets[setName]) return sets[setName];
    } catch (err) {
      console.warn(`[morphLoader] Could not load specific mappings for ${setName}:`, err);
    }
  }

  // Fallback to canonical UBE body mappings
  const bodyData = await loadAllBodySlideData();
  return bodyData.mappings;
}

/**
 * Loads and caches an Outfit Studio ShapeData (.osd) file for a specific garment / clothing item.
 * E.g. garmentName = 'Clothes Pack 6 Bodysuit V1 UBE' or a full relative path.
 */
export async function loadGarmentOsd(
  garmentNameOrPath: string,
  packName: string = 'Clothes Pack 6 UBE',
): Promise<OsdData> {
  let url = garmentNameOrPath;
  if (!url.startsWith('/') && !url.startsWith('http')) {
    const filename = garmentNameOrPath.endsWith('.osd') ? garmentNameOrPath : `${garmentNameOrPath}.osd`;
    url = `/assets/bodyslide/ShapeData/${packName}/${filename}`;
  }

  const cached = garmentOsdCache.get(url);
  if (cached) return cached;

  const osdData = await loadOsd(url);
  garmentOsdCache.set(url, osdData);
  return osdData;
}

/**
 * Applies BodySlide slider morphs to a garment / clothing BufferGeometry.
 */
export function updateGarmentGeometryWithBodySlide(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  sliders: Record<string, number>,
  mappings: Record<string, SliderOspMapping>,
  osdData: OsdData,
): void {
  updateGeometryWithBodySlide(geometry, basePositions, sliders, mappings, osdData);
}

// Hand and Feet OSD and OSP paths
const CANONICAL_HAND_OSD_URLS = [
  '/assets/bodyslide/ShapeData/UBE SE 2.0 - Necoco Hand/UBE SE 2.0 - Necoco Hand.osd',
  '/assets/bodyslide/UBE SE 2.0 - Necoco Hand.osd',
];
const CANONICAL_HAND_OSP_URLS = [
  '/assets/bodyslide/SliderSets/UBE SE 2.0 - Necoco Hand.osp',
  '/assets/bodyslide/UBE SE 2.0 - Necoco Hand.osp',
];

const CANONICAL_FEET_OSD_URLS = [
  '/assets/bodyslide/ShapeData/UBE SE 2.0 - Necoco Feet/UBE SE 2.0 - Necoco Feet.osd',
  '/assets/bodyslide/UBE SE 2.0 - Necoco Feet.osd',
];
const CANONICAL_FEET_OSP_URLS = [
  '/assets/bodyslide/SliderSets/UBE SE 2.0 - Necoco Feet.osp',
  '/assets/bodyslide/UBE SE 2.0 - Necoco Feet.osp',
];

let cachedHandBundle: { osdData: OsdData; mappings: Record<string, SliderOspMapping> } | null = null;
let activeHandPromise: Promise<{ osdData: OsdData; mappings: Record<string, SliderOspMapping> }> | null = null;

let cachedFeetBundle: { osdData: OsdData; mappings: Record<string, SliderOspMapping> } | null = null;
let activeFeetPromise: Promise<{ osdData: OsdData; mappings: Record<string, SliderOspMapping> }> | null = null;

/**
 * Loads and caches BodySlide morph data and slider mappings for UBE Necoco Hands.
 */
export async function loadHandOsd(): Promise<{ osdData: OsdData; mappings: Record<string, SliderOspMapping> }> {
  if (cachedHandBundle) return cachedHandBundle;
  if (activeHandPromise) return activeHandPromise;

  activeHandPromise = (async () => {
    try {
      const [ospRes, osdData] = await Promise.all([
        fetchWithFallback(CANONICAL_HAND_OSP_URLS, async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        }),
        fetchWithFallback(CANONICAL_HAND_OSD_URLS, (url) => loadOsd(url)),
      ]);

      const mappings = parseOspXml(ospRes);
      cachedHandBundle = { osdData, mappings };
      return cachedHandBundle;
    } finally {
      activeHandPromise = null;
    }
  })();

  return activeHandPromise;
}

/**
 * Loads and caches BodySlide morph data and slider mappings for UBE Necoco Feet.
 */
export async function loadFeetOsd(): Promise<{ osdData: OsdData; mappings: Record<string, SliderOspMapping> }> {
  if (cachedFeetBundle) return cachedFeetBundle;
  if (activeFeetPromise) return activeFeetPromise;

  activeFeetPromise = (async () => {
    try {
      const [ospRes, osdData] = await Promise.all([
        fetchWithFallback(CANONICAL_FEET_OSP_URLS, async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        }),
        fetchWithFallback(CANONICAL_FEET_OSD_URLS, (url) => loadOsd(url)),
      ]);

      const mappings = parseOspXml(ospRes);
      cachedFeetBundle = { osdData, mappings };
      return cachedFeetBundle;
    } finally {
      activeFeetPromise = null;
    }
  })();

  return activeFeetPromise;
}

/**
 * Applies BodySlide slider morphs to a Hand mesh BufferGeometry.
 */
export function updateHandGeometryWithBodySlide(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  sliders: Record<string, number>,
  mappings: Record<string, SliderOspMapping>,
  osdData: OsdData,
): void {
  updateGeometryWithBodySlide(geometry, basePositions, sliders, mappings, osdData);
}

/**
 * Applies BodySlide slider morphs to a Foot mesh BufferGeometry.
 */
export function updateFeetGeometryWithBodySlide(
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
  sliders: Record<string, number>,
  mappings: Record<string, SliderOspMapping>,
  osdData: OsdData,
): void {
  updateGeometryWithBodySlide(geometry, basePositions, sliders, mappings, osdData);
}
