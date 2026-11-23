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
    id: 'wolf_haircut',
    label: 'Wolf Haircut (Fitted)',
    file: 'wolf_haircut.glb',
    meshUrl: '/assets/hair/wolf_haircut.glb',
    badge: 'GLB',
    author: 'Community',
    mod: 'Custom',
    description: 'Layered wolf haircut scaled to 80% natural head proportions.',
    partCount: 1,
  },
  {
    id: 'dint_hair_03',
    label: 'Dint Hair 03',
    file: 'hair_03.glb',
    meshUrl: '/assets/hair/hair_03.glb',
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack02',
    description: 'High-poly braided twin tail with ribbons and multi-layer alpha hair cards.',
    partCount: 21,
  },
  {
    id: "dint_hair_03long",
    label: "Dint Hair 03 Long",
    file: "dint_hair_03long.glb",
    meshUrl: "/assets/hair/dint_hair_03long.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 21 sub-parts and PBR textures.",
    partCount: 21,
  },
  {
    id: "dint_hair_07",
    label: "Dint Hair 07",
    file: "dint_hair_07.glb",
    meshUrl: "/assets/hair/dint_hair_07.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 16 sub-parts and PBR textures.",
    partCount: 16,
  },
  {
    id: "dint_hair_10",
    label: "Dint Hair 10",
    file: "dint_hair_10.glb",
    meshUrl: "/assets/hair/dint_hair_10.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 13 sub-parts and PBR textures.",
    partCount: 13,
  },
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
    id: "dint_hair_13",
    label: "Dint Hair 13",
    file: "dint_hair_13.glb",
    meshUrl: "/assets/hair/dint_hair_13.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 13 sub-parts and PBR textures.",
    partCount: 13,
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
    id: "dint_hair_15",
    label: "Dint Hair 15",
    file: "dint_hair_15.glb",
    meshUrl: "/assets/hair/dint_hair_15.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 27 sub-parts and PBR textures.",
    partCount: 27,
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
  {
    id: "dint_hair_17",
    label: "Dint Hair 17",
    file: "dint_hair_17.glb",
    meshUrl: "/assets/hair/dint_hair_17.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 20 sub-parts and PBR textures.",
    partCount: 20,
  },
  {
    id: "dint_hair_18",
    label: "Dint Hair 18",
    file: "dint_hair_18.glb",
    meshUrl: "/assets/hair/dint_hair_18.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 42 sub-parts and PBR textures.",
    partCount: 42,
  },
  {
    id: "dint_hair_19",
    label: "Dint Hair 19",
    file: "dint_hair_19.glb",
    meshUrl: "/assets/hair/dint_hair_19.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 18 sub-parts and PBR textures.",
    partCount: 18,
  },
  {
    id: "dint_hair_20",
    label: "Dint Hair 20",
    file: "dint_hair_20.glb",
    meshUrl: "/assets/hair/dint_hair_20.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 10 sub-parts and PBR textures.",
    partCount: 10,
  },
  {
    id: "dint_hair_21",
    label: "Dint Hair 21",
    file: "dint_hair_21.glb",
    meshUrl: "/assets/hair/dint_hair_21.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 22 sub-parts and PBR textures.",
    partCount: 22,
  },
  {
    id: "dint_hair_22",
    label: "Dint Hair 22",
    file: "dint_hair_22.glb",
    meshUrl: "/assets/hair/dint_hair_22.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 37 sub-parts and PBR textures.",
    partCount: 37,
  },
  {
    id: "dint_hair_23",
    label: "Dint Hair 23",
    file: "dint_hair_23.glb",
    meshUrl: "/assets/hair/dint_hair_23.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 20 sub-parts and PBR textures.",
    partCount: 20,
  },
  {
    id: "dint_hair_24",
    label: "Dint Hair 24",
    file: "dint_hair_24.glb",
    meshUrl: "/assets/hair/dint_hair_24.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 49 sub-parts and PBR textures.",
    partCount: 49,
  },
  {
    id: "dint_hair_25",
    label: "Dint Hair 25",
    file: "dint_hair_25.glb",
    meshUrl: "/assets/hair/dint_hair_25.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 9 sub-parts and PBR textures.",
    partCount: 9,
  },
  {
    id: "dint_hair_26",
    label: "Dint Hair 26",
    file: "dint_hair_26.glb",
    meshUrl: "/assets/hair/dint_hair_26.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 7 sub-parts and PBR textures.",
    partCount: 7,
  },
  {
    id: "dint_hair_27",
    label: "Dint Hair 27",
    file: "dint_hair_27.glb",
    meshUrl: "/assets/hair/dint_hair_27.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 27 sub-parts and PBR textures.",
    partCount: 27,
  },
  {
    id: "dint_hair_28",
    label: "Dint Hair 28",
    file: "dint_hair_28.glb",
    meshUrl: "/assets/hair/dint_hair_28.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 23 sub-parts and PBR textures.",
    partCount: 23,
  },
  {
    id: "dint_hair_29",
    label: "Dint Hair 29",
    file: "dint_hair_29.glb",
    meshUrl: "/assets/hair/dint_hair_29.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 24 sub-parts and PBR textures.",
    partCount: 24,
  },
  {
    id: "dint_hair_30",
    label: "Dint Hair 30",
    file: "dint_hair_30.glb",
    meshUrl: "/assets/hair/dint_hair_30.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 19 sub-parts and PBR textures.",
    partCount: 19,
  },
  {
    id: "dint_hair_31",
    label: "Dint Hair 31",
    file: "dint_hair_31.glb",
    meshUrl: "/assets/hair/dint_hair_31.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 5 sub-parts and PBR textures.",
    partCount: 5,
  },
  {
    id: "dint_hair_32",
    label: "Dint Hair 32",
    file: "dint_hair_32.glb",
    meshUrl: "/assets/hair/dint_hair_32.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 20 sub-parts and PBR textures.",
    partCount: 20,
  },
  {
    id: "dint_hair_33",
    label: "Dint Hair 33",
    file: "dint_hair_33.glb",
    meshUrl: "/assets/hair/dint_hair_33.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 5 sub-parts and PBR textures.",
    partCount: 5,
  },
  {
    id: "dint_hair_34",
    label: "Dint Hair 34",
    file: "dint_hair_34.glb",
    meshUrl: "/assets/hair/dint_hair_34.glb",
    badge: 'GLB',
    author: 'Dint999',
    mod: '[Dint999] HairPack',
    description: "High-poly hair with 10 sub-parts and PBR textures.",
    partCount: 10,
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
