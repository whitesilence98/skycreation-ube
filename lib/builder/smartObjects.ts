import type { PlacedItem } from '@/lib/builderStore';

export type NeedKey = 'energy' | 'comfort' | 'fun' | 'grooming';

/**
 * Abstract interaction tag decoupling Room Life AI from concrete animation clips.
 * Current clips fall back to `'idle-clip'`; custom `'sit'`/`'sleep'` clips can drop in later.
 */
export type ActionTag =
  | 'idle'
  | 'sleep'
  | 'sit'
  | 'groom'
  | 'read'
  | 'laptop'
  | 'tv'
  | 'admire';

export interface SmartObjectDef {
  actionTag: ActionTag;
  label: string;
  /** Approach slot in item-local XZ meters before Y rotation. */
  standOffset: [number, number];
  /** Desired character facing offset relative to item Y rotation (degrees). */
  facingOffsetDeg: number;
  /** Duration of the interaction in in-game minutes. */
  durationGameMins: number;
  /** Total motive points restored over the full interaction. */
  restores: Partial<Record<NeedKey, number>>;
  /** Optional time-of-day score multiplier (`hour` in `0..23`). */
  timeBias?: (hour: number) => number;
}

const nightSleepBias = (hour: number): number =>
  hour >= 22 || hour < 6 ? 2.4 : hour >= 20 ? 1.5 : hour >= 13 && hour <= 15 ? 1.15 : 0.7;

const morningGroomBias = (hour: number): number =>
  hour >= 6 && hour <= 10 ? 1.75 : hour >= 20 && hour <= 22 ? 1.2 : 0.9;

const daytimeWorkBias = (hour: number): number =>
  hour >= 9 && hour <= 18 ? 1.45 : hour >= 23 || hour < 6 ? 0.55 : 1.0;

const eveningMediaBias = (hour: number): number =>
  hour >= 18 && hour <= 23 ? 1.7 : hour < 7 ? 0.5 : 0.95;

const SMART_CATALOG_TABLE: ReadonlyArray<{
  match: (catalogId: string) => boolean;
  def: SmartObjectDef;
}> = [
  {
    match: (id) => id.includes('bedDouble') || id.includes('bedSingle'),
    def: {
      actionTag: 'sleep',
      label: 'Resting on Bed',
      standOffset: [0, 1.35],
      facingOffsetDeg: 180,
      durationGameMins: 90,
      restores: { energy: 75, comfort: 25 },
      timeBias: nightSleepBias,
    },
  },
  {
    match: (id) => id.includes('loungeSofa') || id.includes('benchCushion'),
    def: {
      actionTag: 'sit',
      label: 'Lounging on Sofa',
      standOffset: [0, 0.95],
      facingOffsetDeg: 180,
      durationGameMins: 35,
      restores: { comfort: 42, energy: 14 },
    },
  },
  {
    match: (id) => id.includes('Chair') || id.includes('chair') || id.includes('stoolBar'),
    def: {
      actionTag: 'sit',
      label: 'Relaxing in Chair',
      standOffset: [0, 0.8],
      facingOffsetDeg: 180,
      durationGameMins: 28,
      restores: { comfort: 32, energy: 10 },
    },
  },
  {
    match: (id) => id.includes('bathroomMirror'),
    def: {
      actionTag: 'groom',
      label: 'Checking Mirror',
      standOffset: [0, 0.95],
      facingOffsetDeg: 180,
      durationGameMins: 20,
      restores: { grooming: 48 },
      timeBias: morningGroomBias,
    },
  },
  {
    match: (id) => id.includes('desk'),
    def: {
      actionTag: 'groom',
      label: 'Using Vanity Desk',
      standOffset: [0, 0.95],
      facingOffsetDeg: 180,
      durationGameMins: 25,
      restores: { grooming: 42, comfort: 10 },
      timeBias: morningGroomBias,
    },
  },
  {
    match: (id) => id.includes('coatRack') || id.includes('cabinetBedDrawer'),
    def: {
      actionTag: 'groom',
      label: 'Checking Wardrobe',
      standOffset: [0, 0.85],
      facingOffsetDeg: 180,
      durationGameMins: 22,
      restores: { grooming: 38 },
      timeBias: morningGroomBias,
    },
  },
  {
    match: (id) => id.includes('laptop'),
    def: {
      actionTag: 'laptop',
      label: 'Using Laptop',
      standOffset: [0, 0.78],
      facingOffsetDeg: 180,
      durationGameMins: 35,
      restores: { fun: 38 },
      timeBias: daytimeWorkBias,
    },
  },
  {
    match: (id) => id.includes('televisionModern') || id.includes('speaker'),
    def: {
      actionTag: 'tv',
      label: 'Enjoying TV & Audio',
      standOffset: [0, 1.25],
      facingOffsetDeg: 180,
      durationGameMins: 40,
      restores: { fun: 46, comfort: 15 },
      timeBias: eveningMediaBias,
    },
  },
  {
    match: (id) => id.includes('bookcase') || id.includes('books'),
    def: {
      actionTag: 'read',
      label: 'Browsing Books',
      standOffset: [0, 0.9],
      facingOffsetDeg: 180,
      durationGameMins: 30,
      restores: { fun: 34, comfort: 12 },
    },
  },
  {
    match: (id) => id.includes('pottedPlant') || id.includes('lamp'),
    def: {
      actionTag: 'admire',
      label: 'Checking Decor',
      standOffset: [0, 0.85],
      facingOffsetDeg: 180,
      durationGameMins: 14,
      restores: { fun: 12, comfort: 8 },
    },
  },
];

export function getSmartObjectDef(catalogId: string): SmartObjectDef | null {
  for (const entry of SMART_CATALOG_TABLE) {
    if (entry.match(catalogId)) return entry.def;
  }
  return null;
}

/**
 * Computes world-space approach coordinates `[x, z]` and target facing yaw (radians)
 * for a placed prop.
 */
export function resolveSmartSlot(
  item: PlacedItem,
  def: SmartObjectDef,
): { standXZ: [number, number]; facingYaw: number } {
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const [lx, lz] = def.standOffset;
  const wx = item.position[0] + lx * cos + lz * sin;
  const wz = item.position[2] - lx * sin + lz * cos;
  const facingYaw = rad + (def.facingOffsetDeg * Math.PI) / 180;
  return { standXZ: [wx, wz], facingYaw };
}
