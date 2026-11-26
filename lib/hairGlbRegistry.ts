import type { HairGroup } from '@/lib/hair';

/**
 * Curated glTF 2.0 Binary (.glb) Hairstyle Entry.
 *
 * Each entry represents a standalone, self-contained hairstyle model
 * loaded directly by the WebGL 3D engine (Three.js / @react-three/drei).
 *
 * To add a new hairstyle manually:
 * 1. Place the exported .glb in public/assets/hair/ (e.g. public/assets/hair/hair_04.glb).
 * 2. Add an entry below to CURATED_GLB_HAIRS.
 * 3. (Optional) Place a custom thumbnail in public/assets/hair/thumbs/ if desired.
 */
export interface CuratedGlbHair {
  /** Unique identifier for selection state, e.g. 'dint_hair_03' */
  id: string;
  /** Human-readable display label, e.g. 'Dint Hair 03' */
  label: string;
  /** Relative filename in public/assets/hair/, e.g. 'hair_03.glb' */
  file: string;
  /** Absolute URL to the .glb file, e.g. '/assets/hair/hair_03.glb' */
  meshUrl: string;
  /** Optional custom thumbnail URL (when manually added) */
  thumbnailUrl?: string;
  /** Badge text shown on tile when no thumbnail image is present */
  badge?: string;
  /** Hair author or mod series */
  author?: string;
  /** Mod origin */
  mod?: string;
  /** Number of modular sub-parts embedded in the .glb */
  partCount?: number;
  /** Description or notes */
  description?: string;
  /** Optional vertical offset in metres (NPC Head space) */
  defaultOffsetMetres?: number;
}

export const CURATED_GLB_HAIRS: CuratedGlbHair[] = [
  {
    id: "dint_hair_12",
    label: "Dint Hair 12",
    file: "dint_hair_12.glb",
    meshUrl: "/assets/hair/dint_hair_12.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 11 sub-parts and PBR textures.",
    partCount: 11,
  },
  {
    id: "dint_hair_14",
    label: "Dint Hair 14",
    file: "dint_hair_14.glb",
    meshUrl: "/assets/hair/dint_hair_14.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 16 sub-parts and PBR textures.",
    partCount: 16,
  },
  {
    id: "dint_hair_16",
    label: "Dint Hair 16",
    file: "dint_hair_16.glb",
    meshUrl: "/assets/hair/dint_hair_16.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 39 sub-parts and PBR textures.",
    partCount: 39,
  },
];

/**
 * Converts a CuratedGlbHair entry into a standard HairGroup contract.
 */
export function curatedHairToHairGroup(h: CuratedGlbHair): HairGroup {
  return {
    id: h.id,
    label: h.label,
    brand: 'OTHER',
    groupKey: h.id,
    mod: h.mod || h.author || 'Custom',
    isHL: false,
    partCount: h.partCount ?? 1,
    pairedTextureId: undefined,
    representative: {
      id: h.id,
      label: h.label,
      mod: h.mod || h.author || 'Custom',
      file: h.file,
      rel: h.file,
      meshUrl: h.meshUrl,
      thumbnailUrl: h.thumbnailUrl,
    },
    parts: [
      {
        id: h.id,
        label: h.label,
        partNumber: 1,
        raw: {
          id: h.id,
          label: h.label,
          mod: h.mod || h.author || 'Custom',
          file: h.file,
          rel: h.file,
          meshUrl: h.meshUrl,
          thumbnailUrl: h.thumbnailUrl,
        },
      },
    ],
  };
}

/**
 * Returns all active curated GLB hair groups.
 */
export function getCuratedHairGroups(): HairGroup[] {
  return CURATED_GLB_HAIRS.map(curatedHairToHairGroup);
}

/**
 * Finds a curated GLB hairstyle by id or meshUrl.
 */
export function findCuratedGlbHair(idOrUrl: string | null | undefined): CuratedGlbHair | undefined {
  if (!idOrUrl) return undefined;
  return CURATED_GLB_HAIRS.find(
    (h) => h.id === idOrUrl || h.meshUrl === idOrUrl || h.file === idOrUrl
  );
}
