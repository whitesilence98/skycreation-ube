/**
 * lib/export/skinAtlasPacker.ts
 *
 * Shared export-time UV Atlas Packer & PBR Texture Merger for Three.js meshes.
 *
 * Consolidates multi-part body/skin material slots (e.g. Body, Face/Head,
 * Hands, Feet) into:
 *   - 1 non-overlapping UV atlas grid (with bleed margins for mipmap safety)
 *   - 1 unified PBR material (`Skin_Atlas`) with baked BaseColor, Normal & ORM maps
 *   - Coincident seam boundary normal smoothing (eliminates neck/wrist creases)
 *
 * Pure Three.js + browser Canvas — operates strictly on cloned export data so
 * live viewport rendering, rigging skeletons and sliders are never mutated.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Options
// ─────────────────────────────────────────────────────────────────────────────

export interface SkinAtlasOptions {
  /** Output square atlas texture resolution in pixels. Default: 4096 (auto-clamped by slot count). */
  atlasSize?: number;
  /** Gutter margin (px) extruded around each tile to prevent mipmap border bleeding. Default: 8. */
  paddingPx?: number;
  /** Output material name. Default: 'Skin_Atlas'. */
  materialName?: string;
  /** Which material slots to include in the packed atlas. Default: opaque non-hair/eye slots. */
  filterSlot?: (material: THREE.Material, slotIndex: number) => boolean;
  /** Average vertex normals across coincident open seam boundary edges. Default: true. */
  smoothBoundaryNormals?: boolean;
}

export interface PackedAtlasResult {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  packedTextures: THREE.Texture[];
  packedSlotCount: number;
}

interface AtlasTile {
  slotIndex: number;
  col: number;
  row: number;
  cellX: number;
  cellY: number;
  cellW: number;
  cellH: number;
  innerX: number;
  innerY: number;
  innerW: number;
  innerH: number;
  uOffset: number;
  vOffset: number;
  uScale: number;
  vScale: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ALPHA_EXCLUDED_RE = /eye(?!lash)|lash|brow|hair|beard|mustache|glass|lens/i;

/**
 * Default filter: packs opaque skin/body material slots while preserving
 * eyes, eyelashes, brows and hair cards in separate slots so alpha masking works.
 */
export function isDefaultPackableMaterial(mat: THREE.Material): boolean {
  if (!mat || mat.visible === false) return false;
  const std = mat as THREE.MeshStandardMaterial;
  if (std.transparent || (typeof std.alphaTest === 'number' && std.alphaTest > 0)) {
    return false;
  }
  if (ALPHA_EXCLUDED_RE.test(mat.name || '')) {
    return false;
  }
  return true;
}

/** Wraps UV coordinate cleanly into `[0, 1]`, keeping exact upper edge `1.0` intact. */
function wrapUv01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v >= 0 && v <= 1) return v;
  const f = v - Math.floor(v);
  return v > 0 && f === 0 ? 1 : f;
}

/** Computes a balanced grid of non-overlapping UV tiles inside `[0, atlasSize]^2`. */
function computeAtlasTiles(slotIndices: number[], atlasSize: number, paddingPx: number): AtlasTile[] {
  const count = slotIndices.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = Math.floor(atlasSize / cols);
  const cellH = Math.floor(atlasSize / rows);
  const pad = Math.min(paddingPx, Math.floor(Math.min(cellW, cellH) * 0.1));

  return slotIndices.map((slotIndex, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * cellW;
    const cellY = row * cellH;
    const innerX = cellX + pad;
    const innerY = cellY + pad;
    const innerW = Math.max(1, cellW - pad * 2);
    const innerH = Math.max(1, cellH - pad * 2);
    return {
      slotIndex,
      col,
      row,
      cellX,
      cellY,
      cellW,
      cellH,
      innerX,
      innerY,
      innerW,
      innerH,
      uOffset: innerX / atlasSize,
      // When atlasTex.flipY = true, canvas Y=0 is top (UV V=1) and canvas Y=innerY+innerH is bottom edge of inner rect.
      vOffset: 1 - (innerY + innerH) / atlasSize,
      uScale: innerW / atlasSize,
      vScale: innerH / atlasSize,
    };
  });
}

/** Converts any Three.js Texture (`HTMLImageElement`, `HTMLCanvasElement`, `ImageBitmap`, `DataTexture`) into an HTMLCanvasElement. */
function textureToCanvas(tex: THREE.Texture): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !tex || !tex.image) return null;
  const img = tex.image as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    data?: Uint8Array | Uint8ClampedArray;
  };

  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w <= 0 || h <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  if (img.data && !(img instanceof HTMLCanvasElement) && !(img instanceof HTMLImageElement)) {
    const clamped = img.data instanceof Uint8ClampedArray
      ? img.data
      : new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    const imgData = new ImageData(new Uint8ClampedArray(clamped), w, h);
    ctx.putImageData(imgData, 0, 0);
  } else {
    try {
      ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
    } catch {
      return null;
    }
  }

  // Flip vertically when source texture uses top-down glTF convention (`flipY === false`)
  // so every packed tile aligns under unified `atlasTexture.flipY = true`.
  if (!tex.flipY) {
    const flipped = document.createElement('canvas');
    flipped.width = w;
    flipped.height = h;
    const fctx = flipped.getContext('2d', { willReadFrequently: true });
    if (!fctx) return canvas;
    fctx.translate(0, h);
    fctx.scale(1, -1);
    fctx.drawImage(canvas, 0, 0, w, h);
    return flipped;
  }

  return canvas;
}

/** Draws a source canvas into `tile` plus 8px extruded edge gutters to prevent mipmap seams. */
function drawTileWithBleed(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  tile: AtlasTile,
): void {
  const { cellX, cellY, cellW, cellH, innerX, innerY, innerW, innerH } = tile;
  const padLeft = innerX - cellX;
  const padTop = innerY - cellY;
  const padRight = (cellX + cellW) - (innerX + innerW);
  const padBottom = (cellY + cellH) - (innerY + innerH);
  const sw = src.width;
  const sh = src.height;

  // Inner image
  ctx.drawImage(src, 0, 0, sw, sh, innerX, innerY, innerW, innerH);

  // Edge bleed strips
  if (padLeft > 0) ctx.drawImage(src, 0, 0, 1, sh, cellX, innerY, padLeft, innerH);
  if (padRight > 0) ctx.drawImage(src, sw - 1, 0, 1, sh, innerX + innerW, innerY, padRight, innerH);
  if (padTop > 0) ctx.drawImage(src, 0, 0, sw, 1, innerX, cellY, innerW, padTop);
  if (padBottom > 0) ctx.drawImage(src, 0, sh - 1, sw, 1, innerX, innerY + innerH, innerW, padBottom);

  // 4 corners
  if (padLeft > 0 && padTop > 0) ctx.drawImage(src, 0, 0, 1, 1, cellX, cellY, padLeft, padTop);
  if (padRight > 0 && padTop > 0) ctx.drawImage(src, sw - 1, 0, 1, 1, innerX + innerW, cellY, padRight, padTop);
  if (padLeft > 0 && padBottom > 0) ctx.drawImage(src, 0, sh - 1, 1, 1, cellX, innerY + innerH, padLeft, padBottom);
  if (padRight > 0 && padBottom > 0) ctx.drawImage(src, sw - 1, sh - 1, 1, 1, innerX + innerW, innerY + innerH, padRight, padBottom);
}

/** Applies linear Three.Color tint in sRGB pixel space on a cloned canvas. */
function tintCanvasSrgb(src: HTMLCanvasElement, color: THREE.Color): HTMLCanvasElement {
  const srgb = color.clone().convertLinearToSRGB();
  if (srgb.r >= 0.995 && srgb.g >= 0.995 && srgb.b >= 0.995) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);
  const imgData = ctx.getImageData(0, 0, src.width, src.height);
  const d = imgData.data;
  const rMul = Math.max(0, Math.min(1, srgb.r));
  const gMul = Math.max(0, Math.min(1, srgb.g));
  const bMul = Math.max(0, Math.min(1, srgb.b));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i]! * rMul);
    d[i + 1] = Math.round(d[i + 1]! * gMul);
    d[i + 2] = Math.round(d[i + 2]! * bMul);
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

/** Builds a glTF-canonical ORM tile canvas (`R=255 AO, G=roughness, B=metalness, A=255`). */
function buildSlotOrmCanvas(mat: THREE.MeshStandardMaterial): HTMLCanvasElement {
  const rTex = mat.roughnessMap;
  const mTex = mat.metalnessMap;
  const rCanvas = rTex ? textureToCanvas(rTex) : null;
  const mCanvas = mTex && mTex !== rTex ? textureToCanvas(mTex) : rTex && mTex === rTex ? rCanvas : null;

  const w = Math.max(rCanvas?.width ?? 0, mCanvas?.width ?? 0, 64);
  const h = Math.max(rCanvas?.height ?? 0, mCanvas?.height ?? 0, 64);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  const outImg = ctx.createImageData(w, h);
  const outPx = outImg.data;

  let rPx: Uint8ClampedArray | null = null;
  if (rCanvas) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
    tctx.drawImage(rCanvas, 0, 0, w, h);
    rPx = tctx.getImageData(0, 0, w, h).data;
  }

  let mPx: Uint8ClampedArray | null = null;
  if (mCanvas && mCanvas !== rCanvas) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
    tctx.drawImage(mCanvas, 0, 0, w, h);
    mPx = tctx.getImageData(0, 0, w, h).data;
  } else if (mCanvas && mCanvas === rCanvas) {
    mPx = rPx;
  }

  const scalarR = Math.max(0, Math.min(1, mat.roughness ?? 0.55));
  const scalarM = Math.max(0, Math.min(1, mat.metalness ?? 0.0));
  const sameOrmMap = Boolean(rTex && rTex === mTex);

  for (let i = 0; i < outPx.length; i += 4) {
    outPx[i] = rPx && sameOrmMap ? rPx[i]! : 255;
    const rFactor = rPx ? rPx[i + 1]! / 255 : 1;
    outPx[i + 1] = Math.max(0, Math.min(255, Math.round(rFactor * scalarR * 255)));
    const mFactor = mPx ? mPx[i + 2]! / 255 : 1;
    outPx[i + 2] = Math.max(0, Math.min(255, Math.round(mFactor * scalarM * 255)));
    outPx[i + 3] = 255;
  }

  ctx.putImageData(outImg, 0, 0);
  return out;
}

/**
 * Averages vertex normals along open seam edges where vertices from distinct
 * parts coincide (such as neck, wrist and ankle borders), removing shading creases.
 */
function smoothCoincidentBoundaryNormals(
  geometry: THREE.BufferGeometry,
  maxIndexInPackedGroup: number,
): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const indexAttr = geometry.getIndex();
  if (!posAttr || !normAttr || !indexAttr || maxIndexInPackedGroup <= 0) return;

  // Count how often each undirected edge appears inside the packed triangles
  const edgeCounts = new Map<string, number>();
  const edgePairKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  for (let i = 0; i + 2 < maxIndexInPackedGroup; i += 3) {
    const a = indexAttr.getX(i);
    const b = indexAttr.getX(i + 1);
    const c = indexAttr.getX(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = edgePairKey(u, v);
      edgeCounts.set(k, (edgeCounts.get(k) ?? 0) + 1);
    }
  }

  const boundaryVerts = new Set<number>();
  for (let i = 0; i + 2 < maxIndexInPackedGroup; i += 3) {
    const a = indexAttr.getX(i);
    const b = indexAttr.getX(i + 1);
    const c = indexAttr.getX(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      if (edgeCounts.get(edgePairKey(u, v)) === 1) {
        boundaryVerts.add(u);
        boundaryVerts.add(v);
      }
    }
  }

  if (boundaryVerts.size < 2) return;

  // Bucket boundary vertices by quantized 0.1 mm position
  const posBuckets = new Map<string, number[]>();
  const quant = 10_000;
  for (const vi of boundaryVerts) {
    const key = `${Math.round(posAttr.getX(vi) * quant)},${Math.round(posAttr.getY(vi) * quant)},${Math.round(posAttr.getZ(vi) * quant)}`;
    const list = posBuckets.get(key);
    if (list) list.push(vi);
    else posBuckets.set(key, [vi]);
  }

  const refN = new THREE.Vector3();
  const candN = new THREE.Vector3();
  const avgN = new THREE.Vector3();

  for (const bucket of posBuckets.values()) {
    if (bucket.length < 2) continue;
    refN.set(normAttr.getX(bucket[0]!), normAttr.getY(bucket[0]!), normAttr.getZ(bucket[0]!)).normalize();
    avgN.set(0, 0, 0);
    const matching: number[] = [];
    for (const vi of bucket) {
      candN.set(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).normalize();
      if (refN.dot(candN) >= 0.25) {
        avgN.add(candN);
        matching.push(vi);
      }
    }
    if (matching.length >= 2 && avgN.lengthSq() > 1e-6) {
      avgN.normalize();
      for (const vi of matching) {
        normAttr.setXYZ(vi, avgN.x, avgN.y, avgN.z);
      }
    }
  }
  normAttr.needsUpdate = true;
}

/** Clones an attribute array with extra capacity appended via source vertex duplication. */
function expandAttributeBuffer(
  attr: THREE.BufferAttribute,
  extraSourceIndices: number[],
): THREE.BufferAttribute {
  const itemSize = attr.itemSize;
  const origCount = attr.count;
  const newCount = origCount + extraSourceIndices.length;
  const ArrayCtor = attr.array.constructor as {
    new (len: number): Float32Array | Uint16Array | Uint32Array;
  };
  const out = new ArrayCtor(newCount * itemSize);
  out.set(attr.array.subarray(0, origCount * itemSize));

  for (let i = 0; i < extraSourceIndices.length; i++) {
    const srcVi = extraSourceIndices[i]!;
    const dstBase = (origCount + i) * itemSize;
    const srcBase = srcVi * itemSize;
    for (let k = 0; k < itemSize; k++) {
      out[dstBase + k] = attr.array[srcBase + k]!;
    }
  }

  return new THREE.BufferAttribute(out, itemSize, attr.normalized);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Atlas Packer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Packs eligible material slots on a multi-material geometry into a single
 * unified UV atlas + PBR `Skin_Atlas` material, preserving any non-eligible
 * slots (such as eyes, eyelashes, brows or hair) on trailing material indices.
 */
export function packGeometryAndMaterialsIntoAtlas(
  sourceGeometry: THREE.BufferGeometry,
  sourceMaterials: THREE.Material | THREE.Material[],
  options: SkinAtlasOptions = {},
): PackedAtlasResult {
  const matList = Array.isArray(sourceMaterials) ? [...sourceMaterials] : [sourceMaterials];
  const geo = sourceGeometry.clone();

  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }

  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    return { geometry: geo, materials: matList, packedTextures: [], packedSlotCount: 0 };
  }

  // Ensure indexed triangle representation
  if (!geo.getIndex()) {
    const vCount = posAttr.count;
    const idxArr = vCount > 65535 ? new Uint32Array(vCount) : new Uint16Array(vCount);
    for (let i = 0; i < vCount; i++) idxArr[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }

  const indexAttr = geo.getIndex()!;
  const groups = geo.groups.length > 0
    ? geo.groups.map((g) => ({ ...g }))
    : [{ start: 0, count: indexAttr.count, materialIndex: 0 }];

  const filterFn = options.filterSlot ?? ((m) => isDefaultPackableMaterial(m));
  const packedSlotSet = new Set<number>();
  const orderedPackedSlots: number[] = [];
  const trailingSlots: number[] = [];
  const seenSlots = new Set<number>();

  for (const g of groups) {
    const mIdx = Math.min(matList.length - 1, Math.max(0, g.materialIndex ?? 0));
    if (seenSlots.has(mIdx)) continue;
    seenSlots.add(mIdx);
    const mat = matList[mIdx];
    if (mat && filterFn(mat, mIdx)) {
      packedSlotSet.add(mIdx);
      orderedPackedSlots.push(mIdx);
    } else if (mat) {
      trailingSlots.push(mIdx);
    }
  }

  if (orderedPackedSlots.length < 2) {
    return {
      geometry: geo,
      materials: matList,
      packedTextures: [],
      packedSlotCount: orderedPackedSlots.length,
    };
  }

  const atlasSize = options.atlasSize ?? 4096;
  const paddingPx = options.paddingPx ?? 8;
  const tiles = computeAtlasTiles(orderedPackedSlots, atlasSize, paddingPx);
  const tileBySlot = new Map<number, AtlasTile>(tiles.map((t) => [t.slotIndex, t]));

  // Walk all groups: isolate shared vertices across slots by duplicating when needed
  const origVertCount = posAttr.count;
  const ownerSlotByVert = new Int32Array(origVertCount).fill(-1);
  const extraVertexSources: number[] = [];
  const extraVertexTiles: AtlasTile[] = [];
  const dupKeyToNewIndex = new Map<string, number>();

  const packedIndices: number[] = [];
  const trailingBuckets = new Map<number, number[]>();
  for (const ts of trailingSlots) trailingBuckets.set(ts, []);

  // First reserve vertices used by non-packed trailing groups so packed UVs never mutate them
  for (const g of groups) {
    const mIdx = Math.min(matList.length - 1, Math.max(0, g.materialIndex ?? 0));
    if (packedSlotSet.has(mIdx)) continue;
    const bucket = trailingBuckets.get(mIdx)!;
    const end = Math.min(indexAttr.count, g.start + g.count);
    for (let i = g.start; i < end; i++) {
      const vi = indexAttr.getX(i);
      ownerSlotByVert[vi] = -2;
      bucket.push(vi);
    }
  }

  for (const g of groups) {
    const mIdx = Math.min(matList.length - 1, Math.max(0, g.materialIndex ?? 0));
    const tile = tileBySlot.get(mIdx);
    if (!tile) continue;
    const end = Math.min(indexAttr.count, g.start + g.count);
    for (let i = g.start; i < end; i++) {
      const vi = indexAttr.getX(i);
      const owner = ownerSlotByVert[vi]!;
      if (owner === -1 || owner === mIdx) {
        ownerSlotByVert[vi] = mIdx;
        packedIndices.push(vi);
      } else {
        const dupKey = `${vi}_${mIdx}`;
        let newVi = dupKeyToNewIndex.get(dupKey);
        if (newVi === undefined) {
          newVi = origVertCount + extraVertexSources.length;
          dupKeyToNewIndex.set(dupKey, newVi);
          extraVertexSources.push(vi);
          extraVertexTiles.push(tile);
        }
        packedIndices.push(newVi);
      }
    }
  }

  // Expand vertex attributes cleanly if any boundary vertex was shared across parts
  const attrNames = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', '_skincavity'] as const;
  if (extraVertexSources.length > 0) {
    for (const name of attrNames) {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (attr) {
        geo.setAttribute(name, expandAttributeBuffer(attr, extraVertexSources));
      }
    }
  }

  // Ensure UV attribute exists
  let uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uvAttr) {
    uvAttr = new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2);
    geo.setAttribute('uv', uvAttr);
  }

  // Remap UVs into each packed tile
  for (let vi = 0; vi < origVertCount; vi++) {
    const owner = ownerSlotByVert[vi]!;
    if (owner < 0) continue;
    const tile = tileBySlot.get(owner);
    if (!tile) continue;
    const u = wrapUv01(uvAttr.getX(vi));
    const v = wrapUv01(uvAttr.getY(vi));
    uvAttr.setXY(vi, tile.uOffset + u * tile.uScale, tile.vOffset + v * tile.vScale);
  }
  for (let i = 0; i < extraVertexSources.length; i++) {
    const vi = origVertCount + i;
    const tile = extraVertexTiles[i]!;
    const u = wrapUv01(uvAttr.getX(vi));
    const v = wrapUv01(uvAttr.getY(vi));
    uvAttr.setXY(vi, tile.uOffset + u * tile.uScale, tile.vOffset + v * tile.vScale);
  }
  uvAttr.needsUpdate = true;

  // Rebuild contiguous index buffer + groups (slot 0 = packed Skin_Atlas; trailing = 1..K)
  const finalVertCount = geo.getAttribute('position').count;
  const totalOutIndices =
    packedIndices.length +
    Array.from(trailingBuckets.values()).reduce((sum, arr) => sum + arr.length, 0);
  const newIndexArr =
    finalVertCount > 65535 ? new Uint32Array(totalOutIndices) : new Uint16Array(totalOutIndices);

  geo.clearGroups();
  let cursor = 0;
  for (let i = 0; i < packedIndices.length; i++) {
    newIndexArr[cursor++] = packedIndices[i]!;
  }
  geo.addGroup(0, packedIndices.length, 0);

  const outMaterials: THREE.Material[] = [];
  // Placeholder slot 0 updated once textures are baked below
  for (let t = 0; t < trailingSlots.length; t++) {
    const origMatIdx = trailingSlots[t]!;
    const bucket = trailingBuckets.get(origMatIdx)!;
    if (bucket.length === 0) continue;
    const groupStart = cursor;
    for (let i = 0; i < bucket.length; i++) {
      newIndexArr[cursor++] = bucket[i]!;
    }
    geo.addGroup(groupStart, bucket.length, 1 + outMaterials.length);
    outMaterials.push(matList[origMatIdx]!);
  }

  geo.setIndex(new THREE.BufferAttribute(newIndexArr, 1));

  if (options.smoothBoundaryNormals ?? true) {
    smoothCoincidentBoundaryNormals(geo, packedIndices.length);
  }

  // Composite textures (Albedo, Normal, ORM) when DOM Canvas is available
  const packedTextures: THREE.Texture[] = [];
  const packedStdMats = tiles.map((t) => matList[t.slotIndex] as THREE.MeshStandardMaterial);

  const anyNormal = packedStdMats.some((m) => Boolean(m?.normalMap?.image));
  const anyRoughMetal = packedStdMats.some((m) => Boolean(m?.roughnessMap?.image || m?.metalnessMap?.image));
  const roughnessDiffers = packedStdMats.some(
    (m, _, arr) => Math.abs((m?.roughness ?? 0.55) - (arr[0]?.roughness ?? 0.55)) > 0.01,
  );
  const anyMetal = packedStdMats.some((m) => (m?.metalness ?? 0) > 0.01);

  let albedoAtlas: THREE.CanvasTexture | null = null;
  let normalAtlas: THREE.CanvasTexture | null = null;
  let ormAtlas: THREE.CanvasTexture | null = null;

  if (typeof document !== 'undefined') {
    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = atlasSize;
    albedoCanvas.height = atlasSize;
    const aCtx = albedoCanvas.getContext('2d')!;
    aCtx.fillStyle = '#d4b4a0';
    aCtx.fillRect(0, 0, atlasSize, atlasSize);

    let nCtx: CanvasRenderingContext2D | null = null;
    let normalCanvas: HTMLCanvasElement | null = null;
    if (anyNormal) {
      normalCanvas = document.createElement('canvas');
      normalCanvas.width = atlasSize;
      normalCanvas.height = atlasSize;
      nCtx = normalCanvas.getContext('2d')!;
      nCtx.fillStyle = 'rgb(128,128,255)';
      nCtx.fillRect(0, 0, atlasSize, atlasSize);
    }

    let oCtx: CanvasRenderingContext2D | null = null;
    let ormCanvas: HTMLCanvasElement | null = null;
    if (anyRoughMetal || roughnessDiffers) {
      ormCanvas = document.createElement('canvas');
      ormCanvas.width = atlasSize;
      ormCanvas.height = atlasSize;
      oCtx = ormCanvas.getContext('2d')!;
      const rByte = Math.round((packedStdMats[0]?.roughness ?? 0.55) * 255);
      oCtx.fillStyle = `rgb(255,${rByte},0)`;
      oCtx.fillRect(0, 0, atlasSize, atlasSize);
    }

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      const std = packedStdMats[i]!;

      // Albedo tile
      const srgbFill = (std.color ? std.color.clone() : new THREE.Color(1, 1, 1)).convertLinearToSRGB();
      aCtx.fillStyle = `rgb(${Math.round(srgbFill.r * 255)},${Math.round(srgbFill.g * 255)},${Math.round(srgbFill.b * 255)})`;
      aCtx.fillRect(tile.cellX, tile.cellY, tile.cellW, tile.cellH);
      const diffSrc = std.map ? textureToCanvas(std.map) : null;
      if (diffSrc) {
        const tinted = std.color ? tintCanvasSrgb(diffSrc, std.color) : diffSrc;
        drawTileWithBleed(aCtx, tinted, tile);
      }

      // Normal tile
      if (nCtx && std.normalMap) {
        const normSrc = textureToCanvas(std.normalMap);
        if (normSrc) drawTileWithBleed(nCtx, normSrc, tile);
      }

      // ORM tile
      if (oCtx) {
        const ormSrc = buildSlotOrmCanvas(std);
        drawTileWithBleed(oCtx, ormSrc, tile);
      }
    }

    const baseName = options.materialName ?? 'Skin_Atlas';
    albedoAtlas = new THREE.CanvasTexture(albedoCanvas);
    albedoAtlas.name = `${baseName}_basecolor`;
    albedoAtlas.colorSpace = THREE.SRGBColorSpace;
    albedoAtlas.flipY = true;
    albedoAtlas.needsUpdate = true;
    packedTextures.push(albedoAtlas);

    if (normalCanvas) {
      normalAtlas = new THREE.CanvasTexture(normalCanvas);
      normalAtlas.name = `${baseName}_normal`;
      normalAtlas.colorSpace = THREE.NoColorSpace;
      normalAtlas.flipY = true;
      normalAtlas.needsUpdate = true;
      packedTextures.push(normalAtlas);
    }

    if (ormCanvas) {
      ormAtlas = new THREE.CanvasTexture(ormCanvas);
      ormAtlas.name = `${baseName}_roughness`;
      ormAtlas.colorSpace = THREE.NoColorSpace;
      ormAtlas.flipY = true;
      ormAtlas.needsUpdate = true;
      packedTextures.push(ormAtlas);
    }
  }

  const firstStd = packedStdMats[0] ?? new THREE.MeshStandardMaterial();
  const atlasMaterial = new THREE.MeshStandardMaterial({
    name: options.materialName ?? 'Skin_Atlas',
    color: new THREE.Color(1, 1, 1),
    map: albedoAtlas ?? firstStd.map ?? null,
    normalMap: normalAtlas ?? firstStd.normalMap ?? null,
    normalScale: firstStd.normalScale ? firstStd.normalScale.clone() : new THREE.Vector2(1, 1),
    roughness: ormAtlas ? 1.0 : (firstStd.roughness ?? 0.55),
    metalness: anyMetal && ormAtlas ? 1.0 : 0.0,
    roughnessMap: ormAtlas ?? null,
    metalnessMap: ormAtlas ?? null,
    transparent: false,
    opacity: 1.0,
    side: firstStd.side ?? THREE.FrontSide,
  });

  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  return {
    geometry: geo,
    materials: [atlasMaterial, ...outMaterials],
    packedTextures,
    packedSlotCount: tiles.length,
  };
}

/**
 * Convenience helper for an existing consolidated `THREE.SkinnedMesh` (such as
 * Creator's consolidated `Body` mesh): swaps geometry & material slots in-place
 * with the packed UV atlas and returns temporary assets to dispose after export.
 */
export function applySkinAtlasToSkinnedMesh(
  mesh: THREE.SkinnedMesh,
  options: SkinAtlasOptions = {},
): { packedTextures: THREE.Texture[]; packedGeometry: THREE.BufferGeometry | null; packedSlotCount: number } {
  const result = packGeometryAndMaterialsIntoAtlas(mesh.geometry, mesh.material, options);
  if (result.packedSlotCount < 2) {
    result.geometry.dispose();
    return { packedTextures: [], packedGeometry: null, packedSlotCount: result.packedSlotCount };
  }

  mesh.geometry.dispose();
  mesh.geometry = result.geometry;
  mesh.material = result.materials.length === 1 ? result.materials[0]! : result.materials;
  return {
    packedTextures: result.packedTextures,
    packedGeometry: result.geometry,
    packedSlotCount: result.packedSlotCount,
  };
}
