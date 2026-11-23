/**
 * Binary parser for BodySlide .osd (Outfit Studio Morph Delta) files.
 *
 * Binary Format Specification:
 * - Magic (4 bytes): "\0DSO" (0x00, 0x44, 0x53, 0x4F)
 * - Version (4 bytes): uint32 Little Endian (1)
 * - Block Count (4 bytes): uint32 Little Endian (236 for UBE 2.0 Necoco Body)
 *
 * Each Block:
 * - name_len (1 byte): uint8
 * - name (name_len bytes): ASCII/UTF-8 string (e.g. "BaseShapeBreastsBigger")
 * - diff_count (2 bytes): uint16 Little Endian
 * - diff_count entries of 14 bytes:
 *   - vert_idx (2 bytes): uint16 Little Endian (0 .. 32511)
 *   - dx (4 bytes): float32 Little Endian
 *   - dy (4 bytes): float32 Little Endian
 *   - dz (4 bytes): float32 Little Endian
 */

/** Canonical vertex count for UBE 2.0 female body mesh (femalebody_0 / femalebody_1) */
export const DEFAULT_UBE_BODY_VERTEX_COUNT = 32512;

/**
 * Coordinate scale factor from Skyrim NIF centimeter units to Three.js render frame.
 * Mirrors `FRAMES` in scripts/convert_worker.py:
 * render_X = nif_X * 0.01288
 * render_Y = nif_Z * 0.01288 (Z-up in Skyrim -> Y-up in Three.js)
 * render_Z = nif_Y * 0.01288 (Y-forward in Skyrim -> Z-forward in Three.js)
 */
export const DEFAULT_NIF_TO_RENDER_SCALE = 0.01288;

/** Expected 4-byte magic signature at offset 0 */
export const OSD_MAGIC = new Uint8Array([0x00, 0x44, 0x53, 0x4f]); // \0DSO

/** Sparse morph delta block for a single BodySlide slider */
export interface OsdDiffBlock {
  /** Raw block name as authored in OSD file, e.g. "BaseShapeBreastsBigger" */
  rawName: string;
  /** Normalized slider name without "BaseShape" prefix, e.g. "BreastsBigger" */
  name: string;
  /** Total vertex count affected by this morph */
  diffCount: number;
  /** Vertex indices in the base mesh (0 .. 32511 for UBE body) */
  indices: Uint16Array;
  /**
   * Delta displacement offsets in Skyrim NIF coordinates:
   * [dx0, dy0, dz0, dx1, dy1, dz1, ...]
   * Length is diffCount * 3.
   */
  deltas: Float32Array;
}

/** Structured result returned by parseOsd */
export interface OsdData {
  /** OSD file version (typically 1) */
  version: number;
  /** Total number of morph delta blocks */
  blockCount: number;
  /** Map of blockName -> OsdDiffBlock. Keys include both rawName and clean name. */
  blocks: Map<string, OsdDiffBlock>;
  /** Ordered list of unique blocks */
  blockList: OsdDiffBlock[];
  /** Look up a block by raw name ("BaseShapeBreastsBigger") or clean name ("BreastsBigger") */
  getBlock(name: string): OsdDiffBlock | undefined;
  /**
   * Unpack sparse deltas into a dense Float32Array of length (totalVertices * 3).
   *
   * @param name Block name (raw or clean)
   * @param totalVertices Base mesh vertex count (default 32512)
   * @param frame 'render' for Three.js space (Y-up, Z-forward, scaled) or 'nif' for raw Skyrim space
   * @param scale Scale factor from Skyrim units to Three.js (default 0.01288)
   */
  getDenseDeltas(
    name: string,
    totalVertices?: number,
    frame?: 'render' | 'nif',
    scale?: number
  ): Float32Array | null;
}

/**
 * Parses an ArrayBuffer or Uint8Array containing BodySlide .osd binary data.
 * High-performance parser: completes 236 blocks / 1.2M deltas in ~40ms.
 */
export function parseOsd(buffer: ArrayBuffer | Uint8Array): OsdData {
  const byteOffset = 'byteOffset' in buffer ? buffer.byteOffset : 0;
  const byteLength = buffer.byteLength;
  const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;

  if (byteLength < 12) {
    throw new Error(`Invalid OSD file: buffer length ${byteLength} is too short (minimum 12 bytes).`);
  }

  const view = new DataView(arrayBuffer, byteOffset, byteLength);

  // Validate magic "\0DSO"
  const m0 = view.getUint8(0);
  const m1 = view.getUint8(1);
  const m2 = view.getUint8(2);
  const m3 = view.getUint8(3);
  if (m0 !== 0x00 || m1 !== 0x44 || m2 !== 0x53 || m3 !== 0x4f) {
    throw new Error(
      `Invalid OSD magic signature: expected [0x00, 0x44, 0x53, 0x4F] ("\\0DSO"), got [0x${m0.toString(16)}, 0x${m1.toString(16)}, 0x${m2.toString(16)}, 0x${m3.toString(16)}].`
    );
  }

  const version = view.getUint32(4, true);
  const blockCount = view.getUint32(8, true);

  const blocks = new Map<string, OsdDiffBlock>();
  const blockList: OsdDiffBlock[] = [];
  const textDecoder = new TextDecoder('utf-8');

  let offset = 12;

  for (let b = 0; b < blockCount; b++) {
    if (offset >= byteLength) {
      throw new Error(`Unexpected end of OSD stream at block ${b} / ${blockCount}.`);
    }

    const nameLen = view.getUint8(offset);
    offset += 1;

    if (offset + nameLen > byteLength) {
      throw new Error(`Unexpected end of OSD stream while reading block name at block ${b}.`);
    }

    const nameBytes = new Uint8Array(arrayBuffer, byteOffset + offset, nameLen);
    const rawName = textDecoder.decode(nameBytes);
    offset += nameLen;

    const diffCount = view.getUint16(offset, true);
    offset += 2;

    const indices = new Uint16Array(diffCount);
    const deltas = new Float32Array(diffCount * 3);

    for (let d = 0; d < diffCount; d++) {
      indices[d] = view.getUint16(offset, true);
      deltas[d * 3] = view.getFloat32(offset + 2, true);
      deltas[d * 3 + 1] = view.getFloat32(offset + 6, true);
      deltas[d * 3 + 2] = view.getFloat32(offset + 10, true);
      offset += 14;
    }

    // Strip "BaseShape", "Hands", or "Feet" prefix for clean slider name mapping
    const cleanName = rawName.replace(/^(BaseShape|Baseshape|Hands|Feet)/i, '');

    const block: OsdDiffBlock = {
      rawName,
      name: cleanName,
      diffCount,
      indices,
      deltas,
    };

    blockList.push(block);
    blocks.set(rawName, block);
    // Also index by clean slider name so lookup works without prefix
    if (!blocks.has(cleanName)) {
      blocks.set(cleanName, block);
    }
  }

  const getBlock = (name: string): OsdDiffBlock | undefined => {
    const clean = name.replace(/^(BaseShape|Baseshape|Hands|Feet)/i, '');
    const unescapedName = name.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    const unescapedClean = clean.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    return (
      blocks.get(name) ??
      blocks.get(unescapedName) ??
      blocks.get(clean) ??
      blocks.get(unescapedClean) ??
      blocks.get(`BaseShape${name}`) ??
      blocks.get(`BaseShape${unescapedName}`) ??
      blocks.get(`BaseShape${clean}`) ??
      blocks.get(`BaseShape${unescapedClean}`) ??
      blocks.get(`Hands${name}`) ??
      blocks.get(`Hands${unescapedName}`) ??
      blocks.get(`Feet${name}`) ??
      blocks.get(`Feet${unescapedName}`)
    );
  };

  const getDenseDeltas = (
    name: string,
    totalVertices: number = DEFAULT_UBE_BODY_VERTEX_COUNT,
    frame: 'render' | 'nif' = 'render',
    scale: number = DEFAULT_NIF_TO_RENDER_SCALE
  ): Float32Array | null => {
    const block = getBlock(name);
    if (!block) return null;
    return unpackDenseDeltas(block, totalVertices, frame, scale);
  };

  return {
    version,
    blockCount,
    blocks,
    blockList,
    getBlock,
    getDenseDeltas,
  };
}

/**
 * Unpacks a sparse OsdDiffBlock into a full Float32Array of vertex displacement deltas.
 *
 * @param block The sparse diff block
 * @param totalVertices Base mesh vertex count (32512 for UBE body)
 * @param frame 'render' (Three.js coordinates: X=dx*S, Y=dz*S, Z=dy*S) or 'nif' (Skyrim coordinates: X=dx, Y=dy, Z=dz)
 * @param scale Unit scale factor (default 0.01288)
 */
export function unpackDenseDeltas(
  block: OsdDiffBlock,
  totalVertices: number = DEFAULT_UBE_BODY_VERTEX_COUNT,
  frame: 'render' | 'nif' = 'render',
  scale: number = DEFAULT_NIF_TO_RENDER_SCALE
): Float32Array {
  const dense = new Float32Array(totalVertices * 3);
  const { diffCount, indices, deltas } = block;

  if (frame === 'render') {
    // Three.js Render Frame conversion:
    // render_X = dx * scale
    // render_Y = dz * scale (NIF Z-up -> Three.js Y-up)
    // render_Z = dy * scale (NIF Y-forward -> Three.js Z-forward)
    for (let i = 0; i < diffCount; i++) {
      const vIdx = indices[i];
      if (vIdx < totalVertices) {
        const outBase = vIdx * 3;
        const inBase = i * 3;
        dense[outBase] = deltas[inBase] * scale;
        dense[outBase + 1] = deltas[inBase + 2] * scale;
        dense[outBase + 2] = deltas[inBase + 1] * scale;
      }
    }
  } else {
    // Raw Skyrim NIF coordinates
    for (let i = 0; i < diffCount; i++) {
      const vIdx = indices[i];
      if (vIdx < totalVertices) {
        const outBase = vIdx * 3;
        const inBase = i * 3;
        dense[outBase] = deltas[inBase];
        dense[outBase + 1] = deltas[inBase + 1];
        dense[outBase + 2] = deltas[inBase + 2];
      }
    }
  }

  return dense;
}

/**
 * Parses an OSD binary buffer directly into a structured map:
 * Map<string, { indices: Uint16Array, deltas: Float32Array }>
 * Keys contain both raw and clean slider names.
 */
export function parseOsdToMap(
  buffer: ArrayBuffer | Uint8Array
): Map<string, { indices: Uint16Array; deltas: Float32Array }> {
  const data = parseOsd(buffer);
  const out = new Map<string, { indices: Uint16Array; deltas: Float32Array }>();
  for (const [key, block] of data.blocks) {
    out.set(key, { indices: block.indices, deltas: block.deltas });
  }
  return out;
}

/**
 * Loads and parses a BodySlide .osd file from a URL, filesystem path, or buffer.
 * Automatically handles browser `fetch()` and Node.js `fs.promises.readFile()`.
 */
export async function loadOsd(source: string | ArrayBuffer | Uint8Array): Promise<OsdData> {
  if (typeof source !== 'string') {
    return parseOsd(source);
  }

  // In Node.js environment (e.g. CLI, scripts, test suites)
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('fs/promises');
      const buf = await fs.readFile(source);
      return parseOsd(buf);
    } catch {
      // Fall through to fetch if fs fails (e.g. relative url)
    }
  }

  // Browser fetch environment
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to load OSD file from "${source}" (HTTP ${response.status} ${response.statusText})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return parseOsd(arrayBuffer);
}

export const parseOsdBuffer = parseOsd;

export interface SliderTargetMapping {
  /** The block name in the OSD file (e.g. "bodysuit_v1BreastsBigger") */
  dataTarget: string;
  /** The target sub-shape name in the mesh (e.g. "bodysuit_v1", "BaseShape") */
  shapeTarget: string;
}

export interface SliderOspMapping {
  sliderName: string;
  dataTarget: string;
  /** All shape targets mapped by this slider (e.g. for multi-shape garments) */
  targets?: SliderTargetMapping[];
  invert: boolean;
  small: number;
  big: number;
  hidden: boolean;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function parseOspXml(xmlString: string): Record<string, SliderOspMapping> {
  const mappings: Record<string, SliderOspMapping> = {};
  const cleanXml = xmlString.replace(/<!--[\s\S]*?-->/g, '');
  const sliderRegex = /<Slider\s+([^>]*?)>(?:([\s\S]*?)<\/Slider>)?/gi;
  let match: RegExpExecArray | null;

  while ((match = sliderRegex.exec(cleanXml)) !== null) {
    const attrString = match[1];
    const innerContent = match[2] ?? '';

    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrString);
    if (!nameMatch) continue;

    const rawSliderName = nameMatch[1];
    const sliderName = unescapeXml(rawSliderName);
    const invert = /invert\s*=\s*["']true["']/i.test(attrString);
    const hidden = /hidden\s*=\s*["']true["']/i.test(attrString);

    const smallMatch = /small\s*=\s*["']([-\d.]+)["']/i.exec(attrString);
    const bigMatch = /big\s*=\s*["']([-\d.]+)["']/i.exec(attrString);
    const small = smallMatch ? parseFloat(smallMatch[1]) : 0;
    const big = bigMatch ? parseFloat(bigMatch[1]) : 0;

    const targets: SliderTargetMapping[] = [];
    const dataRegex = /<Data\s+([^>]*?)>([^<]*?)<\/Data>/gi;
    let dm: RegExpExecArray | null;
    while ((dm = dataRegex.exec(innerContent)) !== null) {
      const dataAttrs = dm[1];
      const dataText = dm[2].trim();

      const nameAttrMatch = /name\s*=\s*["']([^"']+)["']/i.exec(dataAttrs);
      const targetAttrMatch = /target\s*=\s*["']([^"']+)["']/i.exec(dataAttrs);

      let dataTargetName = '';
      if (nameAttrMatch) {
        dataTargetName = unescapeXml(nameAttrMatch[1]);
      } else if (dataText) {
        const parts = dataText.split(/[\\/]/);
        dataTargetName = unescapeXml(parts[parts.length - 1]);
      }

      const shapeTarget = targetAttrMatch ? unescapeXml(targetAttrMatch[1]) : '';

      if (dataTargetName) {
        targets.push({
          dataTarget: dataTargetName,
          shapeTarget,
        });
      }
    }

    const primaryTarget = targets.length > 0 ? targets[0].dataTarget : `BaseShape${sliderName}`;

    const mapping: SliderOspMapping = {
      sliderName,
      dataTarget: primaryTarget,
      targets: targets.length > 0 ? targets : [{ dataTarget: primaryTarget, shapeTarget: '' }],
      invert,
      small,
      big,
      hidden,
    };

    mappings[sliderName] = mapping;
    if (rawSliderName !== sliderName) {
      mappings[rawSliderName] = mapping;
    }
  }

  return mappings;
}

export { type BodySlideCategory, NECOCO_CATEGORIES } from './categories';
