/**
 * Shared shapes for the MO2 catalogue.
 *
 * Client-safe: no `node:` imports, no filesystem. `lib/mo2/server.ts` imports
 * these and adds the disk side; components import these and add nothing.
 */

/**
 * Geometry kinds — every selectable part of the character.
 *
 * Exported as a typed constant so the route, the indexer parity check and any
 * UI can agree on the same seven names without restating them.
 */
export const MESH_KINDS = [
  'headMesh',
  'eyeMesh',
  'lashesMesh',
  'browsMesh',
  'mouthMesh',
  'bodyMesh',
  'hairMesh',
  'clothingMesh',
] as const;

export type MeshKind = (typeof MESH_KINDS)[number];

export function isMeshKind(kind: string): kind is MeshKind {
  return (MESH_KINDS as readonly string[]).includes(kind);
}

/** One recorded file. `rel` is relative to the active source root (includes the mod folder in MO2 mode). */
export interface CatalogueEntry {
  id: string;
  mod: string;
  file: string;
  label: string;
  rel: string;
  bytes: number;
  mtime: number;
  kind: string;
  /** Distinguishes an albedo from its `_n` / `_sk` companions. */
  mapRole?: 'albedo' | 'normal' | 'specular' | 'mesh' | 'morph' | 'collision';
  size?: [number, number];
  note?: string;
  /**
   * Geometry kinds only. Absent means decodable — every mesh the indexer
   * could not decode carries `false` plus a `reason`, so the panel can grey
   * the row instead of dropping it.
   */
  decodable?: boolean;
  available?: boolean;
  unavailable?: boolean;
  /**
   * Geometry decodes, but a required albedo DDS is absent. The row stays
   * `unavailable` (texture modes refuse it) while `mode=mesh` may still
   * convert it; the app draws its shapes with a flat grey material and
   * never receives texture URLs for the missing refs.
   */
  untextured?: boolean;
  authored?: boolean;
  geometryRole?: 'skin';
  missingTextures?: string[];
  /** Non-blocking slots (normal/spec/gloss/emissive) that resolve to nothing. */
  optionalMissingTextures?: string[];
  /** Human-readable cause, shown verbatim on the greyed row. */
  reason?: string;
  /**
   * Mesh kinds: the texture entry the author's sibling `.nif` references.
   * Only set when that reference is unambiguous; a mesh with no authored atlas
   * has no pairing rather than a borrowed sibling.
   */
  pairedTextureId?: string;
  /**
   * Textures: the `_n` companion the author's `.nif` (or the sibling-file
   * convention) names. Always a catalogue id, never a raw path.
   */
  normalId?: string;
  /**
   * Mesh kinds: the coordinate frame the geometry was authored in.
   * `head` is the FaceGen head origin; `ground` is the COR hair origin, whose
   * z-up coordinates are already relative to the scalp. Explicit and known,
   * never inferred from a bounding box.
   */
  meshFrame?: 'head' | 'ground';
  /**
   * Mesh kinds: fraction (0–1) of this mesh's vertices that sit outside the
   * shipped head, measured against that head's cranium radius. A mesh authored
   * for the other sex wraps *inside* this head and can never be seen, so the
   * hair picker hides anything under `VISIBLE_MIN`. Absent on meshes that were
   * never measured, and on non-mesh kinds.
   */
  visibility?: number;
  /**
   * Body meshes: the `_0`/`_1` weight pair this row belongs to, both as
   * catalogue ids. Skyrim stores a body twice — weight 0 and weight 100 — over
   * one atlas; the renderer lerps positions between the two. Present only when
   * both halves decoded with identical topology, which is what makes a
   * per-vertex blend safe.
   */
  weightVariants?: { w0: string; w1: string };
  /** Body meshes: the normalised stem shared by the pair (`femalebody`). */
  weightKey?: string;
  /** Body meshes: the half Skyrim itself defaults to (`1`). */
  weightDefault?: 0 | 1;
}

export interface CatalogueIndex {
  available: boolean;
  source: string;
  sourceId?: string;
  sourceLayout?: 'pack' | 'mo2';
  diagnostics?: string[];
  generatedAt?: string;
  kinds: Record<string, number>;
}

/** Every part texture kind — the counterpart of `MESH_KINDS`. */
export const TEXTURE_KINDS = [
  'skin',
  'eyes',
  'lashes',
  'brows',
  'mouth',
  'body',
  'hair',
  'clothing',
] as const;

export type TextureKind = (typeof TEXTURE_KINDS)[number];

export function isTextureKind(kind: string): kind is TextureKind {
  return (TEXTURE_KINDS as readonly string[]).includes(kind);
}

/** The picker shows these; `other` is reachable but not a default row. */
export const PICKER_KINDS = [
  'headMesh',
  'eyeMesh',
  'lashesMesh',
  'browsMesh',
  'mouthMesh',
  'bodyMesh',
  'hairMesh',
  'clothingMesh',
  'skeleton',
  'skin',
  'eyes',
  'lashes',
  'brows',
  'mouth',
  'body',
  'hair',
  'clothing',
  'preset',
  'makeup',
  'tattoo',
  'wrinkle',
] as const;

export type PickerKind = (typeof PICKER_KINDS)[number];

export const KIND_LABEL: Record<string, string> = {
  headMesh: 'HEAD MESH',
  eyeMesh: 'EYE MESH',
  lashesMesh: 'LASH MESH',
  browsMesh: 'BROW MESH',
  mouthMesh: 'MOUTH MESH',
  bodyMesh: 'BODY MESH',
  hairMesh: 'HAIR MESH',
  clothingMesh: 'CLOTHING MESH',
  skeleton: 'SKELETON',
  skin: 'SKIN',
  eyes: 'EYES',
  lashes: 'LASHES',
  brows: 'BROWS',
  mouth: 'MOUTH',
  body: 'BODY',
  hair: 'HAIR',
  clothing: 'CLOTHING',
  preset: 'PRESET',
  makeup: 'MAKEUP',
  tattoo: 'TATTOO',
  wrinkle: 'WRINKLE',
  other: 'OTHER',
};

/** Catalogue file stem per kind — must match `index_mo2_assets.py`. */
export const KIND_TO_CATALOGUE: Record<string, string> = {
  headMesh: 'headMesh',
  eyeMesh: 'eyeMesh',
  lashesMesh: 'lashesMesh',
  browsMesh: 'browsMesh',
  mouthMesh: 'mouthMesh',
  bodyMesh: 'bodyMesh',
  hairMesh: 'hairMesh',
  clothingMesh: 'clothingMesh',
  skeleton: 'skeleton',
  skin: 'skin',
  eyes: 'eyes',
  lashes: 'lashes',
  brows: 'brows',
  mouth: 'mouth',
  body: 'body',
  hair: 'hair',
  clothing: 'clothing',
  preset: 'preset',
  makeup: 'makeup',
  tattoo: 'tattoo',
  wrinkle: 'wrinkle',
  other: 'other',
};

export const CONVERT_MODES = ['albedo', 'normal', 'alpha', 'thumb', 'disc', 'mesh', 'atlas'] as const;export type ConvertMode = (typeof CONVERT_MODES)[number];

/**
 * The overlay categories composite onto the skin in atlas space; `skin`,
 * `eyes`, `hair` and `headMesh` are single-select and drive the 3D render.
 */
export const OVERLAY_KINDS = ['makeup', 'tattoo', 'wrinkle', 'brows'] as const;

export function isOverlayKind(kind: string): boolean {
  return (OVERLAY_KINDS as readonly string[]).includes(kind);
}

/** How a kind reaches the viewport. */
export function defaultModeFor(kind: string, mapRole?: string): ConvertMode {
  if (isMeshKind(kind)) return 'mesh';
  if (kind === 'eyes') return 'disc';
  if (mapRole === 'normal') return 'normal';
  if (mapRole === 'albedo' || !mapRole) {
    return isTextureKind(kind) && kind !== 'eyes' ? 'albedo' : 'alpha';
  }
  return 'albedo';
}
