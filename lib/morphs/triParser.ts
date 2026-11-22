/**
 * lib/morphs/triParser.ts
 *
 * Binary parser for Skyrim / FaceGen FRTRI003 (.tri) morph target files.
 * Supports character generation (CharGen) head, brow, eye, lash, and mouth shape deltas.
 */

export const NIF_TO_RENDER_SCALE = 0.01288;

export interface TriHeader {
  magic: string;
  numVerts: number;
  numTris: number;
  numMorphs: number;
  flags: number;
}

export interface TriMorph {
  name: string;
  scale: number;
  /**
   * Pre-computed morph delta displacements in Three.js coordinates (X, Y, Z).
   * Length is numVerts * 3.
   * Coordinate transformation:
   * dx_three = dx_skyrim * NIF_TO_RENDER_SCALE
   * dy_three = dz_skyrim * NIF_TO_RENDER_SCALE (Z-up in Skyrim -> Y-up in Three.js)
   * dz_three = dy_skyrim * NIF_TO_RENDER_SCALE (Y-forward in Skyrim -> Z-forward in Three.js)
   */
  deltas: Float32Array;
}

export interface TriData {
  header: TriHeader;
  morphCount: number;
  morphNames: string[];
  morphs: Map<string, TriMorph>;
}

/**
 * Parses a FaceGen .tri ArrayBuffer into structured TriData.
 */
export function parseTri(buffer: ArrayBuffer): TriData {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // 1. Verify Magic Header (8 bytes "FRTRI003")
  const magic = String.fromCharCode(...u8.slice(0, 8));
  if (!magic.startsWith('FRTRI')) {
    throw new Error(`Invalid TRI magic: expected FRTRI003, got "${magic}"`);
  }

  // 2. Read 10 32-bit integer counts
  const numVerts = view.getInt32(8, true);
  const numTris = view.getInt32(12, true);
  const numUvs = view.getInt32(28, true);
  const flags = view.getInt32(32, true);
  const numMorphs = view.getInt32(36, true);

  if (numVerts <= 0 || numVerts > 2_000_000) {
    throw new Error(`Implausible vertex count in TRI: ${numVerts}`);
  }

  // Offset after 8 magic + 40 counts header + 16 reserved bytes = 64
  let offset = 64;

  // Skip base vertices: numVerts * 3 floats (12 bytes)
  offset += numVerts * 12;

  // Skip triangles: numTris * 3 ints (12 bytes)
  offset += numTris * 12;

  // Skip UVs: numUvs * 2 floats (8 bytes)
  if (numUvs > 0) {
    offset += numUvs * 8;
  }

  // Skip Triangle UV indices if flags & 1
  if ((flags & 1) !== 0) {
    offset += numTris * 12;
  }

  const morphNames: string[] = [];
  const morphs = new Map<string, TriMorph>();

  // 3. Parse Difference Morphs
  for (let m = 0; m < numMorphs; m++) {
    if (offset >= buffer.byteLength) break;

    const nameLen = view.getUint32(offset, true);
    offset += 4;

    const rawName = String.fromCharCode(...u8.slice(offset, offset + nameLen));
    const name = rawName.replace(/\0/g, '').trim();
    offset += nameLen;

    const scale = view.getFloat32(offset, true);
    offset += 4;

    const deltas = new Float32Array(numVerts * 3);

    // Read numVerts * 3 signed 16-bit integers
    for (let v = 0; v < numVerts; v++) {
      const rx = view.getInt16(offset, true);
      const ry = view.getInt16(offset + 2, true);
      const rz = view.getInt16(offset + 4, true);
      offset += 6;

      const dxSkyrim = rx * scale;
      const dySkyrim = ry * scale;
      const dzSkyrim = rz * scale;

      // Transform to Three.js coordinates
      deltas[v * 3] = dxSkyrim * NIF_TO_RENDER_SCALE;
      deltas[v * 3 + 1] = dzSkyrim * NIF_TO_RENDER_SCALE;
      deltas[v * 3 + 2] = dySkyrim * NIF_TO_RENDER_SCALE;
    }

    morphNames.push(name);
    morphs.set(name, {
      name,
      scale,
      deltas,
    });
  }

  return {
    header: {
      magic,
      numVerts,
      numTris,
      numMorphs,
      flags,
    },
    morphCount: morphNames.length,
    morphNames,
    morphs,
  };
}
